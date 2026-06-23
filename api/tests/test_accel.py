import sys
import os
import pandas as pd

# Reconfigure stdout to use UTF-8 to handle Arabic text print
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Add the project root to python path
sys.path.append(r"C:\Users\MR__CODER__\Desktop\stokscan_AI")

from api.acceleration_score import (
    calculate_acceleration_score,
    calculate_dynamic_risk,
    calculate_momentum_sentiment,
)
from api.stock_ai import add_trade_levels

def run_tests():
    # 1. Mock high-momentum stock (similar to TYCN: RSI=96, ADX=57, R_VOL=2.68)
    tycn_mock = {
        "Close": 10.0,
        "Close_prev": 9.5,
        "EMA_20": 9.2,
        "EMA_50": 8.5,
        "EMA_200": 7.0,
        "ADX_14": 57.0,
        "RSI": 96.0,
        "Volume": 26800.0,
        "VOL_SMA20": 10000.0,
        "ROC_12": 0.08,
        "Momentum": 0.08,
        "MACD": 0.5,
        "MACD_Signal": 0.2,
        "ATR_14": 0.5
    }
    
    score = calculate_acceleration_score(tycn_mock)
    print(f"TYCN Mock Acceleration Score (0-10): {score}")
    assert score >= 9, f"TYCN score should be 9 or 10, got {score}"
    
    # Check dynamic risk
    risk = calculate_dynamic_risk(
        score=score,
        last_close=10.0,
        atr=0.5,
        adx=57.0,
        r_vol=2.68
    )
    print(f"TYCN Dynamic Risk Profile: {risk}")
    assert risk["target_pct"] >= 20.0, f"Target pct should be >= 20%, got {risk['target_pct']}"
    assert risk["stop_loss_pct"] >= 8.0, f"Stop loss pct should be >= 8%, got {risk['stop_loss_pct']}"
    
    # Check stock_ai trade levels
    df = pd.DataFrame([tycn_mock])
    tp, sl = add_trade_levels(df, acceleration_score=score)
    print(f"TYCN trade levels: Entry=10.0, TP={tp}, SL={sl}")
    # tp should be around 13.0 (which is +30%) or more
    tp_pct = (tp / 10.0 - 1) * 100
    sl_pct = (1 - sl / 10.0) * 100
    print(f"TYCN TP pct: {tp_pct:.1f}%, SL pct: {sl_pct:.1f}%")
    assert tp_pct >= 20.0, f"Stock AI TP should be >= 20%, got {tp_pct:.1f}%"
    assert sl_pct >= 8.0, f"Stock AI SL should be >= 8%, got {sl_pct:.1f}%"
    
    # 2. Mock low-momentum stock (RSI=40, ADX=12, volume below average)
    low_mock = {
        "Close": 10.0,
        "Close_prev": 10.1,
        "EMA_20": 10.2,
        "EMA_50": 10.5,
        "EMA_200": 11.0,
        "ADX_14": 12.0,
        "RSI": 40.0,
        "Volume": 4000.0,
        "VOL_SMA20": 10000.0,
        "ROC_12": -0.02,
        "Momentum": -0.02,
        "MACD": -0.1,
        "MACD_Signal": -0.05,
        "ATR_14": 0.3
    }
    
    low_score = calculate_acceleration_score(low_mock)
    print(f"Low Mock Acceleration Score: {low_score}")
    assert low_score <= 4, f"Low score should be <= 4, got {low_score}"
    
    low_risk = calculate_dynamic_risk(
        score=low_score,
        last_close=10.0,
        atr=0.3,
        adx=12.0,
        r_vol=0.4
    )
    print(f"Low Dynamic Risk Profile: {low_risk}")
    assert low_risk["target_pct"] <= 10.0, f"Target pct for low score should be low, got {low_risk['target_pct']}"
    assert low_risk["stop_loss_pct"] <= 5.0, f"Stop loss pct for low score should be tight, got {low_risk['stop_loss_pct']}"
    
    print("All tests passed successfully!")

if __name__ == "__main__":
    run_tests()
