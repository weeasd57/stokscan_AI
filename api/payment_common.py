"""Shared billing flags, prices and Pro entitlement activation."""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from api.stock_ai import _init_supabase, supabase

_SETTINGS_CACHE_SECONDS = 15
_settings_cache: dict = {"fetched_at": 0.0, "row": None}


def is_payments_enabled() -> bool:
    return os.getenv("PAYMENTS_ENABLED", "false").strip().lower() not in {"", "0", "false", "no", "off"}


def billing_settings() -> dict:
    """Admin-managed billing row from local_billing_settings, cached briefly.

    Returns an empty dict when the table is missing or unreachable, so prices
    fall back to env defaults and checkout never breaks on a settings outage.
    """
    now = time.monotonic()
    if now - _settings_cache["fetched_at"] < _SETTINGS_CACHE_SECONDS:
        return _settings_cache["row"] or {}
    row: dict = {}
    try:
        _init_supabase()
        if supabase:
            result = supabase.table("local_billing_settings").select("*").eq("id", 1).maybe_single().execute()
            row = (result.data if result else None) or {}
    except Exception:
        row = {}
    _settings_cache["fetched_at"] = now
    _settings_cache["row"] = row or None
    return row


def _env_price(name: str, fallback: float) -> float:
    try:
        return float(os.getenv(name, str(fallback)))
    except ValueError:
        return fallback


def pro_discount() -> dict:
    """Return the currently-active limited-time Pro discount window, if any.

    Admin settings (local_billing_settings) take precedence; env variables
    PRO_DISCOUNT_PRICE_EGP + PRO_DISCOUNT_ENDS_AT are the fallback. Missing,
    invalid, or past end means no discount.
    """
    inactive = {"active": False, "price_egp": None, "ends_at": None}
    settings = billing_settings()
    if "discount_enabled" in settings:
        if not settings.get("discount_enabled"):
            return inactive
        price = settings.get("discount_price_egp")
        end_raw = settings.get("discount_ends_at")
    else:
        price = str(os.getenv("PRO_DISCOUNT_PRICE_EGP", "")).strip()
        end_raw = str(os.getenv("PRO_DISCOUNT_ENDS_AT", "")).strip()
    if price in (None, "") or not end_raw:
        return inactive
    try:
        price_value = float(price)
        ends_at = datetime.fromisoformat(str(end_raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return inactive
    if ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=timezone.utc)
    if price_value <= 0 or datetime.now(timezone.utc) >= ends_at:
        return inactive
    return {"active": True, "price_egp": price_value, "ends_at": ends_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")}


def pro_discount_active() -> bool:
    return pro_discount()["active"]


def plan_amount_egp(plan_id: str) -> float:
    plan = (plan_id or "").strip().lower()
    if plan == "pro":
        discount = pro_discount()
        if discount["active"]:
            return float(discount["price_egp"])
        settings = billing_settings()
        if settings.get("pro_price_egp") is not None:
            return float(settings["pro_price_egp"])
        return _env_price("PRO_PRICE_EGP", 200)
    if plan == "pro_6m":
        settings = billing_settings()
        if settings.get("pro_6m_price_egp") is not None:
            return float(settings["pro_6m_price_egp"])
        return _env_price("PRO_6M_PRICE_EGP", 1000)
    if plan == "pro_1y":
        settings = billing_settings()
        if settings.get("pro_1y_price_egp") is not None:
            return float(settings["pro_1y_price_egp"])
        return _env_price("PRO_1Y_PRICE_EGP", 1800)
    return _env_price("PRO_PRICE_EGP", 200)


def pro_regular_amount_egp() -> float:
    """Base (undiscounted) monthly Pro price, for discount strike-through."""
    settings = billing_settings()
    if settings.get("pro_price_egp") is not None:
        return float(settings["pro_price_egp"])
    return _env_price("PRO_PRICE_EGP", 200)


def subscription_days(plan_id: str) -> int:
    plan = (plan_id or "").strip().lower()
    return {"pro": 30, "pro_6m": 180, "pro_1y": 365}.get(plan, 30)


def activate_subscription(user_id: str, plan_id: str, provider: str = "easykash", payment_order_id: str | None = None) -> None:
    """Activate the subscription only after a verified gateway callback."""
    _init_supabase()
    if not supabase:
        raise RuntimeError("Supabase is not initialized")
    requested_plan = (plan_id or "pro").strip().lower()
    stored_plan = "pro" if requested_plan in {"pro", "pro_6m", "pro_1y"} else requested_plan
    if not payment_order_id:
        raise ValueError("Payment order id is required for idempotent activation")
    supabase.rpc("activate_easykash_subscription", {
        "p_user_id": user_id,
        "p_plan_id": stored_plan,
        "p_duration_days": subscription_days(requested_plan),
        "p_provider": provider,
        "p_payment_order_id": payment_order_id,
        "p_price_monthly_cents": int(round(plan_amount_egp(requested_plan) * 100)),
    }).execute()
