import os
import hmac
import datetime as dt
from fastapi import APIRouter, Query, Request, HTTPException, Header
from typing import Optional
from api.short_swings_engine import get_cached_short_swings, compute_short_swings

router = APIRouter(prefix="/api/short-swings", tags=["Short Swings"])


def _is_internal_authorized(x_admin_key: Optional[str]) -> bool:
    secret = (os.getenv("ADMIN_SECRET_KEY") or "").strip()
    # Missing configuration must fail closed.  This endpoint is also directly
    # reachable on the Python service, so a missing secret must never turn
    # ?is_pro=true into an entitlement bypass.
    return bool(secret and x_admin_key and hmac.compare_digest(x_admin_key.strip(), secret))


@router.get("")
@router.get("/")
def get_short_swings(
    request: Request,
    is_pro: bool = Query(False, description="Whether the requesting user has an active PRO subscription"),
    refresh: bool = Query(False, description="Force recompute signals"),
    x_admin_key: Optional[str] = Header(None, alias="x-admin-key"),
):
    """
    Fetch active and historical short swing trades.

    Security & Entitlement:
      - Closed trades: NEVER encrypted for any user. Historical record is always fully visible for auditing.
      - Active (open) trades: locked (is_locked=True) for free users ONLY IF entry_date is
        within the last 15 days (the signal is still fresh & actionable) or pending for tomorrow.
        Active trades older than 15 days are shown freely.
      - PRO unmasking and cache refresh require authenticated internal request (x-admin-key header).
        Unauthenticated callers requesting is_pro=True or refresh=True are safely coerced to is_pro=False.
    """
    is_internal = _is_internal_authorized(x_admin_key)
    if not is_internal:
        is_pro = False
        refresh = False

    data = compute_short_swings() if refresh else get_cached_short_swings()
    cutoff_date = (dt.date.today() - dt.timedelta(days=15)).strftime("%Y-%m-%d")

    if not is_pro:
        # Active trades: lock only the ones whose entry_date is within the last 15 days or is_pending_entry for tomorrow
        masked_active = []
        for t in data.get("active_trades", []):
            entry_date = t.get("entry_date", "")
            is_pending = bool(t.get("is_pending_entry"))
            is_recent = is_pending or bool(entry_date and entry_date >= cutoff_date)
            if is_recent:
                sym = t.get("symbol", "")
                masked_active.append({
                    # signal_id is derived from the real ticker/date and is
                    # therefore sensitive just like the ticker itself.
                    "signal_id": None,
                    "symbol": (sym[:2] + "**") if len(sym) > 2 else "**",
                    "name_ar": "سهم قيادي مشفر (متاح لـ PRO)",
                    "name_en": "PRO Signal",
                    "sector": t.get("sector", "عام"),
                    "entry_date": t.get("entry_date"),
                    "signal_date": t.get("signal_date"),
                    "entry_price": None,
                    "current_price": None,
                    "reference_close": None,
                    "trailing_stop": None,
                    "stop_loss": None,
                    "ema10_trend": None,
                    "return_pct": t.get("return_pct", 0.0),
                    "is_breakeven_protected": t.get("is_breakeven_protected", False),
                    "max_gain_pct": t.get("max_gain_pct", 0.0),
                    "trigger_type": "صفقة زخم وليدة مشفرة",
                    "status": t.get("status"),
                    "is_pending_entry": is_pending,
                    "is_locked": True
                })
            else:
                masked_active.append({**t, "is_locked": False})

        unmasked_closed = [{**t, "is_locked": False} for t in data.get("closed_trades", [])]

        return {
            "status": data.get("status", "ok"),
            "is_pro": False,
            "kpis": data.get("kpis", {}),
            "active_trades": masked_active,
            "closed_trades": unmasked_closed,
            "total_active": data.get("total_active", len(masked_active)),
            "total_closed": data.get("total_closed", len(unmasked_closed)),
            "as_of": data.get("as_of"),
            "cutoff_date_15d": cutoff_date,
            "upgrade_cta": "اشترك في باقة PRO للوصول اللحظي لإشارات الصفقات القصيرة فور ظهورها ومستويات الوقف المتحرك اليومية."
        }

    # PRO users: all trades unmasked
    unmasked_closed = [{**t, "is_locked": False} for t in data.get("closed_trades", [])]
    unmasked_active = [{**t, "is_locked": False} for t in data.get("active_trades", [])]

    return {
        "status": data.get("status", "ok"),
        "is_pro": True,
        "kpis": data.get("kpis", {}),
        "active_trades": unmasked_active,
        "closed_trades": unmasked_closed,
        "total_active": data.get("total_active", len(unmasked_active)),
        "total_closed": data.get("total_closed", len(unmasked_closed)),
        "as_of": data.get("as_of"),
        "cutoff_date_15d": cutoff_date
    }
