"""Recommendation lifecycle events and Telegram delivery bookkeeping."""

import os
import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional, Dict, List


def event_key(recommendation_id: Any, event_type: str, event_date: Optional[str] = None, event_identity: Optional[str] = None) -> str:
    raw = f"{recommendation_id}:{event_type}:{event_date or datetime.now(timezone.utc).date().isoformat()}:{event_identity or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _is_read_only() -> bool:
    val = os.getenv("TELEGRAM_RECOMMENDATIONS_READ_ONLY", "false").strip().lower()
    return val not in {"0", "false", "no", "off"}


def telegram_recommendations_read_only() -> bool:
    """Single source of truth for recommendation Telegram delivery mode."""
    return _is_read_only()


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
    event_identity: Optional[str] = None,
) -> Optional[dict]:
    """Insert one idempotent event; duplicate events return existing record."""
    key = event_key(recommendation_id, event_type, event_date, event_identity)
    
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
    # Older deployments still enforce recommendation_id_legacy_uuid as NOT
    # NULL. Populate it when the canonical recommendation id is a UUID, while
    # keeping the newer string identifier as the source of truth.
    try:
        payload["recommendation_id_legacy_uuid"] = str(uuid.UUID(str(recommendation_id)))
    except (ValueError, TypeError, AttributeError):
        pass
    try:
        existing = (
            supabase.table("recommendation_events")
            .select("*")
            .eq("idempotency_key", key)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]
        try:
            result = supabase.table("recommendation_events").insert(payload).execute()
        except Exception as insert_error:
            # Another evaluator may have inserted the same idempotency key
            # between the initial read and this insert. Treat that as success
            # and return the winner's event.
            raced = (
                supabase.table("recommendation_events")
                .select("*")
                .eq("idempotency_key", key)
                .limit(1)
                .execute()
            )
            if raced.data:
                return raced.data[0]
            raise insert_error
        data = result.data or []
        if data:
            return data[0]
        # A concurrent insert may have won between the read and insert.
        existing_after_race = (
            supabase.table("recommendation_events")
            .select("*")
            .eq("idempotency_key", key)
            .limit(1)
            .execute()
        )
        return (existing_after_race.data or [None])[0]
    except Exception as error:
        print(f"[RECOMMENDATION_EVENT] Could not record {event_type} for {recommendation_id}: {error}")
        return None


