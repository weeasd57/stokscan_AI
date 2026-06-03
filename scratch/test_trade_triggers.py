import os
import sys
import pandas as pd
import numpy as np

# Add parent and api directories to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(project_root)
sys.path.append(os.path.join(project_root, "api"))

from api.backtest_radar import load_model, run_radar_simulation
from api.optimize_radar import load_models_and_data
from api.strategy_engine import StrategyEngine

def _align_for_king_local(X_src: pd.DataFrame, king_artifact: dict) -> pd.DataFrame:
    try:
        pm = king_artifact.get("primary_model") or {}
        feats = list(pm.get("feature_names") or [])
        cats = list(pm.get("categorical_features") or [])
        if not feats:
            return X_src.replace([np.inf, -np.inf], np.nan).fillna(0)
        Xk = X_src.copy()
        missing = [c for c in feats if c not in Xk.columns]
        for c in missing:
            Xk[c] = 0
        Xk = Xk[feats]
        for col in cats:
            if col in Xk.columns:
                Xk[col] = Xk[col].astype(str).replace(['nan', 'None', ''], "Unknown").fillna("Unknown").astype('category')
        return Xk
    except Exception as e:
        print(f"Error in alignment: {e}")
        return X_src

def test_diagnostics():
    print("🔄 Loading data...")
    # Load data for KING on EGX starting 2023-06-01
    df, model, _ = load_models_and_data(exchange="EGX", model_name="KING.pkl", start_date="2023-06-01")
    print(f"✅ Data loaded: {df.shape[0]} rows across all symbols.")
    
    symbols = df['symbol'].unique()
    target_symbol = symbols[0]
    for s in symbols:
        if df[df['symbol'] == s].shape[0] > 150:
            target_symbol = s
            break
            
    print(f"🔎 Running diagnostics for symbol: {target_symbol}")
    symbol_df = df[df['symbol'] == target_symbol].copy()
    print(f"Symbol data size: {symbol_df.shape}")
    
    # Run simulation with verbose logging
    res = run_radar_simulation(
        df=symbol_df,
        model=model,
        council=None,
        threshold=0.6,
        capital=100000,
        sim_start_dt=pd.to_datetime("2023-06-01"),
        quiet=False,
        use_market_regime=False,
        use_rsi_filter=False,
        use_smart_exit=False,
        use_atr_exits=False,
        min_volume_ratio=0.0
    )
    
    trades = res.get("Trades Log")
    if trades is not None and not trades.empty:
        print(f"🎉 Generated {len(trades)} trades without filters!")
        print(trades.head(5))
    else:
        print("❌ Still no trades even without filters!")
        
        # Let's inspect raw confidences
        from api.backtest_radar import reconstruct_meta_model
        classifier = model
        if isinstance(model, dict) and model.get("kind") == "meta_labeling_system":
            classifier = reconstruct_meta_model(model)
            
        Xk = _align_for_king_local(symbol_df, model) if isinstance(model, dict) else symbol_df
        
        # Drop target if exists
        feats_to_use = [c for c in Xk.columns if c not in {"target", "target_barrier", "date", "symbol", "close", "high", "low", "open", "volume"}]
        X = Xk[feats_to_use]
        
        probs = classifier.predict_proba(X)
        confidences = probs[:, 1]
        
        high_conf_indices = np.where(confidences >= 0.6)[0]
        print(f"Total bars: {len(confidences)}")
        print(f"Max confidence: {np.max(confidences):.4f}")
        print(f"Number of bars with confidence >= 0.60: {len(high_conf_indices)}")
        
        if len(high_conf_indices) > 0:
            print("Confidence >= 0.60 dates:")
            for idx in high_conf_indices:
                dt_val = symbol_df.index[idx]
                print(f"Index {idx} | Date: {dt_val} | Confidence: {confidences[idx]:.4f}")
                # Print index bounds around simulation start
                try:
                    entry_dt = pd.to_datetime(dt_val).tz_localize(None)
                    sim_start = pd.to_datetime("2023-06-01").tz_localize(None)
                    print(f"  entry_dt: {entry_dt} | sim_start: {sim_start} | entry_dt < sim_start: {entry_dt < sim_start}")
                except Exception as ex:
                    print(f"  Error converting date: {ex}")

if __name__ == "__main__":
    test_diagnostics()
