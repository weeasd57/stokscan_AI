#!/usr/bin/env python
"""
Threshold Calibration Script
هدف: إيجاد أفضل threshold للموديل الحالي بدون إعادة تدريب
Usage:
    python api/calibrate_threshold.py --model_path api/models/model_EGX_0.pkl
"""
import argparse
import pickle
import sys
import os
import pandas as pd
import numpy as np
from typing import Dict, Tuple, List, Any
from datetime import datetime, timedelta

# Force UTF-8 stdout for Windows terminals to handle emojis
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from dotenv import load_dotenv

# Load environment variables
api_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(api_dir)
load_dotenv(os.path.join(project_root, ".env"))

from supabase import create_client, Client

# Add parent directory to path
sys.path.insert(0, project_root)

from api.unified_features import FeatureEngineeringManager
from api.unified_labeling import TripleBarrierLabeler
from api.trading_config import TradingParameters


def get_supabase_client() -> Client:
    """
    Initialize Supabase client using environment variables
    """
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    
    if not url or not key:
        raise ValueError("Missing Supabase credentials. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    
    client = create_client(url, key)
    return client


def load_validation_data(exchange: str = "EGX", months_back: int = 6, predictors: List[str] = None) -> Tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    """
    Load real validation data from Supabase, run feature engineering, and label it.
    """
    from api.train_exchange_model import (
        add_technical_indicators,
        add_massive_features,
        add_market_context,
        fetch_fundamentals_for_exchange
    )
    from api.backtest_radar import load_egx30_index
    from api.stock_ai import _get_exchange_bulk_data
    from api.strict_quality_labeler import StrictQualityLabeler
    from api.unified_labeling import TripleBarrierLabeler
    
    print(f"📊 Loading REAL validation data for {exchange} from Supabase ({months_back} months)...")
    
    if not predictors:
        raise ValueError("Predictors list must be provided to filter feature columns")
        
    # Supabase Client
    supabase_client = get_supabase_client()
    
    # Calculate dates
    # We want validation data for the last `months_back` months
    val_start_date = (datetime.now() - timedelta(days=months_back * 30)).strftime("%Y-%m-%d")
    
    # Add a buffer (e.g. 180 days) for feature warmup
    buffer_start = (datetime.now() - timedelta(days=(months_back * 30) + 180)).strftime("%Y-%m-%d")
    
    # Load bulk price data
    data_map = _get_exchange_bulk_data(exchange, from_date=buffer_start)
    if not data_map:
        raise ValueError(f"No price data found in Supabase for {exchange}")
        
    print(f"   Loaded price data for {len(data_map)} symbols.")
    
    # Fetch index context
    market_df = None
    if exchange == "EGX":
        market_df = load_egx30_index(buffer_start)
        if market_df is not None:
            print(f"   EGX30 index loaded: {len(market_df)} days.")
            
    # Fetch fundamentals
    df_funds = fetch_fundamentals_for_exchange(supabase_client, exchange)
    fundamentals_loaded = df_funds is not None and not df_funds.empty
    if fundamentals_loaded:
        print(f"   Fundamentals loaded: {len(df_funds)} rows.")
        
    # Setup parameters matching training config
    t_params = TradingParameters(
        entry_mode="next_open",
        look_forward_days=20, # Default look_forward_days used in EGX model
        barrier_mode="percent",
        target_pct=0.04,      # Default profit target used in EGX model
        stop_loss_pct=0.02,   # Default stop loss used in EGX model
        min_history_needed=120,
        warmup_bars=120,
        require_volume_confirmation=(exchange == "EGX"),
        min_volume_ratio=0.8 if (exchange == "EGX") else 0.3,
    )
    
    all_processed_dfs = []
    
    for sym, df_sym in data_map.items():
        if len(df_sym) < 120:
            continue
            
        # Copy to prevent warnings
        df_sym = df_sym.copy()
            
        # Merge fundamentals
        if fundamentals_loaded:
            sym_funds = df_funds[df_funds["symbol"] == sym]
            if not sym_funds.empty:
                for col in ["marketCap", "peRatio", "eps", "dividendYield", "sector", "industry"]:
                    if col in sym_funds.columns:
                        df_sym[col] = sym_funds[col].iloc[0]
                        
        # Precompute daily return
        df_sym["stock_daily_return"] = df_sym["Close"].pct_change().fillna(0.0)
        
        # Calculate technical indicators
        df = add_technical_indicators(df_sym)
        if df.empty:
            continue
            
        # Align column casing
        df = df.rename(columns={"Close": "close", "Open": "open", "High": "high", "Low": "low", "Volume": "volume"})
        
        # Carry fundamentals
        for col in ["marketCap", "peRatio", "eps", "dividendYield", "sector", "industry", "stock_daily_return"]:
            if col in df_sym.columns and col not in df.columns:
                df[col] = df_sym[col].values
                
        # 2. Massive Feature Set
        df = add_massive_features(df)
        
        # 3. Market Context
        df = add_market_context(df, market_df)
        
        # 4. Labeling
        if exchange == "EGX":
            labeler = StrictQualityLabeler(t_params)
            df, _ = labeler.label_training_data_strict(df, egx30_data=market_df, drop_labels=True)
        else:
            labeler = TripleBarrierLabeler(t_params)
            df = labeler.label_training_data(df, drop_labels=True)
            
        if df.empty:
            continue
            
        # Filter to validation date range (exclude buffer period)
        df = df[df.index >= pd.to_datetime(val_start_date)]
        if df.empty:
            continue
            
        df["symbol"] = sym
        all_processed_dfs.append(df)
        
    if not all_processed_dfs:
        raise ValueError("No validation data samples could be successfully prepared after filtering dates and warm-up periods.")
        
    df_val_all = pd.concat(all_processed_dfs).sort_index()
    
    # Ensure all required features are in df_val_all, else fill them with 0
    for col in predictors:
        if col not in df_val_all.columns:
            df_val_all[col] = 0
            
    X_val = df_val_all[predictors].copy()
    X_val = X_val.replace([np.inf, -np.inf], np.nan).fillna(0)
    
    # Force categoricals
    cat_cols = ["sector", "industry"]
    for col in cat_cols:
        if col in X_val.columns:
            X_val[col] = (
                X_val[col]
                .astype(str)
                .replace(["nan", "None", "", "0", "0.0"], "Unknown")
                .fillna("Unknown")
                .astype("category")
            )
            
    y_val = df_val_all["Target"].values
    dates = df_val_all.index.values
    
    print(f"✅ Loaded {len(X_val)} validation samples from Supabase database")
    print(f"   Positive rate (win rate of target): {y_val.mean():.1%}")
    
    return X_val, y_val, dates


def calculate_metrics_at_threshold(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    threshold: float,
    dates: np.ndarray
) -> Dict:
    """
    Calculate comprehensive metrics at a given threshold
    """
    # Basic metrics
    tp = ((y_pred == 1) & (y_true == 1)).sum()
    fp = ((y_pred == 1) & (y_true == 0)).sum()
    fn = ((y_pred == 0) & (y_true == 1)).sum()
    tn = ((y_pred == 0) & (y_true == 0)).sum()
    
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    
    # Signals per month
    total_signals = (y_pred == 1).sum()
    dates_dt = pd.to_datetime(dates)
    n_days = (dates_dt.max() - dates_dt.min()).days
    n_months = n_days / 30
    signals_per_month = total_signals / n_months if n_months > 0 else 0
    
    # Expected profit (simplified)
    avg_win = 0.04
    avg_loss = 0.02
    expected_return = precision * avg_win - (1 - precision) * avg_loss
    
    # Profit factor
    profit_factor = (precision * avg_win) / ((1 - precision) * avg_loss) if precision < 1 else 999
    
    return {
        "threshold": threshold,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "total_signals": total_signals,
        "signals_per_month": signals_per_month,
        "expected_return": expected_return,
        "profit_factor": profit_factor,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn
    }


def find_optimal_thresholds(
    model: Any,
    X_val: pd.DataFrame,
    y_true: np.ndarray,
    dates: np.ndarray,
    min_precision: float = 0.58,
    min_signals_per_month: float = 5,
    max_signals_per_month: float = 25
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Find optimal thresholds based on different criteria
    """
    print("\n🔍 Scanning thresholds from 0.1 to 0.9...")
    
    thresholds = np.arange(0.1, 0.91, 0.05)
    results = []
    
    for threshold in thresholds:
        if hasattr(model, "meta_threshold"):
            model.meta_threshold = threshold
            y_proba = model.predict_proba(X_val)[:, 1]
            y_pred = (y_proba >= 0.5).astype(int)
        else:
            y_proba = model.predict_proba(X_val)[:, 1]
            y_pred = (y_proba >= threshold).astype(int)
            
        metrics = calculate_metrics_at_threshold(y_true, y_pred, threshold, dates)
        results.append(metrics)
    
    df_results = pd.DataFrame(results)
    
    # Filter by constraints
    df_filtered = df_results[
        (df_results['precision'] >= min_precision) &
        (df_results['signals_per_month'] >= min_signals_per_month) &
        (df_results['signals_per_month'] <= max_signals_per_month)
    ].copy()
    
    return df_results, df_filtered


def print_threshold_table(df_results: pd.DataFrame, df_filtered: pd.DataFrame):
    """
    Print formatted threshold analysis table
    """
    print("\n" + "=" * 100)
    print("📊 THRESHOLD CALIBRATION RESULTS")
    print("=" * 100)
    
    print("\nAll Thresholds:")
    print("-" * 100)
    print(f"{'Threshold':>10} | {'Precision':>10} | {'Recall':>10} | {'F1':>10} | "
          f"{'Signals':>8} | {'Sig/Month':>10} | {'Exp.Ret':>10} | {'PF':>8}")
    print("-" * 100)
    
    for _, row in df_results.iterrows():
        print(f"{row['threshold']:>10.2f} | "
              f"{row['precision']:>10.1%} | "
              f"{row['recall']:>10.1%} | "
              f"{row['f1']:>10.3f} | "
              f"{row['total_signals']:>8.0f} | "
              f"{row['signals_per_month']:>10.1f} | "
              f"{row['expected_return']:>10.2%} | "
              f"{row['profit_factor']:>8.2f}")
    
    print("\n" + "=" * 100)
    print("✅ RECOMMENDED THRESHOLDS (Precision >= 58%, 5-25 signals/month)")
    print("=" * 100)
    
    if len(df_filtered) == 0:
        print("\n⚠️  No thresholds meet the criteria!")
        print("\nRelaxing constraints... showing closest matches:")
        
        df_top = df_results.nlargest(5, 'profit_factor')
        print("-" * 100)
        print(f"{'Threshold':>10} | {'Precision':>10} | {'Signals/Mo':>12} | "
              f"{'Exp.Return':>12} | {'PF':>8} | {'Reason'}")
        print("-" * 100)
        
        for _, row in df_top.iterrows():
            reasons = []
            if row['precision'] < 0.58:
                reasons.append("Low Prec")
            if row['signals_per_month'] < 5:
                reasons.append("Few Sig")
            if row['signals_per_month'] > 25:
                reasons.append("Too Many")
            
            print(f"{row['threshold']:>10.2f} | "
                  f"{row['precision']:>10.1%} | "
                  f"{row['signals_per_month']:>12.1f} | "
                  f"{row['expected_return']:>12.2%} | "
                  f"{row['profit_factor']:>8.2f} | "
                  f"{', '.join(reasons) if reasons else 'OK'}")
    else:
        print(f"\n✅ Found {len(df_filtered)} suitable thresholds:\n")
        print("-" * 100)
        print(f"{'Threshold':>10} | {'Precision':>10} | {'Recall':>10} | "
              f"{'Sig/Month':>10} | {'Exp.Ret':>10} | {'PF':>8} | {'Strategy'}")
        print("-" * 100)
        
        for _, row in df_filtered.iterrows():
            if row['signals_per_month'] < 8:
                strategy = "Conservative"
            elif row['signals_per_month'] < 15:
                strategy = "Balanced"
            else:
                strategy = "Aggressive"
            
            marker = "⭐" if row['profit_factor'] > 1.8 else ""
            
            print(f"{row['threshold']:>10.2f} | "
                  f"{row['precision']:>10.1%} | "
                  f"{row['recall']:>10.1%} | "
                  f"{row['signals_per_month']:>10.1f} | "
                  f"{row['expected_return']:>10.2%} | "
                  f"{row['profit_factor']:>8.2f} | "
                  f"{strategy:>12} {marker}")
        
        print("\n" + "-" * 100)
        print("💡 RECOMMENDATIONS:")
        print("-" * 100)
        
        best_pf = df_filtered.nlargest(1, 'profit_factor').iloc[0]
        print(f"\n🎯 Best Profit Factor: Threshold = {best_pf['threshold']:.2f}")
        print(f"   Precision: {best_pf['precision']:.1%}, "
              f"Signals/Month: {best_pf['signals_per_month']:.1f}, "
              f"PF: {best_pf['profit_factor']:.2f}")
        
        best_ret = df_filtered.nlargest(1, 'expected_return').iloc[0]
        print(f"\n💰 Best Expected Return: Threshold = {best_ret['threshold']:.2f}")
        print(f"   Precision: {best_ret['precision']:.1%}, "
              f"Expected Return: {best_ret['expected_return']:.2%}, "
              f"Signals/Month: {best_ret['signals_per_month']:.1f}")
        
        df_filtered_copy = df_filtered.copy()
        df_filtered_copy['balance_score'] = abs(df_filtered_copy['signals_per_month'] - 11)
        best_balanced = df_filtered_copy.nsmallest(1, 'balance_score').iloc[0]
        print(f"\n⚖️  Most Balanced: Threshold = {best_balanced['threshold']:.2f}")
        print(f"   Precision: {best_balanced['precision']:.1%}, "
              f"Signals/Month: {best_balanced['signals_per_month']:.1f}, "
              f"PF: {best_balanced['profit_factor']:.2f}")
    
    print("\n" + "=" * 100)


def analyze_by_market_regime(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    dates: np.ndarray,
    threshold: float
):
    """
    Analyze performance by market regime
    """
    print(f"\n📈 Performance Analysis at Threshold = {threshold:.2f}")
    print("-" * 100)
    
    df_analysis = pd.DataFrame({
        'date': dates,
        'y_true': y_true,
        'y_proba': y_proba,
        'y_pred': (y_proba >= threshold).astype(int)
    })
    
    df_analysis['month'] = pd.to_datetime(df_analysis['date']).dt.to_period('M')
    
    monthly_stats = []
    for month, group in df_analysis.groupby('month'):
        if len(group) < 10:
            continue
        
        tp = ((group['y_pred'] == 1) & (group['y_true'] == 1)).sum()
        fp = ((group['y_pred'] == 1) & (group['y_true'] == 0)).sum()
        
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        signals = (group['y_pred'] == 1).sum()
        
        monthly_stats.append({
            'month': str(month),
            'precision': precision,
            'signals': signals,
            'samples': len(group)
        })
    
    if monthly_stats:
        df_monthly = pd.DataFrame(monthly_stats)
        
        print("\nMonthly Performance:")
        print(f"{'Month':>10} | {'Precision':>10} | {'Signals':>8} | {'Samples':>8}")
        print("-" * 50)
        
        for _, row in df_monthly.iterrows():
            marker = "✅" if row['precision'] >= 0.58 else "⚠️"
            print(f"{row['month']:>10} | {row['precision']:>10.1%} | "
                  f"{row['signals']:>8.0f} | {row['samples']:>8.0f} {marker}")
        
        print("-" * 50)
        print(f"{'Average':>10} | {df_monthly['precision'].mean():>10.1%} | "
              f"{df_monthly['signals'].mean():>8.1f} | {df_monthly['samples'].mean():>8.1f}")


def main():
    parser = argparse.ArgumentParser(description="Calibrate model threshold")
    parser.add_argument(
        "--model_path",
        type=str,
        default="api/models/model_EGX_0.pkl",
        help="Path to model pickle file"
    )
    parser.add_argument(
        "--exchange",
        type=str,
        default="EGX",
        help="Exchange to analyze"
    )
    parser.add_argument(
        "--months_back",
        type=int,
        default=6,
        help="Months of validation data"
    )
    parser.add_argument(
        "--min_precision",
        type=float,
        default=0.58,
        help="Minimum acceptable precision"
    )
    parser.add_argument(
        "--analyze_threshold",
        type=float,
        default=None,
        help="Analyze specific threshold in detail"
    )
    
    args = parser.parse_args()
    
    # Load model
    print(f"🔧 Loading model: {args.model_path}")
    try:
        from api.backtest_radar import load_model, reconstruct_meta_model
        artifact = load_model(args.model_path)
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        sys.exit(1)
        
    if artifact is None:
        print("❌ Failed to load model artifact")
        sys.exit(1)
    
    # Check if it's a meta-labeling system
    if isinstance(artifact, dict) and artifact.get("kind") == "meta_labeling_system":
        model = reconstruct_meta_model(artifact)
        predictors = artifact["primary_model"].get("feature_names")
        categorical_features = artifact["primary_model"].get("categorical_features", [])
        print("   Model type: Meta-labeling system (reconstructed)")
    else:
        if isinstance(artifact, dict):
            model = artifact.get("model") or artifact.get("primary_model") or artifact
            predictors = artifact.get("feature_names") or artifact.get("predictors")
            categorical_features = artifact.get("categorical_features", [])
        else:
            model = artifact
            predictors = None
            categorical_features = []
        print("   Model type: Direct classifier")
    
    if model is None:
        print("❌ No model found in artifact")
        sys.exit(1)
        
    if not predictors:
        print("❌ Warning: No predictors list found in model artifact. Attempting to get features from model...")
        if hasattr(model, "feature_name_"):
            predictors = model.feature_name_()
        elif hasattr(model, "feature_names"):
            predictors = model.feature_names
        else:
            print("❌ Error: Could not determine feature names for calibration data loading.")
            sys.exit(1)
    
    # Load validation data
    try:
        X_val, y_val, dates = load_validation_data(
            exchange=args.exchange,
            months_back=args.months_back,
            predictors=predictors
        )
    except Exception as e:
        print(f"❌ Error loading validation data: {e}")
        sys.exit(1)
        
    # Align categories if it is a LightGBM booster
    try:
        from api.model_utils import align_pandas_categories_to_booster, get_primary_booster
        primary_booster = get_primary_booster(model)
        cat_cols = ["sector", "industry"]
        cat_cols_present = [c for c in cat_cols if c in X_val.columns]
        
        X_val = align_pandas_categories_to_booster(
            X_val,
            cat_cols=cat_cols_present,
            booster=primary_booster,
            cat_cols_order=list(categorical_features or []),
        )
        print("   Aligned categorical features with LightGBM booster.")
    except Exception as e:
        print(f"   Note: Categorical alignment skipped: {e}")
    
    # Find optimal thresholds
    df_results, df_filtered = find_optimal_thresholds(
        model, X_val, y_val, dates,
        min_precision=args.min_precision
    )
    
    # Print results
    print_threshold_table(df_results, df_filtered)
    
    # Analyze specific threshold if requested
    if args.analyze_threshold:
        if hasattr(model, "meta_threshold"):
            model.meta_threshold = args.analyze_threshold
            y_proba = model.predict_proba(X_val)[:, 1]
        else:
            y_proba = model.predict_proba(X_val)[:, 1]
        analyze_by_market_regime(y_val, y_proba, dates, args.analyze_threshold)
    elif len(df_filtered) > 0:
        # Analyze best threshold
        best_threshold = df_filtered.nlargest(1, 'profit_factor').iloc[0]['threshold']
        if hasattr(model, "meta_threshold"):
            model.meta_threshold = best_threshold
            y_proba = model.predict_proba(X_val)[:, 1]
        else:
            y_proba = model.predict_proba(X_val)[:, 1]
        analyze_by_market_regime(y_val, y_proba, dates, best_threshold)
    
    # Save results
    output_file = f"threshold_calibration_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    df_results.to_csv(output_file, index=False)
    print(f"\n💾 Results saved to: {output_file}")
    
    print("\n✅ Calibration complete!")


if __name__ == "__main__":
    main()