def update_telegram_delivery(
    supabase: Any,
    event_id: str,
    success: Any,
    message_id: Optional[str] = None,
    error: Optional[str] = None,
    attempts_already_claimed: bool = False,
    claim_token: Optional[str] = None,
) -> bool:
    """Record the result of a Telegram delivery attempt and increment attempts counter."""
    if not event_id:
        return False
    if _is_read_only():
        return False

    success_flag = bool(success)
    if success_flag and not message_id:
        receipts = getattr(success, "receipts", None)
        if receipts:
            message_id = json.dumps(receipts, separators=(",", ":"), ensure_ascii=False)

    now_iso = datetime.now(timezone.utc).isoformat()
    update_payload = {
        "telegram_status": "sent" if success_flag else "failed",
        "updated_at": now_iso,
        "retry_claimed_at": None,
    }
    if not attempts_already_claimed:
        update_payload["telegram_attempts"] = 1
    if success_flag and message_id:
        update_payload["telegram_message_id"] = str(message_id)
    if not success_flag and error:
        update_payload["last_error"] = str(error)[:500]
        update_payload["next_retry_at"] = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()

    try:
        update_query = supabase.table("recommendation_events").update(update_payload).eq("id", event_id)
        if claim_token:
            update_query = update_query.eq("retry_claim_token", claim_token)
            update_query = update_query.gte(
                "retry_claimed_at",
                (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            )
        # PostgREST update responses may have no representation. Do not chain
        # select() after update(), because that fails on the deployed client
        # and makes a delivered Telegram message look retryable.
        update_query.execute()
        verify = (
            supabase.table("recommendation_events")
            .select("id,telegram_status,telegram_message_id")
            .eq("id", event_id)
            .eq("updated_at", now_iso)
            .limit(1)
            .execute()
        )
        row = (getattr(verify, "data", None) or [None])[0]
        if not row:
            return False
        return row.get("telegram_status") == update_payload["telegram_status"] and (
            not success_flag or not message_id or str(row.get("telegram_message_id")) == str(message_id)
        )
    except Exception as upd_err:
        print(f"[RECOMMENDATION_EVENT] Failed to update telegram delivery for {event_id}: {upd_err}")
        return False


def claim_event_delivery(supabase: Any, event_id: Optional[str]) -> Optional[str]:
    """Atomically claim a pending event so exactly one worker sends its Telegram message.

    The inline evaluator (daily job / website / adaptive learning) and the
    background retry loop both run against the same event row. Without a claim,
    both can read ``telegram_status == 'pending'`` and each send the same message,
    producing duplicate Telegram posts. This writes the same retry lease that
    ``claim_recommendation_telegram_events`` honors, so the loser of the race
    skips delivery. Returns the claim token on success, otherwise ``None``.
    """
    if not event_id or _is_read_only():
        return None
    token = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        (
            supabase.table("recommendation_events")
            .update({
                "retry_claimed_at": now_iso,
                "retry_claim_token": token,
                "updated_at": now_iso,
            })
            .eq("id", event_id)
            .eq("telegram_status", "pending")
            .is_("retry_claimed_at", "null")
            .execute()
        )
        verify = (
            supabase.table("recommendation_events")
            .select("id")
            .eq("id", event_id)
            .eq("retry_claim_token", token)
            .limit(1)
            .execute()
        )
        return token if getattr(verify, "data", None) else None
    except Exception as error:
        print(f"[RECOMMENDATION_EVENT] Could not claim Telegram delivery for {event_id}: {error}")
        return None


def verify_event_delivery_claim(
    supabase: Any,
    event_id: Optional[str],
    claim_token: Optional[str],
    allowed_event_types: Optional[set[str]] = None,
) -> bool:
    """Fail closed unless a recent delivery lease exists for a durable event.

    Telegram formatting helpers are imported by jobs, API routes, and tests.  A
    caller must therefore prove that the message belongs to an event persisted
    and claimed in ``recommendation_events`` before any network send is allowed.
    """
    if not supabase or not event_id or not claim_token or _is_read_only():
        return False
    try:
        result = (
            supabase.table("recommendation_events")
            .select("id,event_type,telegram_status,retry_claim_token,retry_claimed_at")
            .eq("id", event_id)
            .eq("retry_claim_token", claim_token)
            .gte(
                "retry_claimed_at",
                (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            )
            .limit(1)
            .execute()
        )
        row = (getattr(result, "data", None) or [None])[0]
        if not row or row.get("telegram_status") not in {"pending", "failed"}:
            return False
        return not allowed_event_types or row.get("event_type") in allowed_event_types
    except Exception as error:
        print(f"[RECOMMENDATION_EVENT] Could not verify Telegram claim for {event_id}: {error}")
        return False


def invalidate_event(supabase: Any, event_id: str, reason: str = "lifecycle compensation") -> bool:
    """Mark an event as cancelled so a compensated mutation cannot be retried."""
    if not event_id:
        return False
    try:
        updated_at = datetime.now(timezone.utc).isoformat()
        update_query = (
            supabase.table("recommendation_events")
            .update({
                "telegram_status": "cancelled",
                "last_error": reason[:500],
                "retry_claimed_at": None,
                "updated_at": updated_at,
            })
            .eq("id", event_id)
            .not_.is_("telegram_status", "sent")
        )
        update_query.execute()
        verify = supabase.table("recommendation_events").select("id,telegram_status,updated_at").eq("id", event_id).eq("updated_at", updated_at).limit(1).execute()
        row = (getattr(verify, "data", None) or [None])[0]
        return bool(row and row.get("telegram_status") == "cancelled")
    except Exception as error:
        print(f"[RECOMMENDATION_EVENT] Could not invalidate {event_id}: {error}")
        return False

def claim_pending_telegram_events(supabase: Any, limit: int = 10) -> List[Dict[str, Any]]:
    """Atomically claim retry rows through the database function."""
    if _is_read_only():
        return []
    try:
        result = supabase.rpc("claim_recommendation_telegram_events", {"p_limit": limit, "p_token": str(uuid.uuid4())}).execute()
        return result.data or []
    except Exception as error:
        print(f"[RECOMMENDATION_EVENT] Claim query failed: {error}")
        return []


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
            .is_("retry_claimed_at", "null")
            .or_("next_retry_at.is.null,next_retry_at.lte." + datetime.now(timezone.utc).isoformat())
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
