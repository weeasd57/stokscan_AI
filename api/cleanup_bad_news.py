#!/usr/bin/env python3
"""
One-time cleanup script for stock_news_sentiment.
Scans all rows with news_count > 0 and zeroes out headlines that are
unrelated to the stock's symbol/company name.
Uses ThreadPoolExecutor for parallel updates.
"""
import os
import sys
import json
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
from api.stock_ai import _init_supabase, supabase
from api.news_sentiment_engine import is_relevant_news, is_unrelated_news, get_symbol_search_terms

parser = argparse.ArgumentParser()
parser.add_argument("--force", action="store_true", help="Skip confirmation prompt")
parser.add_argument("--workers", type=int, default=20, help="Parallel workers")
args = parser.parse_args()

load_dotenv()
_init_supabase()

if not supabase:
    print("❌ Supabase not initialized")
    sys.exit(1)

print("[CLEANUP] Loading stock symbol->name map...")
stocks_res = supabase.table("stocks").select("symbol, name").execute()
stocks = stocks_res.data or []
name_map = {row["symbol"].upper(): (row.get("name") or "") for row in stocks}
print(f"[CLEANUP] Loaded {len(name_map)} stocks")

print("[CLEANUP] Fetching stock_news_sentiment rows with news_count > 0...")
all_news = []
page_size = 1000
offset = 0
while True:
    res = (
        supabase.table("stock_news_sentiment")
        .select("symbol, exchange, date, news_count, headlines, sources")
        .gt("news_count", 0)
        .order("date", desc=True)
        .range(offset, offset + page_size - 1)
        .execute()
    )
    batch = res.data or []
    all_news.extend(batch)
    if len(batch) < page_size:
        break
    offset += page_size

print(f"[CLEANUP] Fetched {len(all_news)} news rows")

bad_rows = []
clean_rows = []
for row in all_news:
    sym = (row.get("symbol") or "").upper()
    name = name_map.get(sym, "") or ""
    headlines = row.get("headlines") or []
    if not isinstance(headlines, list):
        headlines = []
    valid_headlines = [hl for hl in headlines if is_relevant_news(hl, sym, name) and not is_unrelated_news(hl)]
    if len(valid_headlines) != len(headlines):
        bad_rows.append({
            "symbol": sym,
            "exchange": row.get("exchange"),
            "date": row.get("date"),
            "old_count": row.get("news_count", 0),
            "new_count": len(valid_headlines),
            "removed": len(headlines) - len(valid_headlines),
            "removed_headlines": [hl for hl in headlines if hl not in valid_headlines][:3],
        })
        clean_rows.append({
            "symbol": sym,
            "exchange": row.get("exchange"),
            "date": row.get("date"),
            "news_count": len(valid_headlines),
            "headlines": valid_headlines,
            "sources": row.get("sources") or [],
        })

print(f"[CLEANUP] Rows with bad headlines: {len(bad_rows)}")
if bad_rows and not args.force:
    print("\n[SAMPLE] Bad entries (first 10):")
    for entry in bad_rows[:10]:
        print(json.dumps(entry, ensure_ascii=False))
    resp = input("\nProceed with cleanup? (yes/no): ").strip().lower()
    if resp != "yes":
        print("[CLEANUP] Aborted by user.")
        sys.exit(0)

progress_lock = Lock()
fixed = 0
errors = 0

def update_row(row: dict) -> bool:
    global fixed, errors
    try:
        supabase.table("stock_news_sentiment") \
            .update({
                "news_count": row["news_count"],
                "headlines": row["headlines"],
                "sources": row["sources"],
            }) \
            .eq("symbol", row["symbol"]) \
            .eq("exchange", row["exchange"]) \
            .eq("date", row["date"]) \
            .execute()
        with progress_lock:
            fixed += 1
        return True
    except Exception as e:
        with progress_lock:
            errors += 1
        print(f"[CLEANUP] Error updating {row['symbol']} {row['date']}: {e}")
        return False

print(f"[CLEANUP] Starting parallel update with {args.workers} workers...")
with ThreadPoolExecutor(max_workers=args.workers) as executor:
    futures = [executor.submit(update_row, row) for row in clean_rows]
    for i, future in enumerate(as_completed(futures), 1):
        future.result()
        if i % 100 == 0:
            print(f"[CLEANUP] Progress: {i}/{len(clean_rows)}")

print(f"\n[CLEANUP] Done. Updated {fixed} rows, {errors} errors.")
if bad_rows:
    print(f"[CLEANUP] Total rows with bad headlines found: {len(bad_rows)}")
