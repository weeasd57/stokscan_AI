"""Pro Telegram VIP invite links and channel membership tracking."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

import requests

from api.stock_ai import _init_supabase, supabase


def pro_chat_id() -> str:
    return os.getenv("TELEGRAM_PRO_CHAT_ID", "").strip()


def _bot_token() -> str:
    return os.getenv("SUPPORT_BOT_TOKEN", "").strip()


def telegram_api(method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    token = _bot_token()
    if not token:
        raise RuntimeError("SUPPORT_BOT_TOKEN is not configured")
    relay = os.getenv("TELEGRAM_RELAY_URL", "https://api.telegram.org").rstrip("/")
    for base in (relay, "https://api.telegram.org"):
        try:
            response = requests.post(f"{base}/bot{token}/{method}", json=payload, timeout=10)
            data = response.json()
            if data.get("ok"):
                return data
            if base == relay:
                continue
            raise RuntimeError(f"Telegram {method} failed: {data.get('description', 'unknown error')}")
        except RuntimeError:
            raise
        except Exception:
            if base != relay:
                raise
    raise RuntimeError(f"Telegram {method} failed")


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _is_postgrest_no_content(error: Exception) -> bool:
    """Recognize successful/no-row PostgREST responses rejected by old clients."""
    text = str(error).lower()
    code = str(getattr(error, "code", "")).strip()
    return code == "204" or ("missing response" in text and "204" in text)


def _execute_write(query: Any) -> Any:
    """Execute a write while accepting HTTP 204 as a successful empty response."""
    try:
        return query.execute()
    except Exception as error:
        if _is_postgrest_no_content(error):
            return None
        raise


def create_invite_link(user_id: str, subscription_end: str) -> str:
    chat_id = pro_chat_id()
    if not chat_id:
        return ""
    expires_at = _parse_dt(subscription_end) or datetime.now(timezone.utc)
    result = telegram_api(
        "createChatInviteLink",
        {
            "chat_id": chat_id,
            "name": f"Pro {user_id[:8]}",
            "expire_date": int(expires_at.timestamp()),
            "member_limit": 1,
        },
    )
    return str((result.get("result") or {}).get("invite_link") or "")


def _load_invite_row(user_id: str) -> Optional[Dict[str, Any]]:
    _init_supabase()
    if not supabase:
        return None
    try:
        res = (
            supabase.table("pro_telegram_invites")
            .select("user_id,invite_link,invite_expires_at,vip_telegram_user_id")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception as error:
        # Some deployed postgrest-py versions raise on a legitimate 204 when
        # maybe_single() finds no row. Treat that as "missing", not an outage.
        if _is_postgrest_no_content(error):
            return None
        raise
    return res.data if res else None


def _sync_order_invite(user_id: str, invite_link: str, invite_expires_at: str) -> None:
    if not supabase:
        return
    orders = (
        supabase.table("local_payment_orders")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "approved")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not orders:
        return
    _execute_write(
        supabase.table("local_payment_orders").update(
            {"telegram_invite_link": invite_link, "telegram_invite_expires_at": invite_expires_at}
        ).eq("id", orders[0]["id"])
    )


def save_invite(user_id: str, invite_link: str, invite_expires_at: str) -> Dict[str, Any]:
    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not initialized")
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "user_id": user_id,
        "invite_link": invite_link,
        "invite_expires_at": invite_expires_at,
        "updated_at": now,
    }
    _execute_write(
        supabase.table("pro_telegram_invites").upsert(row, on_conflict="user_id")
    )
    _sync_order_invite(user_id, invite_link, invite_expires_at)
    return row


def ensure_pro_invite(user_id: str, subscription_end: str) -> Dict[str, Any]:
    """Return a valid invite for an active Pro user, creating one if needed."""
    end_dt = _parse_dt(subscription_end)
    if not end_dt or end_dt <= datetime.now(timezone.utc):
        return {"invite_link": "", "invite_expires_at": None}

    existing = _load_invite_row(user_id)
    if existing:
        invite_end = _parse_dt(existing.get("invite_expires_at"))
        link = str(existing.get("invite_link") or "").strip()
        if link and invite_end and invite_end > datetime.now(timezone.utc):
            return {
                "invite_link": link,
                "invite_expires_at": existing.get("invite_expires_at"),
            }

    invite = create_invite_link(user_id, subscription_end)
    if not invite:
        return {"invite_link": "", "invite_expires_at": None}
    saved = save_invite(user_id, invite, subscription_end)
    return {
        "invite_link": saved["invite_link"],
        "invite_expires_at": saved["invite_expires_at"],
    }


def record_vip_channel_join(telegram_user_id: int, invite_link: Optional[str] = None) -> None:
    """Persist Telegram user id for Pro VIP revocations after channel join."""
    _init_supabase()
    if not supabase or not telegram_user_id:
        return
    tg_id = int(telegram_user_id)
    user_id: Optional[str] = None

    if invite_link:
        by_link = (
            supabase.table("pro_telegram_invites")
            .select("user_id")
            .eq("invite_link", invite_link.strip())
            .maybe_single()
            .execute()
        )
        if by_link and by_link.data:
            user_id = str(by_link.data.get("user_id") or "")
        if not user_id:
            order = (
                supabase.table("local_payment_orders")
                .select("user_id")
                .eq("telegram_invite_link", invite_link.strip())
                .order("created_at", desc=True)
                .limit(1)
                .execute()
                .data
                or []
            )
            if order:
                user_id = str(order[0].get("user_id") or "")

    if not user_id:
        prof = (
            supabase.table("profiles")
            .select("id")
            .eq("telegram_chat_id", str(tg_id))
            .maybe_single()
            .execute()
        )
        if prof and prof.data:
            user_id = str(prof.data.get("id") or "")

    if not user_id:
        return

    now = datetime.now(timezone.utc).isoformat()
    existing = _load_invite_row(user_id)
    if existing:
        supabase.table("pro_telegram_invites").update(
            {"vip_telegram_user_id": tg_id, "updated_at": now}
        ).eq("user_id", user_id).execute()
    elif invite_link:
        sub = (
            supabase.table("subscriptions")
            .select("current_period_end")
            .eq("user_id", user_id)
            .eq("plan_id", "pro")
            .eq("status", "active")
            .order("current_period_end", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        end = (sub.data or {}).get("current_period_end") if sub and sub.data else now
        save_invite(user_id, invite_link.strip(), str(end))
        supabase.table("pro_telegram_invites").update(
            {"vip_telegram_user_id": tg_id, "updated_at": now}
        ).eq("user_id", user_id).execute()

    try:
        supabase.table("profiles").update({"telegram_chat_id": str(tg_id)}).eq("id", user_id).execute()
    except Exception:
        pass


def _expired_pro_user_ids() -> Set[str]:
    _init_supabase()
    if not supabase:
        return set()
    expired_ids: Set[str] = set()
    expired = (
        supabase.table("subscriptions")
        .select("user_id")
        .eq("plan_id", "pro")
        .neq("status", "active")
        .execute()
        .data
        or []
    )
    expired_ids.update(str(row.get("user_id")) for row in expired if row.get("user_id"))

    active = (
        supabase.table("subscriptions")
        .select("user_id,current_period_end")
        .eq("plan_id", "pro")
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    now = datetime.now(timezone.utc)
    for row in active:
        uid = str(row.get("user_id") or "")
        if not uid:
            continue
        end = _parse_dt(row.get("current_period_end"))
        if not end or end <= now:
            expired_ids.add(uid)
    return expired_ids


def revoke_expired_pro_members() -> int:
    """Remove users whose Pro entitlement expired from the VIP Telegram chat."""
    chat_id = pro_chat_id()
    if not chat_id:
        return 0
    expired_ids = _expired_pro_user_ids()
    if not expired_ids:
        return 0

    telegram_targets: Set[int] = set()
    _init_supabase()
    if not supabase:
        return 0

    profiles = (
        supabase.table("profiles")
        .select("id,telegram_chat_id")
        .in_("id", list(expired_ids))
        .execute()
        .data
        or []
    )
    for profile in profiles:
        raw = str(profile.get("telegram_chat_id") or "").strip()
        if raw.lstrip("-").isdigit():
            telegram_targets.add(int(raw))

    invites = (
        supabase.table("pro_telegram_invites")
        .select("user_id,vip_telegram_user_id")
        .in_("user_id", list(expired_ids))
        .execute()
        .data
        or []
    )
    for row in invites:
        vip_id = row.get("vip_telegram_user_id")
        if vip_id is not None:
            telegram_targets.add(int(vip_id))

    removed = 0
    until = int(datetime.now(timezone.utc).timestamp()) + 60
    for member_id in telegram_targets:
        try:
            telegram_api(
                "banChatMember",
                {"chat_id": chat_id, "user_id": member_id, "until_date": until},
            )
            telegram_api(
                "unbanChatMember",
                {"chat_id": chat_id, "user_id": member_id, "only_if_banned": True},
            )
            removed += 1
        except Exception as exc:
            print(f"[TELEGRAM_PRO] failed to revoke VIP access for {member_id}: {exc}")
    return removed


def handle_chat_member_update(payload: Dict[str, Any]) -> None:
    """Track Pro VIP joins from Telegram chat_member updates."""
    chat_id = pro_chat_id()
    if not chat_id:
        return
    for key in ("chat_member", "my_chat_member"):
        update = payload.get(key)
        if not update:
            continue
        chat = update.get("chat") or {}
        if str(chat.get("id")) != str(chat_id):
            continue
        new_member = update.get("new_chat_member") or {}
        if new_member.get("status") not in {"member", "administrator", "creator"}:
            continue
        actor = update.get("from") or {}
        tg_user_id = actor.get("id")
        if not tg_user_id:
            continue
        invite_payload = update.get("invite_link") or {}
        invite_link = invite_payload.get("invite_link") if isinstance(invite_payload, dict) else None
        record_vip_channel_join(int(tg_user_id), invite_link)
        return
