"""
Acceleration Score Engine for EGXBots.

This module replaces the old Mean Reversion scoring philosophy with an
Acceleration & Momentum approach. It captures stocks in the "Acceleration"
phase before price explosions, based on 5 weighted factors:

    Trend Score       30%  (EMA alignment: Close > EMA20 > EMA50 > EMA200)
    Volume Score      25%  (Relative Volume: current vs 20-day average)
    Momentum Score    20%  (Rate of Change + positive momentum confirmation)
    ADX Score         15%  (Trend strength, not direction)
    RSI Score         10%  (Momentum confirmation, NOT mean-reversion)

Key Design Decision:
    HIGH RSI (e.g., 96) is REWARDED, not penalized.
    TYCN hit +72.8% with RSI=96. Traditional filters would have excluded it.

Dynamic Risk Management:
    Score 9-10 → Wide stop (8-10%), high target (25-35%) — ride the wave
    Score 7-8  → Medium stop (5-7%), good target (15-20%)
    Score 5-6  → Normal stop (3-5%), standard target (8-12%)
    Score 1-4  → Tight stop (2-3%), conservative target (5-7%)

Author: EGXBots AI Team
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, Optional, Tuple


# ──────────────────────────────────────────────────────────────────────
#  1. ACCELERATION SCORE  (0 → 10)
# ──────────────────────────────────────────────────────────────────────

def calculate_acceleration_score(row) -> int:
    """
    Calculate Acceleration Score (0-10) using the Momentum philosophy.

    Instead of penalizing high RSI, we look for the combination of:
        - Strong uptrend alignment (EMA stack)
        - Above-average volume (smart money entering)
        - Positive momentum (buyers already in control)
        - High ADX (strong trend, not choppy sideways)
        - RSI confirming strength (high RSI = strong momentum, not overbought)

    Args:
        row: A DataFrame row or dict-like object with technical indicators.
             Can be a single-row DataFrame (use .iloc[0]) or a dict.

    Returns:
        int: Score from 0 to 10 (10 = strongest acceleration signal)
    """
    try:
        r = row.iloc[0] if hasattr(row, 'iloc') else row

        # Helper to safely extract float values
        def _f(key, default=0.0):
            if key in r:
                v = r.get(key) if hasattr(r, 'get') else r[key]
                try:
                    val = float(v)
                    return val if np.isfinite(val) else default
                except (TypeError, ValueError):
                    return default
            return default

        # Extract indicators (support both Capitalized and lowercase column names)
        close = _f("Close", _f("close", 0.0))
        ema20 = _f("EMA_20", _f("ema_20", 0.0))
        ema50 = _f("EMA_50", _f("ema_50", 0.0))
        ema200 = _f("EMA_200", _f("ema_200", 0.0))
        sma50 = _f("SMA_50", _f("sma_50", 0.0))
        sma200 = _f("SMA_200", _f("sma_200", 0.0))
        adx = _f("ADX_14", _f("adx_14", 0.0))
        rsi = _f("RSI", _f("rsi_14", 50.0))
        volume = _f("Volume", _f("volume", 0.0))
        vol_sma20 = _f("VOL_SMA20", _f("vol_sma20", 1.0))
        r_vol = _f("R_VOL", 0.0)
        momentum = _f("Momentum", _f("momentum_10", 0.0))
        roc = _f("ROC_12", _f("roc_12", 0.0))
        macd = _f("MACD", _f("macd", 0.0))
        macd_signal = _f("MACD_Signal", _f("macd_signal", 0.0))

        # If EMA20 is not available, estimate from close/SMA
        if ema20 <= 0 and close > 0:
            ema20 = close * 0.99  # Approximate; won't break logic

        # If EMA50 missing, fallback to SMA50
        if ema50 <= 0:
            ema50 = sma50
        if ema200 <= 0:
            ema200 = sma200

        # Calculate R_VOL if not pre-computed
        if r_vol <= 0 and vol_sma20 > 0 and volume > 0:
            r_vol = volume / vol_sma20

        # ── TREND SCORE (max 3.0 points → 30%) ──────────────────
        trend_pts = 0.0

        # Full EMA stack: Close > EMA20 > EMA50 > EMA200 → 3 points
        if close > 0 and ema50 > 0 and ema200 > 0:
            if ema20 > 0 and close > ema20 > ema50 > ema200:
                trend_pts = 3.0  # Perfect acceleration alignment
            elif close > ema50 > ema200:
                trend_pts = 2.5  # Strong uptrend (no EMA20 check)
            elif close > ema50 > 0 and close > ema200:
                trend_pts = 2.0  # Above both MAs
            elif close > ema50 > 0:
                trend_pts = 1.5  # Above EMA50 only
            elif close > ema200 > 0:
                trend_pts = 1.0  # Above EMA200 only (long-term support)
            # Golden cross bonus
            if ema50 > ema200 > 0:
                trend_pts = min(3.0, trend_pts + 0.5)

        # ── VOLUME SCORE (max 2.5 points → 25%) ─────────────────
        volume_pts = 0.0

        if r_vol > 0:
            if r_vol >= 3.0:
                volume_pts = 2.5   # Massive volume explosion (like EASB = 6.54x)
            elif r_vol >= 2.0:
                volume_pts = 2.0   # Strong volume surge (like TYCN = 2.68x)
            elif r_vol >= 1.5:
                volume_pts = 1.5   # Good volume above average
            elif r_vol >= 1.2:
                volume_pts = 1.0   # Slightly above average
            elif r_vol >= 0.8:
                volume_pts = 0.5   # Normal volume
            # else: 0 — below average volume = no support

        # ── MOMENTUM SCORE (max 2.0 points → 20%) ───────────────
        momentum_pts = 0.0

        # ROC (Rate of Change) is a better momentum indicator
        effective_momentum = roc if abs(roc) > 0 else momentum
        if effective_momentum > 0.05:
            momentum_pts += 1.0    # Strong positive momentum
        elif effective_momentum > 0.02:
            momentum_pts += 0.75
        elif effective_momentum > 0:
            momentum_pts += 0.5    # Mild positive

        # MACD confirmation
        if macd > macd_signal and macd > 0:
            momentum_pts += 1.0    # MACD bullish crossover + above zero
        elif macd > macd_signal:
            momentum_pts += 0.5    # MACD bullish crossover (below zero)
        elif macd > 0:
            momentum_pts += 0.25   # At least MACD positive

        momentum_pts = min(2.0, momentum_pts)

        # ── ADX SCORE (max 1.5 points → 15%) ────────────────────
        adx_pts = 0.0

        if adx >= 50:
            adx_pts = 1.5   # Very strong trend (TYCN=57, ISMA=99)
        elif adx >= 35:
            adx_pts = 1.25  # Strong trend
        elif adx >= 25:
            adx_pts = 1.0   # Trend confirmed
        elif adx >= 20:
            adx_pts = 0.5   # Weak trend forming
        # Below 20 = no trend / choppy → 0 points

        # ── RSI SCORE (max 1.0 point → 10%) ─────────────────────
        # KEY CHANGE: High RSI is GOOD for momentum stocks!
        # TYCN had RSI=96 and gained +72.8%
        rsi_pts = 0.0

        if rsi >= 70:
            rsi_pts = 1.0    # Strong momentum (NOT overbought!)
        elif rsi >= 55:
            rsi_pts = 0.75   # Healthy bullish momentum
        elif rsi >= 45:
            rsi_pts = 0.5    # Neutral momentum
        elif rsi >= 30:
            rsi_pts = 0.25   # Weakening
        # RSI < 30 = 0 points (selling pressure, no momentum)

        # ── TOTAL SCORE ──────────────────────────────────────────
        raw_score = trend_pts + volume_pts + momentum_pts + adx_pts + rsi_pts
        
        # ── MARKET MAKER PHASE ADJUSTMENTS ──
        mm_dist = _f("MM_Distribution", 0.0)
        mm_accum = _f("MM_Accumulation", 0.0)
        cmf_20 = _f("CMF_20", 0.0)

        # Downgrade score if in distribution phase or negative money flow
        if mm_dist > 0.5:
            raw_score -= 3.0  # Heavy penalty for distribution (avoid buying near tops)
        elif cmf_20 < -0.05:
            raw_score -= 1.5

        # Upgrade score if in accumulation phase or positive money flow
        if mm_accum > 0.5:
            raw_score += 1.0  # Bonus for accumulation support
        elif cmf_20 > 0.10:
            raw_score += 0.5

        return int(round(min(10, max(0, raw_score))))

    except Exception:
        return 5  # Neutral fallback on error


def get_acceleration_breakdown(row) -> Dict[str, Any]:
    """
    Return a detailed breakdown of each score component for debugging/UI.

    Returns:
        Dict with keys: trend, volume, momentum, adx, rsi, total,
        and their max values for display.
    """
    try:
        r = row.iloc[0] if hasattr(row, 'iloc') else row

        def _f(key, default=0.0):
            if key in r:
                v = r.get(key) if hasattr(r, 'get') else r[key]
                try:
                    val = float(v)
                    return val if np.isfinite(val) else default
                except (TypeError, ValueError):
                    return default
            return default

        close = _f("Close", _f("close", 0.0))
        ema50 = _f("EMA_50", _f("ema_50", 0.0))
        ema200 = _f("EMA_200", _f("ema_200", 0.0))
        adx = _f("ADX_14", _f("adx_14", 0.0))
        rsi = _f("RSI", _f("rsi_14", 50.0))
        r_vol = _f("R_VOL", 0.0)
        volume = _f("Volume", _f("volume", 0.0))
        vol_sma20 = _f("VOL_SMA20", _f("vol_sma20", 1.0))

        if r_vol <= 0 and vol_sma20 > 0 and volume > 0:
            r_vol = volume / vol_sma20

        total = calculate_acceleration_score(row)

        return {
            "total": total,
            "close": round(close, 2),
            "ema50": round(ema50, 2),
            "ema200": round(ema200, 2),
            "adx": round(adx, 1),
            "rsi": round(rsi, 1),
            "r_vol": round(r_vol, 2),
            "trend_weight": "30%",
            "volume_weight": "25%",
            "momentum_weight": "20%",
            "adx_weight": "15%",
            "rsi_weight": "10%",
        }
    except Exception:
        return {"total": 5, "error": "calculation failed"}


# ──────────────────────────────────────────────────────────────────────
#  2. DYNAMIC RISK MANAGEMENT
# ──────────────────────────────────────────────────────────────────────

# Risk profiles keyed by score range
_RISK_PROFILES = {
    # score_min, score_max → (sl_pct, tp_pct, risk_reward, label_ar, label_en)
    (9, 10): {
        "stop_loss_pct": 0.12,      # WIDER: 12% stop loss (was 10%) — wide room to breathe
        "target_pct": 0.30,         # 30% target — ride the wave
        "risk_reward": 2.5,
        "label_ar": "ركوب الموجة — ريسك عالي وهدف كبير",
        "label_en": "Wave Rider — High risk, high reward",
        "max_target_cap": 0.40,     # Allow up to 40% target for extreme cases
        "trailing_start_pct": 0.10, # Start trailing at +10% profit
    },
    (7, 8): {
        "stop_loss_pct": 0.09,      # WIDER: 9% stop loss (was 7%)
        "target_pct": 0.20,         # 20% target (was 18%)
        "risk_reward": 2.2,
        "label_ar": "صفقة قوية — مساحة تنفس جيدة",
        "label_en": "Strong Setup — Good breathing room",
        "max_target_cap": 0.30,
        "trailing_start_pct": 0.08,
    },
    (5, 6): {
        "stop_loss_pct": 0.06,      # WIDER: 6% stop loss (was 5%)
        "target_pct": 0.12,         # 12% target (was 10%)
        "risk_reward": 2.0,
        "label_ar": "صفقة متوازنة — ريسك معتدل",
        "label_en": "Balanced Setup — Moderate risk",
        "max_target_cap": 0.18,
        "trailing_start_pct": 0.06,
    },
    (0, 4): {
        "stop_loss_pct": 0.045,     # WIDER: 4.5% stop loss (was 3.5%)
        "target_pct": 0.08,         # 8% target (was 6%)
        "risk_reward": 1.7,
        "label_ar": "صفقة تحفظية — ريسك منخفض",
        "label_en": "Conservative Setup — Low risk",
        "max_target_cap": 0.12,
        "trailing_start_pct": 0.04,
    },
}


def _get_risk_profile(score: int) -> Dict[str, Any]:
    """Get the risk profile matching the given score."""
    for (lo, hi), profile in _RISK_PROFILES.items():
        if lo <= score <= hi:
            return profile
    return _RISK_PROFILES[(0, 4)]  # Fallback to conservative


def calculate_dynamic_risk(
    score: int,
    last_close: float,
    atr: float = 0.0,
    adx: float = 0.0,
    r_vol: float = 1.0,
) -> Dict[str, Any]:
    """
    Calculate dynamic target price and stop loss based on acceleration score.

    For high-score stocks (9+), we use wider stops and higher targets
    to ride the wave and capture gains above 20%.

    Args:
        score: Acceleration score (0-10)
        last_close: Current stock price
        atr: Average True Range (14-period). Used for fine-tuning.
        adx: ADX value. Higher ADX = can push target even further.
        r_vol: Relative Volume. Higher = more confidence in the move.

    Returns:
        Dict with target_price, stop_loss, risk_profile, and metadata.
    """
    if last_close <= 0:
        return {
            "target_price": 0.0,
            "stop_loss": 0.0,
            "risk_profile": "invalid",
            "target_pct": 0.0,
            "stop_loss_pct": 0.0,
        }

    profile = _get_risk_profile(score)
    base_tp_pct = profile["target_pct"]
    base_sl_pct = profile["stop_loss_pct"]
    max_cap = profile["max_target_cap"]

    # ── Fine-tune based on ADX and Volume ──
    tp_pct = base_tp_pct
    sl_pct = base_sl_pct

    # If ADX is very high (>50), the trend is exceptionally strong
    # → Push target even higher (up to +30% additional)
    if adx > 60:
        tp_pct = min(max_cap, tp_pct * 1.30)  # +30% target boost
    elif adx > 45:
        tp_pct = min(max_cap, tp_pct * 1.15)  # +15% target boost

    # If Relative Volume is very high (>2x), smart money is in
    # → Slightly wider stop to avoid shakeout, push target
    if r_vol >= 3.0:
        sl_pct = min(0.15, sl_pct * 1.20)     # 20% wider stop (max 15%)
        tp_pct = min(max_cap, tp_pct * 1.15)   # +15% target boost
    elif r_vol >= 2.0:
        sl_pct = min(0.15, sl_pct * 1.10)     # 10% wider stop

    # ── ATR-based adjustment for volatility (widen stops for volatile stocks) ──
    if atr > 0 and last_close > 0:
        atr_pct = atr / last_close  # ATR as percentage of price
        # Determine ATR multiplier based on score to prevent stop hunting
        sl_multiplier = 2.5 if score >= 9 else 2.2 if score >= 7 else 2.0
        atr_sl = atr_pct * sl_multiplier
        if sl_pct < atr_sl:
            sl_pct = min(0.15, atr_sl)  # Wide enough to avoid shakeouts, capped at 15%

    # ── Calculate prices ──
    target_price = round(last_close * (1.0 + tp_pct), 2)
    stop_loss = round(last_close * (1.0 - sl_pct), 2)

    # Safety: stop_loss must be positive
    stop_loss = max(stop_loss, round(last_close * 0.85, 2))  # Never more than 15% loss

    return {
        "target_price": target_price,
        "stop_loss": stop_loss,
        "target_pct": round(tp_pct * 100, 1),
        "stop_loss_pct": round(sl_pct * 100, 1),
        "risk_reward": round(tp_pct / sl_pct, 1) if sl_pct > 0 else 0.0,
        "risk_profile": profile["label_en"],
        "risk_profile_ar": profile["label_ar"],
        "trailing_start_pct": profile["trailing_start_pct"],
        "score": score,
    }


def get_risk_profile_label(score: int, lang: str = "ar") -> str:
    """Get human-readable risk profile label for a given score."""
    profile = _get_risk_profile(score)
    if lang == "ar":
        return profile["label_ar"]
    return profile["label_en"]


# ──────────────────────────────────────────────────────────────────────
#  3. ENHANCED SENTIMENT SCORE (Momentum-First)
# ──────────────────────────────────────────────────────────────────────

def calculate_momentum_sentiment(row) -> int:
    """
    Calculate sentiment score (1-10) using momentum-first philosophy.

    Unlike the old system that penalized high RSI, this system rewards:
    - Strong momentum (ROC, MACD direction)
    - High relative volume (institutional buying)
    - Price breaking above key levels

    Returns:
        int: Score from 1 to 10
    """
    score = 5  # Neutral start
    try:
        r = row.iloc[0] if hasattr(row, 'iloc') else row

        def _f(key, default=0.0):
            if key in r:
                v = r.get(key) if hasattr(r, 'get') else r[key]
                try:
                    val = float(v)
                    return val if np.isfinite(val) else default
                except (TypeError, ValueError):
                    return default
            return default

        momentum = _f("Momentum", _f("momentum_10", 0.0))
        rsi = _f("RSI", _f("rsi_14", 50.0))
        r_vol = _f("R_VOL", 0.0)
        volume = _f("Volume", _f("volume", 0.0))
        vol_sma20 = _f("VOL_SMA20", _f("vol_sma20", 1.0))
        adx = _f("ADX_14", _f("adx_14", 0.0))
        macd = _f("MACD", _f("macd", 0.0))
        macd_signal = _f("MACD_Signal", _f("macd_signal", 0.0))

        if r_vol <= 0 and vol_sma20 > 0 and volume > 0:
            r_vol = volume / vol_sma20

        # Momentum direction (+2/-2)
        if momentum > 0.03:
            score += 2
        elif momentum > 0:
            score += 1
        elif momentum < -0.03:
            score -= 2
        elif momentum < 0:
            score -= 1

        # RSI as momentum gauge (not mean reversion!)
        if rsi > 70:
            score += 2   # Strong buying pressure
        elif rsi > 55:
            score += 1   # Healthy bullish
        elif rsi < 25:
            score -= 2   # Panic selling
        elif rsi < 40:
            score -= 1   # Bearish pressure

        # Volume confirmation (+2/-1)
        if r_vol > 2.0:
            score += 2   # Heavy institutional buying
        elif r_vol > 1.3:
            score += 1   # Above average interest
        elif r_vol < 0.5:
            score -= 1   # No interest / drying up

        # ADX trend strength bonus
        if adx > 40:
            score += 1   # Very strong directional move

        # MACD momentum
        if macd > macd_signal and macd > 0:
            score += 1   # Bullish and accelerating

    except Exception:
        pass

    return min(10, max(1, score))
