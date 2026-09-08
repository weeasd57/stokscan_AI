"""Recommendation lifecycle events and Telegram delivery bookkeeping."""

import os
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional, Dict, List


def event_key(recommendation_id: Any, event_type: str, event_date: Optional[str] = None) -> str:
    raw = f"{recommendation_id}:{event_type}:{event_date or datetime.now(timezone.utc).date().isoformat()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _is_read_only() -> bool:
    val = os.getenv("TELEGRAM_RECOMMENDATIONS_READ_ONLY", "false").strip().lower()
    return val not in {"0", "false", "no", "off"}


def record_event(
    supabase: Any,
    recommendation_id: Any,
    event_type: str,
    *,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    price_at_event: Optional[float] = None,
    source: str = "daily_bot",
    event_date: Optional[str] = None,
    initial_status: Optional[str] = None,
) -> Optional[dict]:
    """Insert one idempotent event; duplicate events return existing record."""
    key = event_key(recommendation_id, event_type, event_date)
    
    if initial_status:
        status = initial_status
    elif _is_read_only():
        status = "blocked_read_only"
    else:
        status = "pending"

    payload = {
        "recommendation_id": str(recommendation_id),
        "event_type": event_type,
        "idempotency_key": key,
        "old_values": old_values,
        "new_values": new_values,
        "price_at_event": price_at_event,
        "source": source,
        "telegram_status": status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = (
            supabase.table("recommendation_events")
            .upsert(payload, on_conflict="idempotency_key")
            .execute()
        )
        data = result.data or []
        return data[0] if data else None
    except Exception as error:
        print(f"[RECOMMENDATION_EVENT] Could not record {event_type} for {recommendation_id}: {error}")
        return None


def update_telegram_delivery(
    supabase: Any,
    event_id: str,
    success: bool,
    message_id: Optional[str] = None,
    error: Optional[str] = None,
) -> bool:
    """Record the result of a Telegram delivery attempt and increment attempts counter."""
    if not event_id:
        return False

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        # Fetch current attempts count
        current = (
            supabase.table("recommendation_events")
            .select("telegram_attempts")
            .eq("id", event_id)
            .single()
            .execute()
        )
        attempts = 0
        if current.data and "telegram_attempts" in current.data:
            attempts = int(current.data.get("telegram_attempts") or 0)
    except Exception:
        attempts = 0

    update_payload = {
        "telegram_status": "sent" if success else "failed",
        "telegram_attempts": attempts + 1,
        "updated_at": now_iso,
    }
    if success and message_id:
        update_payload["telegram_message_id"] = str(message_id)
    if not success and error:
        update_payload["last_error"] = str(error)[:500]

    try:
        supabase.table("recommendation_events").update(update_payload).eq("id", event_id).execute()
        return True
    except Exception as upd_err:
        print(f"[RECOMMENDATION_EVENT] Failed to update telegram delivery for {event_id}: {upd_err}")
        return False


def get_pending_telegram_retries(
    supabase: Any,
    max_attempts: int = 3,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """Retrieve events that failed or are pending delivery, for retry queue processing."""
    if _is_read_only():
        return []

    try:
        res = (
            supabase.table("recommendation_events")
            .select("id, recommendation_id, event_type, price_at_event, new_values, old_values, telegram_attempts")
            .in_("telegram_status", ["pending", "failed"])
            .lt("telegram_attempts", max_attempts)
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[RECOMMENDATION_EVENT] Error querying retry queue: {e}")
        return []


def event_values(row: dict) -> dict:
    """Extract standard snapshot values for event logging."""
    if not row:
        return {}
    return {
        key: row.get(key)
        for key in (
            "symbol",
            "exchange",
            "status",
            "entry_price",
            "target_price",
            "stop_loss",
            "exit_price",
            "profit_loss_pct",
            "last_close",
            "updated_at",
        )
        if key in row
    }
