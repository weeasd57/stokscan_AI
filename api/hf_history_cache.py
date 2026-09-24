"""Versioned EGX price-history snapshots stored in a private HF Dataset.

The Space filesystem is ephemeral, so it must never be treated as a database.
This module keeps a read-only, compressed history snapshot in a Hugging Face
Dataset repository and lets Supabase provide only a small, recent correction
window.  Supabase remains the source of truth for live and operational data.
"""
from __future__ import annotations

import gzip
import io
import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional

import pandas as pd


_CACHE_LOCK = threading.RLock()
_FRAME_CACHE: Dict[str, pd.DataFrame] = {}
_META_CACHE: Dict[str, Dict[str, Any]] = {}

_PRICE_COLUMNS = ["symbol", "exchange", "date", "open", "high", "low", "close", "volume"]


def _repo_id() -> str:
    """Dataset storage is opt-in so local/test installations retain old behavior."""
    return os.getenv("HF_HISTORY_DATASET_REPO", "").strip()


def _token() -> Optional[str]:
    return os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")


def _history_path(exchange: str) -> str:
    return f"prices/{exchange.upper()}/stock_prices.json.gz"


def _metadata_path(exchange: str) -> str:
    return f"prices/{exchange.upper()}/metadata.json"


def _empty_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=_PRICE_COLUMNS)


def _normalise_frame(value: pd.DataFrame) -> pd.DataFrame:
    if value is None or value.empty:
        return _empty_frame()
    frame = value.copy()
    frame.columns = [str(column).lower() for column in frame.columns]
    if "date" not in frame and isinstance(frame.index, pd.DatetimeIndex):
        frame = frame.reset_index().rename(columns={frame.index.name or "index": "date"})
    has_prices = all(column in frame.columns for column in ("open", "high", "low", "close", "volume"))
    for column in _PRICE_COLUMNS:
        if column not in frame:
            frame[column] = None
    frame = frame[_PRICE_COLUMNS]
    frame["symbol"] = frame["symbol"].astype(str).str.upper()
    frame["exchange"] = frame["exchange"].astype(str).str.upper()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame.dropna(subset=["date", "symbol", "exchange"])
    if has_prices:
        for column in ("open", "high", "low", "close", "volume"):
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
        valid = (
            frame[["open", "high", "low", "close"]].gt(0).all(axis=1)
            & frame["high"].ge(frame[["open", "close", "low"]].max(axis=1))
            & frame["low"].le(frame[["open", "close", "high"]].min(axis=1))
            & frame["volume"].ge(0)
        )
        frame = frame.loc[valid]
    return frame.drop_duplicates(["symbol", "exchange", "date"], keep="last").sort_values(["symbol", "date"])


def load_history_snapshot(exchange: str) -> pd.DataFrame:
    """Load a full, versioned history snapshot without querying Supabase.

    Failures intentionally return an empty frame. Callers then use their
    existing Supabase loading path, so an unavailable HF Hub never blocks the
    daily job or scanner.
    """
    exchange = (exchange or "").upper()
    repo_id = _repo_id()
    if not exchange or not repo_id:
        return _empty_frame()

    with _CACHE_LOCK:
        cached = _FRAME_CACHE.get(exchange)
        if cached is not None:
            return cached.copy()

    try:
        from huggingface_hub import hf_hub_download

        downloaded = hf_hub_download(
            repo_id=repo_id,
            repo_type="dataset",
            filename=_history_path(exchange),
            token=_token(),
        )
        with gzip.open(downloaded, "rt", encoding="utf-8") as source:
            records = json.load(source)
        frame = _normalise_frame(pd.DataFrame(records))

        try:
            metadata_file = hf_hub_download(
                repo_id=repo_id,
                repo_type="dataset",
                filename=_metadata_path(exchange),
                token=_token(),
            )
            with open(metadata_file, "r", encoding="utf-8") as source:
                metadata = json.load(source)
        except Exception:
            metadata = {}

        with _CACHE_LOCK:
            _FRAME_CACHE[exchange] = frame
            _META_CACHE[exchange] = metadata if isinstance(metadata, dict) else {}
        print(f"[HF-HISTORY] Loaded {len(frame)} {exchange} history rows from {repo_id}.")
        return frame.copy()
    except Exception as exc:
        print(f"[HF-HISTORY] Snapshot unavailable for {exchange}; using Supabase fallback: {exc}")
        return _empty_frame()


def snapshot_metadata(exchange: str) -> Dict[str, Any]:
    load_history_snapshot(exchange)
    with _CACHE_LOCK:
        return dict(_META_CACHE.get((exchange or "").upper(), {}))


def load_symbol_history_snapshot(exchange: str, symbol: str) -> pd.DataFrame:
    """Read one symbol without copying the whole cached exchange on each chart request."""
    exchange = (exchange or "").upper()
    symbol = (symbol or "").upper()
    with _CACHE_LOCK:
        cached = _FRAME_CACHE.get(exchange)
        if cached is not None:
            return cached.loc[cached["symbol"] == symbol].copy()
    frame = load_history_snapshot(exchange)
    return frame.loc[frame["symbol"] == symbol].copy()


