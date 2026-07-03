"""Shared market-status helpers for post-model buy gating.

This module intentionally reads the generated cache only. It does not create
training features, so existing model artifacts keep their feature schema.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from typing import Any, Dict


def _market_status_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "symbols_data", "market_status.json")


def load_market_status_cache(max_age_hours: int = 36) -> Dict[str, Any]:
    """Load cached market status, failing open when missing, stale, or invalid."""
    status: Dict[str, Any] = {
        "available": False,
        "stale": True,
        "reject_buys": False,
        "reason": "market status cache unavailable",
    }
    
    # Try loading from Supabase market_cache first
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if supabase:
            res = supabase.table("market_cache").select("payload,computed_at").eq("cache_key", "market_status_Egypt").eq("country", "Egypt").maybe_single().execute()
            if res.data and res.data.get("payload"):
                data = res.data["payload"]
                updated_at = res.data.get("computed_at") or data.get("updated_at")
                stale = True
                if updated_at:
                    try:
                        parsed = dt.datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
                        if parsed.tzinfo is not None:
                            parsed = parsed.astimezone(dt.timezone.utc).replace(tzinfo=None)
                        stale = (dt.datetime.utcnow() - parsed) > dt.timedelta(hours=max_age_hours)
                    except Exception:
                        stale = True

                data["available"] = True
                data["stale"] = stale
                data["reject_buys"] = bool(data.get("reject_buys")) and not stale
                data["reason"] = _market_gate_reason(data)
                return data
    except Exception as e_sb:
        print(f"[MARKET_STATUS] Supabase load failed: {e_sb}")

    # Fallback to local file cache
    path = _market_status_path()
    try:
        if not os.path.exists(path):
            return status

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return status

        updated_at = data.get("updated_at")
        stale = True
        if updated_at:
            try:
                parsed = dt.datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
                if parsed.tzinfo is not None:
                    parsed = parsed.astimezone(dt.timezone.utc).replace(tzinfo=None)
                stale = (dt.datetime.utcnow() - parsed) > dt.timedelta(hours=max_age_hours)
            except Exception:
                stale = True

        data["available"] = True
        data["stale"] = stale
        data["reject_buys"] = bool(data.get("reject_buys")) and not stale
        data["reason"] = _market_gate_reason(data)
        return data
    except Exception as exc:
        status["reason"] = f"market status cache read failed: {exc}"
        return status


def should_reject_new_buys(max_age_hours: int = 36) -> Dict[str, Any]:
    """Return a normalized gate payload for code that creates new BUY signals."""
    status = load_market_status_cache(max_age_hours=max_age_hours)
    return {
        "blocked": bool(status.get("reject_buys")),
        "reason": status.get("reason") or _market_gate_reason(status),
        "regime": status.get("regime"),
        "egx30_return": status.get("egx30_return"),
        "updated_at": status.get("updated_at"),
        "stale": bool(status.get("stale", True)),
        "available": bool(status.get("available", False)),
    }


def _market_gate_reason(status: Dict[str, Any]) -> str:
    if not status.get("available", True):
        return "market status cache unavailable"
    if status.get("stale"):
        return "market status cache is stale; gate failed open"
    if bool(status.get("reject_buys")):
        regime = status.get("regime") or "unknown"
        ret = status.get("egx30_return")
        if isinstance(ret, (int, float)):
            return f"market regime rejects new BUYs ({regime}, EGX30 {ret:.2%})"
        return f"market regime rejects new BUYs ({regime})"
    return "market status allows new BUYs"
