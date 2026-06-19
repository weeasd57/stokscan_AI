import argparse
import sys
import os
import pickle
import warnings
import re
import pandas as pd
import numpy as np
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load envs similar to main.py
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(base_dir, ".env"))
# Also try web/.env.local where Supabase keys overlap often in this project structure
load_dotenv(os.path.join(base_dir, "web", ".env.local"), override=True)

if os.getenv("BT_DEBUG_ENV") == "1":
    print(
        f"DEBUG: NEXT_PUBLIC_SUPABASE_URL found? {'NEXT_PUBLIC_SUPABASE_URL' in os.environ}",
        flush=True,
    )


# Add api parent dir to path to allow imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.stock_ai import _get_exchange_bulk_data, _get_exchange_bulk_intraday_data, _MetaLabelingClassifier
from api.train_exchange_model import add_massive_features
from api.strategy_engine import StrategyEngine
from api.model_utils import reset_booster_cats, reset_nested_boosters, get_primary_booster, align_pandas_categories_to_booster, align_for_king
from api.trading_config import TradingParameters
from api.unified_labeling import TripleBarrierLabeler
from api.unified_features import FeatureEngineeringManager
from api.structured_logger import StructuredLogger
from api.portfolio_manager import PortfolioManager

warnings.filterwarnings("ignore")

# Force UTF-8 stdout for Windows terminals to handle emojis
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Safe print wrapper that removes non-ASCII characters to prevent encoding errors
_orig_print = print
def safe_print(*args, **kwargs):
    """Print with automatic removal of non-ASCII characters for Windows compatibility."""
    try:
        # Convert all args to strings and remove non-ASCII
        safe_args = []
        for arg in args:
            s = str(arg)
            # Remove emoji/unicode characters, keep only ASCII
            s = s.encode('ascii', 'replace').decode('ascii')
            safe_args.append(s)
        _orig_print(*safe_args, **kwargs)
    except Exception:
        # Fallback: just try to print anyway
        try:
            _orig_print(*args, **kwargs)
        except Exception:
            pass

# Override print for this module
print = safe_print

# Global cache for index data to avoid repeated file reads
_INDEX_CACHE = {}

_DATE_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATE_ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T")
_DATE_DMY_SLASH_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")


def _parse_cli_date(value: str) -> pd.Timestamp:
    """
    Parse CLI dates reliably.

    Notes:
    - The UI sends ISO dates like YYYY-MM-DD. Pandas with dayfirst=True will mis-parse
      these as YYYY-DD-MM (e.g. 2025-07-01 -> 2025-01-07), so we must detect ISO.
    - We still support dd/mm/yyyy from older UI inputs.
    """
    v = (value or "").strip()
    if not v:
        raise ValueError("Empty date")

    if _DATE_ISO_RE.match(v):
        return pd.to_datetime(v, format="%Y-%m-%d", errors="raise")

    if _DATE_ISO_DATETIME_RE.match(v):
        return pd.to_datetime(v, errors="raise")

    if _DATE_DMY_SLASH_RE.match(v):
        return pd.to_datetime(v, dayfirst=True, errors="raise")

    # Fallback: prefer month-first parsing, then day-first.
    try:
        return pd.to_datetime(v, dayfirst=False, errors="raise")
    except Exception:
        return pd.to_datetime(v, dayfirst=True, errors="raise")


def load_egx30_index(start_date: str = None, end_date: str = None):
    """
    Load EGX30 index data from JSON file and filter by date range.
    Falls back to Supabase database if local JSON file is missing.
    Returns DataFrame with date index and close prices.
    """
    global _INDEX_CACHE
    
    # Check cache first
    cache_key = f"{start_date}:{end_date}"
    if cache_key in _INDEX_CACHE:
        return _INDEX_CACHE[cache_key].copy()
    
    df = None
    try:
        # Path to EGX30-INDEX.json
        index_path = os.path.join(base_dir, "symbols_data", "EGX30-INDEX.json")
        
        if os.path.exists(index_path):
            with open(index_path, 'r') as f:
                index_data = json.load(f)
            
            df = pd.DataFrame(index_data)
            df['date'] = pd.to_datetime(df['date'])
            df = df.set_index('date').sort_index()
            print(f"DEBUG: Loaded EGX30 index data from JSON: {len(df)} days", flush=True)
    except Exception as e:
        print(f"WARNING: Error loading EGX30 index from JSON: {e}", flush=True)
        
    if df is None or df.empty:
        print("DEBUG: Fetching EGX30 index data from Supabase...", flush=True)
        try:
            from api import stock_ai
            stock_ai._init_supabase()
            supabase = stock_ai.supabase
            if supabase:
                offset = 0
                limit = 1000
                all_data = []
                while True:
                    idx_res = (
                        supabase.table("stock_prices")
                        .select("date, close")
                        .eq("symbol", "EGX30")
                        .eq("exchange", "INDX")
                        .order("date", desc=False)
                        .range(offset, offset + limit - 1)
                        .execute()
                    )
                    if not idx_res.data:
                        break
                    all_data.extend(idx_res.data)
                    if len(idx_res.data) < limit:
                        break
                    offset += limit
                
                if all_data:
                    df = pd.DataFrame(all_data)
                    df["date"] = pd.to_datetime(df["date"])
                    df = df.set_index("date").sort_index()
                    print(f"DEBUG: Loaded EGX30 index data from Supabase: {len(df)} days", flush=True)
        except Exception as e:
            print(f"ERROR fetching EGX30 index from Supabase: {e}", flush=True)
            
    if df is not None and not df.empty:
        # Filter by date range if provided
        if start_date:
            df = df[df.index >= pd.to_datetime(start_date)]
        if end_date:
            df = df[df.index <= pd.to_datetime(end_date)]
        
        # Cache the result
        _INDEX_CACHE[cache_key] = df.copy()
        return df
        
    return None

def calculate_benchmark_returns(start_date: str, end_date: str):
   
    index_df = load_egx30_index(start_date, end_date)

    if index_df is None or len(index_df) < 2:
        print("WARNING: Insufficient index data for benchmark calculation", flush=True)
        return None

    try:
        if 'open' in index_df.columns:
            start_price = float(index_df['open'].iloc[0])
        else:
            start_price = float(index_df['close'].iloc[0])
    except Exception:
        start_price = float(index_df['close'].iloc[0])

    end_price = float(index_df['close'].iloc[-1])

    benchmark_return = (end_price - start_price) / start_price
    
    print(
        f"DEBUG: EGX30 Benchmark - Start: {start_price:.2f}, End: {end_price:.2f}, "
        f"Return: {benchmark_return*100:.2f}%",
        flush=True
    )
    
    return benchmark_return

def load_model(model_path):
    """Loads a model from a pickle file."""
    try:
        with open(model_path, "rb") as f:
            obj = pickle.load(f)
        
        # Determine if it's a naked booster/model or a dictionary artifact
        if isinstance(obj, dict):
             # Check if it's a meta-labeling system
            if obj.get("kind") == "meta_labeling_system":
                return obj
            # For regular model artifact, ensure optimal_threshold is present
            if obj.get("optimal_threshold") is None:
                # Fallback: use default or meta_threshold if available
                if obj.get("meta_threshold") is not None:
                    obj["optimal_threshold"] = obj["meta_threshold"]
                else:
                    obj["optimal_threshold"] = 0.5  # Default safe threshold
            return obj
        return obj
    except Exception as e:
        msg = f"Error loading model {model_path}: {e}"
        try:
            print(msg, flush=True)
        except UnicodeEncodeError:
            print(msg.encode("ascii", "replace").decode("ascii"), flush=True)
        return None

def reconstruct_meta_model(artifact):
    """
    Reconstructs a usable _MetaLabelingClassifier from the dictionary artifact.
    """
    if not isinstance(artifact, dict) or artifact.get("kind") != "meta_labeling_system":
        return None
        
    import lightgbm as lgb
    
    pm_art = artifact["primary_model"]
    if pm_art.get("model_str"):
        primary_booster = lgb.Booster(model_str=pm_art["model_str"])
        # Wrap it if needed to have a similar API
        class PrimaryWrapper:
            def __init__(self, b): self.b = b
            def predict(self, X): return self.b.predict(X)
            def predict_proba(self, X): 
                raw = self.b.predict(X)
                return np.column_stack([1-raw, raw])
            
        primary_model = PrimaryWrapper(primary_booster)
    else:
        # Fallback
        primary_model = pm_art
        
    meta_model = artifact["meta_model"]
    meta_features = artifact["meta_feature_names"]
    threshold = artifact.get("meta_threshold", 0.6)
    
    from api.stock_ai import _MetaLabelingClassifier
    wrapper = _MetaLabelingClassifier(
        primary_model=primary_model,
        meta_model=meta_model,
        meta_feature_names=meta_features,
        meta_threshold=threshold
    )
    return wrapper

