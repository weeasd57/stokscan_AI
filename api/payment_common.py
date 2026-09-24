"""Shared billing flags, prices and Pro entitlement activation."""
import os

from api.stock_ai import _init_supabase, supabase


def is_payments_enabled() -> bool:
    return os.getenv("PAYMENTS_ENABLED", "false").strip().lower() not in {"", "0", "false", "no", "off"}


def plan_amount_egp(plan_id: str) -> float:
    plan = (plan_id or "").strip().lower()
    if plan == "pro_6m":
        return float(os.getenv("PRO_6M_PRICE_EGP", "1000"))
    if plan == "pro_1y":
        return float(os.getenv("PRO_1Y_PRICE_EGP", "1800"))
    return float(os.getenv("PRO_PRICE_EGP", "200"))


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
