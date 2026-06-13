"""
Integration and Unit Tests for the Backtesting Pipeline
"""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict

from api.trading_config import TradingParameters
from api.unified_labeling import TripleBarrierLabeler, TradeOutcome
from api.unified_features import FeatureEngineeringManager
from api.backtest_radar import run_radar_simulation, load_model


class MockModel:
    """Mock model to mimic prediction probabilities in backtests"""
    def __init__(self, expected_predictions, feature_names):
        self.expected_predictions = expected_predictions
        self.feature_names = feature_names
        self.categorical_features = []

    def predict_proba(self, X):
        n = len(X)
        probs = np.zeros((n, 2))
        # Use our preset expected predictions
        probs[:, 1] = self.expected_predictions[:n]
        probs[:, 0] = 1.0 - probs[:, 1]
        return probs


def test_backtest_simulation_consistency_with_labeler():
    """Verify that run_radar_simulation trade outcomes match labeler outputs"""
    # 1. Create synthetic dataset (more than 100 rows to satisfy warmup/history checks)
    dates = pd.date_range(start="2025-01-01", periods=150, freq="D")
    df = pd.DataFrame({
        "open": np.linspace(100, 110, 150),
        "high": np.linspace(101, 111, 150),
        "low": np.linspace(99, 109, 150),
        "close": np.linspace(100.5, 110.5, 150),
        "volume": np.ones(150) * 1000,
        "symbol": ["TEST"] * 150
    }, index=dates)
    df.index.name = "Date"

    # Add features mock values
    df["rsi"] = 40.0
    df["feat_vol_acceleration"] = 1.0
    df["feat_sector_rel_strength"] = 0.0
    df["feat_overnight_gap"] = 0.0
    df["feat_amihud_10d_sma"] = 1e-6
    df["atr_14"] = 2.0
    df["volume_ma_20"] = 1000.0

    # 2. Mock model metadata
    model_metadata = {
        "kind": "lgbm_booster",
        "feature_names": ["rsi", "feat_vol_acceleration"],
        "categorical_features": [],
        "primary_model": {
            "feature_names": ["rsi", "feat_vol_acceleration"],
            "categorical_features": []
        },
        "trading_parameters": {
            "entry_mode": "next_open",
            "barrier_mode": "percent",
            "target_pct": 0.05,
            "stop_loss_pct": 0.02,
            "look_forward_days": 5,
            "require_volume_confirmation": False,
            "min_volume_ratio": 0.3
        },
        "thresholds": {
            "king_threshold": 0.50
        },
        "feature_requirements": {
            "min_history_needed": 100,
            "warmup_bars": 10
        }
    }

    # Set up prediction scores where index 110 triggers a buy signal (prob > threshold)
    predictions = np.ones(150) * 0.1
    predictions[110] = 0.85  # Buy trigger

    classifier = MockModel(predictions, model_metadata["feature_names"])
    model_metadata["model"] = classifier
    
    # Run the backtest simulation
    res = run_radar_simulation(
        df=df,
        model=model_metadata,
        threshold=0.50,
        sim_start_dt=datetime(2025, 4, 1),
        quiet=True,
        use_rsi_filter=False,
        use_trend_filter=False,
        use_market_regime=False,
        use_smart_exit=False,
        use_trailing=False,
        use_atr_exits=False
    )

    assert isinstance(res, dict)
    assert "Trades Log" in res
    trades_df = res["Trades Log"]
    
    # Check that a trade was executed
    assert len(trades_df) > 0
    trade = trades_df.iloc[0]
    assert trade["Status"] == "Accepted"
    
    # Calculate expected outcomes with TripleBarrierLabeler directly
    params = TradingParameters.from_model_artifact(model_metadata)
    labeler = TripleBarrierLabeler(params)
    
    entry_price = df["open"].iloc[111]  # entry_mode = next_open
    bars_ahead = []
    for f in range(1, params.look_forward_days + 1):
        idx = 111 + f
        bars_ahead.append({
            "high": df["high"].iloc[idx],
            "low": df["low"].iloc[idx],
            "close": df["close"].iloc[idx],
            "volume": df["volume"].iloc[idx]
        })
        
    outcome_obj = labeler.backtest_trade(
        entry_price=entry_price,
        atr=df["atr_14"].iloc[111],
        bars_ahead=bars_ahead,
        max_bars=params.look_forward_days
    )

    # Simulated trade details must match outcome_obj details
    assert trade["PnL_Pct"] == pytest.approx(outcome_obj.pnl_pct / 100.0)
    assert trade["Days_Held"] == outcome_obj.exit_bars
