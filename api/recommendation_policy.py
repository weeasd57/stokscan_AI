"""Deterministic daily-bar evaluation shared by production and offline replay.

Policy changes are explicit and versioned. This is an execution policy, not a
claim that an old trained model was trained with identical labels or barriers.
"""
from math import isfinite

POLICY_VERSION = "fixed_barriers_v2"
MAX_ENTRY_CLOSE_MISMATCH = 0.02


def positive(value):
    try:
        number = float(value)
        return number if isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None


def valid_candidate(row, minimum_rr=1.5):
    return candidate_assessment(row, minimum_rr)["accepted"]


def candidate_assessment(row, minimum_rr=1.5):
    entry, target, stop = (positive(row.get(key)) for key in ("last_close", "target_price", "stop_loss"))
    result = dict(symbol=row.get("symbol"), entry=entry, target=target, stop=stop,
                  minimum_rr=minimum_rr, risk_reward=None, accepted=False)
    if entry is None or target is None or stop is None or not stop < entry < target:
        return {**result, "reason": "invalid_price_geometry"}
    rr = (target - entry) / (entry - stop)
    return {**result, "risk_reward": round(rr, 6), "accepted": rr >= minimum_rr,
            "reason": "accepted" if rr >= minimum_rr else "risk_reward_below_minimum"}


def resolve_signal_reference(entry, bars, published_date, price_date=None, max_age_days=14):
    """Use the latest actual session, not the timestamp of publication.

    Never search older matching prices when the latest reference disagrees.
    Never infer a corporate-action adjustment from a coincidental price match.
    """
    from datetime import date
    cutoff = str(price_date or published_date)[:10]
    prior = [b for b in bars if str(b.get("date", ""))[:10] <= cutoff]
    if not prior:
        return {"ok": False, "reason": "missing_signal_history"}
    reference = max(prior, key=lambda b: str(b["date"])[:10])
    day = str(reference["date"])[:10]
    if price_date and day != cutoff:
        return {"ok": False, "reason": "missing_explicit_signal_bar", "price_date": day}
    age = (date.fromisoformat(str(published_date)[:10]) - date.fromisoformat(day)).days
    if age < 0 or age > max_age_days:
        return {"ok": False, "reason": "stale_signal_reference", "price_date": day}
    return dict(ok=price_basis_matches(entry, reference.get("close")),
                reason="verified_last_trading_session" if price_basis_matches(entry, reference.get("close"))
                else "incompatible_price_basis", price_date=day, close=reference.get("close"))


def profit_protection_stop(entry, stop, bars, day, policy):
    """ATR protection calculated with data available at this close only."""
    if not policy or day < str(policy.get("effective_from", "9999")):
        return None
    history = sorted((b for b in bars if str(b["date"])[:10] <= day), key=lambda b: str(b["date"]))
    window = int(policy.get("atr_window", 14))
    if len(history) < window + 1:
        return None
    last = history[-1]
    close = positive(last.get("close"))
    if not close or (last.get("volume") is not None and float(last["volume"]) <= 0):
        return None
    if (close / entry - 1) * 100 < float(policy.get("trigger_pct", 5)):
        return None
    ranges = []
    for previous, current in zip(history[-window-1:-1], history[-window:]):
        high, low, prior_close = (positive(v) for v in (current.get("high"), current.get("low"), previous.get("close")))
        if high is None or low is None or prior_close is None or high < low:
            return None
        ranges.append(max(high-low, abs(high-prior_close), abs(low-prior_close)))
    atr = sum(ranges) / window
    closes = [positive(b.get("close")) for b in history[-20:]]
    if any(c is None for c in closes):
        return None
    trending = len(closes) == 20 and close >= sum(closes) / len(closes)
    multiplier = float(policy.get("trend_atr_multiple", 2.5) if trending else policy.get("atr_multiple", 2))
    distance = max(multiplier * atr, close * float(policy.get("minimum_distance_pct", 3)) / 100)
    candidate = round(close - distance, 6)
    if not max(entry, stop or 0) < candidate < close:
        return None
    return dict(type="stop_raised", old_stop=stop, new_stop=candidate, current_price=close,
                pl_pct=(close/entry-1)*100, effective_after=day, timestamp=f"{day}T23:59:59",
                atr=round(atr, 6), atr_multiple=multiplier, policy_version=policy.get("version"),
                reason_ar="حماية الربح بوقف متحرك حسب التقلب والاتجاه؛ يسري من الجلسة التالية",
                reason_en="ATR profit protection effective from the next session")


def price_basis_matches(entry, signal_close, tolerance=MAX_ENTRY_CLOSE_MISMATCH):
    """Reject a mixed adjusted/raw price history before comparing barriers."""
    entry, signal_close = positive(entry), positive(signal_close)
    return (entry is not None and signal_close is not None and
            abs(signal_close / entry - 1) <= tolerance)


def evaluate_bars(*, entry, target, stop, bars, entry_date, cursor, max_sessions=None,
                  trail_pct=None, trail_trigger_pct=5.0, sector_risk_by_date=None,
                  recommendation_sector=None, recommendation_symbol=None,
                  weak_symbols_by_date=None, profit_protection=None):
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
    session_dates = sorted(day for day in by_date if day > entry_date and
                           (by_date[day].get("volume") is None or float(by_date[day]["volume"]) > 0))
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
        # Sector risk is evaluated at the session close, after intraday barriers.
        # The caller only supplies dates where both broad-market weakness and
        # sector distribution were independently confirmed.
        risk = (sector_risk_by_date or {}).get(day, {})
        weak_symbols = (weak_symbols_by_date or {}).get(day, set())
        weak_stock = recommendation_symbol and recommendation_symbol in weak_symbols
        if exit_price is None and recommendation_sector and recommendation_sector in risk and weak_stock:
            exit_price, reason = close, "sector_distribution_exit"
        if exit_price is not None:
            pnl = (exit_price / entry - 1) * 100
            result.update(status="win" if pnl >= 0 else "loss", exit_price=exit_price,
                          profit_loss_pct=pnl, closed_on=day, exit_reason=reason)
            if reason == "sector_distribution_exit":
                result["sector_risk"] = risk[recommendation_sector]
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
        adjustment = profit_protection_stop(entry, stop, bars, day, profit_protection)
        if adjustment:
            result["adjustments"].append(adjustment)
            stop = adjustment["new_stop"]
            result["stop_loss"] = stop
    # Policy activation may happen after this session was already evaluated.
    # Raise tomorrow's stop without re-evaluating today's intraday barriers.
    if result["last_close"] is None and by_date and cursor in by_date:
        adjustment = profit_protection_stop(entry, stop, bars, cursor, profit_protection)
        if adjustment:
            result.update(last_close=adjustment["current_price"], stop_loss=adjustment["new_stop"],
                          profit_loss_pct=adjustment["pl_pct"], sessions_held=len([d for d in session_dates if d <= cursor]),
                          adjustments=[adjustment])
    return result
