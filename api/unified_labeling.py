"""
Unified Triple Barrier Labeling Module

This module provides consistent labeling logic used across:
- Training (to create labels for supervised learning)
- Backtesting (to simulate trade outcomes)
- Live Bot (to evaluate trade potential)

By centralizing this logic, we ensure that all three components
use the same definitions of profit/loss, preventing discrepancies.

Key Concepts:
    - Entry Price: The price at which a trade is entered
    - Take Profit: Price at which profit is realized
    - Stop Loss: Price at which loss is cut
    - Look-Forward Window: How many bars to look ahead for TP/SL hit
    - Volume Confirmation: Whether volume must be above average for TP
"""

from typing import Tuple, Dict, Any, Optional, List
import numpy as np
import pandas as pd
from dataclasses import dataclass

from api.trading_config import TradingParameters


@dataclass
class TradeOutcome:
    """Result of a single trade"""
    outcome: str  # "TP_HIT" | "SL_HIT" | "HOLD" | "TIMEOUT"
    exit_price: float
    exit_bars: int
    pnl_pct: float
    exit_reason: str = ""


class TripleBarrierLabeler:
    """
    Unified triple barrier labeling logic.
    
    Used in three contexts:
    1. Training: Label historical data for supervised learning
    2. Backtesting: Simulate trade outcomes
    3. Live Bot: Evaluate potential trades
    """
    
    def __init__(self, params: TradingParameters):
        """
        Initialize labeler with trading parameters.
        
        Args:
            params: TradingParameters instance with all settings
        """
        self.params = params
        self._cached_tp: Optional[float] = None
        self._cached_sl: Optional[float] = None
    
    def calculate_barriers(
        self,
        entry_price: float,
        atr: Optional[float] = None
    ) -> Tuple[float, float]:
        """
        Calculate Take Profit and Stop Loss barriers.
        
        Returns:
            (tp_price, sl_price) tuple
            
        Uses parameters from self.params:
        - barrier_mode: "percent" or "atr_multiplier"
        - target_pct: profit target
        - stop_loss_pct: loss limit
        """
        if entry_price <= 0:
            raise ValueError(f"Entry price must be positive: {entry_price}")
        
        if self.params.barrier_mode == "percent":
            tp = entry_price * (1.0 + self.params.target_pct)
            sl = entry_price * (1.0 - self.params.stop_loss_pct)
        
        elif self.params.barrier_mode == "atr_multiplier":
            if atr is None or atr <= 0:
                raise ValueError(
                    f"ATR required for atr_multiplier mode, got: {atr}"
                )
            tp = entry_price + (atr * self.params.target_pct)
            sl = entry_price - (atr * self.params.stop_loss_pct)
        
        else:
            raise ValueError(
                f"Unknown barrier_mode: {self.params.barrier_mode}"
            )
        
        self._cached_tp = tp
        self._cached_sl = sl
        
        return tp, sl
    
    def label_single_trade(
        self,
        entry_idx: int,
        high_window: np.ndarray,
        low_window: np.ndarray,
        volume_window: Optional[np.ndarray] = None,
        volume_ma_20: Optional[float] = None,
    ) -> int:
        """
        Label whether a trade would be WIN (1) or LOSS (0).
        
        This is the core labeling logic used during training.
        
        Args:
            entry_idx: Index of entry bar (for reference only)
            high_window: High prices in look-forward window
            low_window: Low prices in look-forward window
            volume_window: Volume in window (if volume confirmation needed)
            volume_ma_20: 20-day average volume (if volume confirmation needed)
            
        Returns:
            1 if TP hit before SL (and volume confirmed if required)
            0 otherwise (SL hit, neither hit, or volume not confirmed)
            
        Logic:
            1. Check if TP was ever touched in window
            2. Check if SL was ever touched in window
            3. If both touched, determine which came first
            4. If TP first and volume confirmation required, check volume
            5. Return 1 for TP win, 0 for SL loss or no volume
        """
        if self._cached_tp is None or self._cached_sl is None:
            raise ValueError(
                "Must call calculate_barriers() before label_single_trade()"
            )
        
        tp = self._cached_tp
        sl = self._cached_sl
        
        # Check which barrier was hit first
        tp_hit = np.any(high_window >= tp)
        sl_hit = np.any(low_window <= sl)
        
        # If TP not hit, definitely a loss
        if not tp_hit:
            return 0
        
        # If SL also hit, check which came first
        if sl_hit:
            tp_idx = np.argmax(high_window >= tp)
            sl_idx = np.argmax(low_window <= sl)
            
            # If SL hit at same bar or earlier, it's a loss
            if sl_idx <= tp_idx:
                return 0
        
        # TP hit first, but might fail volume confirmation
        if self.params.require_volume_confirmation:
            if volume_window is None or volume_ma_20 is None or volume_ma_20 <= 0:
                # Can't confirm volume, accept as win
                return 1
            
            # Check if average volume during TP bars >= threshold
            avg_volume = np.mean(volume_window)
            min_required_volume = volume_ma_20 * self.params.min_volume_ratio
            
            if avg_volume < min_required_volume:
                # Volume confirmation failed
                return 0
        
        # All checks passed
        return 1
    
    def backtest_trade(
        self,
        entry_price: float,
        atr: float,
        bars_ahead: List[Dict[str, float]],
        max_bars: Optional[int] = None,
        volume_ma_20: Optional[float] = None,
    ) -> TradeOutcome:
        """
        Simulate a complete trade from entry to exit.
        
        This is used in backtesting to evaluate trade outcomes.
        
        Args:
            entry_price: Price at which position is entered
            atr: ATR value for barrier calculation
            bars_ahead: List of bars with 'high', 'low', 'close', 'volume'
            max_bars: Maximum bars to hold (defaults to look_forward_days)
            volume_ma_20: 20-bar average volume (for volume confirmation)
            
        Returns:
            TradeOutcome with exit price, reason, and P&L
            
        Process:
            1. Calculate TP/SL based on entry and ATR
            2. Iterate through bars until TP/SL hit or timeout
            3. Return outcome with exit price and reason
        """
        if max_bars is None:
            max_bars = self.params.look_forward_days
        
        tp, sl = self.calculate_barriers(entry_price, atr)
        
        for bar_idx, bar in enumerate(bars_ahead):
            # Timeout: exceeded look-forward period
            if bar_idx >= max_bars:
                exit_price = bar.get("close", entry_price)
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
                return TradeOutcome(
                    outcome="TIMEOUT",
                    exit_price=exit_price,
                    exit_bars=bar_idx,
                    pnl_pct=pnl_pct,
                    exit_reason=f"Exceeded {max_bars} bar limit"
                )
            
            high = bar.get("high", 0)
            low = bar.get("low", 0)
            close = bar.get("close", entry_price)
            
            # Check SL first (more urgent)
            if low <= sl:
                pnl_pct = ((sl - entry_price) / entry_price) * 100
                return TradeOutcome(
                    outcome="SL_HIT",
                    exit_price=sl,
                    exit_bars=bar_idx,
                    pnl_pct=pnl_pct,
                    exit_reason="Stop loss triggered"
                )
            
            # Check TP
            if high >= tp:
                # If volume confirmation required, verify it
                if self.params.require_volume_confirmation and volume_ma_20 is not None and volume_ma_20 > 0:
                    vol_vals = [b.get("volume", 0.0) for b in bars_ahead[:bar_idx + 1]]
                    avg_vol = np.mean(vol_vals) if vol_vals else 0.0
                    min_req = volume_ma_20 * self.params.min_volume_ratio
                    if avg_vol < min_req:
                        # Volume confirmation failed, keep scanning
                        continue
                
                pnl_pct = ((tp - entry_price) / entry_price) * 100
                return TradeOutcome(
                    outcome="TP_HIT",
                    exit_price=tp,
                    exit_bars=bar_idx,
                    pnl_pct=pnl_pct,
                    exit_reason="Take profit hit"
                )
        
        # Fallback if no bars (shouldn't happen)
        return TradeOutcome(
            outcome="HOLD",
            exit_price=entry_price,
            exit_bars=0,
            pnl_pct=0.0,
            exit_reason="No bars to process"
        )
    
    def label_training_data(
        self,
        df: pd.DataFrame,
        drop_labels: bool = True,
    ) -> pd.DataFrame:
        """
        Label historical data for training.
        
        This is a convenience method that applies labeling to a full
        DataFrame of historical data.
        
        Args:
            df: DataFrame with OHLCV data
            drop_labels: If True, remove last look_forward_days rows
            
        Returns:
            DataFrame with added 'Target' column (0 or 1)
        """
        out = df.copy()
        
        # Ensure required columns
        close_col = "Close" if "Close" in out.columns else "close"
        high_col = "High" if "High" in out.columns else "high"
        low_col = "Low" if "Low" in out.columns else "low"
        open_col = "Open" if "Open" in out.columns else "open"
        volume_col = None
        
        if "Volume" in out.columns:
            volume_col = "Volume"
        elif "volume" in out.columns:
            volume_col = "volume"
        
        if close_col not in out.columns:
            raise ValueError(f"Missing close price column")
        
        # Entry logic: entry at next open to prevent look-ahead bias
        out["entry_price"] = out[open_col].shift(-1)
        
        if "ATR_14" not in out.columns:
            # Simple fallback ATR
            out["ATR_14"] = out[close_col].rolling(14).std().bfill()
        
        shifted_atr = out["ATR_14"].shift(-1)
        
        # Calculate barriers
        if self.params.barrier_mode == "percent":
            out["tp_barrier"] = out["entry_price"] * (1 + self.params.target_pct)
            out["sl_barrier"] = out["entry_price"] * (1 - self.params.stop_loss_pct)
        else:
            out["tp_barrier"] = out["entry_price"] + (shifted_atr * self.params.target_pct)
            out["sl_barrier"] = out["entry_price"] - (shifted_atr * self.params.stop_loss_pct)
        
        # Initialize labels
        targets = np.zeros(len(out), dtype=int)
        
        # Extract to arrays for speed
        high_vals = out[high_col].values
        low_vals = out[low_col].values
        tp_vals = out["tp_barrier"].values
        sl_vals = out["sl_barrier"].values
        volume_vals = out[volume_col].values if volume_col else None
        
        # Calculate volume MA if needed
        vol_ma_vals = None
        if self.params.require_volume_confirmation and volume_vals is not None:
            volume_ma_20 = out[volume_col].rolling(20).mean()
            vol_ma_vals = volume_ma_20.values
        
        # Label each row
        for i in range(len(out) - self.params.look_forward_days - 1):
            if not (np.isfinite(tp_vals[i]) and np.isfinite(sl_vals[i])):
                continue
            
            # Get window
            high_window = high_vals[i+1:i+self.params.look_forward_days+1]
            low_window = low_vals[i+1:i+self.params.look_forward_days+1]
            
            # Check barriers
            tp_hit = np.any(high_window >= tp_vals[i])
            sl_hit = np.any(low_window <= sl_vals[i])
            
            if not tp_hit:
                targets[i] = 0
                continue
            
            if sl_hit:
                tp_idx = np.argmax(high_window >= tp_vals[i])
                sl_idx = np.argmax(low_window <= sl_vals[i])
                if sl_idx <= tp_idx:
                    targets[i] = 0
                    continue
            
            # TP hit, check volume if needed
            if self.params.require_volume_confirmation and volume_vals is not None and vol_ma_vals is not None:
                if vol_ma_vals[i] > 0:
                    tp_idx = np.argmax(high_window >= tp_vals[i])
                    vol_window = volume_vals[i+1:i+tp_idx+2]
                    if len(vol_window) > 0:
                        avg_vol = np.mean(vol_window)
                        min_req = vol_ma_vals[i] * self.params.min_volume_ratio
                        if avg_vol < min_req:
                            targets[i] = 0
                            continue
            
            targets[i] = 1
        
        out["Target"] = targets
        
        # Cleanup
        out.drop(columns=["entry_price", "tp_barrier", "sl_barrier"], inplace=True, errors="ignore")
        
        # Remove labels at end (can't label them without future data)
        if drop_labels:
            out = out.iloc[:-self.params.look_forward_days].copy()
        
        return out
    
    @staticmethod
    def validate_trade_outcome(outcome: TradeOutcome) -> Tuple[bool, List[str]]:
        """
        Validate a trade outcome for correctness.
        
        Returns:
            (is_valid, list_of_errors)
        """
        errors = []
        
        valid_outcomes = ["TP_HIT", "SL_HIT", "HOLD", "TIMEOUT"]
        if outcome.outcome not in valid_outcomes:
            errors.append(f"Invalid outcome: {outcome.outcome}")
        
        if outcome.exit_price < 0:
            errors.append(f"Exit price cannot be negative: {outcome.exit_price}")
        
        if outcome.exit_bars < 0:
            errors.append(f"Exit bars cannot be negative: {outcome.exit_bars}")
        
        if not (-100 <= outcome.pnl_pct <= 1000):
            errors.append(f"P&L seems extreme: {outcome.pnl_pct}%")
        
        return len(errors) == 0, errors
