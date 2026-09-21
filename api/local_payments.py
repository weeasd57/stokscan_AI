"""Manual Vodafone Cash checkout reviewed through the support Telegram bot."""
import html
import os
import requests
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4
from datetime import timedelta

from api.stock_ai import _init_supabase, supabase
from api.kashier_payments import _activate_subscription


def is_local_payments_enabled() -> bool:
    return os.getenv("LOCAL_VODAFONE_CASH_ENABLED", "false").strip().lower() not in {"", "0", "false", "no", "off"}


def price_egp(plan_id: str) -> int:
    return int(float(os.getenv("LOCAL_PRO_PRICE_EGP", os.getenv("KASHIER_PRO_PRICE_EGP", "300"))))


def _admin_chat_id() -> Optional[int]:
    from api.support_chat import load_admin_chat_id
    return load_admin_chat_id()


def _bot_token() -> str:
    return os.getenv("SUPPORT_BOT_TOKEN", "").strip()


def _telegram(method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    token = _bot_token()
    if not token:
        raise RuntimeError("SUPPORT_BOT_TOKEN is not configured")
    relay = os.getenv("TELEGRAM_RELAY_URL", "https://api.telegram.org").rstrip("/")
    try:
        response = requests.post(f"{relay}/bot{token}/{method}", json=payload, timeout=10)
        data = response.json()
        if data.get("ok"):
            return data
    except Exception:
        pass
    response = requests.post(f"https://api.telegram.org/bot{token}/{method}", json=payload, timeout=10)
    data = response.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram {method} failed: {data.get('description', 'unknown error')}")
    return data


def _create_pro_invite(order_id: str, user_id: str, subscription_end: str | None = None) -> str:
    chat_id = os.getenv("TELEGRAM_PRO_CHAT_ID", "").strip()
    if not chat_id:
        return ""
    if subscription_end:
        try:
            expires_at = datetime.fromisoformat(subscription_end.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    else:
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    result = _telegram("createChatInviteLink", {
        "chat_id": chat_id,
        "name": f"Pro {user_id[:8]}",
        "expire_date": int(expires_at.timestamp()),
        "member_limit": 10,
    })
    return str((result.get("result") or {}).get("invite_link") or "")


def revoke_expired_pro_members() -> int:
    """Remove linked users whose Pro entitlement has expired from the VIP chat."""
    chat_id = os.getenv("TELEGRAM_PRO_CHAT_ID", "").strip()
    if not chat_id:
        return 0
    _init_supabase()
    if not supabase:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    expired = supabase.table("subscriptions").select("user_id").eq("plan_id", "pro").neq("status", "active").execute().data or []
    expired_ids = {str(row.get("user_id")) for row in expired if row.get("user_id")}
    active = supabase.table("subscriptions").select("user_id,current_period_end").eq("plan_id", "pro").eq("status", "active").execute().data or []
    for row in active:
        try:
            if not row.get("current_period_end") or datetime.fromisoformat(str(row["current_period_end"]).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                expired_ids.add(str(row.get("user_id")))
        except (TypeError, ValueError):
            expired_ids.add(str(row.get("user_id")))
    if not expired_ids:
        return 0
    profiles = supabase.table("profiles").select("id,telegram_chat_id").in_("id", list(expired_ids)).execute().data or []
    removed = 0
    for profile in profiles:
        member_id = str(profile.get("telegram_chat_id") or "").strip()
        if not member_id:
            continue
        try:
            _telegram("banChatMember", {"chat_id": chat_id, "user_id": int(member_id), "until_date": int(datetime.now(timezone.utc).timestamp()) + 60})
            _telegram("unbanChatMember", {"chat_id": chat_id, "user_id": int(member_id), "only_if_banned": True})
            removed += 1
        except Exception as exc:
            print(f"[LOCAL_PAY] failed to revoke VIP access for {profile.get('id')}: {exc}")
    return removed


def create_order(user_id: str, plan_id: str = "pro") -> Dict[str, Any]:
    if plan_id.lower() != "pro":
        raise ValueError("Only the Pro plan is available")
    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not initialized")
    order_id = str(uuid4())
    row = {
        "id": order_id,
        "user_id": user_id,
        "plan_id": "pro",
        "amount_egp": price_egp("pro"),
        "status": "pending",
    }
    result = supabase.table("local_payment_orders").insert(row).execute()
    if not result.data:
        raise RuntimeError("Could not create payment order")
    return {"order_id": order_id, "plan_id": "pro", "amount_egp": row["amount_egp"], "status": "pending"}


def submit_order(order_id: str, user_id: str, note: str = "") -> Dict[str, Any]:
    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not initialized")
    result = supabase.table("local_payment_orders").select("*").eq("id", order_id).eq("user_id", user_id).maybe_single().execute()
    order = result.data if result else None
    if not order or order.get("status") not in {"pending", "submitted"}:
        raise ValueError("Payment order is not available")
    updated = supabase.table("local_payment_orders").update({
        "status": "submitted", "customer_note": note[:500], "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", order_id).eq("user_id", user_id).execute()
    order = (updated.data or [order])[0]
    admin_chat = _admin_chat_id()
    if not admin_chat:
        raise RuntimeError("Support admin chat is not configured")
    text = (
        "💰 <b>طلب دفع Vodafone Cash</b>\n"
        f"<b>Order:</b> <code>{html.escape(order_id)}</code>\n"
        f"<b>User:</b> <code>{html.escape(user_id)}</code>\n"
        f"<b>Plan:</b> Pro | <b>Amount:</b> {order['amount_egp']} EGP\n"
        f"<b>Note:</b> {html.escape(note[:500] or 'لا توجد ملاحظة')}\n\n"
        "راجع التحويل في Vodafone Cash ثم اختر القرار:"
    )
    _telegram("sendMessage", {"chat_id": admin_chat, "text": text, "parse_mode": "HTML", "reply_markup": {
        "inline_keyboard": [[
            {"text": "✅ تأكيد وتفعيل Pro", "callback_data": f"localpay:approve:{order_id}"},
            {"text": "❌ رفض", "callback_data": f"localpay:reject:{order_id}"},
        ]]
    }})
    return {"order_id": order_id, "status": "submitted"}


def get_order_status(order_id: str, user_id: str) -> Dict[str, Any]:
    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not initialized")
    result = supabase.table("local_payment_orders").select("id,plan_id,amount_egp,status,reviewed_at").eq("id", order_id).eq("user_id", user_id).maybe_single().execute()
    if not result.data:
        raise ValueError("Payment order not found")
    order = result.data
    if order.get("status") == "approved":
        if not order.get("telegram_invite_link"):
            try:
                sub = supabase.table("subscriptions").select("status,current_period_end").eq("user_id", user_id).eq("plan_id", "pro").eq("status", "active").order("current_period_end", desc=True).limit(1).maybe_single().execute()
                invite = _create_pro_invite(order_id, user_id, sub.data.get("current_period_end") if sub.data else None)
                if invite:
                    expires = sub.data.get("current_period_end") if sub.data else (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
                    supabase.table("local_payment_orders").update({"telegram_invite_link": invite, "telegram_invite_expires_at": expires}).eq("id", order_id).execute()
                    order["telegram_invite_link"] = invite
                    order["telegram_invite_expires_at"] = expires
            except Exception as exc:
                print(f"[LOCAL_PAY] invite creation failed: {exc}")
        sub = supabase.table("subscriptions").select("status,current_period_end").eq("user_id", user_id).eq("plan_id", "pro").eq("status", "active").order("current_period_end", desc=True).limit(1).maybe_single().execute()
        order["subscription"] = sub.data or None
        end = (sub.data or {}).get("current_period_end") if sub.data else None
        try:
            active = bool(end and datetime.fromisoformat(str(end).replace("Z", "+00:00")) > datetime.now(timezone.utc))
        except ValueError:
            active = False
        order["telegram_pro_url"] = order.get("telegram_invite_link", "") if active else ""
    return order


def handle_callback(callback: Dict[str, Any]) -> None:
    data = str(callback.get("data") or "")
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "localpay" or parts[1] not in {"approve", "reject"}:
        return
    callback_id = callback.get("id")
    admin_chat = _admin_chat_id()
    message_chat = ((callback.get("message") or {}).get("chat") or {}).get("id")
    if not admin_chat or str(message_chat) != str(admin_chat):
        if callback_id:
            try:
                _telegram("answerCallbackQuery", {"callback_query_id": callback_id, "text": "⛔ غير مصرح لك بتنفيذ هذا الإجراء", "show_alert": True})
            except Exception:
                pass
        return
    order_id = parts[2]
    _init_supabase()
    if not supabase:
        if callback_id:
            try:
                _telegram("answerCallbackQuery", {"callback_query_id": callback_id, "text": "خطأ: تعذر الاتصال بقاعدة البيانات", "show_alert": True})
            except Exception:
                pass
        return
    result = supabase.table("local_payment_orders").select("*").eq("id", order_id).maybe_single().execute()
    order = result.data if result else None
    if not order:
        if callback_id:
            try:
                _telegram("answerCallbackQuery", {"callback_query_id": callback_id, "text": "❌ لم يتم العثور على هذا الطلب", "show_alert": True})
            except Exception:
                pass
        return
    if order.get("status") not in {"pending", "submitted"}:
        curr_status = "مقبول ومفعّل" if order.get("status") == "approved" else "مرفوض" if order.get("status") == "rejected" else order.get("status")
        if callback_id:
            try:
                _telegram("answerCallbackQuery", {"callback_query_id": callback_id, "text": f"⚠️ هذا الطلب تمت مراجعته بالفعل ({curr_status})", "show_alert": True})
            except Exception:
                pass
        return

    now = datetime.now(timezone.utc).isoformat()
    status = "approved" if parts[1] == "approve" else "rejected"
    if status == "approved":
        _activate_subscription(order["user_id"], order.get("plan_id", "pro"), provider="vodafone_cash")
        try:
            sub = supabase.table("subscriptions").select("status,current_period_end").eq("user_id", order["user_id"]).eq("plan_id", "pro").eq("status", "active").order("current_period_end", desc=True).limit(1).maybe_single().execute()
            invite = _create_pro_invite(order_id, order["user_id"], sub.data.get("current_period_end") if sub.data else None)
            if invite:
                expires = sub.data.get("current_period_end") if sub.data else (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
                order["telegram_invite_link"] = invite
                order["telegram_invite_expires_at"] = expires
        except Exception as exc:
            print(f"[LOCAL_PAY] invite creation failed: {exc}")
    supabase.table("local_payment_orders").update({
        "status": status, "reviewed_by": str(message_chat), "reviewed_at": now, "updated_at": now,
    }).eq("id", order_id).execute()
    if status == "approved" and order.get("telegram_invite_link"):
        supabase.table("local_payment_orders").update({
            "telegram_invite_link": order["telegram_invite_link"],
            "telegram_invite_expires_at": order["telegram_invite_expires_at"],
        }).eq("id", order_id).execute()

    if callback_id:
        try:
            alert_msg = "✅ تم تفعيل اشتراك Pro بنجاح!" if status == "approved" else "❌ تم رفض طلب الدفع"
            _telegram("answerCallbackQuery", {"callback_query_id": callback_id, "text": alert_msg, "show_alert": False})
        except Exception as e:
            print(f"[LOCAL_PAY] answerCallbackQuery error: {e}")

    message_id = (callback.get("message") or {}).get("message_id")
    if message_id:
        try:
            order_text = (
                f"{'✅ <b>تم تفعيل Pro بنجاح</b>' if status == 'approved' else '❌ <b>تم رفض طلب الدفع</b>'}\n\n"
                f"<b>Order:</b> <code>{html.escape(order_id)}</code>\n"
                f"<b>User:</b> <code>{html.escape(str(order.get('user_id', '')))}</code>\n"
                f"<b>Plan:</b> {html.escape(str(order.get('plan_id', 'pro')).upper())}\n"
                f"<b>Amount:</b> {order.get('amount_egp', 300)} EGP\n"
                f"<b>Date:</b> {now[:19].replace('T', ' ')}"
            )
            _telegram("editMessageText", {
                "chat_id": admin_chat,
                "message_id": message_id,
                "text": order_text,
                "parse_mode": "HTML"
            })
        except Exception as e:
            print(f"[LOCAL_PAY] editMessageText error: {e}")
