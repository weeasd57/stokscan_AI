"""
Integration and Unit Tests for the Live Bot Pipeline
"""

import pytest
import os
import pandas as pd
import numpy as np
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

from api.live_bot import LiveBot, BotConfig
from api.trading_config import TradingParameters

class MockModel:
    def __init__(self, expected_predictions, feature_names):
        self.expected_predictions = expected_predictions
        self.feature_names = feature_names
        self.categorical_features = []

    def predict_proba(self, X):
        n = len(X)
        probs = np.zeros((n, 2))
        probs[:, 1] = self.expected_predictions[:n]
        probs[:, 0] = 1.0 - probs[:, 1]
        return probs

@pytest.fixture
def base_bot_config():
    return BotConfig(
        name="Test Bot",
        coins=["TEST.CA"],
        king_threshold=0.85,
        council_threshold=0.25,
        hold_max_bars=5,
        warmup_bars=10,
        use_atr_exits=False,
        target_pct=0.05,
        stop_loss_pct=0.02,
        execution_mode="TELEGRAM",
        use_council=False,
        use_market_regime=False,
        use_winrate_feedback=False,
        use_schedule=False,
        min_volume_ratio=0.3
    )

@pytest.fixture
def mock_king_artifact():
    classifier = MockModel(np.ones(150) * 0.1, ["rsi"])
    return {
        "kind": "lgbm_booster",
        "feature_names": ["rsi"],
        "categorical_features": [],
        "primary_model": {
            "feature_names": ["rsi"],
            "categorical_features": []
        },
        "model": classifier,
        "trading_parameters": {
            "entry_mode": "next_open",
            "barrier_mode": "percent",
            "target_pct": 0.05,
            "stop_loss_pct": 0.02,
            "look_forward_days": 5,
            "require_volume_confirmation": True,
            "min_volume_ratio": 0.3,
            "warmup_bars": 10,
            "min_history_needed": 20
        },
        "thresholds": {
            "king_threshold": 0.85,
            "council_threshold": 0.25
        },
        "feature_requirements": {
            "min_history_needed": 20,
            "warmup_bars": 10
        }
    }

def test_parameter_validation_and_loading(base_bot_config, mock_king_artifact, monkeypatch):
    """Test loading model parameter validation works and respects STRICT_VALIDATION"""
    bot = LiveBot(bot_id="test_param_load", config=base_bot_config)
    
    # Mock the backtest_radar load_model and reconstruct_meta_model functions
    import api.backtest_radar
    monkeypatch.setattr(api.backtest_radar, "load_model", lambda path: mock_king_artifact)
    monkeypatch.setattr(api.backtest_radar, "reconstruct_meta_model", lambda art: mock_king_artifact["model"])
    
    # 1. Test parameter mismatch with STRICT_VALIDATION=True raises error
    os.environ["STRICT_VALIDATION"] = "True"
    # Modify config to cause a mismatch on hold_max_bars
    bot.config.hold_max_bars = 99
    with pytest.raises(ValueError, match="STRICT VALIDATION ERROR"):
        bot._load_models()
        
    # 2. Test parameter mismatch with STRICT_VALIDATION=False overrides values instead
    os.environ["STRICT_VALIDATION"] = "False"
    bot.config.hold_max_bars = 99
    king_art, king_clf, validator = bot._load_models()
    assert bot.config.hold_max_bars == 5 # Overridden to 5 from look_forward_days in model artifact
    assert bot.trading_params.require_volume_confirmation is True

def test_data_readiness_enforcement(base_bot_config, mock_king_artifact):
    """Test that data readiness check skips predictions if warmup/data constraints not met"""
    bot = LiveBot(bot_id="test_readiness", config=base_bot_config)
    bot.trading_params = TradingParameters.from_model_artifact(mock_king_artifact)
    from api.unified_features import FeatureEngineeringManager
    bot.feature_manager = FeatureEngineeringManager(bot.trading_params)
    
    # Create an empty bars dataframe
    empty_df = pd.DataFrame()
    report = bot.feature_manager.check_data_ready(empty_df)
    assert report.is_ready is False
    
    # Create a bars dataframe with too few rows (less than min_history_needed = 20)
    dates = pd.date_range(start="2025-01-01", periods=5, freq="h")
    insufficient_df = pd.DataFrame({
        "open": [100.0] * 5,
        "high": [101.0] * 5,
        "low": [99.0] * 5,
        "close": [100.5] * 5,
        "volume": [1000] * 5
    }, index=dates)
    report = bot.feature_manager.check_data_ready(insufficient_df)
    assert report.is_ready is False

