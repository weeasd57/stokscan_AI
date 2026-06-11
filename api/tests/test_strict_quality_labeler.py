"""
Unit Tests for StrictQualityLabeler

This file contains unit tests for the EGX-specific StrictQualityLabeler class.
"""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

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
        """Test strict labeling of a standard winning trade that passes all filters"""
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
        
        # Set signal day = index 20. Entry price is open at index 21 = 100.0
        # TP target is 110.0 (100 * 1.10), SL is 95.0
        # Make a clear TP hit on day 2 (index 23 high = 112.0), which is within 7 days limit
        df.loc[dates[23], "high"] = 112.0
        
        # Ensure volume on signal day (index 20) exceeds rolling average (index 0 to 19 are 1000)
        df.loc[dates[20], "volume"] = 1500.0
        
        labeled_df, rejections = labeler.label_training_data_strict(df, drop_labels=False)
        
        # The target at index 20 should be 1
        assert labeled_df["Target"].iloc[20] == 1
        # Adjacent index 19 should be 0 (rejected due to low volume)
        assert labeled_df["Target"].iloc[19] == 0

    def test_strict_labeling_late_tp_rejection(self, default_params):
        """Test rejection when TP is hit but after 7 days (e.g. day 10, index 31)"""
        labeler = StrictQualityLabeler(default_params)
        
        dates = pd.date_range("2024-01-01", periods=50)
        df = pd.DataFrame({
            "open": [100.0] * 50,
            "high": [101.0] * 50,
            "low": [99.0] * 50,
            "close": [100.0] * 50,
            "volume": [1000.0] * 50,
        }, index=dates)
        
        # Set signal day = index 20. Entry price = index 21 open = 100.0. TP = 110.0.
        # Set high on index 31 (day 10 after entry) to 112.0. This is standard win but fails strict 7-day limit.
        df.loc[dates[31], "high"] = 112.0
        df.loc[dates[20], "volume"] = 1500.0  # pass volume filter
        
        labeled_df, rejections = labeler.label_training_data_strict(df, drop_labels=False)
        
        # Target at index 20 should be 0 because TP hit was too late (day 10)
        assert labeled_df["Target"].iloc[20] == 0
        assert rejections["no_tp_hit"] > 0

    def test_strict_labeling_low_volume_rejection(self, default_params):
        """Test rejection when volume on signal day is <= 20-day MA"""
        labeler = StrictQualityLabeler(default_params)
        
        dates = pd.date_range("2024-01-01", periods=50)
        df = pd.DataFrame({
            "open": [100.0] * 50,
            "high": [101.0] * 50,
            "low": [99.0] * 50,
            "close": [100.0] * 50,
            "volume": [1000.0] * 50,
        }, index=dates)
        
        # Set signal day (index 20) volume low (900), and MA will be around 1000
        df.loc[dates[20], "volume"] = 900.0
        # TP hit on day 2 (index 23)
        df.loc[dates[23], "high"] = 112.0
        
        labeled_df, rejections = labeler.label_training_data_strict(df, drop_labels=False)
        
        # The target at index 20 should be 0 because volume (900) <= MA (approx 995)
        assert labeled_df["Target"].iloc[20] == 0
        assert rejections["low_volume"] > 0

    def test_strict_labeling_circuit_breaker_rejection(self, default_params):
        """Test rejection when signal day is on circuit breaker"""
        labeler = StrictQualityLabeler(default_params)
        
        dates = pd.date_range("2024-01-01", periods=50)
        df = pd.DataFrame({
            "open": [100.0] * 50,
            "high": [101.0] * 50,
            "low": [99.0] * 50,
            "close": [100.0] * 50,
            "volume": [1000.0] * 50,
        }, index=dates)
        
        # Set signal day (index 20) to have high == low (circuit breaker active!)
        df.loc[dates[20], "high"] = 100.0
        df.loc[dates[20], "low"] = 100.0
        df.loc[dates[20], "volume"] = 1500.0  # pass volume filter
        
        # TP hit on day 2 (index 23)
        df.loc[dates[23], "high"] = 112.0
        
        labeled_df, rejections = labeler.label_training_data_strict(df, drop_labels=False)
        
        assert labeled_df["Target"].iloc[20] == 0
        assert rejections["circuit_breaker"] > 0

    def test_strict_labeling_market_panic_rejection(self, default_params):
        """Test rejection when EGX30 daily return <= -2%"""
        labeler = StrictQualityLabeler(default_params)
        
        dates = pd.date_range("2024-01-01", periods=50)
        df = pd.DataFrame({
            "open": [100.0] * 50,
            "high": [101.0] * 50,
            "low": [99.0] * 50,
            "close": [100.0] * 50,
            "volume": [1000.0] * 50,
        }, index=dates)
        
        # TP hit on day 2 (index 23)
        df.loc[dates[23], "high"] = 112.0
        df.loc[dates[20], "volume"] = 1500.0  # pass volume filter
        
        # Create EGX30 data with a panic return on signal day (index 20)
        egx30_df = pd.DataFrame({
            "egx30_return": [0.0] * 50
        }, index=dates)
        egx30_df.loc[dates[20], "egx30_return"] = -0.025  # Panic!
        
        labeled_df, rejections = labeler.label_training_data_strict(df, egx30_data=egx30_df, drop_labels=False)
        
        assert labeled_df["Target"].iloc[20] == 0
        assert rejections["market_panic"] > 0