def merge_snapshot_with_live(snapshot: pd.DataFrame, live_rows: Any) -> pd.DataFrame:
    """Merge a static snapshot with newer Supabase rows; live data wins ties."""
    source_rows = live_rows if isinstance(live_rows, pd.DataFrame) else (live_rows or [])
    live = _normalise_frame(pd.DataFrame(source_rows))
    static = _normalise_frame(snapshot)
    if static.empty:
        return live
    if live.empty:
        return static
    combined = pd.concat([static, live], ignore_index=True)
    return _normalise_frame(combined)


def history_for_exchange_with_live_tail(exchange: str, live_rows: Any) -> pd.DataFrame:
    """Return the canonical historical frame with Supabase rows taking priority.

    Callers deliberately supply only the recent operational tail.  This makes
    the immutable Dataset revision the source for old bars while preserving the
    live database as the correction source for recent sessions.
    """
    return merge_snapshot_with_live(load_history_snapshot(exchange), live_rows)


def tail_start_date(snapshot: pd.DataFrame, days: int = 45) -> Optional[str]:
    """Return a bounded correction window that safely overwrites stale bars."""
    frame = _normalise_frame(snapshot)
    if frame.empty:
        return None
    last_date = pd.Timestamp(frame["date"].max())
    return (last_date - pd.Timedelta(days=max(1, int(days)))).date().isoformat()


def _serialise_records(frame: pd.DataFrame) -> bytes:
    clean = _normalise_frame(frame)
    clean["date"] = clean["date"].dt.strftime("%Y-%m-%d")
    for column in ("open", "high", "low", "close", "volume"):
        clean[column] = pd.to_numeric(clean[column], errors="coerce")
        clean[column] = clean[column].astype(object).where(clean[column].notna(), None)
    raw = json.dumps(clean.to_dict("records"), separators=(",", ":"), allow_nan=False).encode("utf-8")
    return gzip.compress(raw, compresslevel=6)


def publish_history_snapshot(exchange: str, frame: pd.DataFrame) -> Dict[str, Any]:
    """Atomically publish a new private dataset snapshot.

    This is designed for an explicit seed or a low-frequency rebase, never for
    every visitor request. The caller is responsible for ensuring the Dataset
    repository itself is private when market-data licensing requires it.
    """
    repo_id = _repo_id()
    exchange = (exchange or "").upper()
    clean = _normalise_frame(frame)
    if not repo_id:
        raise RuntimeError("HF_HISTORY_DATASET_REPO is not configured")
    if clean.empty:
        raise ValueError("Refusing to publish an empty history snapshot")

    from huggingface_hub import CommitOperationAdd, HfApi

    payload = _serialise_records(clean)
    metadata = {
        "exchange": exchange,
        "rows": int(len(clean)),
        "first_date": clean["date"].min().date().isoformat(),
        "last_date": clean["date"].max().date().isoformat(),
        "published_at": datetime.now(timezone.utc).isoformat(),
        "format": "json.gz",
    }
    with tempfile.TemporaryDirectory(prefix="hf-history-") as temp_dir:
        history_file = os.path.join(temp_dir, "stock_prices.json.gz")
        metadata_file = os.path.join(temp_dir, "metadata.json")
        with open(history_file, "wb") as target:
            target.write(payload)
        with open(metadata_file, "w", encoding="utf-8") as target:
            json.dump(metadata, target, ensure_ascii=False, separators=(",", ":"))

        HfApi(token=_token()).create_commit(
            repo_id=repo_id,
            repo_type="dataset",
            operations=[
                CommitOperationAdd(path_in_repo=_history_path(exchange), path_or_fileobj=history_file),
                CommitOperationAdd(path_in_repo=_metadata_path(exchange), path_or_fileobj=metadata_file),
            ],
            commit_message=f"Refresh {exchange} price history through {metadata['last_date']}",
        )

    with _CACHE_LOCK:
        _FRAME_CACHE[exchange] = clean
        _META_CACHE[exchange] = metadata
    print(f"[HF-HISTORY] Published {len(clean)} {exchange} history rows to {repo_id}.")
    return metadata


def frame_from_symbol_map(exchange: str, data_by_symbol: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    """Convert the scanner's per-symbol frames back into portable rows."""
    rows = []
    for symbol, frame in (data_by_symbol or {}).items():
        if not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        current = frame.copy().reset_index()
        date_column = current.columns[0]
        current = current.rename(columns={
            date_column: "date",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        })
        current["symbol"] = str(symbol).upper()
        current["exchange"] = str(exchange).upper()
        rows.append(current)
    return _normalise_frame(pd.concat(rows, ignore_index=True)) if rows else _empty_frame()


def should_rebase_snapshot(exchange: str, days: int = 30) -> bool:
    """Limit Dataset writes; recent Supabase tail keeps the scanner current."""
    if not _repo_id():
        return False
    metadata = snapshot_metadata(exchange)
    try:
        last_date = pd.Timestamp(metadata.get("last_date")).date()
    except Exception:
        return True
    return (datetime.now(timezone.utc).date() - last_date).days >= max(1, int(days))


def reset_history_cache() -> None:
    """Test/support helper; the remote dataset is never modified."""
    with _CACHE_LOCK:
        _FRAME_CACHE.clear()
        _META_CACHE.clear()
