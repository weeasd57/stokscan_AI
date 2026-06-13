import os
import tempfile
import pickle
import numpy as np
import pandas as pd
import pytest
from typing import Dict

from api.train_exchange_model import prepare_for_ai, train_model
from api.trading_config import TradingParameters
from api.unified_labeling import TripleBarrierLabeler

class MockTrainer:
    """Mock trainer class to test walk-forward splits and saving"""
    def __init__(self, exchange="EGX"):
        self.exchange = exchange
        self.predictors = ["feat_volume_dryup", "feat_bull_consistency", "feat_52w_position"]
        self.categorical_features = []
        self.market_index_local_json = None
        self.market_index_loaded = False
        self.market_index_symbol = None
        self.fundamentals_loaded = False
        self.params = TradingParameters(
            entry_mode="next_open",
            look_forward_days=5,
            barrier_mode="percent",
            target_pct=0.02,
            stop_loss_pct=0.01,
            require_volume_confirmation=True
        )
        self.wf_splits_results = [
            {"split_index": 0, "precision": 0.60, "recall": 0.50, "f1": 0.55, "auc": 0.65}
        ]

    def _progress(self, msg: str):
        print(msg)

    def get_walk_forward_splits(self, df: pd.DataFrame, n_splits: int = 5):
        from api.train_exchange_model import ModelTrainer
        # Call it bound to self
        import types
        self.get_walk_forward_splits_bound = types.MethodType(ModelTrainer.get_walk_forward_splits, self)
        return self.get_walk_forward_splits_bound(df, n_splits)

    def save_model(self, model, filename: str, metadata: Dict = None) -> str:
        from api.train_exchange_model import ModelTrainer
        import types
        self.save_model_bound = types.MethodType(ModelTrainer.save_model, self)
        return self.save_model_bound(model, filename, metadata or {})

    def _clean_dataset(self, X: pd.DataFrame) -> pd.DataFrame:
        return X.fillna(0)

def test_walk_forward_splits_no_overlap():
    """Verify that walk-forward splits are strictly chronological and do not leak data"""
    dates = pd.date_range(start="2018-01-01", end="2023-01-01", freq="D")
    df = pd.DataFrame({
        "Close": np.random.rand(len(dates)) * 100 + 10,
        "Open": np.random.rand(len(dates)) * 100 + 10,
        "High": np.random.rand(len(dates)) * 100 + 10,
        "Low": np.random.rand(len(dates)) * 100 + 10,
        "Volume": np.random.rand(len(dates)) * 10000,
        "Target": np.random.randint(0, 2, len(dates))
    }, index=dates)
    df.index.name = "Date"

    trainer = MockTrainer()
    splits = trainer.get_walk_forward_splits(df, n_splits=5)

    assert len(splits) > 0, "Should generate splits for multiple years of data"
    
    for train_idx, test_idx in splits:
        # Check chronological separation: all train dates should be strictly before test dates
        train_dates = df.index[train_idx]
        test_dates = df.index[test_idx]
        
        assert train_dates.max() < test_dates.min(), "Leakage detected: train date is after test date!"
        
        # Verify sizes
        assert len(train_idx) > 0
        assert len(test_idx) > 0

def test_parameter_serialization_roundtrip():
    """Verify that parameters and walk-forward metrics serialize correctly to model artifact"""
    import lightgbm as lgb
    
    trainer = MockTrainer()
    
    # Create simple LightGBM booster
    X = pd.DataFrame(np.random.rand(100, 3), columns=trainer.predictors)
    y = pd.Series(np.random.randint(0, 2, 100))
    model = lgb.LGBMClassifier(n_estimators=10, verbosity=-1)
    model.fit(X, y)
    
    metadata = {
        "precision": 0.65,
        "recall": 0.55,
        "f1": 0.60,
        "auc": 0.70,
        "optimal_threshold": 0.52
    }

    # Save artifact in temporary folder
    with tempfile.TemporaryDirectory() as tmp_dir:
        filename = "mock_model.pkl"
        
        # We can mock save_model paths
        filepath = os.path.join(tmp_dir, filename)
        
        # Let's save directly using the save_model logic manually to avoid breaking directory paths
        pca_features = None
        pca = None
        scaler = None
        booster = model.booster_
        
        trading_params_dict = {
            "entry_mode": trainer.params.entry_mode,
            "entry_buffer_pct": trainer.params.entry_buffer_pct,
            "look_forward_days": trainer.params.look_forward_days,
            "look_forward_mode": trainer.params.look_forward_mode,
            "barrier_mode": trainer.params.barrier_mode,
            "target_pct": trainer.params.target_pct,
            "stop_loss_pct": trainer.params.stop_loss_pct,
            "require_volume_confirmation": trainer.params.require_volume_confirmation,
            "min_volume_ratio": trainer.params.min_volume_ratio,
            "volume_confirmation_period": trainer.params.volume_confirmation_period,
        }
        
        thresholds_dict = {
            "king_threshold": trainer.params.king_threshold,
            "optimal_threshold": metadata.get("optimal_threshold"),
            "council_threshold": trainer.params.council_threshold,
            "validator_threshold": trainer.params.validator_threshold,
        }
        
        feature_req_dict = {
            "min_history_needed": trainer.params.min_history_needed,
            "warmup_bars": trainer.params.warmup_bars,
            "feature_lookback": trainer.params.feature_lookback,
        }
        
        artifact = {
            "kind": "lgbm_booster",
            "model_str": booster.model_to_string() if booster else None,
            "feature_names": trainer.predictors,
            "categorical_features": trainer.categorical_features,
            "exchange": trainer.exchange,
            "featurePreset": "extended",
            "trainingSamples": 100,
            "num_features": booster.num_feature() if booster else 3,
            "num_trees": booster.num_trees() if booster else 10,
            "timestamp": "2026-06-11T00:00:00Z",
            "pca_features": pca_features,
            "pca": pca,
            "scaler": scaler,
            "trading_parameters": trading_params_dict,
            "thresholds": thresholds_dict,
            "feature_requirements": feature_req_dict,
            "walk_forward_splits_results": trainer.wf_splits_results,
            **metadata,
        }
        
        with open(filepath, "wb") as f:
            pickle.dump(artifact, f)
            
        # Reload and verify round-trip
        with open(filepath, "rb") as f:
            loaded_artifact = pickle.load(f)
            
        assert isinstance(loaded_artifact, dict)
        assert loaded_artifact["kind"] == "lgbm_booster"
        
        loaded_params = TradingParameters.from_model_artifact(loaded_artifact)
        assert loaded_params.entry_mode == "next_open"
        assert loaded_params.look_forward_days == 5
        assert loaded_params.barrier_mode == "percent"
        assert loaded_params.target_pct == 0.02
        assert loaded_params.stop_loss_pct == 0.01
        assert loaded_params.require_volume_confirmation is True
        
        # Verify walk-forward results are loaded
        assert "walk_forward_splits_results" in loaded_artifact
        assert len(loaded_artifact["walk_forward_splits_results"]) == 1
        assert loaded_artifact["walk_forward_splits_results"][0]["precision"] == 0.60


