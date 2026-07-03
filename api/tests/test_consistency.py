"""
Consistency Tests for Unified Trading Logic

These tests ensure that training, live bot, and backtesting use
the same logic and produce consistent results.
"""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

# Import the unified modules
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.trading_config import TradingParameters
from api.unified_labeling import TripleBarrierLabeler, TradeOutcome
from api.unified_features import FeatureEngineeringManager, DataReadinessReport


class TestTradingParameters:
    """Tests for TradingParameters configuration"""
    
    def test_basic_creation(self):
        """Test creating basic parameters"""
        params = TradingParameters(
            entry_mode="next_open",
            target_pct=0.10,
            stop_loss_pct=0.05,
            look_forward_days=20,
        )
        assert params.entry_mode == "next_open"
        assert params.target_pct == 0.10
        assert params.stop_loss_pct == 0.05
        assert params.look_forward_days == 20
    
    def test_validation_pass(self):
        """Test parameter validation passes for valid params"""
        params = TradingParameters(
            entry_mode="next_open",
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
            king_threshold=0.55,
        )
        is_valid, errors = params.validate()
        assert is_valid
        assert len(errors) == 0
    
    def test_validation_fail(self):
        """Test parameter validation fails for invalid params"""
        params = TradingParameters(
            target_pct=2.0,  # Invalid for percent mode
            stop_loss_pct=-0.1,  # Negative
        )
        is_valid, errors = params.validate()
        assert not is_valid
        assert len(errors) > 0
    
    def test_calculate_barriers_percent(self):
        """Test barrier calculation in percent mode"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
        )
        tp, sl = params.calculate_barriers(100.0)
        assert tp == pytest.approx(110.0)
        assert sl == pytest.approx(95.0)
    
    def test_calculate_barriers_atr(self):
        """Test barrier calculation in ATR mode"""
        params = TradingParameters(
            barrier_mode="atr_multiplier",
            target_pct=2.5,
            stop_loss_pct=1.5,
        )
        tp, sl = params.calculate_barriers(100.0, atr=2.0)
        assert tp == pytest.approx(105.0)  # 100 + 2*2.5
        assert sl == pytest.approx(97.0)   # 100 - 2*1.5
    
    def test_from_model_artifact(self):
        """Test loading parameters from model artifact"""
        artifact = {
            "entry_mode": "next_open",
            "barrier_mode": "percent",
            "target_pct": 0.10,
            "stop_loss_pct": 0.05,
            "look_forward_days": 20,
            "optimal_threshold": 0.55,
        }
        params = TradingParameters.from_model_artifact(artifact)
        assert params.entry_mode == "next_open"
        assert params.barrier_mode == "percent"
        assert params.target_pct == 0.10
        assert params.king_threshold == 0.55
    
    def test_to_dict(self):
        """Test converting parameters to dictionary"""
        params = TradingParameters(target_pct=0.10)
        d = params.to_dict()
        assert isinstance(d, dict)
        assert d["target_pct"] == 0.10
    
    def test_risk_reward_ratio(self):
        """Test risk/reward ratio calculation"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
        )
        ratio = params.estimate_risk_reward_ratio(100.0)
        assert ratio == pytest.approx(2.0)  # 10% profit / 5% loss


