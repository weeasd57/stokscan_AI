"""
Centralized plan / feature limits for EGX Bots.

Single source of truth for the two tiers:
  FREE  - (when PAYMENTS_ENABLED=true) signals delayed 5 days, 50 chat msgs/month, 5 portfolio stocks.
  PRO   - 300 EGP: daily signals, 350 chat msgs/month, 10 portfolio stocks.

When PAYMENTS_ENABLED is false (default) the platform is FREE-UNLIMITED:
no delays, no message cap, and no portfolio stock cap. This keeps the site
completely free until the operator flips the flag.
"""
import os
from typing import Any, Dict

from api.kashier_payments import is_payments_enabled


# ---------------------------------------------------------------------------
# Tiers
# ---------------------------------------------------------------------------

def free_limits() -> Dict[str, Any]:
    return {
        "name": "free",
        "signal_delay_days": int(os.getenv("FREE_SIGNAL_DELAY_DAYS", "5")),
        "chat_messages_per_month": int(os.getenv("FREE_CHAT_MESSAGES", "50")),
        "portfolio_stocks": int(os.getenv("FREE_PORTFOLIO_STOCKS", "5")),
        "price_egp": 0,
    }


def pro_limits() -> Dict[str, Any]:
    return {
        "name": "pro",
        "signal_delay_days": 0,
        "chat_messages_per_month": int(os.getenv("PRO_CHAT_MESSAGES", "350")),
        "portfolio_stocks": int(os.getenv("PRO_PORTFOLIO_STOCKS", "10")),
        "price_egp": int(float(os.getenv("KASHIER_PRO_PRICE_EGP", "300"))),
    }


def plan_limits(plan_id: str) -> Dict[str, Any]:
    if (plan_id or "").strip().lower() == "pro":
        return pro_limits()
    return free_limits()


def effective_limits(plan_id: str) -> Dict[str, Any]:
    """Return limits actually in force for a plan.

    When payments are disabled the platform is FREE-UNLIMITED regardless of
    plan_id so the site stays free.
    """
    if not is_payments_enabled():
        return {
            "name": "free",
            "signal_delay_days": int(os.getenv("FREE_SIGNAL_DELAY_DAYS", "5")),
            "chat_messages_per_month": 10 ** 9,  # effectively unlimited
            "portfolio_stocks": 10 ** 9,
            "price_egp": 0,
            "billing": "disabled",
        }
    limits = plan_limits(plan_id)
    limits["billing"] = "enabled"
    return limits


def is_pro_user(user_id: str, supabase) -> bool:
    """True when the user holds an active Pro subscription (payments on)."""
    if not is_payments_enabled():
        return True  # site is free; everyone gets everything
    from dateutil import parser as date_parser
    from datetime import datetime, timezone

    try:
        res = (
            supabase.table("subscriptions")
            .select("plan_id,status,current_period_end")
            .eq("user_id", user_id)
            .eq("status", "active")
            .order("updated_at", desc=True)
            .limit(5)
            .execute()
        )
        now = datetime.now(timezone.utc)
        for row in res.data or []:
            plan = str(row.get("plan_id", "")).lower()
            if plan != "pro":
                continue
            end = row.get("current_period_end")
            if end:
                try:
                    if date_parser.isoparse(end) < now:
                        continue  # expired
                except Exception:
                    pass
            return True
        return False
    except Exception:
        return False


def user_is_pro(user_id: str, supabase) -> bool:
    return is_pro_user(user_id, supabase)


# ---------------------------------------------------------------------------
# Telegram destination
# ---------------------------------------------------------------------------

def telegram_recommendations_target() -> str:
    """Chat target that daily recommendations are published to.

    Until the global pricing flag (PAYMENTS_ENABLED) is activated, signals stay
    on the OLD public channel/topic so nothing changes for current members.
    Only after billing is enabled does it switch to the new group
    (TELEGRAM_RECOMMENDATIONS_CHAT_ID), then TELEGRAM_CHAT_ID, then the legacy
    public channel.
    """
    if not is_payments_enabled():
        return "-1002083067817_153"  # legacy public channel while free

    target = os.getenv("TELEGRAM_RECOMMENDATIONS_CHAT_ID", "").strip()
    if target:
        return target
    target = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if target and str(target).strip() not in {"-1003699330518"}:
        return target
    return "-1002083067817_153"


def telegram_public_link() -> str:
    """Invite/link for the channel shown in chatbot footers."""
    # While free, point users at the old channel; switch to the new group only
    # once billing is enabled.
    if not is_payments_enabled():
        return os.getenv("TELEGRAM_PUBLIC_LINK_FREE", "https://t.me/egxbots/153").strip()
    return os.getenv("TELEGRAM_PUBLIC_LINK", "https://t.me/+oPTsNYS03FE3MDQ0").strip()

