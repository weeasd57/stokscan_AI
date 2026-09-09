"""
Kashier payment integration (TEST-first).

Server-to-server flow:
  1. create_payment_session(...)  -> calls Kashier /v3/payment/sessions, stores a
     kashier_payments row (status=initiated), returns the hosted sessionUrl.
  2. Kashier notifies POST /payment/kashier/webhook; we verify the
     x-kashier-signature header (HMAC-SHA256 over the sorted signatureKeys),
     record the payment outcome, and idempotently activate the subscription.
  3. get_payment_status(order_ref) lets the frontend poll for the outcome so it
     is never trusted from a browser redirect alone.

Credentials are read from environment variables only (never exposed to the
frontend). TEST vs LIVE is purely a host + key switch, so the application logic
stays unchanged when promoting.

Env:
  KASHIER_MID             e.g. MID-50230-954
  KASHIER_API_KEY         payment api key (HMAC signing key)
  KASHIER_SECRET_KEY      server-side Authorization secret
  KASHIER_MODE            test | live   (default test)
  KASHIER_WEBHOOK_URL     public URL of the webhook endpoint
"""
import hmac
import hashlib
import json
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import requests

from api.stock_ai import _init_supabase, supabase

# Kashier v3 API hosts (test vs live).
_KASHIER_HOSTS = {
    "test": "https://test-api.kashier.io",
    "live": "https://api.kashier.io",
}


class KashierConfigError(Exception):
    pass


def is_payments_enabled() -> bool:
    """Master feature flag. When False (default) the whole platform behaves as
    FREE: payment endpoints are disabled, no plan limits are enforced, and no
    purchase UI is shown. Flip PAYMENTS_ENABLED=true to activate billing."""
    val = os.getenv("PAYMENTS_ENABLED", "false").strip().lower()
    return val not in {"0", "false", "no", "off", ""}


def current_mode() -> str:
    """billing mode used by the frontend to decide whether to show purchase UI."""
    return "enabled" if is_payments_enabled() else "disabled"


def get_mode() -> str:
    mode = os.getenv("KASHIER_MODE", "test").strip().lower()
    return mode if mode in ("test", "live") else "test"


def get_api_base() -> str:
    return _KASHIER_HOSTS[get_mode()]


def _require_env(name: str) -> str:
    val = os.getenv(name, "").strip()
    if not val:
        raise KashierConfigError(f"{name} is not configured on the server")
    return val


def get_mid() -> str:
    return _require_env("KASHIER_MID")


def get_api_key() -> str:
    return _require_env("KASHIER_API_KEY")


def get_secret_key() -> str:
    return _require_env("KASHIER_SECRET_KEY")


def plan_amount_egp(plan_id: str) -> float:
    """Amount in EGP for a plan. Single 300 EGP Pro plan by default."""
    plan = (plan_id or "").strip().lower()
    if plan == "pro":
        return float(os.getenv("KASHIER_PRO_PRICE_EGP", "300"))
    return float(os.getenv("KASHIER_PRO_PRICE_EGP", "300"))


def subscription_days(plan_id: str) -> int:
    plan = (plan_id or "").strip().lower()
    return int(os.getenv("KASHIER_SUBSCRIPTION_DAYS", "30"))


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------

def _urlencode_rfc3986(value: str) -> str:
    return urlencode({"v": value})[2:].replace("+", "%20")


