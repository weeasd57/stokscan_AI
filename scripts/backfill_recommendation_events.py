import os
import sys
import datetime as dt
from dotenv import load_dotenv

_base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_base_dir, ".env"))
load_dotenv(os.path.join(_base_dir, "web", ".env.local"), override=True)

if _base_dir not in sys.path:
    sys.path.insert(0, _base_dir)

from supabase import create_client
from api.recommendation_events import record_event, event_values

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Supabase credentials not found in env.")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def backfill():
    print("Fetching public recommendations for backfill...")
    res = (
        supabase.table("scan_results")
        .select("id, symbol, exchange, status, entry_price, target_price, stop_loss, exit_price, profit_loss_pct, created_at, updated_at")
        .eq("is_public", True)
        .order("created_at", desc=False)
        .execute()
    )
    rows = res.data or []
    print(f"Found {len(rows)} recommendations to backfill.")

    created_events = 0
    closed_events = 0

    for row in rows:
        rec_id = row["id"]
        sym = row["symbol"]
        status = (row.get("status") or "").lower()
        created_at = row.get("created_at") or ""
        created_date = created_at[:10] if created_at else None
        updated_at = row.get("updated_at") or ""
        updated_date = updated_at[:10] if updated_at else None

        # 1. Backfill 'recommendation_created'
        created_res = record_event(
            supabase,
            rec_id,
            "recommendation_created",
            new_values=event_values(row),
            price_at_event=float(row.get("entry_price") or 0.0),
            source="backfill",
            event_date=created_date,
            initial_status="historical",
        )
        if created_res:
            created_events += 1

        # 2. Backfill 'recommendation_closed' for closed trades
        if status in ("win", "loss", "closed_manual", "stale"):
            closed_res = record_event(
                supabase,
                rec_id,
                "recommendation_closed",
                new_values=event_values(row),
                price_at_event=float(row.get("exit_price") or row.get("entry_price") or 0.0),
                source="backfill",
                event_date=updated_date or created_date,
                initial_status="historical",
            )
            if closed_res:
                closed_events += 1

    print(f"Backfill complete! Created {created_events} creation events and {closed_events} closed events.")

if __name__ == "__main__":
    backfill()