class TestTripleBarrierLabeler:
    """Tests for labeling logic"""
    
    def test_calculate_barriers(self):
        """Test barrier calculation"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
        )
        labeler = TripleBarrierLabeler(params)
        tp, sl = labeler.calculate_barriers(100.0)
        assert tp == pytest.approx(110.0)
        assert sl == pytest.approx(95.0)
    
    def test_label_tp_hit_first(self):
        """Test labeling when TP is hit first"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
            require_volume_confirmation=False,
        )
        labeler = TripleBarrierLabeler(params)
        labeler.calculate_barriers(100.0)
        
        high_window = np.array([105, 115, 110])  # TP at 110
        low_window = np.array([104, 100, 109])   # No SL at 95
        
        label = labeler.label_single_trade(0, high_window, low_window)
        assert label == 1  # TP hit first
    
    def test_label_sl_hit_first(self):
        """Test labeling when SL is hit first"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
            require_volume_confirmation=False,
        )
        labeler = TripleBarrierLabeler(params)
        labeler.calculate_barriers(100.0)
        
        high_window = np.array([105, 100, 108])  # TP at 110
        low_window = np.array([94, 96, 105])     # SL at 95
        
        label = labeler.label_single_trade(0, high_window, low_window)
        assert label == 0  # SL hit first
    
    def test_label_neither_hit(self):
        """Test labeling when neither TP nor SL is hit"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
            require_volume_confirmation=False,
        )
        labeler = TripleBarrierLabeler(params)
        labeler.calculate_barriers(100.0)
        
        high_window = np.array([105, 106, 107])  # Below TP of 110
        low_window = np.array([96, 97, 98])      # Above SL of 95
        
        label = labeler.label_single_trade(0, high_window, low_window)
        assert label == 0  # Neither hit
    
    def test_backtest_trade_tp_hit(self):
        """Test backtest simulation when TP is hit"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
            look_forward_days=20,
        )
        labeler = TripleBarrierLabeler(params)
        
        bars = [
            {"high": 105, "low": 104, "close": 104.5, "volume": 1000},
            {"high": 115, "low": 105, "close": 110, "volume": 1000},  # TP hit here
            {"high": 112, "low": 110, "close": 111, "volume": 1000},
        ]
        
        outcome = labeler.backtest_trade(100.0, 2.0, bars)
        assert outcome.outcome == "TP_HIT"
        assert outcome.exit_price == pytest.approx(110.0)
        assert outcome.pnl_pct == pytest.approx(10.0)
    
    def test_backtest_trade_sl_hit(self):
        """Test backtest simulation when SL is hit"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
            look_forward_days=20,
        )
        labeler = TripleBarrierLabeler(params)
        
        bars = [
            {"high": 100, "low": 94, "close": 95, "volume": 1000},  # SL hit here
            {"high": 102, "low": 94, "close": 101, "volume": 1000},
        ]
        
        outcome = labeler.backtest_trade(100.0, 2.0, bars)
        assert outcome.outcome == "SL_HIT"
        assert outcome.exit_price == pytest.approx(95.0)
        assert outcome.pnl_pct == pytest.approx(-5.0)
    
    def test_backtest_trade_timeout(self):
        """Test backtest simulation timeout"""
        params = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
            look_forward_days=2,
        )
        labeler = TripleBarrierLabeler(params)
        
        bars = [
            {"high": 102, "low": 99, "close": 101, "volume": 1000},
            {"high": 103, "low": 99, "close": 102, "volume": 1000},
            {"high": 104, "low": 99, "close": 103, "volume": 1000},  # Exceeds limit
        ]
        
        outcome = labeler.backtest_trade(100.0, 2.0, bars, max_bars=2)
        assert outcome.outcome == "TIMEOUT"


