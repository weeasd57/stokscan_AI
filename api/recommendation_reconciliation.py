"""Read-only reconciliation helpers for legacy Telegram/recommendation drift."""

from typing import Any


def get_reconciliation_rows(supabase: Any, symbols=None):
    query = supabase.table("reconciliation_conflicts").select("*")
    if symbols:
        query = query.in_("symbol", [str(s).upper() for s in symbols])
    try:
        return query.order("last_updated_at", desc=True).execute().data or []
    except Exception as error:
        print(f"[RECONCILIATION] View unavailable until migration is applied: {error}")
        return []


def summarize_legacy_conflicts(supabase: Any):
    rows = get_reconciliation_rows(supabase, ["TYCN", "EASB"])
    return {
        "read_only": True,
        "symbols": rows,
        "notes": [
            "TYCN and EASB are not auto-closed or auto-repaired.",
            "Telegram remains blocked until the source-of-truth migration is deployed and reviewed.",
        ],
    }
