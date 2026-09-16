#!/usr/bin/env python3
"""
Repair existing stock_news_sentiment / corporate_actions data.

Modes (all default to a dry run; pass --apply to persist):
  --mode sources   Rows whose headlines were removed but sources/sentiment stayed
                   (produced by the old cleanup script) are reset to a clean
                   empty state: news_count=0, headlines=[], sources=[],
                   sentiment_score=0, flags=0.
  --mode symbols   Rows attached to symbols that do not exist in `stocks`
                   (NULL / delisted tickers). Known renames are merged into the
                   canonical row; empty rows are deleted.
  --mode revalidate Re-filter stored headlines with the current relevance rules
                   and recompute sentiment from the headlines that survive.
                   Symbols without any registered name are reported, not changed.
  --mode corporate-actions
                   Drop duplicate corporate-action rows: exact duplicates plus
                   rows sharing one source URL across several symbols when the
                   title identifies only one of them.

Usage:
    python api/repair_news_data.py --mode sources
    python api/repair_news_data.py --mode sources --apply
"""
import argparse
import collections
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

from api.stock_ai import _init_supabase, supabase
from api.news_sentiment_engine import (
    analyze_sentiment,
    is_relevant_news,
    is_unrelated_news,
    load_company_names,
    _normalize_arabic,
)

# Delisted/renamed tickers that still have news rows:
#   CIB  -> COMI : old ticker of the Commercial International Bank
#   MNHD -> MASR : old ticker of Madinet Masr (headline explicitly says
#                  "MNHD ... Madinet Masr")
SYMBOL_REMAP = {
    "CIB": "COMI",
    "MNHD": "MASR",
}


def fetch_all(client, table, fields, order="id", page=1000):
    out = []
    offset = 0
    while True:
        batch = (
            client.table(table).select(fields).order(order).range(offset, offset + page - 1).execute().data
            or []
        )
        out.extend(batch)
        if len(batch) < page:
            return out
        offset += page


def load_stock_symbols(client):
    rows = fetch_all(client, "stocks", "symbol,name,name_ar", order="symbol")
    return {str(r.get("symbol") or "").upper() for r in rows if r.get("symbol")}


def repair_sources(client, apply):
    rows = fetch_all(
        client,
        "stock_news_sentiment",
        "id,symbol,exchange,date,news_count,headlines,sources,sentiment_score,negative_flag,positive_flag",
    )
    targets = []
    for row in rows:
        headlines = row.get("headlines") or []
        sources = row.get("sources") or []
        count = int(row.get("news_count") or 0)
        has_headlines = isinstance(headlines, list) and any(str(h).strip() for h in headlines)
        if count > 0 and not has_headlines:
            targets.append((row, "positive_count_without_headlines"))
        elif count == 0 and sources:
            targets.append((row, "sources_without_headlines"))
    print(f"[REPAIR:sources] rows needing cleanup: {len(targets)}")
    for row, reason in targets[:10]:
        print(f"  - {row['symbol']} {row['date']} ({reason}) sources={row.get('sources')}")
    if not apply:
        return len(targets)
    fixed = 0
    for row, _reason in targets:
        client.table("stock_news_sentiment").update({
            "news_count": 0,
            "headlines": [],
            "sources": [],
            "sentiment_score": 0,
            "negative_flag": 0,
            "positive_flag": 0,
        }).eq("id", row["id"]).execute()
        fixed += 1
    print(f"[REPAIR:sources] reset {fixed} rows")
    return fixed


def repair_symbols(client, apply):
    valid = load_stock_symbols(client)
    rows = fetch_all(
        client,
        "stock_news_sentiment",
        "id,symbol,exchange,date,news_count,headlines,sources,sentiment_score,negative_flag,positive_flag",
    )
    unknown = [r for r in rows if str(r.get("symbol") or "").upper() not in valid]
    print(f"[REPAIR:symbols] rows with unknown symbols: {len(unknown)}")
    planned_delete, planned_merge = [], []
    for row in unknown:
        sym = str(row.get("symbol") or "").upper()
        count = int(row.get("news_count") or 0)
        headlines = [h for h in (row.get("headlines") or []) if str(h).strip()]
        target = SYMBOL_REMAP.get(sym)
        print(f"  - id={row['id']} {sym} {row['date']} news_count={count} headlines={headlines[:1]}")
        if target and target in valid:
            planned_merge.append((row, target))
        elif count == 0 and not headlines:
            planned_delete.append(row)
        else:
            print(f"    ! kept for manual review (no safe target)")
    if not apply:
        print(f"[REPAIR:symbols] would merge {len(planned_merge)}, delete {len(planned_delete)}")
        return len(planned_merge) + len(planned_delete)

    merged = 0
    for row, target in planned_merge:
        existing = (
            client.table("stock_news_sentiment")
            .select("id,headlines,sources")
            .eq("symbol", target)
            .eq("date", row["date"])
            .limit(1)
            .execute()
            .data
            or []
        )
        incoming = [h for h in (row.get("headlines") or []) if str(h).strip()]
        if existing:
            base = existing[0]
            combined = list(dict.fromkeys([*(base.get("headlines") or []), *incoming]))
            sentiment = analyze_sentiment([
                {"title": h, "link": "", "published": row.get("date"), "source": "merge"} for h in combined
            ])
            client.table("stock_news_sentiment").update({
                "headlines": sentiment["headlines"],
                "news_count": sentiment["news_count"],
                "sources": sentiment["sources"],
                "sentiment_score": sentiment["sentiment_score"],
                "negative_flag": sentiment["negative_flag"],
                "positive_flag": sentiment["positive_flag"],
            }).eq("id", base["id"]).execute()
            client.table("stock_news_sentiment").delete().eq("id", row["id"]).execute()
        else:
            client.table("stock_news_sentiment").update({"symbol": target}).eq("id", row["id"]).execute()
        merged += 1

    deleted = 0
    for row in planned_delete:
        client.table("stock_news_sentiment").delete().eq("id", row["id"]).execute()
        deleted += 1
    print(f"[REPAIR:symbols] merged={merged} deleted={deleted}")
    return merged + deleted