def run_radar_simulation(
    df,
    model,
    council=None,
    threshold=None,
    capital=100000,
    sim_start_dt: datetime | None = None,
    sim_end_dt: datetime | None = None,
    quiet: bool = False,
    validator_threshold: float | None = None,
    target_pct_override: float | None = None,
    stop_loss_pct_override: float | None = None,
    min_volume_ratio: float = 0.3,
    use_rsi_filter: bool = True,
    use_trend_filter: bool = False,
    use_market_regime: bool = True,
    regime_adx_threshold: float = 14.0,
    use_smart_exit: bool = True,
    smart_exit_rsi_threshold: float = 40.0,
    smart_exit_volume_spike: float = 3.0,
    trading_mode: str = "hybrid",
    use_atr_exits: bool = True,
    atr_sl_multiplier: float = 1.5,
    atr_tp_multiplier: float = 2.5,
    atr_period: int = 14,
    exit_mode: str = "hybrid",
    adaptive_exits: bool = False,
    use_trailing: bool = True,
    trail_be_pct: float = 0.04,
    trail_lock_trigger_pct: float = 0.06,
    trail_lock_pct: float = 0.04
):
    """
    Simulation of Radar: Base Model Detector -> Meta Model Confirmation.
    """
    # Use optimal_threshold from model if threshold is not explicitly provided
    if threshold is None:
        if isinstance(model, dict) and model.get("optimal_threshold") is not None:
            threshold = float(model.get("optimal_threshold"))
        elif isinstance(model, dict) and model.get("meta_threshold") is not None:
            threshold = float(model.get("meta_threshold"))
        else:
            threshold = 0.5
    
    if df.empty: return {}
    if not quiet:
        print(f"DEBUG: run_radar_simulation called for {len(df)} rows", flush=True)

    max_score = 0.0
    max_consensus = 0.0
    max_validator = 0.0
    
    balance = capital
    trade_log = []
    
    # Load unified parameters
    params = TradingParameters.from_model_artifact(model)

    # Apply overrides (CLI/UI parameters)
    if target_pct_override is not None and target_pct_override > 0:
        params.target_pct = target_pct_override
    if stop_loss_pct_override is not None and stop_loss_pct_override > 0:
        params.stop_loss_pct = stop_loss_pct_override
    if threshold is not None:
        params.king_threshold = threshold
    if validator_threshold is not None:
        params.validator_threshold = validator_threshold
    if min_volume_ratio is not None:
        params.min_volume_ratio = min_volume_ratio

    # Log parameters load
    struct_logger = StructuredLogger("backtest")
    struct_logger.log_parameter_load("backtest_pipeline", params)

    # Log loaded parameters
    if not quiet:
        print(f"[BT-LIVE] Active Trading Parameters for simulation:")
        print(f"   - Barrier Mode: {params.barrier_mode}")
        print(f"   - Target Pct / Multiplier: {params.target_pct}")
        print(f"   - Stop Loss Pct / Multiplier: {params.stop_loss_pct}")
        print(f"   - Look Forward Days: {params.look_forward_days}")
        print(f"   - Require Volume Confirmation: {params.require_volume_confirmation}")

    # Set up labeler
    labeler = TripleBarrierLabeler(params)

    # Determine barrier parameters and HOLD_MAX_BARS
    HOLD_MAX_BARS = params.look_forward_days
    
    # Check if target or stop loss look like ATR multipliers (expected >= 1.0)
    if params.barrier_mode == "atr_multiplier" or params.target_pct >= 1.0 or params.stop_loss_pct >= 1.0:
        params.barrier_mode = "atr_multiplier"
        atr_tp_multiplier = params.target_pct
        atr_sl_multiplier = params.stop_loss_pct
        TARGET_PCT = 0.10
        STOP_LOSS_PCT = 0.05
        use_atr_exits = True
    else:
        TARGET_PCT = params.target_pct
        STOP_LOSS_PCT = params.stop_loss_pct
        atr_tp_multiplier = 2.5
        atr_sl_multiplier = 1.5
        use_atr_exits = False

    def _position_size_multiplier(score: float | None) -> float:
        """
        Map Validator Score -> position sizing multiplier.
        Score 0.40-0.55 => 0.5x
        Score 0.55-0.70 => 1.0x
        Score 0.70+     => 1.5x
        """
        try:
            if score is None or (isinstance(score, float) and np.isnan(score)):
                return 1.0
            s = float(score)
        except Exception:
            return 1.0

        if s < 0.55:
            return 0.5
        if s < 0.70:
            return 1.0
        return 1.5
    
    classifier = model
    if isinstance(model, dict):
        if model.get("kind") == "meta_labeling_system":
            classifier = reconstruct_meta_model(model)
            if not classifier:
                return {}
            if hasattr(classifier, "meta_threshold"):
                classifier.meta_threshold = threshold
        elif "model_str" in model:
            import lightgbm as lgb
            primary_booster = lgb.Booster(model_str=model["model_str"])
            class PrimaryWrapper:
                def __init__(self, b): self.b = b
                def predict(self, X): return self.b.predict(X)
                def predict_proba(self, X): 
                    raw = self.b.predict(X)
                    return np.column_stack([1-raw, raw])
            classifier = PrimaryWrapper(primary_booster)
        elif "model" in model:
            classifier = model["model"]

    # Pre-calculate signals
    try:
        expected_features = []
        categorical_features = []
        cat_cols = []

        if isinstance(model, dict) and model.get("kind") == "meta_labeling_system":
            pm = model.get("primary_model") or {}
            expected_features = list(pm.get("feature_names") or [])
            categorical_features = list(pm.get("categorical_features") or [])

        X_all = df.copy()
        X = X_all
        if expected_features:
            # Fill missing with 0 and subset
            missing = set(expected_features) - set(X.columns)
            for m in missing: X[m] = 0
            X = X[expected_features]
            
            # Decide categorical columns:
            # - Prefer the saved artifact list (pm.categorical_features).
            # - Fallback only when the feature is explicitly part of the model input.
            fallback_cats = [c for c in ["sector", "industry"] if c in expected_features]
            cat_cols = list(dict.fromkeys(list(categorical_features or []) + fallback_cats))

            # Normalize categoricals
            for col in cat_cols:
                if col in X.columns:
                    X[col] = (
                        X[col]
                        .astype(str)
                        .replace(["nan", "None", "", "0", "0.0"], "Unknown")
                        .fillna("Unknown")
                        .astype("category")
                    )

            # Force non-categoricals to numeric (prevents accidental "object" columns)
            non_cat_cols = [c for c in X.columns if c not in set(cat_cols)]
            for col in non_cat_cols:
                if not pd.api.types.is_numeric_dtype(X[col]):
                    X[col] = pd.to_numeric(X[col], errors="coerce")

            X = X.replace([np.inf, -np.inf], np.nan)
            if non_cat_cols:
                X[non_cat_cols] = X[non_cat_cols].fillna(0)

        X_pred = X.copy()

        # If we can, align category *levels* to the training booster to keep predictions meaningful.
        # Otherwise, reset booster categorical state per-call to avoid hard crashes.
        primary_booster = get_primary_booster(classifier)
        X_pred = align_pandas_categories_to_booster(
            X_pred,
            cat_cols=[c for c in cat_cols if c in X_pred.columns],
            booster=primary_booster,
            cat_cols_order=list(categorical_features or []),
        )

        # Guard: LightGBM categorical_feature mismatch (ensure booster doesn't carry stale pandas_categorical)
        if primary_booster is None or not (categorical_features and hasattr(primary_booster, "pandas_categorical")):
            reset_nested_boosters(classifier)

        try:
            probs = classifier.predict_proba(X_pred)
            confidences = probs[:, 1]
            max_conf = float(np.max(confidences)) if len(confidences) > 0 else 0.0
            min_conf = float(np.min(confidences)) if len(confidences) > 0 else 0.0
            print(f"[BT-LIVE] DEBUG: predictions OK, shape={probs.shape}, max={max_conf:.4f}, min={min_conf:.4f}", flush=True)
        except Exception as e:
            print(f"[BT-LIVE] ERROR: prediction failed: {str(e)}", flush=True)
            # Try converting all data to float to bypass categorical issues
            try:
                X_numeric = X_pred.copy()
                for col in X_numeric.columns:
                    if X_numeric[col].dtype == 'category' or X_numeric[col].dtype == 'object':
                        X_numeric[col] = X_numeric[col].astype('category').cat.codes.astype('float32')
                    else:
                        X_numeric[col] = X_numeric[col].astype('float32')
                
                reset_nested_boosters(classifier)
                probs = classifier.predict_proba(X_numeric)
                confidences = probs[:, 1]
                print(f"[BT-LIVE] Recovered from prediction error, max={float(np.max(confidences)):.4f}", flush=True)
            except Exception as e2:
                print(f"[BT-LIVE] ERROR: Failed to recover: {str(e2)}", flush=True)
                return {}
        
        # Phase 2: Council Filtering (use full feature frame so each model can align its own features)
        consensus_scores = None
        detailed_votes = {}
        if council:
            consensus_scores = council.get_consensus(X_all)
            detailed_votes = council.get_detailed_votes(X_all)

        # Optional: Council Validator (trains on KING BUYs; needs KING confidence feature)
        validator_probs = None
        if hasattr(run_radar_simulation, "_validator") and getattr(run_radar_simulation, "_validator", None) is not None:
            validator = getattr(run_radar_simulation, "_validator", None)
            # Get KING artifact/model from the council if present; otherwise allow a standalone KING for validator-only mode.
            king_obj = None
            try:
                king_obj = getattr(council, "models", {}).get("king") if council else None
            except Exception:
                king_obj = None
            if king_obj is None:
                king_obj = getattr(run_radar_simulation, "_king_validator_artifact", None)

            king_clf = king_obj
            if isinstance(king_clf, dict) and king_clf.get("kind") == "meta_labeling_system":
                king_clf = reconstruct_meta_model(king_clf)

            if king_clf is not None and hasattr(king_clf, "predict_proba"):
                # Align KING input to its training feature schema.
                Xk = align_for_king(X_all, king_obj) if isinstance(king_obj, dict) else X_all

                # Critical: if KING was trained with pandas categoricals, LightGBM requires
                # the prediction-time category levels to match training-time levels.
                try:
                    if isinstance(king_obj, dict):
                        king_pm = king_obj.get("primary_model") or {}
                        king_cat_cols_order = list(king_pm.get("categorical_features") or [])
                        king_cat_cols = [c for c in king_cat_cols_order if c in Xk.columns]
                    else:
                        king_cat_cols_order = []
                        king_cat_cols = []

                    king_primary_booster = get_primary_booster(king_clf)
                    Xk = align_pandas_categories_to_booster(
                        Xk,
                        cat_cols=king_cat_cols,
                        booster=king_primary_booster,
                        cat_cols_order=king_cat_cols_order,
                    )
                except Exception:
                    pass

                king_conf = king_clf.predict_proba(Xk)[:, 1]
                try:
                    validator_probs = validator.predict_proba(X_all, primary_conf=king_conf)[:, 1]
                except Exception as e:
                    print(f"Warning: Council validator failed: {e}", flush=True)
                    validator_probs = None

        # Calculate max scores for reporting
        max_score = float(np.max(confidences)) if len(confidences) > 0 else 0.0
        max_consensus = float(np.max(consensus_scores)) if consensus_scores is not None else 0.0
        max_validator = float(np.max(validator_probs)) if validator_probs is not None and len(validator_probs) > 0 else 0.0
        
    except Exception as e:
        print(f"ERROR: run_radar_simulation prediction failed: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return {}

    # Iterate to trade
    dates = df.index

    # Accept either lowercase (close/high/low) or the more common OHLCV casing (Close/High/Low)
    close_col = "close" if "close" in df.columns else ("Close" if "Close" in df.columns else None)
    high_col = "high" if "high" in df.columns else ("High" if "High" in df.columns else None)
    low_col = "low" if "low" in df.columns else ("Low" if "Low" in df.columns else None)
    if close_col is None or high_col is None or low_col is None:
        missing_ohlc = [c for c, v in [("close/Close", close_col), ("high/High", high_col), ("low/Low", low_col)] if v is None]
        print(f"ERROR: Missing OHLC columns for trading loop: {missing_ohlc}", flush=True)
        return {}

    closes = df[close_col].values
    highs = df[high_col].values
    lows = df[low_col].values
    symbols = df['symbol'].values if 'symbol' in df.columns else [None]*len(df)
    
    # Track pre-council and post-council separately
    pre_council_trades = []
    post_council_trades = []
    balance_pre = capital
    balance_post = capital
    
    hold_max = min(HOLD_MAX_BARS, max(1, len(df) - 1))
    if hold_max != HOLD_MAX_BARS:
        print(f"[BT-LIVE] Using adaptive hold window: {hold_max} bars (requested {HOLD_MAX_BARS})", flush=True)

    in_trade = False
    exit_idx = -1

    for i in range(len(df)):
        # Skip if we are currently in a trade
        if in_trade:
            if i <= exit_idx:
                continue
            else:
                in_trade = False
        radar_score = confidences[i]
        council_score = consensus_scores[i] if consensus_scores is not None else 1.0
        validator_score = float(validator_probs[i]) if validator_probs is not None else None
        
        # Check if Radar phase passes (before council)
        passes_radar = radar_score >= threshold
        
        # Check if Council phase also passes
        passes_council = council_score >= 0.55
        if validator_probs is not None:
            v_thresh = validator_threshold
            if v_thresh is None:
                v_thresh = float(getattr(getattr(run_radar_simulation, "_validator", None), "approval_threshold", 0.5))
            
            passes_council = passes_council and (validator_probs[i] >= v_thresh)
        
        # Track pre-council if radar passes
        if passes_radar:
            score = council_score # Use consensus as the final "score" for the log
            entry_price = closes[i]
            entry_date = dates[i]
            symbol = symbols[i]

            try:
                entry_dt = pd.to_datetime(entry_date).tz_localize(None)
            except Exception:
                entry_dt = None
            if sim_start_dt is not None and entry_dt is not None and entry_dt < sim_start_dt:
                continue
            if sim_end_dt is not None and entry_dt is not None and entry_dt > sim_end_dt:
                continue

            # Centralized Bot Logic: 1. Market Regime Check
            history_slice = df.iloc[max(0, i - 250):i + 1].copy()
            history_slice.columns = [c.lower() for c in history_slice.columns]
            
            regime = StrategyEngine.detect_market_regime(
                bars=history_slice,
                use_market_regime=use_market_regime,
                regime_adx_threshold=regime_adx_threshold
            )
            
            if regime == "BEAR" and trading_mode.lower() != "aggressive":
                continue

            # Centralized Bot Logic: 2. Technical Filters Check
            filters_passed, filter_msg = StrategyEngine.check_technical_filters(
                bars=history_slice,
                min_volume_ratio=min_volume_ratio,
                use_trend_filter=use_trend_filter,
                use_rsi_filter=use_rsi_filter,
                mode_overrides={"skip_trend_filter": trading_mode.lower() == "aggressive"}
            )
            if not filters_passed:
                continue

            # Position sizing multiplier based on regime
            regime_size_mult = 1.0
            if regime == "SIDEWAYS":
                regime_size_mult = 0.7 if trading_mode.lower() == "aggressive" else 0.5
            elif regime == "STRONG_BULL":
                regime_size_mult = 1.2 # slightly larger sizing in strong momentum
            elif regime == "BEAR" and trading_mode.lower() == "aggressive":
                regime_size_mult = 0.3

            # Retrieve ATR value at index i to pass to backtest_trade
            atr_val = float(df["atr_14"].values[i]) if "atr_14" in df.columns else (
                float(df["ATR_14"].values[i]) if "ATR_14" in df.columns else 0.0
            )
            if atr_val == 0.0 and "close" in df.columns:
                # fallback calculation
                atr_val = float(df["close"].rolling(14).std().bfill().values[i])

            # Construct the bars_ahead list for subsequent prices
            bars_ahead = []
            for days_fwd in range(1, hold_max + 1):
                idx = i + days_fwd
                if idx >= len(df): break
                bars_ahead.append({
                    "high": float(highs[idx]),
                    "low": float(lows[idx]),
                    "close": float(closes[idx]),
                    "volume": float(df['volume'].values[idx]) if 'volume' in df.columns else (
                        float(df['Volume'].values[idx]) if 'Volume' in df.columns else 0.0
                    )
                })

            volume_ma_20_val = None
            if "volume" in df.columns:
                volume_ma_20_val = float(df["volume"].rolling(20).mean().values[i])
            elif "Volume" in df.columns:
                volume_ma_20_val = float(df["Volume"].rolling(20).mean().values[i])

            # Save original parameters to restore afterwards
            orig_tp_mult = labeler.params.target_pct
            orig_sl_mult = labeler.params.stop_loss_pct
            
            # Dynamic overrides for ATR exits based on regime
            if adaptive_exits and labeler.params.barrier_mode == "atr_multiplier":
                if regime == "STRONG_BULL":
                    labeler.params.target_pct = 5.0
                    labeler.params.stop_loss_pct = 2.0
                elif regime == "BULL":
                    labeler.params.target_pct = 3.0
                    labeler.params.stop_loss_pct = 1.5
                elif regime == "SIDEWAYS":
                    labeler.params.target_pct = 2.5
                    labeler.params.stop_loss_pct = 1.2
                elif regime == "BEAR":
                    labeler.params.target_pct = 2.0
                    labeler.params.stop_loss_pct = 1.0

            outcome_obj = labeler.backtest_trade(
                entry_price=entry_price,
                atr=atr_val,
                bars_ahead=bars_ahead,
                max_bars=hold_max,
                volume_ma_20=volume_ma_20_val
            )
            
            # Restore original parameters
            labeler.params.target_pct = orig_tp_mult
            labeler.params.stop_loss_pct = orig_sl_mult

            outcome_mapping = {
                "SL_HIT": "STOP LOSS [X]",
                "TP_HIT": "TARGET HIT 🎯",
                "TIMEOUT": "TIMEOUT",
                "HOLD": "HOLD"
            }
            outcome = outcome_mapping.get(outcome_obj.outcome, outcome_obj.outcome)
            pnl_pct = outcome_obj.pnl_pct / 100.0
            exit_idx = min(len(df) - 1, i + outcome_obj.exit_bars)
            exit_date = dates[exit_idx]
            exit_price = outcome_obj.exit_price

            # Training-to-Backtest consistency check
            if "Target" in df.columns:
                expected_label = int(df["Target"].iloc[i])
                simulated_label = 1 if outcome_obj.outcome == "TP_HIT" else 0
                if expected_label != simulated_label:
                    expected_pnl = params.target_pct if expected_label == 1 else -params.stop_loss_pct
                    simulated_pnl = pnl_pct
                    pnl_diff = abs(expected_pnl - simulated_pnl)
                    if pnl_diff > 0.01: # 1%
                        print(f"[CONSISTENCY-WARN] P&L mismatch > 1% at {dates[i]} (symbol {symbol}): "
                              f"Training Label P&L = {expected_pnl*100:.2f}%, Backtest P&L = {simulated_pnl*100:.2f}% "
                              f"(Diff: {pnl_diff*100:.2f}%)", flush=True)

            try:
                days_held = int((pd.to_datetime(exit_date) - pd.to_datetime(entry_date)).days)
            except Exception:
                days_held = 0

            sizing_score = validator_score if validator_score is not None else float(score)
            size_mult = _position_size_multiplier(sizing_score)
            # Build Buy Reason
            buy_reasons = []
            try:
                row_entry = df.iloc[i]
                cols_lower = {c.lower(): c for c in df.columns}
                
                # Check RSI
                rsi_col = cols_lower.get("rsi")
                if rsi_col:
                    rsi_val = float(row_entry[rsi_col])
                    if rsi_val < 30:
                        buy_reasons.append(f"Oversold RSI ({rsi_val:.1f})")
                    elif rsi_val < 45:
                        buy_reasons.append(f"Low RSI Recovery ({rsi_val:.1f})")
                    elif rsi_val > 70:
                        buy_reasons.append(f"Overbought RSI Momentum ({rsi_val:.1f})")
                    elif rsi_val > 55:
                        buy_reasons.append(f"Bullish RSI Momentum ({rsi_val:.1f})")
                    else:
                        buy_reasons.append(f"RSI ({rsi_val:.1f})")
                
                # Check Vol Acceleration
                vol_acc_col = cols_lower.get("feat_vol_acceleration") or cols_lower.get("vol_acceleration")
                if vol_acc_col:
                    vol_acc_val = float(row_entry[vol_acc_col])
                    if vol_acc_val > 1.8:
                        buy_reasons.append(f"Huge Vol Accel ({vol_acc_val:.1f}x)")
                    elif vol_acc_val > 1.2:
                        buy_reasons.append(f"Rising Vol Accel ({vol_acc_val:.1f}x)")
                    else:
                        buy_reasons.append(f"Vol Accel ({vol_acc_val:.1f}x)")
                
                # Check Sector Relative Strength
                sector_rel_col = cols_lower.get("feat_sector_rel_strength") or cols_lower.get("sector_rel_strength")
                if sector_rel_col:
                    sector_rel_val = float(row_entry[sector_rel_col])
                    if sector_rel_val > 0.01:
                        buy_reasons.append(f"Leading Sector (+{sector_rel_val*100:.1f}%)")
                    elif sector_rel_val < -0.01:
                        buy_reasons.append(f"Lagging Sector ({sector_rel_val*100:.1f}%)")
                
                # Check Overnight Gap
                gap_col = cols_lower.get("feat_overnight_gap") or cols_lower.get("overnight_gap")
                if gap_col:
                    gap_val = float(row_entry[gap_col])
                    if abs(gap_val) > 0.005:
                        buy_reasons.append(f"Gap ({gap_val*100:+.1f}%)")
                
                # Check Amihud Illiquidity
                amihud_col = cols_lower.get("feat_amihud_10d_sma") or cols_lower.get("amihud_10d_sma")
                if amihud_col:
                    amihud_val = float(row_entry[amihud_col])
                    buy_reasons.append(f"Amihud ({amihud_val:.2e})")
            except Exception:
                pass
            
            if not buy_reasons:
                buy_reasons.append("AI Model Prediction Pattern")
                
            buy_reason_str = ", ".join(buy_reasons)

            try:
                fs = None
                if "fund_score" in df.columns:
                    fs = df["fund_score"].iloc[i]
                if fs is not None and (isinstance(fs, float) and np.isnan(fs)):
                    fs = None
            except Exception:
                fs = None

            trade_data = {
                "Date": entry_date.strftime("%d/%m/%Y") if hasattr(entry_date, "strftime") else str(entry_date),
                "Entry_Date": entry_date.strftime("%Y-%m-%d"),
                "Exit_Date": exit_date.strftime("%Y-%m-%d"),
                "Entry_Day": entry_date.strftime("%A"),
                "Exit_Day": exit_date.strftime("%A"),
                "Days_Held": days_held,
                "Symbol": symbol,
                "Entry": entry_price,
                "Exit": exit_price,
                "Score": round(float(score), 2),
                "Radar_Score": round(float(radar_score), 4),
                "Validator_Score": (round(float(validator_score), 4) if validator_score is not None else None),
                "Sizing_Score": round(float(sizing_score), 4),
                "Size_Multiplier": float(size_mult) * regime_size_mult,
                "Fund_Score": (float(fs) if fs is not None else None),
                "Result": outcome,
                "Buy_Reason": buy_reason_str,
                "Exit_Reason": outcome,
                "PnL_Pct": float(pnl_pct),
                "Regime": regime,
                "Status": "Accepted" if passes_council else "Rejected",
                "Votes": {m: round(float(v[i]), 2) for m, v in detailed_votes.items()}
            }
            
            # Set in_trade flag
            in_trade = True

            # Non-compounding: assume fixed allocation of 10% capital per trade
            # This matches the calculation in main() for consistency
            trade_pnl_cash = (capital * 0.1) * pnl_pct * regime_size_mult

            # Track pre-council (all radar signals)
            balance_pre += trade_pnl_cash
            pre_council_trades.append({**trade_data, "Balance": float(balance_pre)})
            
            # Only track post-council if passes both filters
            if passes_council:
                balance_post += trade_pnl_cash
                post_council_trades.append({**trade_data, "Balance": float(balance_post)})
                trade_log.append({**trade_data, "Balance": float(balance_post)})
            else:
                # Still add it to a "global log" if we want to show rejected trades in dialog
                trade_log.append({**trade_data, "Balance": float(balance_post)})

    # Calculate metrics for both phases
    def calc_metrics(trades_list, ignore_status=False):
        if not trades_list:
            return {"total": 0, "win_rate": 0, "profit_pct": 0, "rejected_profitable": 0}
        
        # If ignore_status is True, we treat all trades as Valid candidates (Pre-Council view)
        # If False, we respect the 'Status' field (Post-Council view)
        if ignore_status:
            relevant_trades = trades_list
        else:
            relevant_trades = [t for t in trades_list if t.get("Status") == "Accepted"]

        # 1. Correct Win Rate Calculation: (Count Wins / Total Count) * 100
        # Check if 'PnL_Pct' > 0 for a win
        wins_count = sum(1 for t in relevant_trades if t["PnL_Pct"] > 0)
        total_count = len(relevant_trades)
        
        win_rate = (wins_count / total_count * 100) if total_count > 0 else 0.0
        
        # 2. Correct Rejected Profitable Calculation
        # Count trades that were Rejected but turned out to have Positive PnL
        rejected_profitable_count = sum(1 for t in trades_list if t.get("Status") == "Rejected" and t["PnL_Pct"] > 0)
        
        # 3. Profit Calculation
        # We use the final balance from the simulation loop
        final_bal = trades_list[-1]["Balance"] if trades_list else capital
        total_return = (final_bal - capital) / capital * 100
        
        return {
            "total": total_count, 
            "win_rate": win_rate, 
            "profit_pct": total_return, 
            "rejected_profitable": rejected_profitable_count
        }
    
    pre_metrics = calc_metrics(pre_council_trades, ignore_status=True)
    post_metrics = calc_metrics(post_council_trades, ignore_status=False)
    
    # We actually want total "Rejected Profitable" globally
    # This is now calculated within calc_metrics for each list and aggregated in main()
    # rejected_profitable = sum(1 for t in trade_log if t.get("Status") == "Rejected" and t["PnL_Pct"] > 0)

    return {
        "Total Trades": len([t for t in trade_log if t.get("Status") == "Accepted"]),
        "Trades Log": pd.DataFrame(trade_log),
        "pre_council_trades": pre_metrics["total"],
        "pre_council_win_rate": pre_metrics["win_rate"],
        "pre_council_profit_pct": pre_metrics["profit_pct"],
        "post_council_trades": post_metrics["total"],
        "post_council_win_rate": post_metrics["win_rate"],
        "post_council_profit_pct": post_metrics["profit_pct"],
        "rejected_profitable": pre_metrics["rejected_profitable"], # Use the one from pre_metrics as it considers all radar signals
        "max_radar": max_score,
        "max_council": max_consensus,
        "max_validator": max_validator,
        "threshold_used": float(threshold),
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exchange", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--start", default="2024-01-01")
    parser.add_argument("--end", default=None)
    parser.add_argument("--out", default=None, help="Optional CSV output path")
    parser.add_argument("--council", default=None, help="Path to council model (enables Council filtering)")
    parser.add_argument("--validator", default=None, help="Optional Council Validator model (trained on KING BUYs)")
    parser.add_argument("--meta-threshold", type=float, default=None, help="Override meta threshold (0-1)")
    parser.add_argument("--validator-threshold", type=float, default=None, help="Override validator threshold (0-1)")
    parser.add_argument("--target-pct", type=float, default=None, help="Override target profit percentage (e.g. 0.15)")
    parser.add_argument("--stop-loss-pct", type=float, default=None, help="Override stop loss percentage (e.g. 0.05)")
    parser.add_argument("--capital", type=float, default=100000, help="Initial capital for simulation")
    parser.add_argument("--timeframe", default=None, help="Force a specific timeframe (e.g. 1h, 1d)")
    parser.add_argument("--quiet", "-q", action="store_true", help="Suppress verbose debug output")
    parser.add_argument("--no-trades-json", action="store_true", help="Do not print trades JSON to stdout")
    parser.add_argument("--crypto-filters", default=None, help="Comma-separated quote currency filters for crypto (e.g. USD,USDT,USDC)")
    
    # Centralized Bot Settings CLI
    parser.add_argument("--min-volume-ratio", type=float, default=0.3)
    parser.add_argument("--no-rsi-filter", action="store_true", help="Disable RSI filter")
    parser.add_argument("--use-trend-filter", action="store_true", help="Enable SMA20 trend filter")
    parser.add_argument("--no-market-regime", action="store_true", help="Disable market regime detection")
    parser.add_argument("--regime-adx-threshold", type=float, default=14.0)
    parser.add_argument("--no-smart-exit", action="store_true", help="Disable smart exit")
    parser.add_argument("--smart-exit-rsi", type=float, default=40.0)
    parser.add_argument("--smart-exit-vol", type=float, default=3.0)
    parser.add_argument("--trading-mode", default="hybrid", choices=["hybrid", "aggressive"])
    parser.add_argument("--no-atr-exits", action="store_true", help="Disable ATR-based exits")
    parser.add_argument("--atr-sl-mult", type=float, default=1.5)
    parser.add_argument("--atr-tp-mult", type=float, default=2.5)
    parser.add_argument("--atr-period", type=int, default=14)
    parser.add_argument("--exit-mode", default="hybrid")
    parser.add_argument("--adaptive-exits", action="store_true", help="Enable dynamic exits based on market regime")
    parser.add_argument("--no-trailing", action="store_true", help="Disable trailing stop")
    parser.add_argument("--trail-be-pct", type=float, default=0.04)
    parser.add_argument("--trail-lock-trigger-pct", type=float, default=0.06)
    parser.add_argument("--trail-lock-pct", type=float, default=0.04)
    
    args = parser.parse_args()

    # Always include a buffer window before the selected start date
    # so indicators have enough history (trades still limited to start/end).
    SIM_BUFFER_DAYS = 90
    
    # Load Data
    try:
        start_dt = _parse_cli_date(args.start).tz_localize(None)
        args.start = start_dt.strftime("%Y-%m-%d") 
        
        # Use a generous buffer (1 year) to ensure all technical indicators have enough history
        buffer_start_dt = start_dt - timedelta(days=365)
        buffer_start = buffer_start_dt.strftime("%Y-%m-%d")
    except Exception as e:
        print(f"Warning: Date parsing failed ({e}), using defaults.", flush=True)
        buffer_start = "2023-01-01"
        start_dt = pd.to_datetime("2024-01-01")

    # Load Model (needed early so we can match data source/timeframe)
    models_dir = os.path.join(base_dir, "api", "models")
    model_path = os.path.join(models_dir, args.model)
    if not os.path.exists(model_path):
        if os.path.exists(args.model):
            model_path = args.model
        else:
            print(f"[ERROR] Model not found: {model_path}", flush=True)
            return

    print(f"[AI] Loading model: {args.model}...", flush=True)
    model_obj = load_model(model_path)
    if not model_obj:
        return

    # Load unified parameters
    params = TradingParameters.from_model_artifact(model_obj)
    
    # Apply overrides from CLI (highest precedence)
    if args.target_pct is not None and args.target_pct > 0:
        params.target_pct = args.target_pct
    if args.stop_loss_pct is not None and args.stop_loss_pct > 0:
        params.stop_loss_pct = args.stop_loss_pct
    if args.meta_threshold is not None:
        params.king_threshold = args.meta_threshold
    if args.validator_threshold is not None:
        params.validator_threshold = args.validator_threshold
    if args.min_volume_ratio is not None:
        params.min_volume_ratio = args.min_volume_ratio

    # Log loaded parameters and run compatibility checks at the beginning of the backtest
    print(f"[BT-LIVE] Loaded unified parameters from model artifact:")
    print(f"   - Entry Mode: {params.entry_mode}")
    print(f"   - Barrier Mode: {params.barrier_mode}")
    print(f"   - Target Pct: {params.target_pct}")
    print(f"   - Stop Loss Pct: {params.stop_loss_pct}")
    print(f"   - Look Forward Days: {params.look_forward_days}")
    print(f"   - Require Volume Confirmation: {params.require_volume_confirmation}")
    print(f"   - Min Volume Ratio: {params.min_volume_ratio}")
    print(f"   - King Threshold: {params.king_threshold}")
    print(f"   - Council Threshold: {params.council_threshold}")

    # Run compatibility validation checks
    validation_results = params.validate()
    if validation_results:
        print(f"[BT-LIVE] WARNING: Parameter validation issues: {validation_results}", flush=True)
    if args.exchange.strip().upper() == "EGX":
        # Check EGX-specific warnings
        egx_warns = params.validate_for_market("EGX")
        if egx_warns.get("warnings"):
            print(f"[BT-LIVE] WARNING: EGX-specific validation alerts: {egx_warns['warnings']}", flush=True)

    fem = FeatureEngineeringManager(params)
    sim_threshold = params.king_threshold

    def _meta_get(obj, name: str, default=None):
        if not isinstance(obj, dict):
            return default
        v = obj.get(name)
        if v is not None:
            return v
        pm = obj.get("primary_model") if isinstance(obj.get("primary_model"), dict) else {}
        if isinstance(pm, dict):
            return pm.get(name, default)
        return default

    # Decide data source based on model metadata (fallback: CRYPTO => 1h intraday)
    use_intraday = False
    timeframe = "1d"
    try:
        use_intraday = bool(_meta_get(model_obj, "use_intraday", False))
        timeframe = str(_meta_get(model_obj, "timeframe", "1d") or "1d").strip().lower()
    except Exception:
        use_intraday = False
        timeframe = "1d"

    if args.exchange.strip().upper() == "CRYPTO" and not use_intraday:
        use_intraday = True
        timeframe = "1h"

    # CLI Override for Timeframe
    if args.timeframe:
        timeframe = str(args.timeframe).strip().lower()
        if timeframe != "1d":
            use_intraday = True
        print(f"[TIME] Forcing timeframe: {timeframe} (CLI override)", flush=True)

    if use_intraday:
        print(f"[INPUT] Fetching intraday bulk data for {args.exchange} ({timeframe}) (Buffer Start: {buffer_start}, Sim Start: {args.start})...",
            flush=True,
        )
        data_map = _get_exchange_bulk_intraday_data(args.exchange, timeframe=timeframe, from_ts=buffer_start)
    else:
        print(f"[INPUT] Fetching bulk data for {args.exchange} (Buffer Start: {buffer_start}, Sim Start: {args.start})...",
            flush=True,
        )
        data_map = _get_exchange_bulk_data(args.exchange, from_date=buffer_start)

    if not data_map:
        print("[ERROR] No data found.", flush=True)
        return

    # Context & Fundamentals
    from api.train_exchange_model import add_market_context, fetch_fundamentals_for_exchange
    from api import stock_ai
    stock_ai._init_supabase()
    supabase = stock_ai.supabase

    market_df = None
    if args.exchange == "EGX":
        market_df = load_egx30_index(args.start, args.end)
        if market_df is not None:
            print(f"[OK] Market context (EGX30) loaded. Rows: {len(market_df)}", flush=True)

    df_funds = pd.DataFrame()
    if supabase and args.exchange != "CRYPTO":
        print(f"[INPUT] Fetching fundamentals for {args.exchange}...", flush=True)
        df_funds = fetch_fundamentals_for_exchange(supabase, args.exchange)

    # Prepare TheCouncil (Phase 2) ONLY when explicitly requested.
    # If the user chooses "None (No Filter)" in the UI, the API won't pass --council,
    # and we must not fall back to any default Council model.
    # Clear optional attachments (each run should be independent)
    try:
        setattr(run_radar_simulation, "_validator", None)
        setattr(run_radar_simulation, "_king_validator_artifact", None)
    except Exception:
        pass

    council = None
    council_arg = (args.council or "").strip()
    if council_arg and council_arg.lower() not in {"none", "null", "no", "no_filter", "no filter"}:
        from api.council import TheCouncil

        council_models = {"collector": model_obj}

        actual_council_path = os.path.join(models_dir, council_arg)
        if os.path.exists(actual_council_path):
            print(f"[COUNCIL] Loading Council Model: {council_arg}...", flush=True)
            loaded = load_model(actual_council_path)
            # Guard: user may accidentally pick a Council Validator model in the council dropdown.
            if isinstance(loaded, dict) and (loaded.get("kind") or "").strip().lower() == "council_validator":
                print(f"[WARNING] Selected model is a Council Validator, not a Council member. Using it as --validator instead.", flush=True)
                if not args.validator:
                    args.validator = council_arg
                loaded = None
            council_models["king"] = loaded
        elif os.path.exists(council_arg):
            print(f"[COUNCIL] Loading Council Model (abs): {council_arg}...", flush=True)
            loaded = load_model(council_arg)
            if isinstance(loaded, dict) and (loaded.get("kind") or "").strip().lower() == "council_validator":
                print(f"[WARNING] Selected model is a Council Validator, not a Council member. Using it as --validator instead.", flush=True)
                if not args.validator:
                    args.validator = council_arg
                loaded = None
            council_models["king"] = loaded
        else:
            print(f"[WARNING] Council model not found at {actual_council_path}. Council will be disabled.", flush=True)

        if council_models.get("king") is not None:
            council = TheCouncil(models_dict=council_models)
        else:
            council = None
    else:
        print(f"[COUNCIL] Council disabled (No Filter).", flush=True)

    # Optional validator (gates Council-approved trades based on KING confidence)
    if args.validator:
        from api.council_validator import load_council_validator_from_path
        v_path = os.path.join(models_dir, args.validator)
        if not os.path.exists(v_path) and os.path.exists(args.validator):
            v_path = args.validator
        validator = load_council_validator_from_path(v_path)
        if validator:
            # Attach to function for minimal signature changes
            setattr(run_radar_simulation, "_validator", validator)
            print(f"[INFO] Loaded Council Validator: {os.path.basename(v_path)}", flush=True)

            # If Council is disabled, still support validator-only filtering by loading KING for confidence.
            if council is None:
                king_path = os.path.join(models_dir, "KING 👑.pkl")
                if os.path.exists(king_path):
                    king_art = load_model(king_path)
                    setattr(run_radar_simulation, "_king_validator_artifact", king_art)
                    print(f"[KING] Loaded KING for validator-only mode.", flush=True)
        else:
            print(f"[WARNING] Failed to load Council Validator from {v_path}", flush=True)

    # Threshold Summary
    print("\n" + "="*40, flush=True)
    print(f"[TARGET] THRESHOLD CONFIGURATION:", flush=True)
    print(f"   - Primary Model (KING): {sim_threshold:.2f}", flush=True)
    if council or args.validator:
        v_thresh = args.validator_threshold
        if v_thresh is None:
            v_obj = getattr(run_radar_simulation, "_validator", None)
            v_thresh = float(getattr(v_obj, "approval_threshold", 0.5)) if v_obj else 0.55
        print(f"   - Council/Validator:    {v_thresh:.2f}", flush=True)
    else:
        print("   - Council/Validator:    Disabled (No Filter)", flush=True)
    print("="*40 + "\n", flush=True)

    # Running Simulation
    from api.train_exchange_model import add_technical_indicators
    
    all_trades = []
    all_res_metadata = []
    count = 0
    symbols_list = list(data_map.keys())

    # Apply crypto quote currency filters (e.g. USD, USDT, USDC)
    if args.crypto_filters and args.exchange.strip().upper() == "CRYPTO":
        quote_filters = [q.strip().upper() for q in args.crypto_filters.split(",") if q.strip()]
        if quote_filters:
            before_count = len(symbols_list)
            filtered = []
            for sym in symbols_list:
                sym_upper = sym.upper()
                matched = False
                for qf in quote_filters:
                    if sym_upper.endswith(f"/{qf}") or sym_upper.endswith(qf):
                        matched = True
                        break
                if matched:
                    filtered.append(sym)
            symbols_list = filtered
            # Print per-filter breakdown
            breakdown = {}
            for qf in quote_filters:
                cnt = sum(1 for s in symbols_list if s.upper().endswith(f"/{qf}") or s.upper().endswith(qf))
                breakdown[qf] = cnt
            breakdown_str = ", ".join(f"{k}: {v}" for k, v in breakdown.items())
            print(f" Crypto filter applied: {quote_filters}  {before_count}  {len(symbols_list)} symbols ({breakdown_str})", flush=True)
    
    print(f"[BT-LIVE] Processing {len(symbols_list)} symbols sequentially...", flush=True)
    
    for symbol in symbols_list:
        df = data_map[symbol]
        if df.empty:
            continue
        
        fem_report = fem.check_data_ready(df)
        struct_logger = StructuredLogger("backtest")
        struct_logger.log_data_readiness(symbol, fem_report)
        if not fem_report.is_ready:
            print(f"[BT-LIVE] WARNING: Skipping symbol {symbol} due to data readiness check failure:\n"
                  f"{fem_report.summary()}", flush=True)
            continue
        
        # Save original index
        original_index = df.index
        if not isinstance(original_index, pd.DatetimeIndex):
            original_index = pd.to_datetime(original_index)
        
        if len(df) < 60:
            continue
        
        try:
            df_feat = add_technical_indicators(df)
            if df_feat.empty:
                continue
            
            # Ensure index matches
            if len(df_feat) == len(df):
                df_feat.index = original_index
            
            df_feat = add_massive_features(df_feat)
            
            if market_df is not None:
                df_feat = add_market_context(df_feat, market_df)
            
            df_feat['symbol'] = symbol
            if not df_funds.empty:
                df_feat = df_feat.join(df_funds.set_index("symbol"), on="symbol", how="left")
            
            if len(df_feat) == len(df):
                df_feat.index = original_index

            fund_score_raw = df_feat["fund_score"] if "fund_score" in df_feat.columns else None
            df_feat = df_feat.fillna(0)
            if fund_score_raw is not None:
                df_feat["fund_score"] = fund_score_raw
            
            # Slice simulation period (with optional buffer if too few rows)
            sim_start_dt = _parse_cli_date(args.start).tz_localize(None)
            sim_end_dt = _parse_cli_date(args.end).tz_localize(None) if args.end else None
            
            if not isinstance(df_feat.index, pd.DatetimeIndex):
                df_feat.index = pd.to_datetime(df_feat.index, errors="coerce")
            idx_clean = pd.DatetimeIndex(df_feat.index).tz_localize(None)

            fmt = "%d/%m/%Y"
            
            mask = (idx_clean >= sim_start_dt)
            if sim_end_dt:
                mask = mask & (idx_clean <= sim_end_dt)
            
            buffer_start_dt = sim_start_dt - timedelta(days=SIM_BUFFER_DAYS)
            buffer_mask = (idx_clean >= buffer_start_dt)
            if sim_end_dt:
                buffer_mask = buffer_mask & (idx_clean <= sim_end_dt)
            df_sim = df_feat[buffer_mask]
            # print(
            #     f"[BT-LIVE] Buffer applied for {symbol}: {len(df_sim)} rows "
            #     f"(buffer {SIM_BUFFER_DAYS}d) — trades limited to {args.start} → {args.end}",
            #     flush=True
            # )
            
            if df_sim.empty:
                continue

            # Diagnostic: Warning for very short backtests
            try:
                days_span = (df_sim.index[-1] - df_sim.index[0]).days
                if days_span < 2:
                    print(f"[WARNING] Warning: Backtest duration for {symbol} is very short ({days_span} days). Results may be unreliable.", flush=True)
            except Exception:
                pass

            res = run_radar_simulation(
                df_sim,
                model_obj,
                council=council,
                threshold=sim_threshold,
                sim_start_dt=sim_start_dt,
                sim_end_dt=sim_end_dt,
                quiet=args.quiet,
                validator_threshold=args.validator_threshold,
                target_pct_override=args.target_pct,
                stop_loss_pct_override=args.stop_loss_pct,
                capital=args.capital,
                min_volume_ratio=args.min_volume_ratio,
                use_rsi_filter=not args.no_rsi_filter,
                use_trend_filter=args.use_trend_filter,
                use_market_regime=not args.no_market_regime,
                regime_adx_threshold=args.regime_adx_threshold,
                use_smart_exit=not args.no_smart_exit,
                smart_exit_rsi_threshold=args.smart_exit_rsi,
                smart_exit_volume_spike=args.smart_exit_vol,
                trading_mode=args.trading_mode,
                use_atr_exits=not args.no_atr_exits,
                atr_sl_multiplier=args.atr_sl_mult,
                atr_tp_multiplier=args.atr_tp_mult,
                atr_period=args.atr_period,
                exit_mode=args.exit_mode,
                use_trailing=not args.no_trailing,
                trail_be_pct=args.trail_be_pct,
                trail_lock_trigger_pct=args.trail_lock_trigger_pct,
                trail_lock_pct=args.trail_lock_pct,
                adaptive_exits=args.adaptive_exits,
            ) 
            
            if isinstance(res, dict) and res:
                # Always keep metadata (even when no trades) for diagnostics / aggregate stats.
                all_res_metadata.append(res)

                if res.get("Trades Log") is not None and not res["Trades Log"].empty:
                    all_trades.append(res["Trades Log"])
                
        except Exception as e:
            print(f"CRITICAL Error processing {symbol}: {e}", flush=True)
            
        count += 1
        if count % 20 == 0:
            print(f"Progress: {count}/{len(symbols_list)} symbols processed...", flush=True)

    # Global Report
    if not all_trades:
        max_radar = max((float(r.get("max_radar") or 0.0) for r in all_res_metadata), default=0.0)
        threshold_used = None
        try:
            threshold_used = float(all_res_metadata[0].get("threshold_used")) if all_res_metadata else None
        except Exception:
            threshold_used = None

        if threshold_used is not None:
            print(
                f"[WARNING] No trades found matching criteria. (Processed {len(symbols_list)} symbols) "
                f"| Max Radar={max_radar:.4f} | Threshold={threshold_used:.4f}",
                flush=True,
            )
        else:
            print(
                f"[WARNING] No trades found matching criteria. (Processed {len(symbols_list)} symbols) "
                f"| Max Radar={max_radar:.4f}",
                flush=True,
            )

        # Still emit the JSON marker block so the API/UI can show an empty log consistently.
        if not args.no_trades_json:
            print("\n--- JSON TRADES LOG START ---", flush=True)
            print("[]", flush=True)
            print("--- JSON TRADES LOG END ---", flush=True)
        return
        
    global_log = pd.concat(all_trades).sort_values("Date")
    capital_per_trade = args.capital / 10

    # Dynamic Position Sizing (based on Validator Score when available, otherwise Council Score)
    # Profit_Cash is computed using a fixed base notional per trade (capital_per_trade) times a size multiplier.
    accepted_mask = global_log.get("Status", "Accepted").fillna("Accepted").astype(str).str.lower().eq("accepted")
    if "Size_Multiplier" in global_log.columns:
        base_notional = capital_per_trade * global_log["Size_Multiplier"].fillna(1.0)
    else:
        base_notional = float(capital_per_trade)

    # Rejected trades are not executed => no P/L contribution.
    global_log["Position_Cash"] = np.where(accepted_mask, base_notional, 0.0)
    global_log['Profit_Cash'] = global_log['Position_Cash'] * global_log['PnL_Pct']
    global_log['Cumulative_Profit'] = global_log['Profit_Cash'].cumsum()
    net_profit = global_log['Profit_Cash'].sum()
    denom = int(accepted_mask.sum()) if int(accepted_mask.sum()) > 0 else 1
    win_rate = (len(global_log[accepted_mask & (global_log['PnL_Pct'] > 0)]) / denom) * 100

    # Aggregate Council Impact
    total_pre_trades = sum(r.get("pre_council_trades", 0) for r in all_res_metadata)
    total_post_trades = sum(r.get("post_council_trades", 0) for r in all_res_metadata)
    
    # Calculate weighted averages or just re-calculate from logs if possible?
    # Simple aggregation of pre_metrics
    avg_pre_win_rate = (sum(r.get("pre_council_win_rate", 0) * r.get("pre_council_trades", 0) for r in all_res_metadata) / total_pre_trades) if total_pre_trades > 0 else 0
    avg_post_win_rate = (sum(r.get("post_council_win_rate", 0) * r.get("post_council_trades", 0) for r in all_res_metadata) / total_post_trades) if total_post_trades > 0 else 0
    
    # For profit %, it's cumulative ROI based on net_profit relative to total capital.
    total_pre_profit_pct = (global_log['Position_Cash'] * global_log['PnL_Pct']).sum() / args.capital * 100
    total_post_profit_pct = (net_profit / args.capital) * 100

    # Aggregate rejected profitable
    rejected_profitable = sum(r.get("rejected_profitable", 0) for r in all_res_metadata)

    # Output JSON for API consumption
    if not args.no_trades_json:
        print("\n--- JSON TRADES LOG START ---", flush=True)
        print(global_log.to_json(orient="records", date_format="iso"), flush=True)
        print("--- JSON TRADES LOG END ---", flush=True)

    # out_file = args.out or f"backtest_results_{args.exchange}.csv"
    # try:
    #     global_log.to_csv(out_file, index=False, encoding="utf-8")
    # except Exception as e:
    #     print(f"Warning: Failed to write CSV {out_file}: {e}", flush=True)
    
    print("\n" + "="*40, flush=True)
    print(" === FINAL RADAR BACKTEST REPORT === ", flush=True)
    print("="*40, flush=True)
    print(f"Model: {args.model}", flush=True)
    print(f"Exchange: {args.exchange}", flush=True)
    
    try:
        s_fmt = _parse_cli_date(args.start).strftime("%d/%m/%Y")
        e_fmt = _parse_cli_date(args.end).strftime("%d/%m/%Y") if args.end else "Present"
    except:
        s_fmt, e_fmt = args.start, (args.end or "Present")
        
    print(f"Period: {s_fmt} to {e_fmt}", flush=True)
    print("-" * 20, flush=True)
    print(f"Total Trades Detected: {total_post_trades}", flush=True)
    print(f"Win Rate:              {win_rate:.1f}%", flush=True)
    print(f"Avg Return per Trade:  {global_log['PnL_Pct'].mean()*100:.2f}%", flush=True)
    print("-" * 20, flush=True)
    print(f"Simulated Profit (Base {int(capital_per_trade):,} + Dynamic Sizing): {int(net_profit):,} EGP", flush=True)
    
    print("\n--- Council Impact Analysis ---", flush=True)
    print(f"Pre-Council Trades:    {total_pre_trades}", flush=True)
    print(f"Post-Council Trades:   {total_post_trades}", flush=True)
    print(f"Trades Filtered:       {total_pre_trades - total_post_trades} ({((total_pre_trades - total_post_trades)/total_pre_trades)*100:.1f}% reduction)" if total_pre_trades > 0 else "N/A", flush=True)
    print(f"Pre-Council Win Rate:  {avg_pre_win_rate:.1f}%", flush=True)
    print(f"Post-Council Win Rate: {avg_post_win_rate:.1f}%", flush=True)
    print(f"Pre-Council Profit:    {total_pre_profit_pct:.4f}%", flush=True)
    print(f"Post-Council Profit:   {total_post_profit_pct:.4f}%", flush=True)
    print(f"Win Rate Boost:        {avg_post_win_rate - avg_pre_win_rate:+.1f} percentage points", flush=True)
    print(f"Rejected Profitable:   {rejected_profitable}", flush=True)
    print("="*40, flush=True)


def run_enhanced_radar_simulation(
    df,
    model,
    council=None,
    threshold=None,
    capital=100000,
    sim_start_dt: datetime | None = None,
    sim_end_dt: datetime | None = None,
    quiet: bool = False,
    validator_threshold: float | None = None,
    target_pct_override: float | None = None,
    stop_loss_pct_override: float | None = None,
    min_volume_ratio: float = 0.3,
    use_rsi_filter: bool = True,
    use_trend_filter: bool = False,
    use_market_regime: bool = True,
    regime_adx_threshold: float = 14.0,
    use_smart_exit: bool = True,
    smart_exit_rsi_threshold: float = 40.0,
    smart_exit_volume_spike: float = 3.0,
    trading_mode: str = "hybrid",
    use_atr_exits: bool = True,
    atr_sl_multiplier: float = 1.5,
    atr_tp_multiplier: float = 2.5,
    atr_period: int = 14,
    exit_mode: str = "hybrid",
    adaptive_exits: bool = False,
    use_trailing: bool = True,
    trail_be_pct: float = 0.04,
    trail_lock_trigger_pct: float = 0.06,
    trail_lock_pct: float = 0.04
):
    """
    Enhanced simulation using Portfolio Manager for accurate P&L calculation.
    
    Key improvements:
    - Proper position sizing based on available capital
    - Concurrent trade management
    - Risk management with exposure limits
    - Accurate portfolio-level returns
    """
    
    # Initialize Portfolio Manager
    portfolio = PortfolioManager(
        initial_capital=capital,
        max_position_pct=0.10,  # Max 10% per position
        max_total_exposure=0.50,  # Max 50% total exposure
        max_concurrent_positions=5,  # Max 5 concurrent positions
        reserve_cash_pct=0.20,  # Keep 20% cash reserve
        commission_pct=0.001  # 0.1% commission
    )
    
    # Use the existing model loading and prediction logic
    if df.empty: 
        return {}
    
    if not quiet:
        print(f"DEBUG: Enhanced radar simulation for {len(df)} rows", flush=True)

    # Load unified parameters (existing logic)
    params = TradingParameters.from_model_artifact(model)

    # Apply overrides (existing logic)
    if target_pct_override is not None and target_pct_override > 0:
        params.target_pct = target_pct_override
    if stop_loss_pct_override is not None and stop_loss_pct_override > 0:
        params.stop_loss_pct = stop_loss_pct_override
    if threshold is None:
        if isinstance(model, dict) and model.get("optimal_threshold") is not None:
            threshold = float(model.get("optimal_threshold"))
        elif isinstance(model, dict) and model.get("meta_threshold") is not None:
            threshold = float(model.get("meta_threshold"))
        else:
            threshold = 0.5

    # Set up labeler (existing logic)
    labeler = TripleBarrierLabeler(params)
    HOLD_MAX_BARS = params.look_forward_days
    
    # Get predictions (reuse existing prediction logic)
    classifier = model
    if isinstance(model, dict):
        if model.get("kind") == "meta_labeling_system":
            classifier = reconstruct_meta_model(model)
            if not classifier:
                return {}
        elif "model_str" in model:
            import lightgbm as lgb
            primary_booster = lgb.Booster(model_str=model["model_str"])
            class PrimaryWrapper:
                def __init__(self, b): self.b = b
                def predict(self, X): return self.b.predict(X)
                def predict_proba(self, X): 
                    raw = self.b.predict(X)
                    return np.column_stack([1-raw, raw])
            classifier = PrimaryWrapper(primary_booster)

    # Prepare features (existing logic - simplified)
    try:
        expected_features = []
        if isinstance(model, dict) and model.get("kind") == "meta_labeling_system":
            pm = model.get("primary_model") or {}
            expected_features = list(pm.get("feature_names") or [])

        X = df.copy()
        if expected_features:
            missing = set(expected_features) - set(X.columns)
            for m in missing: X[m] = 0
            X = X[expected_features]
            X = X.replace([np.inf, -np.inf], np.nan).fillna(0)

        # Get predictions
        probs = classifier.predict_proba(X)
        confidences = probs[:, 1]
        
    except Exception as e:
        print(f"ERROR: Enhanced simulation prediction failed: {e}", flush=True)
        return {}

    # Get council scores (existing logic)
    consensus_scores = None
    if council:
        try:
            consensus_scores = council.get_consensus(df.copy())
        except Exception as e:
            print(f"Warning: Council scoring failed: {e}", flush=True)
            consensus_scores = None

    # Prepare data columns
    dates = df.index
    close_col = "close" if "close" in df.columns else ("Close" if "Close" in df.columns else None)
    high_col = "high" if "high" in df.columns else ("High" if "High" in df.columns else None)
    low_col = "low" if "low" in df.columns else ("Low" if "Low" in df.columns else None)
    
    if close_col is None:
        print("ERROR: Missing close price column", flush=True)
        return {}

    closes = df[close_col].values
    highs = df[high_col].values if high_col else closes
    lows = df[low_col].values if low_col else closes
    symbols = df['symbol'].values if 'symbol' in df.columns else [f'STOCK_{i}' for i in range(len(df))]

    # Enhanced trading loop with portfolio management
    all_trades = []  # For compatibility with existing format
    
    for i in range(len(df)):
        current_date = pd.to_datetime(dates[i]).tz_localize(None) if hasattr(dates[i], 'tz_localize') else dates[i]
        current_prices = {sym: closes[j] for j, sym in enumerate(symbols) if j == i}
        
        # Update portfolio snapshot
        portfolio.update_daily_snapshot(current_date, current_prices)
        
        # Force close expired positions
        expired_trades = portfolio.force_close_expired_positions(current_date, current_prices)
        
        # Check for new signal
        radar_score = confidences[i]
        council_score = consensus_scores[i] if consensus_scores is not None else 1.0
        
        passes_radar = radar_score >= threshold
        passes_council = council_score >= 0.55
        
        if not passes_radar:
            continue

        symbol = symbols[i]
        entry_price = closes[i]
        
        # Skip if date filters don't match
        if sim_start_dt and current_date < sim_start_dt:
            continue
        if sim_end_dt and current_date > sim_end_dt:
            continue

        # Market regime check (simplified)
        regime_multiplier = 1.0
        try:
            history_slice = df.iloc[max(0, i - 50):i + 1].copy()
            if len(history_slice) >= 20:
                # Simple regime detection based on trend
                recent_returns = history_slice[close_col].pct_change().tail(20)
                avg_return = recent_returns.mean()
                if avg_return > 0.01:  # Strong uptrend
                    regime_multiplier = 1.2
                elif avg_return < -0.01:  # Downtrend
                    regime_multiplier = 0.3 if trading_mode == "aggressive" else 0.0
                else:  # Sideways
                    regime_multiplier = 0.7
        except Exception:
            pass

        # Skip if regime doesn't allow trading
        if regime_multiplier == 0.0:
            continue

        # Try to open position
        can_open, position_size, reason = portfolio.can_open_position(symbol, entry_price, regime_multiplier)
        
        if not can_open:
            # Log rejected trade for analysis
            rejected_trade = {
                "Date": current_date.strftime("%Y-%m-%d"),
                "Symbol": symbol,
                "Entry": entry_price,
                "Score": round(float(radar_score), 4),
                "Council_Score": round(float(council_score), 4),
                "Status": "Rejected",
                "Reason": reason,
                "PnL_Pct": 0.0  # Won't know until we simulate
            }
            all_trades.append(rejected_trade)
            continue

        # Calculate exit levels
        bars_ahead = []
        for days_fwd in range(1, min(HOLD_MAX_BARS + 1, len(df) - i)):
            idx = i + days_fwd
            bars_ahead.append({
                "high": float(highs[idx]),
                "low": float(lows[idx]),
                "close": float(closes[idx])
            })

        # Simulate trade outcome using existing labeler
        try:
            atr_val = df.get("atr_14", pd.Series([0.02] * len(df))).iloc[i]
            outcome_obj = labeler.backtest_trade(
                entry_price=entry_price,
                atr=float(atr_val),
                bars_ahead=bars_ahead,
                max_bars=min(HOLD_MAX_BARS, len(bars_ahead))
            )
            
            exit_price = outcome_obj.exit_price
            exit_reason = outcome_obj.outcome
            days_held = outcome_obj.exit_bars
            
        except Exception as e:
            # Fallback simple simulation
            exit_price = entry_price * (1 + np.random.normal(0, 0.02))  # Random walk
            exit_reason = "TIMEOUT"
            days_held = min(5, len(bars_ahead))

        # Open the position
        success, message = portfolio.open_position(
            symbol=symbol,
            entry_date=current_date,
            entry_price=entry_price,
            regime_multiplier=regime_multiplier,
            max_hold_days=HOLD_MAX_BARS,
            entry_reason=f"Radar: {radar_score:.3f}, Council: {council_score:.3f}"
        )

        if not success:
            continue

        # Simulate position closure after calculated days
        exit_date = current_date + pd.Timedelta(days=days_held)
        success, message, trade_record = portfolio.close_position(
            symbol=symbol,
            exit_date=exit_date,
            exit_price=exit_price,
            exit_reason=exit_reason
        )

        if success and trade_record:
            # Convert to existing format for compatibility
            trade_data = {
                "Date": current_date.strftime("%d/%m/%Y"),
                "Entry_Date": current_date.strftime("%Y-%m-%d"),
                "Exit_Date": exit_date.strftime("%Y-%m-%d"),
                "Symbol": symbol,
                "Entry": entry_price,
                "Exit": exit_price,
                "Score": round(float(council_score), 2),
                "Radar_Score": round(float(radar_score), 4),
                "Result": exit_reason,
                "PnL_Pct": trade_record.pnl_pct * 100,  # Convert to percentage
                "Days_Held": trade_record.days_held,
                "Position_Size": trade_record.position_size,
                "Status": "Accepted" if passes_council else "Rejected",
                "Regime_Multiplier": regime_multiplier
            }
            all_trades.append(trade_data)

    # Get final portfolio statistics
    stats = portfolio.get_statistics()
    
    # Calculate metrics in existing format
    accepted_trades = [t for t in all_trades if t.get("Status") == "Accepted"]
    rejected_trades = [t for t in all_trades if t.get("Status") == "Rejected"]
    
    total_trades = len(accepted_trades)
    win_rate = (sum(1 for t in accepted_trades if t["PnL_Pct"] > 0) / total_trades * 100) if total_trades > 0 else 0.0
    
    # Use portfolio manager's accurate return calculation
    profit_pct = stats["total_return_pct"] * 100  # Convert to percentage
    
    rejected_profitable = sum(1 for t in rejected_trades if t.get("PnL_Pct", 0) > 0)
    
    if not quiet:
        print(f"Enhanced Simulation Results:", flush=True)
        print(f"  Total Trades: {total_trades}", flush=True)
        print(f"  Win Rate: {win_rate:.1f}%", flush=True)
        print(f"  Total Return: {profit_pct:.2f}%", flush=True)
        print(f"  Portfolio Value: ${stats['portfolio_value']:,.2f}", flush=True)
        print(f"  Cash: ${stats['cash']:,.2f}", flush=True)
        print(f"  Commission Paid: ${stats['total_commission']:,.2f}", flush=True)
        print(f"  Max Drawdown: {stats['max_drawdown']:.2%}", flush=True)
        print(f"  Sharpe Ratio: {stats['sharpe_ratio']:.2f}", flush=True)

    return {
        "Total Trades": total_trades,
        "Trades Log": pd.DataFrame(all_trades),
        "pre_council_trades": len(all_trades),
        "pre_council_win_rate": win_rate,
        "pre_council_profit_pct": profit_pct,
        "post_council_trades": total_trades,
        "post_council_win_rate": win_rate,
        "post_council_profit_pct": profit_pct,
        "rejected_profitable": rejected_profitable,
        "max_radar": float(np.max(confidences)) if len(confidences) > 0 else 0.0,
        "max_council": float(np.max(consensus_scores)) if consensus_scores is not None else 0.0,
        "threshold_used": float(threshold),
        "portfolio_stats": stats
    }


if __name__ == "__main__":
    main()
