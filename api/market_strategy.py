"""Shared market and sector context for public EGX recommendations.

The trained stock models keep their existing feature schema.  This module is a
deterministic execution gate around publication and lifecycle management so the
same market facts govern both new BUYs and defensive exits.
"""

from __future__ import annotations

from collections import defaultdict
from math import isfinite
from typing import Any, Dict, Iterable, List


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        return result if isfinite(result) else default
    except (TypeError, ValueError):
        return default


def index_metrics(rows: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    by_date = {}
    for row in rows or []:
        day = str(row.get("date") or "")[:10]
        close = _number(row.get("close"))
        if day and close > 0:
            by_date[day] = close
    ordered = sorted(by_date.items())
    closes = [value for _, value in ordered]

    def period_return(sessions: int) -> float | None:
        if len(closes) <= sessions:
            return None
        return (closes[-1] / closes[-1 - sessions] - 1) * 100

    def average(sessions: int) -> float | None:
        if len(closes) < sessions:
            return None
        return sum(closes[-sessions:]) / sessions

    latest = closes[-1] if closes else None
    sma20, sma50 = average(20), average(50)
    return {
        "date": ordered[-1][0] if ordered else None,
        "close": latest,
        "return_1d_pct": period_return(1),
        "return_5d_pct": period_return(5),
        "return_10d_pct": period_return(10),
        "sma20": sma20,
        "sma50": sma50,
        "above_sma20": bool(latest is not None and sma20 is not None and latest >= sma20),
        "above_sma50": bool(latest is not None and sma50 is not None and latest >= sma50),
        "sessions": len(closes),
    }


def market_context(egx30_rows, egx100_rows, breadth: Dict[str, Any] | None = None) -> Dict[str, Any]:
    egx30, egx100 = index_metrics(egx30_rows), index_metrics(egx100_rows)
    breadth = dict(breadth or {})
    same_session = bool(egx30.get("date") and egx30.get("date") == egx100.get("date"))
    data_incomplete = not same_session or min(int(egx30.get("sessions") or 0), int(egx100.get("sessions") or 0)) < 11

    def metric(index: Dict[str, Any], key: str, fallback: float = 0.0) -> float:
        value = index.get(key)
        return _number(value, fallback) if value is not None else fallback

    one_day_panic = same_session and (
        metric(egx30, "return_1d_pct") <= -3.0 or metric(egx100, "return_1d_pct") <= -4.0
    )
    five_day_selloff = same_session and (
        metric(egx30, "return_5d_pct") <= -3.0 and metric(egx100, "return_5d_pct") <= -4.0
    )
    ten_day_break = same_session and (
        metric(egx30, "return_10d_pct") <= -4.0 and metric(egx100, "return_10d_pct") <= -6.0
    )
    trend_break = same_session and (
        not egx30.get("above_sma50") and not egx100.get("above_sma50")
        and metric(egx30, "return_5d_pct") < 0 and metric(egx100, "return_5d_pct") < 0
    )
    advancing_pct = breadth.get("advancing_pct")
    weak_breadth = advancing_pct is not None and _number(advancing_pct, 100.0) < 35.0
    breadth_confirmed_selloff = weak_breadth and same_session and (
        metric(egx30, "return_5d_pct") <= -1.5 and metric(egx100, "return_5d_pct") <= -2.0
    )

    confirmed_stress = one_day_panic or five_day_selloff or ten_day_break or trend_break or breadth_confirmed_selloff
    reject_buys = data_incomplete or confirmed_stress
    if one_day_panic or five_day_selloff:
        regime = "panic"
    elif reject_buys:
        regime = "bear"
    elif same_session and egx30.get("above_sma20") and egx100.get("above_sma20") \
            and metric(egx30, "return_5d_pct") > 0 and metric(egx100, "return_5d_pct") > 0:
        regime = "bull"
    else:
        regime = "sideways"

    reasons = []
    if data_incomplete:
        reasons.append("incomplete_or_misaligned_index_data")
    if one_day_panic:
        reasons.append("one_day_panic")
    if five_day_selloff:
        reasons.append("broad_five_day_selloff")
    if ten_day_break:
        reasons.append("broad_ten_day_break")
    if trend_break:
        reasons.append("both_indices_below_sma50")
    if breadth_confirmed_selloff:
        reasons.append("weak_market_breadth")

    return {
        "date": egx30.get("date") if same_session else None,
        "regime": regime,
        "reject_buys": reject_buys,
        "market_stress": confirmed_stress,
        "data_incomplete": data_incomplete,
        "reasons": reasons,
        "egx30": egx30,
        "egx100": egx100,
        "breadth": breadth,
    }


def breadth_from_heatmap(rows: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    latest_by_symbol: Dict[str, Dict[str, Any]] = {}
    latest_day = ""
    for row in rows or []:
        day = str(row.get("captured_at") or row.get("date") or "")[:10]
        if day > latest_day:
            latest_day = day
            latest_by_symbol = {}
        if day == latest_day:
            latest_by_symbol[str(row.get("symbol") or "").upper()] = row
    changes = [_number(row.get("change_pct")) for row in latest_by_symbol.values()]
    advancing = sum(change > 0 for change in changes)
    declining = sum(change < 0 for change in changes)
    total = len(changes)
    return {
        "date": latest_day or None,
        "advancing": advancing,
        "declining": declining,
        "unchanged": total - advancing - declining,
        "total": total,
        "advancing_pct": round(advancing / total * 100, 2) if total else None,
    }


def sector_snapshot(rows: Iterable[Dict[str, Any]], *, market_stress: bool) -> Dict[str, Any]:
    """Build sector signals from the latest two daily captures.

    Each symbol is counted once per date, even if the daily job was retried.
    ``cap`` is traded value (close * volume), not company market cap.
    """
    by_day_symbol: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
    for row in rows or []:
        day = str(row.get("captured_at") or row.get("date") or "")[:10]
        symbol = str(row.get("symbol") or "").upper()
        if day and symbol:
            existing = by_day_symbol[day].get(symbol)
            if existing is None or str(row.get("captured_at") or "") > str(existing.get("captured_at") or ""):
                by_day_symbol[day][symbol] = row
    days = sorted(by_day_symbol)
    if not days:
        return {"date": None, "sectors": {}, "weak_symbols": []}

    def aggregate(day: str) -> Dict[str, Dict[str, Any]]:
        sectors: Dict[str, Dict[str, Any]] = {}
        for symbol, row in by_day_symbol[day].items():
            sector = str(row.get("sector") or "").strip().lower()
            traded_value = max(_number(row.get("cap")), 0.0)
            change = _number(row.get("change_pct"))
            if not sector or traded_value <= 0:
                continue
            value = sectors.setdefault(sector, {
                "traded_value": 0.0, "weighted_change": 0.0, "weighted_cmf": 0.0,
                "advancing": 0, "declining": 0, "stocks": 0, "changes": {},
            })
            value["traded_value"] += traded_value
            value["weighted_change"] += traded_value * change
            value["weighted_cmf"] += traded_value * _number(row.get("cmf_20"))
            value["advancing"] += int(change > 0)
            value["declining"] += int(change < 0)
            value["stocks"] += 1
            value["changes"][symbol] = change
        for value in sectors.values():
            value["weighted_change"] = value["weighted_change"] / value["traded_value"] if value["traded_value"] else 0.0
            value["weighted_cmf"] = value["weighted_cmf"] / value["traded_value"] if value["traded_value"] else 0.0
        return sectors

    current_day = days[-1]
    current = aggregate(current_day)
    previous = aggregate(days[-2]) if len(days) > 1 else {}
    weak_symbols = set()
    output = {}
    for sector, value in current.items():
        prior = previous.get(sector)
        turnover_change = None
        if prior and prior["traded_value"] > 0:
            turnover_change = (value["traded_value"] / prior["traded_value"] - 1) * 100
        decline_pct = value["declining"] / value["stocks"] * 100 if value["stocks"] else 0.0
        broad_distribution = value["weighted_change"] <= -1.0 and decline_pct >= 60.0
        liquidity_withdrawal = turnover_change is not None and turnover_change <= -20.0
        block_new_buys = broad_distribution and (
            liquidity_withdrawal or value["weighted_change"] <= -1.5 or value["weighted_cmf"] <= -0.05
        )
        defensive_exit = bool(market_stress and block_new_buys)
        if defensive_exit:
            weak_symbols.update(symbol for symbol, change in value["changes"].items() if change <= -0.75)
        output[sector] = {
            "sector_change_pct": round(value["weighted_change"], 2),
            "cmf_20": round(value["weighted_cmf"], 3),
            "turnover_change_pct": round(turnover_change, 2) if turnover_change is not None else None,
            "declining_pct": round(decline_pct, 2),
            "advancing": value["advancing"],
            "declining": value["declining"],
            "stocks": value["stocks"],
            "block_new_buys": block_new_buys,
            "defensive_exit": defensive_exit,
        }
    return {"date": current_day, "previous_date": days[-2] if len(days) > 1 else None,
            "sectors": output, "weak_symbols": sorted(weak_symbols)}