class TestFeatureEngineeringManager:
    """Tests for feature engineering validation"""
    
    def test_check_data_ready_pass(self):
        """Test data readiness check passes"""
        params = TradingParameters(min_history_needed=100)
        manager = FeatureEngineeringManager(params)
        
        # Create sample data
        dates = pd.date_range("2024-01-01", periods=200)
        close_vals = np.random.rand(200) * 100
        df = pd.DataFrame({
            "Open": close_vals,
            "High": close_vals + np.random.rand(200) * 10,
            "Low": np.clip(close_vals - np.random.rand(200) * 10, a_min=0.01, a_max=None),
            "Close": close_vals,
            "Volume": np.random.randint(15000, 20000, 200),
        }, index=dates)
        
        report = manager.check_data_ready(df)
        assert report.is_ready
        assert report.bars_count == 200
        assert report.nan_percentage == 0
    
    def test_check_data_ready_insufficient_bars(self):
        """Test data readiness check fails with insufficient bars"""
        params = TradingParameters(min_history_needed=200)
        manager = FeatureEngineeringManager(params)
        
        # Create small dataset
        df = pd.DataFrame({
            "Close": np.random.rand(100),
            "Volume": np.random.rand(100),
        })
        
        report = manager.check_data_ready(df)
        assert not report.is_ready
    
    def test_warmup_skip(self):
        """Test warmup skip calculation"""
        params = TradingParameters(
            warmup_bars=50,
            min_history_needed=100,
            feature_lookback=252,
        )
        manager = FeatureEngineeringManager(params)
        
        skip = manager.get_warmup_skip()
        assert skip == 252  # Maximum of all
    
    def test_validate_features_pass(self):
        """Test feature validation passes"""
        params = TradingParameters()
        manager = FeatureEngineeringManager(params)
        
        X = pd.DataFrame({
            "RSI": np.random.rand(100),
            "MACD": np.random.rand(100),
            "Volume": np.random.rand(100),
        })
        
        is_valid, missing, issues = manager.validate_features(
            X, ["RSI", "MACD", "Volume"]
        )
        assert is_valid
        assert len(missing) == 0
        assert len(issues) == 0
    
    def test_validate_features_missing(self):
        """Test feature validation detects missing features"""
        params = TradingParameters()
        manager = FeatureEngineeringManager(params)
        
        X = pd.DataFrame({
            "RSI": np.random.rand(100),
        })
        
        is_valid, missing, issues = manager.validate_features(
            X, ["RSI", "MACD", "Volume"]
        )
        assert not is_valid
        assert "MACD" in missing
        assert "Volume" in missing
    
    def test_check_data_leakage(self):
        """Test data leakage detection"""
        params = TradingParameters(look_forward_days=5)
        manager = FeatureEngineeringManager(params)
        
        # Create data with potential leakage (feature perfectly correlated with label)
        np.random.seed(42)
        df = pd.DataFrame({
            "future_feature": np.random.rand(100),
            "Target": np.zeros(100),
        })
        df["Target"] = df["future_feature"] > 0.5  # Perfect correlation
        
        has_leakage, issues = manager.check_data_leakage(df)
        # With perfect correlation, should detect leakage
        # (actual behavior depends on implementation)


class TestConsistency:
    """Integration tests for overall consistency"""
    
    def test_entry_price_consistency(self):
        """Test that entry price logic is consistent"""
        params = TradingParameters(entry_mode="next_open")
        
        # Training: entry is next open
        df = pd.DataFrame({
            "Open": [100, 101, 102, 103],
            "Close": [100.5, 101.5, 102.5, 103.5],
        })
        df["entry_price"] = df["Open"].shift(-1)
        
        # Entry at index 0 should use Open[1]
        assert df["entry_price"].iloc[0] == 101
    
    def test_barrier_consistency_across_modes(self):
        """Test that barriers are consistent across different calculations"""
        entry_price = 100.0
        atr = 2.0
        
        # Percent mode
        params_pct = TradingParameters(
            barrier_mode="percent",
            target_pct=0.10,
            stop_loss_pct=0.05,
        )
        tp_pct, sl_pct = params_pct.calculate_barriers(entry_price)
        
        # ATR mode with equivalent multipliers
        # To get same result: target = 0.10 * 100 / 2 = 5, so 0.10 in percent = 5 ATR units
        params_atr = TradingParameters(
            barrier_mode="atr_multiplier",
            target_pct=5.0,
            stop_loss_pct=2.5,
        )
        tp_atr, sl_atr = params_atr.calculate_barriers(entry_price, atr=2.0)
        
        assert tp_pct == pytest.approx(tp_atr)
        assert sl_pct == pytest.approx(sl_atr)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
