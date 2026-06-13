"""
Unit Tests for StrictQualityLabeler

Behaviour after 2025-06-12 refactor:
  - look_forward_days changed from 7 to 15 (captures more valid winning trades)
  - Volume filter is now SOFT: low-volume days get vol_below_avg=1 feature but are NOT rejected
"""

import pytest
import numpy as np
import pandas as pd

from api.trading_config import TradingParameters
from api.strict_quality_labeler import StrictQualityLabeler


class TestStrictQualityLabeler:
    """Tests for StrictQualityLabeler quality filters"""
    
    @pytest.fixture
    def default_params(self):
        return TradingParameters(
            entry_mode="next_open",
            look_forward_days=20,
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
            require_volume_confirmation=True,
            min_volume_ratio=1.0,
            min_history_needed=10,
            warmup_bars=10,
        )

    def test_strict_labeler_initialization(self, default_params):
        """Test initializing StrictQualityLabeler"""
        labeler = StrictQualityLabeler(default_params)
        assert labeler.params.look_forward_days == 20
        assert labeler.params.require_volume_confirmation is True

    def test_strict_labeling_standard_win(self, default_params):
        """Test strict labeling of a standard winning trade that passes all filters.

        With the new 15-day window, TP hit on day 3 (index 23) should label index 20 = 1.
        Index 19 also has volume=1000 which equals the rolling mean → vol_below_avg=1,
        but it is NOT rejected (soft filter), so Target depends purely on TP/SL logic.
        """
        labeler = StrictQualityLabeler(default_params)
        
        # Create a 50-bar DataFrame
        dates = pd.date_range("2024-01-01", periods=50)
        df = pd.DataFrame({
            "open": [100.0] * 50,
            "high": [101.0] * 50,
            "low": [99.0] * 50,
            "close": [100.0] * 50,
            "volume": [1000.0] * 50,
        }, index=dates)
        
        # Signal day = index 20. Entry price = open[21] = 100. TP = 110.
        # TP hit on day 3 (index 23, high = 112) → within the 15-day window → Target[20] = 1
        df.loc[dates[23], "high"] = 112.0
        # Give signal day a higher volume so it clears the average
        df.loc[dates[20], "volume"] = 1500.0

        labeled_df, rejections = labeler.label_training_data_strict(df, drop_labels=False)

        # Index 20: valid TP hit within 15 days + circuit breaker OK + no panic → 1
        assert labeled_df["Target"].iloc[20] == 1, (
            "Expected Target=1 at index 20 (TP hit within 15-day window)"
        )
        # The vol_below_avg feature column must exist
        assert "vol_below_avg" in labeled_df.columns, "vol_below_avg feature column missing"

    def test_strict_labeling_late_tp_rejection(self, default_params):
        """Test that TP hit AFTER 15 days is still rejected (was 7 days, now 15).

        TP hit at index 37 = day 16 after signal (index 20), which exceeds new 15-day limit.
        """
        labeler = StrictQualityLabeler(default_params)
        
        dates = pd.date_range("2024-01-01", periods=60)
        df = pd.DataFrame({
            "open": [100.0] * 60,
            "high": [101.0] * 60,
            "low": [99.0] * 60,
            "close": [100.0] * 60,
            "volume": [1000.0] * 60,
        }, index=dates)
        
        # Signal day = index 20. TP hit at index 37 = day 16 → beyond 15-day window.
        df.loc[dates[37], "high"] = 112.0
        df.loc[dates[20], "volume"] = 1500.0  # pass volume filter

        labeled_df, rejections = labeler.label_training_data_strict(df, drop_labels=False)

        # Target at index 20 should be 0: TP hit was on day 16, outside 15-day window
        assert labeled_df["Target"].iloc[20] == 0, (
            "Expected Target=0 at index 20 (TP hit on day 16, outside 15-day window)"
        )
        assert rejections["no_tp_hit"] > 0
