"""
Strict Quality-Focused Labeling for Egyptian Exchange (EGX)

Requirements:
- Requirement 7.1: label a trade as 1 only if TP is hit within first 7 days (not 20 days)
- Requirement 7.2: check if volume on signal day exceeds 20-day average volume
- Requirement 7.3: if signal-day volume is <= 20-day average, label the trade as 0
- Requirement 7.4: exclude labels where the stock is on circuit breaker on signal day
- Requirement 7.5: when EGX30 daily return is < -2% on signal day, label the trade as 0
- Requirement 7.6: count and log how many potential winning trades are rejected due to quality filters
- Requirement 7.7: ensure quality-filtered labels produce higher precision
"""

import logging
import numpy as np
import pandas as pd
from typing import Optional, Tuple, List, Dict

from api.unified_labeling import TripleBarrierLabeler
from api.trading_config import TradingParameters

logger = logging.getLogger(__name__)

class StrictQualityLabeler(TripleBarrierLabeler):
    """
    EGX-specific Strict Quality-Focused Labeler.
    Extends TripleBarrierLabeler to filter out lower probability setups.
    """
    
    def label_training_data_strict(
        self,
        df: pd.DataFrame,
        egx30_data: Optional[pd.DataFrame] = None,
        drop_labels: bool = True
    ) -> Tuple[pd.DataFrame, Dict[str, int]]:
        """
        Label historical data with strict EGX quality filters.
        
        Args:
            df: DataFrame with OHLCV data
            egx30_data: Optional DataFrame with EGX30 index data containing 'egx30_return'
            drop_labels: If True, remove last look_forward_days rows
            
        Returns:
            Tuple of (DataFrame with added 'Target' column, dict of rejection counts)
        """
        out = df.copy()
        
        # Identify columns
        close_col = "Close" if "Close" in out.columns else "close"
        high_col = "High" if "High" in out.columns else "high"
        low_col = "Low" if "Low" in out.columns else "low"
        open_col = "Open" if "Open" in out.columns else "open"
        volume_col = "Volume" if "Volume" in out.columns else "volume"
        
        if close_col not in out.columns:
            raise ValueError("Missing close price column")
            
        # Entry logic: next open (Requirement 1.1)
        out["entry_price"] = out[open_col].shift(-1)
        
        if "ATR_14" not in out.columns:
            out["ATR_14"] = out[close_col].rolling(14).std().bfill()
        shifted_atr = out["ATR_14"].shift(-1)
        
        # Calculate barriers (Requirement 1.4, 1.5)
        if self.params.barrier_mode == "percent":
            out["tp_barrier"] = out["entry_price"] * (1 + self.params.target_pct)
            out["sl_barrier"] = out["entry_price"] * (1 - self.params.stop_loss_pct)
        else:
            out["tp_barrier"] = out["entry_price"] + (shifted_atr * self.params.target_pct)
            out["sl_barrier"] = out["entry_price"] - (shifted_atr * self.params.stop_loss_pct)
            
        # Volume MA 20
        volume_ma_20 = out[volume_col].rolling(20).mean()
        
        # Circuit Breaker flags: range < 0.1% of close or high == low (Requirement 9.1, 9.2)
        price_range = out[high_col] - out[low_col]
        circuit_breaker = (price_range / out[close_col].replace(0, np.nan)) < 0.001
        circuit_breaker = circuit_breaker | (out[high_col] == out[low_col])
        circuit_breaker_flags = circuit_breaker.fillna(False).values
        
        # EGX30 panic flag: daily return < -2% (Requirement 5.3)
        is_panic = np.zeros(len(out), dtype=bool)
        if egx30_data is not None and not egx30_data.empty:
            # Reindex egx30 to match out's index
            # Ensure indexes are datetime if they represent dates
            if not isinstance(out.index, pd.DatetimeIndex):
                out_dates = pd.to_datetime(out.index)
            else:
                out_dates = out.index
                
            if not isinstance(egx30_data.index, pd.DatetimeIndex) and 'date' in egx30_data.columns:
                egx30_temp = egx30_data.set_index(pd.to_datetime(egx30_data['date']))
            else:
                egx30_temp = egx30_data
                
            egx30_reindexed = egx30_temp.reindex(out_dates, method='ffill')
            if 'egx30_return' in egx30_reindexed.columns:
                is_panic = (egx30_reindexed['egx30_return'] < -0.02).fillna(False).values
                
        targets = np.zeros(len(out), dtype=int)
        
        high_vals = out[high_col].values
        low_vals = out[low_col].values
        tp_vals = out["tp_barrier"].values
        sl_vals = out["sl_barrier"].values
        volume_vals = out[volume_col].values
        vol_ma_vals = volume_ma_20.values
        
        # Keep track of filter impact
        rejected_counts = {
            "low_volume": 0,
            "circuit_breaker": 0,
            "market_panic": 0,
            "late_tp": 0,
            "sl_hit_first": 0,
            "no_tp_hit": 0
        }
        
        # Strict labeling look forward: TP hit within first 7 days (Requirement 7.1)
        look_forward_days = min(7, self.params.look_forward_days)
        
        for i in range(len(out) - self.params.look_forward_days - 1):
            if not (np.isfinite(tp_vals[i]) and np.isfinite(sl_vals[i])):
                continue
                
            # Scan look_forward_days for standard triple barrier outcome
            high_window = high_vals[i+1 : i+look_forward_days+1]
            low_window = low_vals[i+1 : i+look_forward_days+1]
            
            tp_hit = np.any(high_window >= tp_vals[i])
            sl_hit = np.any(low_window <= sl_vals[i])
            
            if not tp_hit:
                rejected_counts["no_tp_hit"] += 1
                continue
                
            if sl_hit:
                tp_idx = np.argmax(high_window >= tp_vals[i])
                sl_idx = np.argmax(low_window <= sl_vals[i])
                if sl_idx <= tp_idx:
                    rejected_counts["sl_hit_first"] += 1
                    continue
            
            # The trade would be a win under standard triple barrier in 7 days.
            # Now apply strict quality filters.
            
            # Quality filter 1: Volume on signal day must exceed 20-day average volume (Requirement 7.2)
            if vol_ma_vals[i] > 0 and volume_vals[i] <= vol_ma_vals[i]:
                rejected_counts["low_volume"] += 1
                continue
                
            # Quality filter 2: Exclude labels on circuit breaker day (Requirement 7.4)
            if circuit_breaker_flags[i]:
                rejected_counts["circuit_breaker"] += 1
                continue
                
            # Quality filter 3: Exclude labels when market is in panic regime (Requirement 7.5)
            if is_panic[i]:
                rejected_counts["market_panic"] += 1
                continue
                
            # Passed all strict filters
            targets[i] = 1
            
        out["Target"] = targets
        
        # Cleanup temporary columns
        out.drop(columns=["entry_price", "tp_barrier", "sl_barrier"], inplace=True, errors="ignore")
        
        if drop_labels:
            out = out.iloc[:-self.params.look_forward_days].copy()
            
        total_rejected = sum(rejected_counts.values())
        logger.info(
            f"Strict labeling complete: {targets.sum()} wins, {total_rejected} rejected by filters. "
            f"Rejections breakdown: {rejected_counts}"
        )
        
        return out, rejected_counts
