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
    If is_pro is False:
      - Active trades are masked (is_locked=True).
      - Closed trades closed within the last 15 days are masked (is_locked=True).
      - Closed trades older than 15 days are completely unmasked for Free users!
    If is_pro is True:
      - All active and historical trades are fully unmasked in real time.
    """
    data = compute_short_swings() if refresh else get_cached_short_swings()
    cutoff_date = (dt.date.today() - dt.timedelta(days=15)).strftime("%Y-%m-%d")
    
    if not is_pro:
        # 1. Active open trades are current market opportunities -> Always encrypted for Free users!
        masked_active = []
        for t in data.get("active_trades", []):
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
        
        # 2. Closed trades: Trades closed within the last 15 days are encrypted.
        # Historical closed trades older than 15 days are 100% visible for Free audit.
        processed_closed = []
        for t in data.get("closed_trades", []):
            exit_date = t.get("exit_date", "")
            if exit_date and exit_date >= cutoff_date:
                sym = t.get("symbol", "")
                processed_closed.append({
                    "symbol": (sym[:2] + "**") if len(sym) > 2 else "**",
                    "name_ar": "سهم مشفر (أقل من 15 يوم)",
                    "name_en": "Locked Signal (<15d)",
                    "sector": t.get("sector", "عام"),
                    "entry_date": t.get("entry_date"),
                    "exit_date": t.get("exit_date"),
                    "entry_price": None,
                    "exit_price": None,
                    "return_pct": t.get("return_pct"),
                    "sessions": t.get("sessions"),
                    "reason": t.get("reason"),
                    "trigger_type": t.get("trigger_type"),
                    "is_locked": True
                })
            else:
                processed_closed.append({
                    **t,
                    "is_locked": False
                })

        return {
            "is_pro": False,
            "kpis": data.get("kpis", {}),
            "active_trades": masked_active,
            "closed_trades": processed_closed,
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

