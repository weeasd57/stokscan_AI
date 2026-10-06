import datetime as dt
from fastapi import APIRouter, Query, Request, HTTPException
from typing import Optional
from api.short_swings_engine import get_cached_short_swings, compute_short_swings

router = APIRouter(prefix="/api/short-swings", tags=["Short Swings"])

@router.get("")
@router.get("/")
def get_short_swings(
    request: Request,
    is_pro: bool = Query(False, description="Whether the requesting user has an active PRO subscription"),
    refresh: bool = Query(False, description="Force recompute signals")
):
    """
    Fetch active and historical short swing trades.

    Encryption rules:
      - Closed trades: NEVER encrypted for any user. Historical record is always fully visible.
      - Active (open) trades: locked (is_locked=True) for free users ONLY IF entry_date is
        within the last 15 days (the signal is still fresh & actionable).
        Active trades older than 15 days are shown freely — the signal is no longer a live edge.
      - PRO users: all trades fully unmasked at all times.
    """
    data = compute_short_swings() if refresh else get_cached_short_swings()
    cutoff_date = (dt.date.today() - dt.timedelta(days=15)).strftime("%Y-%m-%d")

    if not is_pro:
        # Active trades: lock only the ones whose entry_date is within the last 15 days.
        masked_active = []
        for t in data.get("active_trades", []):
            entry_date = t.get("entry_date", "")
            is_recent = bool(entry_date and entry_date >= cutoff_date)
            if is_recent:
                sym = t.get("symbol", "")
                masked_active.append({
                    "symbol": (sym[:2] + "**") if len(sym) > 2 else "**",
                    "name_ar": "سهم قيادي مشفر (متاح لـ PRO)",
                    "name_en": "PRO Signal",
                    "sector": t.get("sector", "عام"),
                    "entry_date": t.get("entry_date"),
                    "entry_price": None,
                    "current_price": None,
                    "trailing_stop": None,
                    "return_pct": t.get("return_pct"),
                    "is_breakeven_protected": t.get("is_breakeven_protected"),
                    "max_gain_pct": t.get("max_gain_pct"),
                    "trigger_type": "صفقة زخم وليدة مشفرة",
                    "status": t.get("status"),
                    "is_locked": True
                })
            else:
                # Active trade but entry is older than 15 days — show freely
                masked_active.append({**t, "is_locked": False})

        # Closed trades: ALWAYS fully visible for every user — historical audit is never restricted.
        unmasked_closed = [{**t, "is_locked": False} for t in data.get("closed_trades", [])]

        return {
            "is_pro": False,
            "kpis": data.get("kpis", {}),
            "active_trades": masked_active,
            "closed_trades": unmasked_closed,
            "total_active": data.get("total_active", 0),
            "total_closed": data.get("total_closed", 0),
            "as_of": data.get("as_of"),
            "cutoff_date_15d": cutoff_date,
            "upgrade_cta": "اشترك في باقة PRO للوصول اللحظي لإشارات الصفقات القصيرة فور ظهورها ومستويات الوقف المتحرك اليومية."
        }
    
    # PRO users: all trades unmasked
    unmasked_closed = [{**t, "is_locked": False} for t in data.get("closed_trades", [])]
    unmasked_active = [{**t, "is_locked": False} for t in data.get("active_trades", [])]

    return {
        "is_pro": True,
        "kpis": data.get("kpis", {}),
        "active_trades": unmasked_active,
        "closed_trades": unmasked_closed,
        "total_active": data.get("total_active", 0),
        "total_closed": data.get("total_closed", 0),
        "as_of": data.get("as_of"),
        "cutoff_date_15d": cutoff_date
    }

