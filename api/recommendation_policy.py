"""Deterministic daily-bar evaluation shared by production and offline replay.

Policy changes are explicit and versioned. This is an execution policy, not a
claim that an old trained model was trained with identical labels or barriers.
"""
from math import isfinite

POLICY_VERSION = "fixed_barriers_v2"


def positive(value):
    try:
        number = float(value)
        return number if isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None


def valid_candidate(row, minimum_rr=1.5):
    entry, target, stop = (positive(row.get(key)) for key in ("last_close", "target_price", "stop_loss"))
    if entry is None or target is None or stop is None or not stop < entry < target:
        return False
    return (target - entry) / (entry - stop) >= minimum_rr


def evaluate_bars(*, entry, target, stop, bars, entry_date, cursor, max_sessions=None,
                  trail_pct=None, trail_trigger_pct=5.0):
    """Process new bars in order; adjustments take effect on the NEXT bar.

    A cursor is a market-data date, never a row's last modification timestamp.
    Legacy positions can have stop > entry after locking a profit. Missing or
    invalid OHLC makes evaluation fail closed, rather than inventing prices.
    """
    entry, target, stop = positive(entry), positive(target), positive(stop)
    if entry is None or target is None or stop is None:
        raise ValueError("Missing positive entry/target/stop")
    if max_sessions is not None and max_sessions < 1:
        raise ValueError("max_sessions must be positive")
    if trail_pct is not None and not 0 < trail_pct < 1:
        raise ValueError("trail_pct must be between zero and one")
    by_date = {str(bar.get("date", ""))[:10]: bar for bar in bars}
    session_dates = sorted(day for day in by_date if day > entry_date)
    result = dict(status="open", exit_price=None, exit_reason=None, closed_on=None,
                  stop_loss=stop, cursor=cursor, last_close=None, sessions_held=0,
                  profit_loss_pct=None, adjustments=[])
    for session, day in enumerate(session_dates, 1):
        if day <= cursor:
            continue
        bar = by_date[day]
        high, low, close = (positive(bar.get(key)) for key in ("high", "low", "close"))
        opening = positive(bar.get("open"))
        if high is None or low is None or close is None or not low <= close <= high:
            raise ValueError(f"Invalid OHLC on {day}")
        if bar.get("open") is not None and (opening is None or not low <= opening <= high):
            raise ValueError(f"Invalid opening price on {day}")
        result.update(cursor=day, last_close=close, sessions_held=session)
        exit_price, reason = None, None
        if low <= stop:
            exit_price = min(opening, stop) if opening is not None else stop
            reason = "stop_hit"
        elif high >= target:
            exit_price, reason = target, "target_hit"
        elif max_sessions is not None and session >= max_sessions:
            exit_price, reason = close, "time_exit"
        if exit_price is not None:
            pnl = (exit_price / entry - 1) * 100
            result.update(status="win" if pnl >= 0 else "loss", exit_price=exit_price,
                          profit_loss_pct=pnl, closed_on=day, exit_reason=reason)
            return result
        result["profit_loss_pct"] = (close / entry - 1) * 100
        if trail_pct is not None and result["profit_loss_pct"] >= trail_trigger_pct:
            candidate = close * (1 - trail_pct)
            if stop < candidate < close:
                result["adjustments"].append(dict(type="stop_raised", old_stop=stop,
                    new_stop=candidate, current_price=close,
                    pl_pct=result["profit_loss_pct"], effective_after=day,
                    timestamp=f"{day}T23:59:59", reason_ar="حماية الربح من الجلسة التالية",
                    reason_en="Profit protection from next session"))
                stop = candidate
                result["stop_loss"] = stop
    return result
