"""Manual Vodafone Cash checkout reviewed through the support Telegram bot."""
import html
import os
import re
import requests
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4
from api.stock_ai import _init_supabase, supabase
from api.kashier_payments import _activate_subscription
from api.telegram_pro_invites import ensure_pro_invite, revoke_expired_pro_members


_EGYPTIAN_MOBILE_PATTERN = re.compile(r"^01[0125]\d{8}$")


def is_local_payments_enabled() -> bool:
    return os.getenv("LOCAL_VODAFONE_CASH_ENABLED", "false").strip().lower() not in {"", "0", "false", "no", "off"}


def price_egp(plan_id: str) -> int:
    plan = (plan_id or "pro").strip().lower()
    if plan == "pro_6m":
        return int(float(os.getenv("PRO_6M_PRICE_EGP", "1000")))
    if plan == "pro_1y":
        return int(float(os.getenv("PRO_1Y_PRICE_EGP", "1800")))
    return int(float(os.getenv("PRO_PRICE_EGP", os.getenv("LOCAL_PRO_PRICE_EGP", os.getenv("KASHIER_PRO_PRICE_EGP", "200")))))


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


def normalize_sender_phone(value: str) -> str:
    """Accept only a valid Egyptian mobile number, independent of the UI."""
    normalized = re.sub(r"[\s-]+", "", str(value or ""))
    if normalized.startswith("+20"):
        normalized = "0" + normalized[3:]
    elif normalized.startswith("0020"):
        normalized = "0" + normalized[4:]
    if not _EGYPTIAN_MOBILE_PATTERN.fullmatch(normalized):
        raise ValueError("Enter a valid Egyptian mobile number for any network (010, 011, 012 or 015)")
    return normalized


def create_order(user_id: str, plan_id: str = "pro") -> Dict[str, Any]:
    plan_id = (plan_id or "pro").strip().lower()
    if plan_id not in {"pro", "pro_6m", "pro_1y"}:
        raise ValueError("Unsupported Pro plan")
    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not initialized")
    order_id = str(uuid4())
    row = {
        "id": order_id,
        "user_id": user_id,
        "plan_id": plan_id,
        "amount_egp": price_egp(plan_id),
        "status": "pending",
    }
    result = supabase.table("local_payment_orders").insert(row).execute()
    if not result.data:
        raise RuntimeError("Could not create payment order")
    return {"order_id": order_id, "plan_id": plan_id, "amount_egp": row["amount_egp"], "status": "pending"}


def submit_order(order_id: str, user_id: str, note: str = "") -> Dict[str, Any]:
    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not initialized")
    result = supabase.table("local_payment_orders").select("*").eq("id", order_id).eq("user_id", user_id).maybe_single().execute()
    order = result.data if result else None
    if not order or order.get("status") not in {"pending", "submitted"}:
        raise ValueError("Payment order is not available")
    sender_phone = normalize_sender_phone(note)
    now = datetime.now(timezone.utc).isoformat()

    # The number is syntactically validated here, server-side. Vodafone Cash
    # does not expose a transaction-verification API for this flow, so the
    # entitlement is activated immediately but remains visibly pending review.
    _activate_subscription(user_id, order.get("plan_id", "pro"), provider="vodafone_cash_auto")
    invite_link = ""
    invite_expires_at = None
    try:
        sub = supabase.table("subscriptions").select("status,current_period_end").eq("user_id", user_id).eq("plan_id", "pro").eq("status", "active").order("current_period_end", desc=True).limit(1).maybe_single().execute()
        sub_end = (sub.data or {}).get("current_period_end") if sub and sub.data else None
        if sub_end:
            invite = ensure_pro_invite(user_id, str(sub_end))
            invite_link = str(invite.get("invite_link") or "")
            invite_expires_at = invite.get("invite_expires_at")
    except Exception as exc:
        # A Telegram outage must not undo a valid immediate subscription.
        print(f"[LOCAL_PAY] invite creation failed after auto-activation: {exc}")

    update_fields = {
        "status": "approved",
        "customer_note": sender_phone,
        "payment_review_status": "pending_review",
        "auto_activated_at": now,
        "updated_at": now,
    }
    if invite_link:
        update_fields["telegram_invite_link"] = invite_link
        update_fields["telegram_invite_expires_at"] = invite_expires_at
    updated = supabase.table("local_payment_orders").update(update_fields).eq("id", order_id).eq("user_id", user_id).execute()
    order = (updated.data or [{**order, **update_fields}])[0]
    admin_chat = _admin_chat_id()
    text = (
        "🟡 <b>تفعيل Pro تلقائي — يحتاج مراجعة دفع</b>\n"
        f"<b>Order:</b> <code>{html.escape(order_id)}</code>\n"
        f"<b>User:</b> <code>{html.escape(user_id)}</code>\n"
        f"<b>Plan:</b> {html.escape(str(order.get('plan_id', 'pro')).upper())} | <b>Amount:</b> {order['amount_egp']} EGP\n"
        f"<b>Sender:</b> <code>{html.escape(sender_phone)}</code>\n\n"
        "تم منح الوصول فورًا بعد التحقق من صيغة الرقم. راجع التحويل لاحقًا من تب المستخدمين."
    )
    if admin_chat:
        try:
            _telegram("sendMessage", {"chat_id": admin_chat, "text": text, "parse_mode": "HTML"})
        except Exception as exc:
            print(f"[LOCAL_PAY] admin notification failed after auto-activation: {exc}")
    return {
        "order_id": order_id,
        "status": "approved",
        "payment_review_status": "pending_review",
        "telegram_pro_url": invite_link,
    }


def get_order_status(order_id: str, user_id: str) -> Dict[str, Any]:
    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not initialized")
    result = supabase.table("local_payment_orders").select(
        "id,plan_id,amount_egp,status,payment_review_status,payment_reviewed_at,reviewed_at,telegram_invite_link,telegram_invite_expires_at"
    ).eq("id", order_id).eq("user_id", user_id).maybe_single().execute()
    if not result.data:
        raise ValueError("Payment order not found")
    order = result.data
    if order.get("status") == "approved":
        sub = supabase.table("subscriptions").select("status,current_period_end").eq("user_id", user_id).eq("plan_id", "pro").eq("status", "active").order("current_period_end", desc=True).limit(1).maybe_single().execute()
        sub_end = (sub.data or {}).get("current_period_end") if sub and sub.data else None
        if sub_end:
            try:
                invite_row = ensure_pro_invite(user_id, str(sub_end))
                if invite_row.get("invite_link"):
                    order["telegram_invite_link"] = invite_row["invite_link"]
                    order["telegram_invite_expires_at"] = invite_row.get("invite_expires_at")
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
            sub_end = (sub.data or {}).get("current_period_end") if sub and sub.data else None
            if sub_end:
                invite_row = ensure_pro_invite(order["user_id"], str(sub_end))
                if invite_row.get("invite_link"):
                    order["telegram_invite_link"] = invite_row["invite_link"]
                    order["telegram_invite_expires_at"] = invite_row.get("invite_expires_at")
        except Exception as exc:
            print(f"[LOCAL_PAY] invite creation failed: {exc}")
    supabase.table("local_payment_orders").update({
        "status": status,
        "reviewed_by": str(message_chat),
        "reviewed_at": now,
        "payment_review_status": "reviewed" if status == "approved" else "rejected",
        "payment_reviewed_by": str(message_chat),
        "payment_reviewed_at": now,
        "updated_at": now,
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