def repair_revalidate(client, apply):
    names = load_company_names(client)
    rows = fetch_all(
        client,
        "stock_news_sentiment",
        "id,symbol,exchange,date,news_count,headlines,sources,sentiment_score,negative_flag,positive_flag",
    )
    changed, unverifiable = [], []
    for row in rows:
        headlines = [str(h) for h in (row.get("headlines") or []) if str(h).strip()]
        if not headlines:
            continue
        sym = str(row.get("symbol") or "").upper()
        aliases = names.get(sym) or []
        if not aliases:
            unverifiable.append(row)
            continue
        company_name = " ".join(aliases)
        kept = [h for h in headlines if is_relevant_news(h, sym, company_name) and not is_unrelated_news(h)]
        if len(kept) == len(headlines):
            continue
        sentiment = analyze_sentiment([
            {"title": h, "link": "", "published": row.get("date"), "source": "revalidate"} for h in kept
        ]) if kept else {"headlines": [], "sources": [], "news_count": 0, "sentiment_score": 0, "negative_flag": 0, "positive_flag": 0}
        changed.append((row, kept, sentiment))
    print(f"[REPAIR:revalidate] rows losing headlines: {len(changed)} | unverifiable (no name): {len(unverifiable)}")
    for row, kept, _s in changed[:12]:
        print(f"  - {row['symbol']} {row['date']}: {row.get('news_count')} -> {len(kept)}")
    if not apply:
        return len(changed)
    for row, kept, sentiment in changed:
        client.table("stock_news_sentiment").update({
            "headlines": sentiment["headlines"],
            "news_count": sentiment["news_count"],
            "sources": sentiment["sources"],
            "sentiment_score": sentiment["sentiment_score"],
            "negative_flag": sentiment["negative_flag"],
            "positive_flag": sentiment["positive_flag"],
        }).eq("id", row["id"]).execute()
    print(f"[REPAIR:revalidate] updated {len(changed)} rows")
    return len(changed)


def repair_corporate_actions(client, apply):
    names = load_company_names(client)
    rows = fetch_all(
        client,
        "corporate_actions",
        "id,symbol,exchange,action_type,title,url,published_at",
        order="id",
    )

    def row_identity(row):
        return (
            str(row.get("symbol") or "").upper(),
            str(row.get("action_type") or ""),
            str(row.get("published_at") or "")[:10],
            _normalize_arabic(row.get("title") or ""),
        )

    # 1) exact duplicate identity -> keep lowest id
    groups = collections.defaultdict(list)
    for row in rows:
        groups[row_identity(row)].append(row)
    exact_dupes = []
    for key, items in groups.items():
        if len(items) > 1:
            exact_dupes.extend(sorted(items, key=lambda r: r["id"])[1:])

    # 2) one URL reused across symbols -> keep rows whose title identifies the symbol
    by_url = collections.defaultdict(list)
    for row in rows:
        url = str(row.get("url") or "").strip()
        if url:
            by_url[url].append(row)
    url_dupes = []
    unattributable = []
    for url, items in by_url.items():
        symbols = {str(r.get("symbol") or "").upper() for r in items}
        if len(symbols) < 2:
            continue
        matches = []
        for row in items:
            sym = str(row.get("symbol") or "").upper()
            company_name = " ".join(names.get(sym) or [])
            if is_relevant_news(str(row.get("title") or ""), sym, company_name):
                matches.append(row)
        if len(matches) == 1:
            keep_id = matches[0]["id"]
            url_dupes.extend([r for r in items if r["id"] != keep_id])
        elif not matches:
            # The generic article names none of the symbols it was attached to
            # (it only came back from their RSS query). The fixed engine refuses
            # these, so the whole group is stale noise.
            unattributable.extend(items)

    targets = {r["id"]: r for r in (*exact_dupes, *url_dupes, *unattributable)}
    print(
        f"[REPAIR:corporate-actions] duplicates to delete: {len(targets)} "
        f"(exact={len(exact_dupes)}, url={len(url_dupes)}, unattributable={len(unattributable)})"
    )
    for row in list(targets.values())[:15]:
        print(f"  - id={row['id']} {row.get('symbol')} {row.get('action_type')} {str(row.get('published_at'))[:10]} :: {str(row.get('title'))[:70]}")
    if not apply:
        return len(targets)
    for row_id in targets:
        client.table("corporate_actions").delete().eq("id", row_id).execute()
    print(f"[REPAIR:corporate-actions] deleted {len(targets)} rows")
    return len(targets)


MODES = {
    "sources": repair_sources,
    "symbols": repair_symbols,
    "revalidate": repair_revalidate,
    "corporate-actions": repair_corporate_actions,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=sorted(MODES))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    _init_supabase()
    if not supabase:
        print("Supabase not initialized")
        return 1

    print(f"[REPAIR] mode={args.mode} {'APPLY' if args.apply else 'DRY RUN'}")
    affected = MODES[args.mode](supabase, args.apply)
    if not args.apply:
        print("[REPAIR] Dry run only — re-run with --apply to persist.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