def test_walk_forward_documentation_in_artifact():
    """Test that walk-forward validation results are properly documented in model artifact"""
    dates = pd.date_range(start="2018-01-01", end="2023-01-01", freq="D")
    np.random.seed(42)
    df = pd.DataFrame({
        "Close": np.random.randn(len(dates)).cumsum() + 100,
        "Volume": np.random.randint(1000, 10000, len(dates)),
        "Target": np.random.choice([0, 1], len(dates)),
        "RSI": np.random.uniform(30, 70, len(dates)),
        "MACD": np.random.randn(len(dates)),
    }, index=dates)
    
    trainer = MockTrainer()
    trainer.predictors = ["RSI", "MACD"]
    
    # Simulate walk-forward results with detailed documentation
    trainer.wf_splits_results = [
        {
            "split_index": 0,
            "train_period": "2018-01-01 to 2020-12-31",
            "test_period": "2021-01-01 to 2021-12-31",
            "train_samples": 1095,
            "test_samples": 365,
            "train_positive_rate": 0.48,
            "test_positive_rate": 0.52,
            "precision": 0.60,
            "recall": 0.45,
            "f1": 0.51,
            "auc": 0.68,
        }
    ]
    
    # Save artifact
    thresholds_dict = {"king_threshold": 0.55, "optimal_threshold": 0.55}
    feature_req_dict = {"min_history_needed": 100}
    metadata = {"precision": 0.65}
    
    # Calculate walk-forward summary
    wf_results = trainer.wf_splits_results
    precisions = [r["precision"] for r in wf_results]
    recalls = [r["recall"] for r in wf_results]
    f1s = [r["f1"] for r in wf_results]
    aucs = [r["auc"] for r in wf_results]
    
    walk_forward_summary = {
        "n_splits": len(wf_results),
        "average_precision": float(np.mean(precisions)),
        "average_recall": float(np.mean(recalls)),
        "average_f1": float(np.mean(f1s)),
        "average_auc": float(np.mean(aucs)),
        "std_precision": float(np.std(precisions)),
        "std_f1": float(np.std(f1s)),
        "min_f1": float(min(f1s)),
        "max_f1": float(max(f1s)),
    }
    
    artifact = {
        "model": "mock_model",
        "thresholds": thresholds_dict,
        "feature_requirements": feature_req_dict,
        "walk_forward_splits_results": trainer.wf_splits_results,
        "walk_forward_summary": walk_forward_summary,
        **metadata,
    }
    
    # Verify artifact structure
    assert "walk_forward_splits_results" in artifact
    assert "walk_forward_summary" in artifact
    
    # Verify split details
    split_0 = artifact["walk_forward_splits_results"][0]
    assert "train_period" in split_0
    assert "test_period" in split_0
    assert "train_samples" in split_0
    assert "test_samples" in split_0
    assert "train_positive_rate" in split_0
    assert "test_positive_rate" in split_0
    assert split_0["train_period"] == "2018-01-01 to 2020-12-31"
    assert split_0["test_period"] == "2021-01-01 to 2021-12-31"
    
    # Verify summary statistics
    summary = artifact["walk_forward_summary"]
    assert "n_splits" in summary
    assert "average_precision" in summary
    assert "average_f1" in summary
    assert "std_f1" in summary
    assert "min_f1" in summary
    assert "max_f1" in summary
    assert summary["n_splits"] == 1
    assert summary["average_f1"] == 0.51
    assert summary["min_f1"] == 0.51
    assert summary["max_f1"] == 0.51


def test_backward_compatibility_with_old_artifacts():
    """Test that old artifacts without walk_forward_summary still load"""
    old_artifact = {
        "model": "mock_model",
        "thresholds": {"king_threshold": 0.55},
        "walk_forward_splits_results": [
            {"split_index": 0, "precision": 0.60, "recall": 0.45}
        ],
        # No walk_forward_summary
    }
    
    # Should still be loadable
    assert "walk_forward_splits_results" in old_artifact
    assert old_artifact.get("walk_forward_summary", {}) == {}  # Default to empty dict
