"""Manual Vodafone Cash checkout reviewed through the support Telegram bot."""
import html
import os
import requests
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4
from api.stock_ai import _init_supabase, supabase
from api.kashier_payments import _activate_subscription
from api.telegram_pro_invites import ensure_pro_invite, revoke_expired_pro_members


def is_local_payments_enabled() -> bool:
    return os.getenv("LOCAL_VODAFONE_CASH_ENABLED", "false").strip().lower() not in {"", "0", "false", "no", "off"}


def price_egp(plan_id: str) -> int:
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
    result = supabase.table("local_payment_orders").select(
        "id,plan_id,amount_egp,status,reviewed_at,telegram_invite_link,telegram_invite_expires_at"
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