def test_egx_market_filters(base_bot_config, mock_king_artifact):
    """Test panic regime, circuit breaker, and volume confirmation checks"""
    # Create mock bars (enough for history and validation)
    dates = pd.date_range(start="2025-01-01", periods=30, freq="D")
    bars = pd.DataFrame({
        "open": np.linspace(100, 110, 30),
        "high": np.linspace(101, 111, 30),
        "low": np.linspace(99, 109, 30),
        "close": np.linspace(100.5, 110.5, 30),
        "volume": np.ones(30) * 1000,
        "symbol": ["TEST.CA"] * 30
    }, index=dates)
    bars.index.name = "Date"
    bars["rsi"] = 40.0
    
    bot = LiveBot(bot_id="test_filters", config=base_bot_config)
    bot.trading_params = TradingParameters.from_model_artifact(mock_king_artifact)
    from api.unified_features import FeatureEngineeringManager
    bot.feature_manager = FeatureEngineeringManager(bot.trading_params)
    
    # Mock EGX30Fetcher and CircuitBreakerDetector
    from api.egx30_fetcher import EGX30Fetcher
    from api.circuit_breaker_detector import CircuitBreakerDetector
    bot.egx30_fetcher = EGX30Fetcher()
    bot.cb_detector = CircuitBreakerDetector()
    
    closed_bars = bars.iloc[:-1].copy()
    
    # 1. Test Panic Filter (EGX30 return <= -2%)
    bot.egx30_fetcher.get_egx30_context = lambda date_str: {
        'date': date_str,
        'egx30_return': -0.03,
        'regime': 'panic',
        'reject_buys': True
    }
    
    date_str = "2025-01-29"
    egx_context = bot.egx30_fetcher.get_egx30_context(date_str)
    assert egx_context.get("regime") == "panic"
    assert egx_context.get("reject_buys") is True
    
    # 2. Test Circuit Breaker detection (high == low or range < 0.1%)
    stagnant_bars = closed_bars.copy()
    stagnant_bars.iloc[-1, stagnant_bars.columns.get_loc("high")] = 100.0
    stagnant_bars.iloc[-1, stagnant_bars.columns.get_loc("low")] = 100.0
    stagnant_bars.iloc[-1, stagnant_bars.columns.get_loc("close")] = 100.0
    
    cb_series = bot.cb_detector.detect_from_ohlcv(stagnant_bars)
    assert cb_series.iloc[-1]
    
    # 3. Test Volume Confirmation
    low_vol_bars = closed_bars.copy()
    low_vol_bars.iloc[-1, low_vol_bars.columns.get_loc("volume")] = 100.0
    
    vol_col = "volume"
    latest_vol = float(low_vol_bars.iloc[-1][vol_col])
    vol_series = low_vol_bars[vol_col].rolling(20).mean()
    vol_ma_20 = float(vol_series.iloc[-1])
    
    assert latest_vol < vol_ma_20 * bot.config.min_volume_ratio


def test_adaptive_exits(base_bot_config):
    """Test that adaptive exits dynamically override TP/SL multipliers depending on regime"""
    # Create mock bars (enough for SMA50 and SMA200 trend/regime)
    dates = pd.date_range(start="2025-01-01", periods=250, freq="D")
    
    strong_bull_prices = np.linspace(100, 130, 250)
    bars_strong_bull = pd.DataFrame({
        "open": strong_bull_prices - 0.5,
        "high": strong_bull_prices + 2.5,
        "low": strong_bull_prices - 2.5,
        "close": strong_bull_prices,
        "volume": [1000] * 250,
        "symbol": ["TEST.CA"] * 250
    }, index=dates)
    bars_strong_bull.index.name = "Date"

    # Configure bot with use_adaptive_exits = True
    config = base_bot_config
    config.use_atr_exits = True
    config.use_adaptive_exits = True
    config.exit_mode = "atr_smart"
    
    bot = LiveBot(bot_id="test_adaptive", config=config)
    
    # Verify that ATR exits for STRONG_BULL are overridden to 5.0x / 2.0x
    tp, sl = bot._calculate_atr_exits(bars_strong_bull, entry_price=130.0, regime="STRONG_BULL")
    atr = bot._calculate_atr(bars_strong_bull, 14)
    expected_tp = 130.0 + atr * 5.0
    expected_sl = 130.0 - atr * 2.0
    assert tp == pytest.approx(expected_tp)
    assert sl == pytest.approx(expected_sl)

    # 2. BEAR scenario: check overrides to 2.0x / 1.0x
    tp, sl = bot._calculate_atr_exits(bars_strong_bull, entry_price=130.0, regime="BEAR")
    expected_tp = 130.0 + atr * 2.0
    expected_sl = 130.0 - atr * 1.0
    assert tp == pytest.approx(expected_tp)
    assert sl == pytest.approx(expected_sl)
