"""Build and verify the canonical EGX history before optional DB-row removal.

Usage (always inspect first):
    python -m api.migrate_egx_history --report history-report.json
    python -m api.migrate_egx_history --publish --report history-report.json
    python -m api.migrate_egx_history --publish --delete-live --report history-report.json

``--delete-live`` requires a verified HF publication and removes *all* EGX
rows from the operational Postgres ``stock_prices`` table, including recent
ones. Do not use it while other application consumers still read that table.
Supabase Storage deletion is handled separately by migrate_storage_archive.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import gzip
import hashlib
import io
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from dotenv import load_dotenv


PRICE_COLUMNS = ["symbol", "exchange", "date", "open", "high", "low", "close", "volume"]
ARCHIVE_BUCKET = "old-stock-data"
EXCLUDED_ARCHIVE_PREFIXES = ("AR/",)
INDEX_SYMBOLS = {"EGX30", "GSPC"}


def _client():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_KEY"]
    return create_client(url, key)


def _read_archive(sb) -> pd.DataFrame:
    files = sb.storage.from_(ARCHIVE_BUCKET).list("", {"limit": 1000, "offset": 0})
    frames: list[pd.DataFrame] = []
    names = [str(item.get("name", "")) for item in files]
    names = [name for name in names if name.endswith(".csv.gz") and not name.startswith(EXCLUDED_ARCHIVE_PREFIXES)]

    def download_one(name: str) -> pd.DataFrame | None:
        symbol = name.removesuffix(".csv.gz").upper()
        if symbol in INDEX_SYMBOLS:
            return None
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                raw = sb.storage.from_(ARCHIVE_BUCKET).download(name)
                break
            except Exception as exc:
                last_error = exc
                time.sleep(0.5 * (attempt + 1))
        else:
            raise RuntimeError(f"Could not download archive object {name}") from last_error
        frame = pd.read_csv(gzip.GzipFile(fileobj=io.BytesIO(raw)))
        # The object name is the canonical archive symbol; do not trust a
        # malformed optional CSV symbol column to relabel another company's bars.
        frame["symbol"] = symbol
        frame["exchange"] = "EGX"
        frame["_source"] = "supabase_archive"
        return frame

    # Storage's HTTP/2 endpoint may reset overly concurrent downloads. Four
    # workers keeps the migration reliable while still avoiding a 200-request
    # serial run.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(download_one, name) for name in names]
        for future in as_completed(futures):
            frame = future.result()
            if frame is not None:
                frames.append(frame)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=PRICE_COLUMNS)


def _read_live(sb) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    offset, page_size = 0, 1000
    while True:
        response = (sb.table("stock_prices").select(
            "symbol,exchange,date,open,high,low,close,volume"
        ).eq("exchange", "EGX").order("symbol").order("date").range(offset, offset + page_size - 1).execute())
        page = response.data or []
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    frame = pd.DataFrame(rows)
    frame["_source"] = "supabase_live"
    return frame


def _clean(frame: pd.DataFrame, source: str) -> tuple[pd.DataFrame, dict[str, int]]:
    if frame.empty:
        return pd.DataFrame(columns=PRICE_COLUMNS + ["_source"]), {"input": 0, "invalid": 0, "duplicates": 0}
    frame = frame.copy()
    frame.columns = [str(col).lower() for col in frame.columns]
    for column in PRICE_COLUMNS:
        if column not in frame:
            frame[column] = None
    frame["symbol"] = frame["symbol"].astype(str).str.upper().str.strip()
    frame["exchange"] = frame["exchange"].astype(str).str.upper().str.strip()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce").dt.normalize()
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    valid = (
        frame["symbol"].ne("") & frame["date"].notna() &
        frame[["open", "high", "low", "close"]].gt(0).all(axis=1) &
        frame["high"].ge(frame[["open", "close", "low"]].max(axis=1)) &
        frame["low"].le(frame[["open", "close", "high"]].min(axis=1)) &
        frame["volume"].ge(0)
    )
    cleaned = frame.loc[valid, PRICE_COLUMNS + ["_source"]].copy()
    before_dedup = len(cleaned)
    cleaned = cleaned.drop_duplicates(["symbol", "exchange", "date"], keep="last")
    return cleaned, {"input": len(frame), "invalid": int((~valid).sum()), "duplicates": before_dedup - len(cleaned)}


def _fingerprint(frame: pd.DataFrame) -> str:
    portable = frame.sort_values(["symbol", "exchange", "date"]).copy()
    portable["date"] = portable["date"].dt.strftime("%Y-%m-%d")
    return hashlib.sha256(portable[PRICE_COLUMNS].to_csv(index=False).encode()).hexdigest()


def _delete_live_rows(sb, symbols: list[str]) -> None:
    # One symbol per request keeps locks/WAL bounded. Do not use a SQL delete on
    # Storage objects; this is strictly the operational Postgres table.
    for symbol in sorted(set(symbols)):
        sb.table("stock_prices").delete().eq("exchange", "EGX").eq("symbol", symbol).execute()
    left = sb.table("stock_prices").select("symbol", count="exact").eq("exchange", "EGX").limit(1).execute().count or 0
    if left:
        raise RuntimeError(f"Refusing completion: {left} EGX live rows remain")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--delete-live", action="store_true")
    parser.add_argument("--report", default="egx-history-migration-report.json")
    args = parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    sb = _client()
    from api.hf_history_cache import load_history_snapshot, publish_history_snapshot, reset_history_cache

    # The destructive phase is intentionally independent from archive download.
    # It accepts only a previously verified manifest and verifies HF again before
    # touching the operational table, which avoids a transient Storage failure
    # blocking an otherwise-safe cutover.
    if args.delete_live and not args.publish:
        report_path = Path(args.report)
        if not report_path.exists():
            parser.error("--delete-live requires a prior verified report")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if not report.get("published") or not report.get("sha256"):
            parser.error("report does not record a verified HF publication")
        reset_history_cache()
        verified, _ = _clean(load_history_snapshot("EGX").assign(_source="verified_hf"), "verified_hf")
        if len(verified) != report.get("canonical_rows") or _fingerprint(verified) != report["sha256"]:
            raise RuntimeError("HF verification failed; Supabase was not changed")
        live, _ = _clean(_read_live(sb), "supabase_live")
        _delete_live_rows(sb, live["symbol"].astype(str).tolist())
        left = sb.table("stock_prices").select("symbol", count="exact").eq("exchange", "EGX").limit(1).execute().count or 0
        if left:
            raise RuntimeError(f"Refusing completion: {left} EGX live rows remain")
        report["deleted_live"] = True
        report["deleted_at"] = datetime.now(timezone.utc).isoformat()
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    archive, archive_stats = _clean(_read_archive(sb), "supabase_archive")
    current_hf, hf_stats = _clean(load_history_snapshot("EGX").assign(_source="hf_snapshot"), "hf_snapshot")
    live, live_stats = _clean(_read_live(sb), "supabase_live")
    # Later sources win only after each source has independently passed OHLC validation.
    canonical = pd.concat([archive, current_hf, live], ignore_index=True)
    conflicts = canonical.duplicated(["symbol", "exchange", "date"], keep=False)
    canonical = canonical.drop_duplicates(["symbol", "exchange", "date"], keep="last")
    canonical = canonical.sort_values(["symbol", "date"]).reset_index(drop=True)
    canonical["return"] = canonical.groupby("symbol")["close"].pct_change()
    large_moves = canonical[canonical["return"].abs() > 0.50]
    canonical = canonical.drop(columns="return")
    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sources": {"archive": archive_stats, "hf": hf_stats, "live": live_stats},
        "canonical_rows": len(canonical), "symbols": int(canonical["symbol"].nunique()),
        "first_date": canonical["date"].min().date().isoformat(),
        "last_date": canonical["date"].max().date().isoformat(),
        "overlapping_rows": int(conflicts.sum()), "large_price_moves_over_50pct": int(len(large_moves)),
        "zero_volume_rows": int((canonical["volume"] == 0).sum()), "sha256": _fingerprint(canonical),
        "published": False, "deleted_live": False,
    }
    if args.publish:
        metadata = publish_history_snapshot("EGX", canonical[PRICE_COLUMNS])
        reset_history_cache()
        verified = load_history_snapshot("EGX")
        verified, _ = _clean(verified.assign(_source="verified_hf"), "verified_hf")
        if len(verified) != len(canonical) or _fingerprint(verified) != report["sha256"]:
            raise RuntimeError("HF verification failed; Supabase was not changed")
        report["published"] = True
        report["hf_metadata"] = metadata
    if args.delete_live:
        _delete_live_rows(sb, live["symbol"].astype(str).tolist())
        report["deleted_live"] = True
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
