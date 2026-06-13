from __future__ import annotations
import numpy as np
import pandas as pd
from typing import Any, Dict, Optional, Tuple
from api.model_utils import align_pandas_categories_to_booster, align_for_king

class StrategyEngine:
    """
    Centralized decision logic engine shared between Backtesting, Live Bot, and Strategy Tester.
    Guarantees 100% logic alignment across the entire application ecosystem.
    """
    
    @staticmethod
    def _normalize_bars(bars: pd.DataFrame) -> pd.DataFrame:
        """Helper to ensure column names are case-insensitive and unique to avoid duplication bugs."""
        if bars is None or bars.empty:
            return bars
        bars = bars.copy()
        # Keep only the first occurrence of each lowercase column name to prevent duplication errors
        bars = bars.loc[:, ~bars.columns.str.lower().duplicated()]
        bars.columns = [c.lower() for c in bars.columns]
        return bars

    @staticmethod
    def calculate_rsi(prices: pd.Series, period: int = 14) -> float:
        if len(prices) < period:
            return 50.0
        try:
            delta = prices.diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
            
            rs = gain.iloc[-1] / loss.iloc[-1] if loss.iloc[-1] != 0 else 100
            rsi = 100 - (100 / (1 + rs))
            return float(rsi) if np.isfinite(rsi) else 50.0
        except Exception:
            return 50.0

    @staticmethod
    def calculate_adx(bars: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average Directional Index for trend strength."""
        try:
            bars = StrategyEngine._normalize_bars(bars)
            if len(bars) < period * 2:
                return 0.0
            high = bars['high'].values
            low = bars['low'].values
            close = bars['close'].values

            plus_dm = np.zeros(len(high))
            minus_dm = np.zeros(len(high))
            tr = np.zeros(len(high))

            for i in range(1, len(high)):
                h_diff = high[i] - high[i-1]
                l_diff = low[i-1] - low[i]
                plus_dm[i] = max(h_diff, 0) if h_diff > l_diff else 0
                minus_dm[i] = max(l_diff, 0) if l_diff > h_diff else 0
                tr[i] = max(high[i] - low[i], abs(high[i] - close[i-1]), abs(low[i] - close[i-1]))

            # Smoothed averages
            atr = pd.Series(tr).rolling(period).mean().values
            plus_di = 100 * pd.Series(plus_dm).rolling(period).mean().values / np.where(atr > 0, atr, 1)
            minus_di = 100 * pd.Series(minus_dm).rolling(period).mean().values / np.where(atr > 0, atr, 1)

            dx = 100 * np.abs(plus_di - minus_di) / np.where((plus_di + minus_di) > 0, plus_di + minus_di, 1)
            adx = pd.Series(dx).rolling(period).mean().iloc[-1]
            return float(adx) if np.isfinite(adx) else 0.0
        except Exception:
            return 0.0

    @staticmethod
    def calculate_atr(bars: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average True Range."""
        try:
            bars = StrategyEngine._normalize_bars(bars)
            if len(bars) < period + 1:
                return 0.0
            high = bars['high'].values
            low = bars['low'].values
            close = bars['close'].values

            tr = np.zeros(len(high))
            for i in range(1, len(high)):
                tr[i] = max(high[i] - low[i], abs(high[i] - close[i-1]), abs(low[i] - close[i-1]))

            atr = pd.Series(tr[1:]).rolling(period).mean().iloc[-1]
            return float(atr) if np.isfinite(atr) else 0.0
        except Exception:
            return 0.0

    @staticmethod
    def check_technical_filters(
        bars: pd.DataFrame,
        min_volume_ratio: float,
        use_trend_filter: bool,
        use_rsi_filter: bool,
        mode_overrides: Optional[dict] = None
    ) -> Tuple[bool, str]:
        """Verify volume, trend, and RSI filters before entering."""
        bars = StrategyEngine._normalize_bars(bars)
        if bars.empty or len(bars) < 25:
            return False, "Insufficient data"
        
        ov = mode_overrides or {}
        
        try:
            # 1. Volume Filter
            if min_volume_ratio > 0:
                recent_volume = bars['volume'].iloc[-5:].mean()
                avg_volume = bars['volume'].iloc[-25:-5].mean()
                effective_vol_ratio = min_volume_ratio * ov.get("volume_mult", 1.0)
                if avg_volume > 0 and recent_volume < avg_volume * effective_vol_ratio:
                    return False, f"Low relative volume ({recent_volume/avg_volume:.2f}x < {effective_vol_ratio:.2f}x)"

            # 2. Trend Filter (SMA20)
            if use_trend_filter and not ov.get("skip_trend_filter", False):
                closes = bars['close'].iloc[-20:]
                sma_20 = closes.mean()
                current_price = bars['close'].iloc[-1]
                sma20_tolerance = 0.03
                if current_price < sma_20 * (1 - sma20_tolerance):
                    return False, f"Price below SMA20 tolerance ({current_price:.4f} < {sma_20 * (1 - sma20_tolerance):.4f})"

            # 3. RSI Filter
            if use_rsi_filter:
                closes = bars['close'].iloc[-25:]
                rsi = StrategyEngine.calculate_rsi(closes, 14)
                if rsi > 70:
                    return False, f"RSI Overbought ({rsi:.1f} > 70)"
                elif rsi < 30:
                    return False, f"RSI Oversold ({rsi:.1f} < 30)"
            
            return True, "Filters passed"
        except Exception as e:
            return False, f"Filter Error: {e}"

    @staticmethod
    def check_smart_exit(
        bars: pd.DataFrame,
        entry_price: float,
        current_price: float,
        use_smart_exit: bool,
        rsi_threshold: float,
        volume_spike_multiplier: float
    ) -> Tuple[bool, str]:
        """Determine if price momentum warrants an early exit."""
        bars = StrategyEngine._normalize_bars(bars)
        if not use_smart_exit or len(bars) < 25:
            return False, ""
        
        try:
            pnl_pct = (current_price - entry_price) / entry_price
            rsi = StrategyEngine.calculate_rsi(bars['close'].iloc[-25:], 14)

            # 1. RSI dropping hard (momentum collapse)
            if rsi < rsi_threshold:
                if pnl_pct > 0.01:
                    return True, f"SMART EXIT: RSI={rsi:.1f} dropping while in profit (+{pnl_pct*100:.1f}%)"
                elif pnl_pct < -0.02:
                    return True, f"SMART EXIT: Momentum collapsed (RSI={rsi:.1f}) in loss (-{abs(pnl_pct*100):.1f}%)"

            # 2. Volume spike on red candle (panic selling)
            last_candle = bars.iloc[-1]
            if last_candle['close'] < last_candle['open']:
                recent_vol = bars['volume'].iloc[-1]
                avg_vol = bars['volume'].iloc[-20:-1].mean()
                if avg_vol > 0 and recent_vol > avg_vol * volume_spike_multiplier:
                    return True, f"SMART EXIT: Volume spike {recent_vol/avg_vol:.1f}x on red candle"
            
            return False, ""
        except Exception:
            return False, ""

    @staticmethod
    def detect_market_regime(
        bars: pd.DataFrame,
        use_market_regime: bool = True,
        regime_adx_threshold: float = 14.0
    ) -> str:
        """Detect market regime: 'STRONG_BULL', 'BULL', 'BEAR', or 'SIDEWAYS'."""
        bars = StrategyEngine._normalize_bars(bars)
        if not use_market_regime or len(bars) < 60:
            return "UNKNOWN"
        
        try:
            adx = StrategyEngine.calculate_adx(bars, 14)
            closes = bars['close'].iloc[-50:]
            sma50 = closes.mean()
            sma50_prev = bars['close'].iloc[-55:-5].mean()
            sma_slope = (sma50 - sma50_prev) / sma50_prev if sma50_prev > 0 else 0
            current_price = bars['close'].iloc[-1]
            
            # Check for STRONG_BULL (Inflation run)
            if len(bars) >= 200:
                sma200 = bars['close'].iloc[-200:].mean()
            else:
                sma200 = bars['close'].mean()
                
            roc_3m = (current_price / bars['close'].iloc[-60]) - 1.0
            
            if roc_3m > 0.20 and sma50 > sma200:
                return "STRONG_BULL"
            
            if adx < regime_adx_threshold:
                regime = "SIDEWAYS"
            elif current_price > sma50 and sma_slope > 0:
                regime = "BULL"
            elif current_price < sma50 and sma_slope < 0:
                regime = "BEAR"
            else:
                regime = "SIDEWAYS"
                
            return regime
        except Exception:
            return "UNKNOWN"

    @staticmethod
    def calculate_atr_exits(
        bars: pd.DataFrame,
        entry_price: float,
        target_pct: float,
        stop_loss_pct: float,
        use_atr_exits: bool = True,
        atr_sl_multiplier: float = 1.5,
        atr_tp_multiplier: float = 2.5,
        atr_period: int = 14,
        exit_mode: str = "hybrid"
    ) -> Tuple[float, float]:
        """
        Calculate dynamic TP/SL based on ATR and exit_mode.
        Returns (take_profit_price, stop_loss_price).
        """
        bars = StrategyEngine._normalize_bars(bars)
        manual_tp = entry_price * (1 + target_pct)
        manual_sl = entry_price * (1 - stop_loss_pct)

        if exit_mode.lower() == "manual" or not use_atr_exits:
            return manual_tp, manual_sl

        try:
            atr = StrategyEngine.calculate_atr(bars, atr_period)
            if atr <= 0:
                return manual_tp, manual_sl

            atr_tp = entry_price + (atr * atr_tp_multiplier)
            atr_sl = entry_price - (atr * atr_sl_multiplier)

            # Sanity: ensure SL isn't too tight or TP isn't too loose
            min_sl_dist = entry_price * 0.03  # At least 3% breathing room
            max_tp_dist = entry_price * 0.30  # At most 30%
            atr_sl = min(atr_sl, entry_price - min_sl_dist)
            atr_tp = min(atr_tp, entry_price + max_tp_dist)

            if exit_mode.lower() == "hybrid":
                tp = max(atr_tp, manual_tp)
                sl = min(atr_sl, manual_sl)
            else:
                tp = atr_tp
                sl = atr_sl

            return tp, sl
        except Exception:
            return manual_tp, manual_sl
