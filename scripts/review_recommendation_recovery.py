"""Read-only by default. --apply repairs only existing public recommendations.

Does not run the daily job or publish new BUYs. Uses existing event delivery
claims when applying, so notifications are backed by saved outcomes.
"""
import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api import daily_bot_run as job
from api.hf_history_cache import load_history_snapshot, merge_snapshot_with_live
from api.recommendation_policy import evaluate_bars, resolve_signal_reference


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.environ["HF_HISTORY_DATASET_REPO"] = "weeasdwee/egx-historical-prices"
    os.environ["PUBLIC_PROFIT_PROTECTION_ENABLED"] = "true"
    os.environ["PUBLIC_PROFIT_PROTECTION_EFFECTIVE_FROM"] = "2026-10-04"
    if args.apply:
        report = job.evaluate_old_recommendations(return_report=True)
        print(json.dumps(report, ensure_ascii=False))
        return
    archive = load_history_snapshot("EGX")
    rows = job.supabase.table("scan_results").select("id,symbol,exchange,created_at,updated_at,entry_price,target_price,stop_loss,rich_details").eq("is_public", True).eq("status", "open").eq("exchange", "EGX").execute().data
    for row in rows:
        published = row["created_at"][:10]
        start = (dt.date.fromisoformat(published)-dt.timedelta(days=60)).isoformat()
        live = job.supabase.table("stock_prices").select("symbol,exchange,date,open,high,low,close,volume").eq("symbol", row["symbol"]).eq("exchange", "EGX").gte("date", start).order("date").execute().data
        historical = archive.loc[(archive.symbol == row["symbol"]) & (archive.date >= start)] if not archive.empty else archive
        frame = merge_snapshot_with_live(historical, live)
        bars = frame.assign(date=frame.date.dt.strftime("%Y-%m-%d")).to_dict("records") if not frame.empty else []
        details = row["rich_details"] if isinstance(row["rich_details"], dict) else {}
        reference = resolve_signal_reference(row["entry_price"], bars, published, (details.get("entry_snapshot") or {}).get("price_date"))
        if not reference["ok"] or not bars or bars[-1]["date"] < published:
            print(json.dumps(dict(symbol=row["symbol"], reference=reference, action="source_repair_required")))
            continue
        evaluation = details.get("evaluation") or {}
        cursor = evaluation.get("last_evaluated_date") or evaluation.get("initial_review_cursor") or min(row["updated_at"][:10], bars[-1]["date"])
        policy = details.get("recommendation_policy") or {}
        result = evaluate_bars(entry=row["entry_price"], target=row["target_price"], stop=row["stop_loss"],
            bars=bars, entry_date=published, cursor=cursor, max_sessions=policy.get("max_sessions"),
            trail_pct=policy.get("trail_pct"), profit_protection=details.get("management_policy") or job._profit_protection_policy())
        print(json.dumps(dict(symbol=row["symbol"], reference=reference, outcome=result), ensure_ascii=False))


if __name__ == "__main__":
    main()
