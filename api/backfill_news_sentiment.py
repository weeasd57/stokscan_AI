#!/usr/bin/env python3
"""
Backfill stock_news_sentiment rows per publish date.

The daily engine only ever writes one row per symbol per *run date*, so the
window where fetching was broken (2026-08-25 .. 2026-09-14) contains only empty
rows. This script fetches a wider Google News window once per symbol, buckets
the items by their publish date, and upserts one aggregated row per
(symbol, date) — filling the gap with real, relevance-checked news.

Usage:
    python api/backfill_news_sentiment.py --days 21 --dry-run
    python api/backfill_news_sentiment.py --days 21 --apply

Notes:
- Existing rows are only overwritten for dates where news was found; a date with
  no news keeps whatever it already has (never overwritten with an empty row).
- Relevance checking uses the Arabic aliases from the `stocks` table, which is
  what allows Arabic-only headlines to be stored at all.
"""
import argparse
import collections
import os
import sys
import time
from datetime import date, timedelta

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

from api.stock_ai import _init_supabase, supabase
from api.news_sentiment_engine import (
    analyze_sentiment,
    fetch_google_news,
    load_company_names,
)


def _active_symbols(client, exchange: str) -> list:
    res = (
        client.table("stocks")
        .select("symbol,exchange,is_active")
        .eq("exchange", exchange)
        .execute()
    )
    out = []
    seen = set()
    for row in res.data or []:
        sym = str(row.get("symbol") or "").upper().strip()
        if not sym or sym in seen:
            continue
        if row.get("is_active") is False:
            continue
        seen.add(sym)
        out.append(sym)
    return sorted(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=21, help="How many days back to fetch")
    parser.add_argument("--exchange", default="EGX")
    parser.add_argument("--symbols", nargs="*", default=None, help="Limit to these symbols")
    parser.add_argument("--limit", type=int, default=0, help="Only process the first N symbols")
    parser.add_argument("--offset", type=int, default=0, help="Skip the first N symbols (chunked runs)")
    parser.add_argument("--apply", action="store_true", help="Write to Supabase (default: dry run)")
    parser.add_argument("--sleep", type=float, default=0.3, help="Delay between symbols")
    args = parser.parse_args()

    load_dotenv()
    _init_supabase()
    client = supabase
    if not client:
        print("Supabase not initialized")
        return 1

    symbols = [s.upper() for s in args.symbols] if args.symbols else _active_symbols(client, args.exchange)
    if args.offset:
        symbols = symbols[args.offset :]
    if args.limit:
        symbols = symbols[: args.limit]
    if not symbols:
        print("No symbols to process")
        return 1

    name_map = load_company_names(client)
    cutoff = date.today() - timedelta(days=args.days)
    print(
        f"[BACKFILL] {len(symbols)} symbols | window {cutoff}..{date.today()} | "
        f"{'APPLY' if args.apply else 'DRY RUN'}"
    )

    rows_written = 0
    symbols_with_news = 0
    date_counts = collections.Counter()
    errors = 0

    for idx, symbol in enumerate(symbols, 1):
        aliases = name_map.get(symbol, [])
        try:
            items = fetch_google_news(symbol, days_back=args.days, company_names=aliases)
        except Exception as exc:  # network failure must not abort the whole backfill
            errors += 1
            print(f"[BACKFILL] {symbol}: fetch error {exc}")
            continue

        if not items:
            if idx % 25 == 0:
                print(f"[BACKFILL] {idx}/{len(symbols)} processed — no news for {symbol}")
            time.sleep(args.sleep)
            continue

        by_date = collections.defaultdict(list)
        for item in items:
            published = str(item.get("published") or "")[:10]
            if published:
                by_date[published].append(item)

        symbols_with_news += 1
        for published, day_items in sorted(by_date.items()):
            sentiment = analyze_sentiment(day_items)
            if sentiment["news_count"] <= 0:
                continue
            payload = {
                "symbol": symbol,
                "exchange": args.exchange,
                "date": published,
                "sentiment_score": sentiment["sentiment_score"],
                "news_count": sentiment["news_count"],
                "negative_flag": sentiment["negative_flag"],
                "positive_flag": sentiment["positive_flag"],
                "headlines": sentiment["headlines"],
                "sources": sentiment["sources"],
            }
            date_counts[published] += 1
            if args.apply:
                client.table("stock_news_sentiment").upsert(
                    payload, on_conflict="symbol,date"
                ).execute()
            rows_written += 1

        if idx % 25 == 0 or idx == len(symbols):
            print(f"[BACKFILL] {idx}/{len(symbols)} processed — {rows_written} rows, {symbols_with_news} symbols with news")
        time.sleep(args.sleep)

    print(
        f"\n[BACKFILL] Done. symbols_with_news={symbols_with_news}/{len(symbols)} "
        f"rows={'written' if args.apply else 'would write'}={rows_written} errors={errors}"
    )
    if date_counts:
        print("[BACKFILL] rows per date:", dict(sorted(date_counts.items(), reverse=True)[:20]))
    if not args.apply:
        print("[BACKFILL] Dry run only — re-run with --apply to persist.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
