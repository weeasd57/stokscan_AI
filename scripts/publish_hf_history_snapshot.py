"""Seed or manually refresh the private Hugging Face price-history Dataset.

Run from the project root after setting HF_HISTORY_DATASET_REPO and HF_TOKEN.
It reads the current authoritative `stock_prices` rows from Supabase once and
publishes a compressed EGX snapshot. The runtime then reads that archive plus a
small fresh Supabase tail instead of downloading all history on every scan.
"""
from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List

import pandas as pd
from dotenv import load_dotenv


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
load_dotenv(os.path.join(ROOT, ".env"))


def fetch_exchange_prices(exchange: str) -> pd.DataFrame:
    from api.stock_ai import _init_supabase, supabase

    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not configured")
    rows: List[Dict[str, Any]] = []
    page_size = 1000

    def load_page(offset: int, include_count: bool = False):
        columns = "symbol,exchange,date,open,high,low,close,volume"
        table = supabase.table("stock_prices")
        query = table.select(columns, count="exact") if include_count else table.select(columns)
        query = (
            query.eq("exchange", exchange.upper())
            .order("symbol", desc=False)
            .order("date", desc=False)
            .range(offset, offset + page_size - 1)
        )
        return query.execute()

    first = load_page(0, include_count=True)
    rows.extend(first.data or [])
    total = int(first.count or len(rows))
    offsets = list(range(page_size, total, page_size))
    # This is an explicit, one-time seed. Parallel pages reduce its wall-clock
    # time without changing the much smaller runtime correction window.
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(load_page, offset) for offset in offsets]
        for future in as_completed(futures):
            rows.extend(future.result().data or [])
    return pd.DataFrame(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exchange", default="EGX")
    args = parser.parse_args()

    if not os.getenv("HF_HISTORY_DATASET_REPO"):
        raise RuntimeError("Set HF_HISTORY_DATASET_REPO to a private Dataset repo before publishing")

    from api.hf_history_cache import publish_history_snapshot

    frame = fetch_exchange_prices(args.exchange)
    metadata = publish_history_snapshot(args.exchange, frame)
    print(f"Published {metadata['rows']} {metadata['exchange']} rows through {metadata['last_date']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
