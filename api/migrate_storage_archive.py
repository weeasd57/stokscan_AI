"""Move the exact legacy Storage objects to the private HF Dataset.

Run a report, then publish and verify, then remove the same verified objects:
    python -m api.migrate_storage_archive
    python -m api.migrate_storage_archive --publish
    python -m api.migrate_storage_archive --delete-storage

Only the old-stock-data bucket is in scope. The raw compressed files are kept
byte-for-byte on HF, including index and crypto files. A cleaned INDX snapshot
is also published so training can read its full historical market context.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import io
import json
import os
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

from api.hf_history_cache import (
    load_history_snapshot, merge_snapshot_with_live, publish_history_snapshot,
    reset_history_cache,
)
from api.migrate_egx_history import _clean, _fingerprint, PRICE_COLUMNS


BUCKET = "old-stock-data"
HF_PREFIX = "source_archives/supabase/old-stock-data"
REPORT_PATH = Path("egx-storage-migration-report.json")


def _list_objects(bucket, folder: str = "") -> list[str]:
    paths: list[str] = []
    offset = 0
    while True:
        page = bucket.list(folder, {"limit": 1000, "offset": offset})
        for item in page:
            name = str(item.get("name") or "")
            if not name or name in (".", "..") or "/" in name:
                raise RuntimeError(f"Unexpected Storage object name: {name!r}")
            path = f"{folder}/{name}" if folder else name
            if item.get("id"):
                if not path.endswith(".csv.gz"):
                    raise RuntimeError(f"Unexpected non-CSV object: {path}")
                paths.append(path)
            else:
                paths.extend(_list_objects(bucket, path))
        if len(page) < 1000:
            break
        offset += len(page)
    return sorted(paths)


def _read_objects(bucket, paths: list[str]) -> dict[str, bytes]:
    def download(path: str) -> tuple[str, bytes]:
        last_error = None
        for attempt in range(4):
            try:
                return path, bucket.download(path)
            except Exception as exc:
                last_error = exc
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"Could not download {path} after four attempts") from last_error

    with ThreadPoolExecutor(max_workers=2) as pool:
        return dict(pool.map(download, paths))


def _data_frame(raw: bytes, symbol: str, exchange: str) -> pd.DataFrame:
    frame = pd.read_csv(gzip.GzipFile(fileobj=io.BytesIO(raw)))
    frame["symbol"] = symbol
    frame["exchange"] = exchange
    frame["_source"] = "storage_archive"
    clean, stats = _clean(frame, "storage_archive")
    if stats["invalid"] or stats["duplicates"] or stats["input"] != len(clean):
        raise RuntimeError(f"Archive file {symbol}.{exchange} has invalid or duplicate rows: {stats}")
    return clean


def _check_stock_coverage(objects: dict[str, bytes]) -> tuple[int, pd.DataFrame]:
    snapshot = load_history_snapshot("EGX")
    if snapshot.empty:
        raise RuntimeError("EGX HF snapshot is unavailable; refusing Storage migration")
    hf_keys = set(zip(snapshot["symbol"], snapshot["date"].dt.strftime("%Y-%m-%d")))
    rows = 0
    index_frames: list[pd.DataFrame] = []
    for path, raw in objects.items():
        if path == "AR/USDT.csv.gz":
            _data_frame(raw, "AR/USDT", "BINANCE")
        elif path in ("EGX30.csv.gz", "GSPC.csv.gz"):
            index_frames.append(_data_frame(raw, path.removesuffix(".csv.gz"), "INDX"))
        elif "/" not in path:
            symbol = path.removesuffix(".csv.gz")
            frame = _data_frame(raw, symbol, "EGX")
            keys = set(zip(frame["symbol"], frame["date"].dt.strftime("%Y-%m-%d")))
            missing = keys - hf_keys
            if missing:
                raise RuntimeError(f"{len(missing)} {symbol} archive dates are absent from HF")
            rows += len(frame)
        else:
            raise RuntimeError(f"Unexpected archive path: {path}")
    if not index_frames:
        raise RuntimeError("The legacy index files are missing")
    return rows, pd.concat(index_frames, ignore_index=True)


def _read_live_index(sb) -> pd.DataFrame:
    rows = []
    for symbol in ("EGX30", "GSPC"):
        offset = 0
        while True:
            page = (sb.table("stock_prices")
                    .select("symbol,exchange,date,open,high,low,close,volume")
                    .eq("exchange", "INDX").eq("symbol", symbol)
                    .order("date").range(offset, offset + 999).execute()).data or []
            rows.extend(page)
            if len(page) < 1000:
                break
            offset += len(page)
    frame = pd.DataFrame(rows)
    if frame.empty:
        return pd.DataFrame(columns=PRICE_COLUMNS + ["_source"])
    frame["_source"] = "supabase_live"
    clean, _ = _clean(frame, "supabase_live")
    return clean


def _verify_hf_files(repo: str, revision: str, hashes: dict[str, str], token: str | None) -> None:
    from huggingface_hub import hf_hub_download

    def verify(item: tuple[str, str]) -> None:
        path, expected = item
        local = hf_hub_download(
            repo_id=repo, repo_type="dataset", revision=revision,
            filename=f"{HF_PREFIX}/{path}", token=token,
        )
        with open(local, "rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if actual != expected:
            raise RuntimeError(f"HF checksum differs for {path}")

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(verify, hashes.items()))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--delete-storage", action="store_true")
    parser.add_argument("--report", type=Path, default=REPORT_PATH)
    args = parser.parse_args()
    if args.publish and args.delete_storage:
        parser.error("Publish and delete are separate verification phases")
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    from supabase import create_client
    from huggingface_hub import CommitOperationAdd, HfApi

    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_KEY"],
    )
    repo = os.environ["HF_HISTORY_DATASET_REPO"]
    token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")
    api = HfApi(token=token)
    if not api.repo_info(repo, repo_type="dataset").private:
        raise RuntimeError("The destination HF Dataset must be private")
    bucket = sb.storage.from_(BUCKET)
    paths = _list_objects(bucket)
    if not paths:
        raise RuntimeError("The source bucket contains no archive files")
    objects = _read_objects(bucket, paths)
    hashes = {path: hashlib.sha256(raw).hexdigest() for path, raw in objects.items()}

    if args.delete_storage:
        report = json.loads(args.report.read_text(encoding="utf-8"))
        if (not report.get("verified") or report.get("bucket") != BUCKET or
                report.get("hf_repo") != repo or report.get("hashes") != hashes):
            raise RuntimeError("Source objects differ from the verified HF manifest")
        _verify_hf_files(repo, report["hf_revision"], hashes, token)
        reset_history_cache()
        index_snapshot = load_history_snapshot("INDX")
        if index_snapshot.empty or _fingerprint(index_snapshot) != report["index_sha256"]:
            raise RuntimeError("HF index snapshot differs from the verified report")
        for start in range(0, len(paths), 100):
            bucket.remove(paths[start:start + 100])
        remaining = _list_objects(bucket)
        if remaining:
            raise RuntimeError(f"Storage deletion incomplete: {len(remaining)} objects remain")
        report["deleted_storage"] = True
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"deleted_storage_objects": len(paths), "hf_revision": report["hf_revision"]}))
        return

    stock_rows, index_archive = _check_stock_coverage(objects)
    report = {
        "bucket": BUCKET, "hf_repo": repo, "objects": len(paths),
        "compressed_bytes": sum(map(len, objects.values())),
        "verified_stock_rows": stock_rows, "hashes": hashes,
        "verified": False, "deleted_storage": False,
    }
    if args.publish:
        operations = [
            CommitOperationAdd(path_in_repo=f"{HF_PREFIX}/{path}", path_or_fileobj=io.BytesIO(raw))
            for path, raw in objects.items()
        ]
        result = api.create_commit(
            repo_id=repo, repo_type="dataset", operations=operations,
            commit_message="Preserve verified legacy Supabase Storage archive",
        )
        revision = result.oid
        _verify_hf_files(repo, revision, hashes, token)

        prior_index = load_history_snapshot("INDX")
        live_index = _read_live_index(sb)
        merged = merge_snapshot_with_live(prior_index, index_archive[PRICE_COLUMNS])
        merged = merge_snapshot_with_live(merged, live_index[PRICE_COLUMNS])
        publish_history_snapshot("INDX", merged)
        reset_history_cache()
        verified_index = load_history_snapshot("INDX")
        if len(verified_index) != len(merged) or _fingerprint(verified_index) != _fingerprint(merged):
            raise RuntimeError("HF index snapshot verification failed")
        report.update({
            "hf_revision": revision, "index_rows": len(verified_index),
            "index_sha256": _fingerprint(verified_index), "verified": True,
        })
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "hashes"}, indent=2))


if __name__ == "__main__":
    main()