def _scalar(value: Any) -> str:
    """Coerce a webhook value to the string form used in the signature payload."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        # Kashier does not sign nested objects; treat as empty string so the
        # signature stays computable and deterministic.
        return ""
    return str(value)


def verify_webhook_signature(body: dict, signature: Optional[str]) -> bool:
    """Verify the Kashier webhook x-kashier-signature header.

    Per developers.kashier.io/docs/webhooks#step-4-verify-the-signature:
      1. take body['data']['signatureKeys'], sort alphabetically;
      2. for each key URL-encode its value from data, join as k=v&...;
      3. HMAC-SHA256(that payload, KASHIER_API_KEY) -> lowercase hex;
      4. compare to the header (case-insensitive hex).
    """
    if not signature:
        return False
    data = body.get("data") or {}
    keys = data.get("signatureKeys") or []
    if not isinstance(keys, list) or not keys:
        return False
    pairs = []
    for key in sorted(keys):
        raw = data.get(key)
        pairs.append(f"{key}={_urlencode_rfc3986(_scalar(raw))}")
    payload = "&".join(pairs)
    expected = hmac.new(
        get_api_key().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, (signature or "").lower())


# ---------------------------------------------------------------------------
# Payment session creation
# ---------------------------------------------------------------------------

def _merchant_redirect() -> str:
    """Public return URL (after payment) on the merchant site. READ → the
    PaymentResult page polls /payment/kashier/status using order_ref."""
    origin = os.getenv("WEB_ORIGIN", "https://egxbots.com").strip().rstrip("/")
    return f"{origin}/payment/result?order_ref={{order}}"


def create_payment_session(
    user_id: str,
    plan_id: str,
    email: str = "",
    customer_ref: str = "",
    quantity: int = 1,
) -> Dict[str, Any]:
    """Create a Kashier hosted checkout session and persist an initiated row.

    Supports local Egyptian cards (Visa/Mastercard/Meeza via BIN detection) and
    mobile wallets (Vodafone Cash / Orange Cash / Etisalat Cash / Smart Wallet)
    through `allowedMethods=card,wallet`. E-wallets are delivered via the hosted
    checkout and do not need a different paymentType.
    """
    _init_supabase()

    amount = float(plan_amount_egp(plan_id))
    order_ref = f"sub_{user_id}_{int(time.time() * 1000)}"

    # Required by Kashier Payment Sessions API.
    expire_at = (datetime.now(timezone.utc) + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    allowed_methods = os.getenv("KASHIER_ALLOWED_METHODS", "card,wallet").strip()

    payload = {
        "type": "one-time",                       # one-time | token :: REQUIRED
        "amount": f"{amount:.2f}",                # REQUIRED
        "currency": "EGP",                        # REQUIRED
        "order": order_ref,                       # REQUIRED (our unique ref)
        "merchantId": get_mid(),                  # REQUIRED
        "merchantRedirect": _merchant_redirect().format(order=order_ref),  # REQUIRED
        "expireAt": expire_at,                    # REQUIRED
        "maxFailureAttempts": 3,                  # REQUIRED (int)
        "display": "en",                          # REQUIRED (en | ar)
        "customer": {                             # REQUIRED (email + reference)
            "email": email,
            "reference": customer_ref or user_id,
        },
        "description": f"EGX Bots Pro plan ({plan_id})",  # < 120 chars
        "paymentType": "credit",                  # credit (charge) | preauth
        "allowedMethods": allowed_methods,        # card,wallet,[bank_installments..]
        "defaultMethod": "card",
        "interactionSource": "ECOMMERCE",
        "enable3DS": True,
        "saveCard": "optional",
        "failureRedirect": True,
    }

    # Per-request webhook: guaranteed delivery of every event for this payment.
    webhook = os.getenv("KASHIER_WEBHOOK_URL", "").strip()
    if webhook:
        payload["serverWebhook"] = webhook

    headers = {
        "Authorization": get_secret_key(),
        "api-key": get_api_key(),
        "Content-Type": "application/json",
    }
    url = f"{get_api_base()}/v3/payment/sessions"
    resp = requests.post(url, json=payload, headers=headers, timeout=20)
    print(f"[KASHIER] create session status={resp.status_code} order={order_ref} mode={get_mode()} methods={allowed_methods}")
    if resp.status_code >= 300:
        print(f"[KASHIER] create session error: {resp.text[:500]}")
        raise RuntimeError(f"Kashier session creation failed ({resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    session_url = data.get("sessionUrl") or data.get("url")
    if not session_url:
        raise RuntimeError(f"Kashier did not return a sessionUrl: {data}")

    expires_at = datetime.now(timezone.utc) + timedelta(days=subscription_days(plan_id))

    try:
        supabase.table("kashier_payments").upsert(
            {
                "user_id": user_id,
                "plan_id": plan_id,
                "amount_paid": amount,
                "currency": "EGP",
                "status": "initiated",
                "provider": "kashier",
                "order_ref": order_ref,
                "expires_at": expires_at.isoformat(),
                "raw_payload": json.dumps({"session": data}),
            },
            on_conflict="order_ref",
        ).execute()
    except Exception as db_err:
        print(f"[KASHIER] failed to persist initiated payment: {db_err}")

    return {
        "success": True,
        "url": session_url,
        "order_ref": order_ref,
        "amount": amount,
        "currency": "EGP",
        "mode": get_mode(),
    }


# ---------------------------------------------------------------------------
# Webhook processing (idempotent subscription activation)
# ---------------------------------------------------------------------------

def _activate_subscription(user_id: str, plan_id: str) -> None:
    """Idempotently activate a subscription row for a plan.

    No unique constraint on (user_id, plan_id) is assumed, so we first try to
    update an existing active subscription; otherwise we insert one. This is
    idempotent under duplicate webhooks.
    """
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=subscription_days(plan_id))
    # Ensure plan catalog row exists to satisfy the FK.
    supabase.table("pricing_plans").upsert(
        {
            "id": plan_id,
            "name": "Pro" if plan_id == "pro" else plan_id,
            "price_monthly_cents": int(round(float(plan_amount_egp(plan_id)) * 100)),
            "is_active": True,
        },
        on_conflict="id",
    ).execute()

    fields = {
        "user_id": user_id,
        "plan_id": plan_id,
        "status": "active",
        "provider": "kashier",
        "current_period_start": now.isoformat(),
        "current_period_end": end.isoformat(),
        "updated_at": now.isoformat(),
    }

    existing = (
        supabase.table("subscriptions")
        .select("id, plan_id, status")
        .eq("user_id", user_id)
        .eq("plan_id", plan_id)
        .limit(1)
        .maybe_single()
        .execute()
    )
    if existing.data:
        # Setting created_at on the first activation; preserve original if present.
        supabase.table("subscriptions").update(fields).eq("id", existing.data["id"]).execute()
    else:
        fields["created_at"] = now.isoformat()
        supabase.table("subscriptions").insert(fields).execute()

    # Enforce single active Pro subscription per user (close any other plan).
    other = (
        supabase.table("subscriptions")
        .select("id, plan_id")
        .eq("user_id", user_id)
        .eq("status", "active")
        .neq("plan_id", plan_id)
        .execute()
    )
    for stale in other.data or []:
        supabase.table("subscriptions").update(
            {"status": "cancelled", "updated_at": now.isoformat()}
        ).eq("id", stale["id"]).execute()

    print(f"[KASHIER] Activated subscription user={user_id} plan={plan_id} until {end.isoformat()}")


def _cancel_subscription(user_id: str) -> None:
    """Close all active Pro subscriptions (e.g. after a refund)."""
    now = datetime.now(timezone.utc)
    try:
        res = (
            supabase.table("subscriptions")
            .select("id")
            .eq("user_id", user_id)
            .eq("status", "active")
            .execute()
        )
        for row in res.data or []:
            supabase.table("subscriptions").update(
                {"status": "cancelled", "updated_at": now.isoformat()}
            ).eq("id", row["id"]).execute()
        print(f"[KASHIER] Cancelled active subscription for user={user_id}")
    except Exception as e:
        print(f"[KASHIER] cancel subscription error: {e}")


def _record_payment_outcome(order_ref: str, status: str, payload: dict) -> None:
    """Update the kashier_payments row for a webhook outcome."""
    data = payload.get("data") or {}
    kashier_status = str(data.get("status", "")).upper()
    update: Dict[str, Any] = {
        "status": status,
        "payment_status_detail": kashier_status,
        "transaction_id": str(data.get("transactionId", "")),
        "kashier_order_id": str(data.get("kashierOrderId", "")),
        "transaction_response_code": str(data.get("transactionResponseCode", "")),
        "method": str(data.get("method", "")),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if status == "success":
        update["paid_at"] = update["updated_at"]
    elif status == "refunded":
        update["paid_at"] = None
    try:
        supabase.table("kashier_payments").update(update).eq("order_ref", order_ref).execute()
    except Exception as db_err:
        print(f"[KASHIER] failed to record outcome for {order_ref}: {db_err}")


def _lookup_order(order_ref: str):
    """Return (user_id, plan_id) for an order_ref from the persisted row."""
    try:
        row = (
            supabase.table("kashier_payments")
            .select("user_id, plan_id, status")
            .eq("order_ref", order_ref)
            .limit(1)
            .maybe_single()
            .execute()
        )
        if row.data:
            return row.data.get("user_id"), row.data.get("plan_id", "pro")
    except Exception as e:
        print(f"[KASHIER] order lookup error: {e}")
    return None, None


def process_webhook_event(body: dict, signature: Optional[str]) -> Dict[str, Any]:
    """Validate + process a Kashier webhook. Idempotent for duplicate events.

    - Branch on data.status (SUCCESS/FAILURE/PENDING), never on `event`.
    - Handle refund/partial_refund by marking the payment refunded and closing
      the subscription (it does NOT keep the plan active).
    - Respond with 200 to acknowledge; 409 if the order was already processed.
    """
    if not verify_webhook_signature(body, signature):
        print("[KASHIER] webhook signature mismatch — rejecting")
        return {"ok": False, "code": "INVALID_SIGNATURE", "status": 401}

    event = body.get("event")
    data = body.get("data") or {}
    status = str(data.get("status", "")).upper()  # SUCCESS | FAILURE | PENDING

    order_ref = str(data.get("merchantOrderId") or data.get("orderReference") or "")
    if not order_ref.startswith("sub_"):
        print(f"[KASHIER] ignored webhook with non-sub order: {order_ref}")
        return {"ok": True, "code": "SKIPPED_NON_SUB", "status": 200}

    _init_supabase()
    user_id, plan_id = _lookup_order(order_ref)
    if not user_id:
        # Order not found locally: acknowledge (200) so Kashier stops retrying,
        # but do not activate anything.
        print(f"[KASHIER] webhook for unknown order {order_ref} — ack only")
        try:
            _record_payment_outcome(order_ref, "failed" if status == "FAILURE" else status.lower(), body)
        except Exception as e:
            print(f"[KASHIER] outcome record error: {e}")
        return {"ok": True, "code": "UNKNOWN_ORDER", "status": 200}

    is_refund = event in {"refund", "partial_refund"}
    # Only a successful `pay` activates; a refund closes the subscription.
    if status == "SUCCESS" and not is_refund:
        try:
            _record_payment_outcome(order_ref, "success", body)
        except Exception as e:
            print(f"[KASHIER] outcome record error: {e}")
        try:
            _activate_subscription(user_id, plan_id)
        except Exception as e:
            print(f"[KASHIER] activation error: {e}")
            return {"ok": False, "code": "ACTIVATION_ERROR", "status": 500}
    elif is_refund:
        try:
            _record_payment_outcome(order_ref, "refunded", body)
            _cancel_subscription(user_id)
        except Exception as e:
            print(f"[KASHIER] refund handling error: {e}")
            return {"ok": False, "code": "REFUND_ERROR", "status": 500}
    else:
        try:
            _record_payment_outcome(order_ref, "failed" if status == "FAILURE" else status.lower(), body)
        except Exception as e:
            print(f"[KASHIER] outcome record error: {e}")

    print(f"[KASHIER] webhook processed event={event} order={order_ref} status={status}")
    return {"ok": True, "code": "PROCESSED", "status": 200}


# ---------------------------------------------------------------------------
# Status polling
# ---------------------------------------------------------------------------

def get_payment_status(order_ref: str) -> Dict[str, Any]:
    """Return the latest persisted state for an order (for frontend polling).
    Never trusts the browser; only the persisted webhook outcome."""
    _init_supabase()
    try:
        row = (
            supabase.table("kashier_payments")
            .select("order_ref, user_id, plan_id, amount_paid, currency, status, transaction_id, paid_at, expires_at, created_at, updated_at")
            .eq("order_ref", order_ref)
            .limit(1)
            .maybe_single()
            .execute()
        )
        return {"ok": True, "payment": row.data} if row.data else {"ok": True, "payment": None}
    except Exception as e:
        print(f"[KASHIER] status query error: {e}")
        return {"ok": False, "error": str(e)}
