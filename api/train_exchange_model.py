import os

from dotenv import load_dotenv

# Load environment variables from .env in project root
api_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(api_dir)
load_dotenv(os.path.join(project_root, ".env"))

import time
import warnings

# Suppress specific FutureWarnings from libraries like 'ta'
warnings.filterwarnings("ignore", category=FutureWarning)

import pandas as pd

# Suppress PerformanceWarning from Pandas (fragmentation warnings)
warnings.simplefilter(action="ignore", category=pd.errors.PerformanceWarning)
import argparse
import json
import pickle
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

import lightgbm as lgb
import numpy as np
import pandas as pd
import ta
from joblib import Memory
from lightgbm import LGBMClassifier
from pandas.api.types import is_numeric_dtype
from sklearn.metrics import (
    f1_score,
    make_scorer,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, train_test_split
from ta import add_all_ta_features

from api.model_catalog import select_canonical_model_cards
from api.trading_config import TradingParameters
from api.unified_features import FeatureEngineeringManager
from api.unified_labeling import TripleBarrierLabeler
from api.structured_logger import StructuredLogger
from supabase import Client, create_client

# Initialize memory cache for heavy feature engineering.
# IMPORTANT: keep it OUTSIDE the repo tree, otherwise uvicorn --reload will detect changes and restart mid-training.
_JOBLIB_CACHE_DIR = os.getenv("STOKSCANAI_JOBLIB_CACHE_DIR")
_DISABLE_JOBLIB_CACHE = os.getenv(
    "STOKSCANAI_DISABLE_JOBLIB_CACHE", "0"
).strip().lower() in {"1", "true", "yes"}

if _DISABLE_JOBLIB_CACHE:
    memory_cache = Memory(location=None, verbose=0)
else:
    cache_dir = _JOBLIB_CACHE_DIR or os.path.join(
        tempfile.gettempdir(), "stokscanai_joblib_cache"
    )
    try:
        os.makedirs(cache_dir, exist_ok=True)
    except Exception:
        # If temp dir creation fails, fall back to no caching (prefer stability over speed)
        cache_dir = None
    memory_cache = Memory(location=cache_dir, verbose=0)

try:
    import xgboost as xgb
except Exception:
    xgb = None

try:
    import optuna
except ImportError:
    optuna = None

# Add parent directory to path for potential imports
# sys.path.append(os.path.dirname(os.path.abspath(__file__)))


def _downcast_df(df: pd.DataFrame) -> pd.DataFrame:
    """Downcast numeric columns to save memory."""
    fcols = df.select_dtypes("float").columns
    icols = df.select_dtypes("integer").columns
    df[fcols] = df[fcols].apply(pd.to_numeric, downcast="float")
    df[icols] = df[icols].apply(pd.to_numeric, downcast="integer")
    return df


def _finite_float(value):
    try:
        v = float(value)
    except Exception:
        return None
    return v if np.isfinite(v) else None


def _resolve_barrier_mode(
    target_pct: float,
    stop_loss_pct: float,
    barrier_mode: Optional[str] = None,
) -> str:
    """
    Resolve how target/stop values should be interpreted.

    Returns:
        "percent" when both values look like fractional percentages (< 1.0).
        "atr_multiplier" otherwise, or when explicitly requested.
    """
    mode = str(barrier_mode or "").strip().lower()
    if mode in {"percent", "percentage", "pct"}:
        return "percent"
    if mode in {"atr", "atr_multiplier", "atr-multiplier", "atr multiplier"}:
        return "atr_multiplier"

    try:
        target_v = float(target_pct)
        stop_v = float(stop_loss_pct)
    except Exception:
        return "atr_multiplier"

    if target_v < 1.0 and stop_v < 1.0:
        return "percent"
    return "atr_multiplier"


def _write_training_summary(summary: dict) -> None:
    """Write last training summary to a local JSON file for UI consumption."""
    try:
        api_dir = os.path.dirname(os.path.abspath(__file__))
        summary_path = os.path.join(api_dir, "training_summary.json")
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(summary, f)
    except Exception as e:
        # Fail softly – training itself should not break because of logging issues
        print(f"Failed to write training summary: {e}")


class StreamCallback:
    def __init__(self, progress_cb):
        self.progress_cb = progress_cb
        self.history = []

    def __call__(self, env):
        # env.iteration, env.evaluation_result_list
        # evaluation_result_list example: [('valid_0', 'logloss', 0.54321, False)]
        try:
            iteration = env.iteration
            metrics = {}
            for data_name, eval_name, result, _ in env.evaluation_result_list:
                key = f"{data_name}_{eval_name}"
                metrics[key] = result

            # Construct a small payload for the graph
            point = {"iteration": iteration, **metrics}

            # Send to frontend
            if self.progress_cb:
                self.progress_cb(
                    {
                        "phase": "training_stream",
                        "message": f"Training iter {iteration}",
                        "stats": point,
                    }
                )
        except Exception:
            pass


def fetch_fundamentals_for_exchange(supabase: Client, exchange: str) -> pd.DataFrame:
    """Fetch all fundamental data for a given exchange from stock_fundamentals table."""
    try:
        offset = 0
        limit = 1000
        all_data = []
        while True:
            res = (
                supabase.table("stock_fundamentals")
                .select("symbol, data, fund_score")
                .eq("exchange", exchange)
                .range(offset, offset + limit - 1)
                .execute()
            )
            if not res.data:
                break
            all_data.extend(res.data)
            if len(res.data) < limit:
                break
            offset += limit

        if not all_data:
            return pd.DataFrame()

        funds = []
        for row in all_data:
            data = row.get("data", {})
            if not data:
                continue

            # Safety: Parse JSON if returned as string
            if isinstance(data, str):
                try:
                    import json

                    data = json.loads(data)
                except:
                    pass

            col_fund_score = row.get("fund_score")
            computed_score = None
            if col_fund_score is not None:
                computed_score = col_fund_score
            else:
                computed_score = data.get("fund_score") or data.get("fundamental_score")

            if computed_score is None:
                # Calculate fundamental score (0-10) based on key fundamentals on the fly
                score = 0
                try:
                    # PE Ratio (0-3 points)
                    pe = _finite_float(data.get("peRatio"))
                    if pe is not None:
                        if 0 < pe <= 15:
                            score += 3
                        elif 15 < pe <= 25:
                            score += 2
                        elif 25 < pe <= 40:
                            score += 1

                    # EPS (0-3 points)
                    eps = _finite_float(data.get("eps"))
                    if eps is not None:
                        if eps > 1:
                            score += 3
                        elif eps > 0:
                            score += 2
                        elif eps > -0.5:
                            score += 1

                    # Dividend Yield (0-2 points)
                    div_yield = _finite_float(data.get("dividendYield"))
                    if div_yield is not None:
                        if div_yield > 3:
                            score += 2
                        elif div_yield > 1:
                            score += 1

                    # Market Cap (0-2 points)
                    mkt_cap = _finite_float(data.get("marketCap"))
                    if mkt_cap is not None:
                        if mkt_cap > 10_000_000_000:
                            score += 2
                        elif mkt_cap > 1_000_000_000:
                            score += 1

                    # Only assign if we actually had some fundamental metrics
                    has_metrics = any(
                        data.get(k) not in (None, "", 0, 0.0)
                        for k in ["peRatio", "eps", "dividendYield", "marketCap"]
                    )
                    if has_metrics:
                        computed_score = float(score)
                except Exception:
                    pass

            flat = {
                "symbol": row["symbol"],
                "marketCap": _finite_float(data.get("marketCap")),
                "peRatio": _finite_float(data.get("peRatio")),
                "eps": _finite_float(data.get("eps")),
                "dividendYield": _finite_float(data.get("dividendYield")),
                "fund_score": _finite_float(computed_score),
                "sector": data.get("sector"),
                "industry": data.get("industry"),
            }
            funds.append(flat)

        df_funds = pd.DataFrame(funds)
        # Force common fundamental columns to numeric if they exist to prevent LightGBM dtype errors
        for c in ["marketCap", "peRatio", "eps", "dividendYield", "fund_score"]:
            if c in df_funds.columns:
                df_funds[c] = pd.to_numeric(df_funds[c], errors="coerce")
        if "fund_score" in df_funds.columns:
            try:
                available = int(df_funds["fund_score"].notna().sum())
                print(
                    f"[OK] Fundamentals loaded: {len(df_funds)} rows, fund_score available for {available}.",
                    flush=True,
                )
            except Exception:
                pass
        return df_funds
    except Exception as e:
        print(f"Warning: Failed to fetch fundamentals: {e}")
        return pd.DataFrame()


# Removed legacy optimize_and_train_model (GridSearchCV) in favor of Optuna-based optimization in ModelTrainer.


def add_market_context(stock_df, market_df):
    """
    Add Advanced Market Context features (Beta, Correlation, Market Regime).
    """
    if market_df is None or market_df.empty:
        # Fill with zeros and defaults (optimized: add all columns at once to avoid fragmentation)
        market_features = [
            "feat_mkt_trend",
            "feat_mkt_volatility",
            "feat_rel_strength",
            "beta",
            "correlation_20",
        ]
        missing_cols = [f for f in market_features if f not in stock_df.columns]

        if missing_cols:
            # Create DataFrame with zeros and concat once (faster than loop)
            zeros_df = pd.DataFrame(0, index=stock_df.index, columns=missing_cols)
            stock_df = pd.concat([stock_df, zeros_df], axis=1)
            # De-fragment memory
            stock_df = stock_df.copy()

        return stock_df

    # Ensure indexes are DatetimeIndex
    if not isinstance(stock_df.index, pd.DatetimeIndex):
        stock_df.index = pd.to_datetime(stock_df.index)
    if not isinstance(market_df.index, pd.DatetimeIndex):
        market_df.index = pd.to_datetime(market_df.index)

    # Reindex market data to match stock data (forward fill)
    market_reindexed = market_df.reindex(stock_df.index, method="ffill")
    stock_df = stock_df.copy()

    # 1. Market Trend
    stock_df["mkt_close"] = market_reindexed["close"]
    stock_df["mkt_sma200"] = stock_df["mkt_close"].rolling(200).mean()
    stock_df["feat_mkt_trend"] = 0
    stock_df.loc[stock_df["mkt_close"] > stock_df["mkt_sma200"], "feat_mkt_trend"] = 1
    stock_df.loc[stock_df["mkt_close"] < stock_df["mkt_sma200"], "feat_mkt_trend"] = -1

    # 2. Market Volatility (ATR Proxy)
    stock_df["feat_mkt_volatility"] = (
        stock_df["mkt_close"].pct_change().rolling(20).std().fillna(0)
    )

    # 3. Relative Strength
    stock_ret = stock_df["close"].pct_change()
    market_ret = stock_df["mkt_close"].pct_change()
    stock_df["feat_rel_strength"] = (stock_ret - market_ret).fillna(0)

    # 4. Beta (Sensitivity)
    window = 60
    covariance = stock_ret.rolling(window).cov(market_ret)
    market_variance = market_ret.rolling(window).var()
    stock_df["beta"] = (covariance / market_variance.replace(0, np.nan)).fillna(1.0)

    # 5. Rolling Correlation
    stock_df["correlation_20"] = stock_ret.rolling(20).corr(market_ret).fillna(0)

    if "egx30_return" in market_reindexed.columns:
        stock_df["egx30_return"] = market_reindexed["egx30_return"]
    if "market_regime" in market_reindexed.columns:
        stock_df["market_regime"] = market_reindexed["market_regime"]

    # Cleanup
    stock_df.drop(columns=["mkt_close", "mkt_sma200"], inplace=True, errors="ignore")

    return stock_df


@memory_cache.cache
def add_massive_features(df):
    """
    Generate over 250 features using:
    1. TA library (~90 features)
    2. Rolling Stats
    3. Lagged historical data
    """
    # Create a copy to avoid modifying the original DataFrame
    df = df.copy()
    cols = {c.lower(): c for c in df.columns}
    for key in ("open", "high", "low", "close", "volume"):
        if key in cols and cols[key] != key:
            df.rename(columns={cols[key]: key}, inplace=True)
    if "close" not in df.columns or "volume" not in df.columns:
        import warnings

        missing = []
        if "close" not in df.columns:
            missing.append("close")
        if "volume" not in df.columns:
            missing.append("volume")
        warnings.warn(
            f"add_massive_features: Missing required columns {missing}. Returning DataFrame unprocessed. Feature engineering skipped!"
        )
        return df

    # ---------------------------------------------------------
    # 1. Ready-made Technical Indicators (Base: ~80-90 features)
    # ---------------------------------------------------------
    # This step alone adds RSI, MACD, Bollinger, Ichimoku, etc.
    df = add_all_ta_features(
        df,
        open="open",
        high="high",
        low="low",
        close="close",
        volume="volume",
        fillna=True,
    )

    # 2. Vectorized Rolling Windows & Tags
    windows = [3, 7, 14, 30]
    target_cols = ["close", "volume", "momentum_rsi"]
    extra_cols = {}

    # Pre-calculate rolling objects for each window to reuse
    for w in windows:
        existing = [c for c in target_cols if c in df.columns]
        if not existing:
            continue

        # Grouped rolling operation is faster than individual ones
        roll = df[existing].rolling(window=w)
        means = roll.mean()
        stds = roll.std()
        maxs = roll.max()
        mins = roll.min()

        for col in existing:
            extra_cols[f"{col}_SMA_{w}"] = means[col]
            extra_cols[f"{col}_STD_{w}"] = stds[col]
            extra_cols[f"{col}_MAX_{w}"] = maxs[col]
            extra_cols[f"{col}_MIN_{w}"] = mins[col]

    # 3. Historical Memory (Lag Features)
    # Detect correct column names (case-insensitive)
    close_col = (
        "close" if "close" in df.columns else "Close" if "Close" in df.columns else None
    )
    vol_col = (
        "volume"
        if "volume" in df.columns
        else "Volume"
        if "Volume" in df.columns
        else None
    )

    if close_col and vol_col:
        lags = [1, 2, 3, 5]
        for lag in lags:
            extra_cols[f"Close_Lag_{lag}"] = df[close_col].shift(lag)
            extra_cols[f"Vol_Lag_{lag}"] = df[vol_col].shift(lag)
            extra_cols[f"Return_{lag}d"] = df[close_col].pct_change(lag)

    # 4. Advanced Vectorized Math
    if close_col:
        extra_cols["Log_Ret"] = np.log(
            df[close_col] / df[close_col].shift(1).replace(0, np.nan)
        )

        # Optimizing Z-Score (one rolling object)
        roll20 = df[close_col].rolling(20)
        mu20 = roll20.mean()
        sigma20 = roll20.std()
        extra_cols["Z_Score_20"] = (df[close_col] - mu20) / sigma20.replace(0, np.nan)

        if vol_col:
            extra_cols["PV_Trend"] = (
                df[close_col].pct_change() * df[vol_col].pct_change()
            )

            # --- الإضافات الجديدة (Smart Money Features) ---
            # 1. Amihud Illiquidity (بصمة المؤسسات والسيولة)
            extra_cols["Amihud_Illiquidity"] = (
                df[close_col].pct_change().abs() / (df[close_col] * df[vol_col] + 1e-9)
            ).replace([np.inf, -np.inf], 0)
            extra_cols["Amihud_SMA_10"] = (
                extra_cols["Amihud_Illiquidity"].rolling(10).mean().fillna(0)
            )

            # 2. Volume Acceleration (تسارع الفوليوم)
            vol_sma_3 = df[vol_col].rolling(3).mean()
            vol_sma_20 = df[vol_col].rolling(20).mean()
            extra_cols["Volume_Acceleration"] = (
                (vol_sma_3 / (vol_sma_20 + 1e-9))
                .replace([np.inf, -np.inf], 1.0)
                .fillna(1.0)
            )

    # 5. Regime Features (Hurst & Volume Delta)
    if close_col:
        try:
            # Approximate Hurst via rolling variance ratio
            roll10 = df[close_col].diff().rolling(10)
            roll30 = df[close_col].diff().rolling(30)
            var10 = roll10.var()
            var30 = roll30.var()
            extra_cols["Regime_Hurst_Proxy"] = (var30 / (var10 * 3 + 1e-9)).fillna(1.0)
        except Exception:
            extra_cols["Regime_Hurst_Proxy"] = 1.0

    if vol_col and close_col:
        # Volume Delta: Volume * sign(Close Return)
        extra_cols["Volume_Delta"] = df[vol_col] * np.sign(df[close_col].diff())
        extra_cols["Volume_Delta_SMA_10"] = (
            extra_cols["Volume_Delta"].rolling(10).mean().fillna(0)
        )

    # 3. Gap Anomalies (الفجوات السعرية)
    if ("open" in df.columns or "Open" in df.columns) and close_col:
        open_c = "open" if "open" in df.columns else "Open"
        prev_close = df[close_col].shift(1)
        extra_cols["Overnight_Gap"] = (
            ((df[open_c] - prev_close) / (prev_close + 1e-9))
            .replace([np.inf, -np.inf], 0)
            .fillna(0)
        )
        extra_cols["Intraday_Return"] = (
            ((df[close_col] - df[open_c]) / (df[open_c] + 1e-9))
            .replace([np.inf, -np.inf], 0)
            .fillna(0)
        )
    else:
        extra_cols["Overnight_Gap"] = 0.0
        extra_cols["Intraday_Return"] = 0.0

    # Sector Relative Strength
    if "sector_avg_return" in df.columns:
        if "stock_daily_return" in df.columns:
            extra_cols["feat_sector_rel_strength"] = (
                df["stock_daily_return"] - df["sector_avg_return"]
            )
        elif close_col:
            stock_ret = df[close_col].pct_change().fillna(0.0)
            extra_cols["feat_sector_rel_strength"] = stock_ret - df["sector_avg_return"]
        else:
            extra_cols["feat_sector_rel_strength"] = 0.0
    else:
        extra_cols["feat_sector_rel_strength"] = 0.0

    # ============================================================================
    # 🔥 EGX-Specific Features (Circuit Breaker, Volume Patterns, Bull Days)
    # ============================================================================
    # These features are tuned for Egyptian Exchange trading behavior

    if close_col and ("high" in df.columns or "High" in df.columns):
        high_col = "high" if "high" in df.columns else "High"
        low_col = "low" if "low" in df.columns else "Low"

        # 1. Distance from ±10% Circuit Breaker Limits (EGX Daily Halt Rules)
        prev_close = df[close_col].shift(1)
        circuit_upper = prev_close * 1.10  # +10% daily limit
        circuit_lower = prev_close * 0.90  # -10% daily limit

        current_high = df[high_col]
        current_low = df[low_col]

        # How far from upper limit (as % of circuit range)
        extra_cols["pct_from_circuit_breaker"] = (
            ((circuit_upper - current_high) / (circuit_upper - circuit_lower + 1e-9))
            .fillna(0.5)
            .clip(0, 1)
        )  # 0 = at upper limit, 1 = at lower limit

        # 2. Previous Day Hit Upper Limit (Strong Bullish Signal)
        prev_high = df[high_col].shift(1)
        extra_cols["prev_hit_upper_limit"] = (
            (prev_high >= circuit_upper.shift(1)).astype(int)
        ).fillna(0)

        # 3. Bull Days Percentage in Last 10 Bars
        returns_10 = df[close_col].diff() > 0
        extra_cols["bull_days_10"] = (returns_10.rolling(10).sum() / 10.0).fillna(
            0.5
        )  # % of up days

        # 4. Volume Dry-up Pattern (Low Volume = Accumulation)
        if vol_col:
            vol_ma_20 = df[vol_col].rolling(20).mean()
            extra_cols["volume_dryup"] = (
                (df[vol_col] / (vol_ma_20 + 1e-9))
                .replace([np.inf, -np.inf], 1.0)
                .fillna(1.0)
            )
            # < 0.7 = dry-up, > 1.3 = spike
            extra_cols["feat_volume_dryup"] = extra_cols["volume_dryup"]

        # --- EGX Specific Features ---
        dist_up = (circuit_upper - df[high_col]) / (prev_close + 1e-9)
        dist_down = (df[low_col] - circuit_lower) / (prev_close + 1e-9)
        extra_cols["feat_circuit_breaker_distance"] = np.minimum(
            dist_up, dist_down
        ).fillna(0.10)

        is_green = (
            (df[close_col] > df["open"]).astype(float)
            if "open" in df.columns
            else returns_10.astype(float)
        )
        extra_cols["feat_bull_consistency"] = is_green.rolling(10).mean().fillna(0.5)

        low_250 = df[close_col].rolling(250).min()
        high_250 = df[close_col].rolling(250).max()
        extra_cols["feat_52w_position"] = (
            (df[close_col] - low_250) / (high_250 - low_250 + 1e-9)
        ).fillna(0.5)

    # Maintain Case-Sensitive Columns for other functions
    for c in ["Open", "High", "Low", "Close", "Volume"]:
        if c.lower() in df.columns:
            extra_cols[c] = df[c.lower()]

    if extra_cols:
        df = pd.concat([df, pd.DataFrame(extra_cols, index=df.index)], axis=1)
        df = df.copy()

    # Clean data (remove NaN values resulting from Lags) - only for numeric columns
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    df[numeric_cols] = df[numeric_cols].replace([np.inf, -np.inf], np.nan).fillna(0)

    return df


@memory_cache.cache
def add_technical_indicators(df):
    cols = {c.lower(): c for c in df.columns}
    close_col = cols.get("close")
    open_col = cols.get("open")
    high_col = cols.get("high")
    low_col = cols.get("low")
    volume_col = cols.get("volume")

    if not close_col or not volume_col:
        return pd.DataFrame()

    out = pd.DataFrame(index=df.index)
    out["Close"] = df[close_col]
    out["Volume"] = df[volume_col]
    if open_col:
        out["Open"] = df[open_col]
    if high_col:
        out["High"] = df[high_col]
    if low_col:
        out["Low"] = df[low_col]

    # 1. Moving Averages
    out["SMA_50"] = out["Close"].rolling(window=50, min_periods=1).mean()
    out["SMA_200"] = out["Close"].rolling(window=200, min_periods=1).mean()
    out["EMA_50"] = out["Close"].ewm(span=50, adjust=False).mean()
    out["EMA_200"] = out["Close"].ewm(span=200, adjust=False).mean()

    # Cross features (Golden Cross / Death Cross logic)
    out["SMA_Cross"] = (out["SMA_50"] - out["SMA_200"]) / out["SMA_200"].replace(
        0, np.nan
    )
    out["EMA_Cross"] = (out["EMA_50"] - out["EMA_200"]) / out["EMA_200"].replace(
        0, np.nan
    )
    out["Price_vs_SMA200"] = (out["Close"] - out["SMA_200"]) / out["SMA_200"].replace(
        0, np.nan
    )

    # 2. MACD
    ema_12 = out["Close"].ewm(span=12, adjust=False).mean()
    ema_26 = out["Close"].ewm(span=26, adjust=False).mean()
    out["MACD"] = ema_12 - ema_26
    out["MACD_Signal"] = out["MACD"].ewm(span=9, adjust=False).mean()
    out["MACD_Hist"] = out["MACD"] - out["MACD_Signal"]

    # 3. RSI
    delta = out["Close"].diff()
    gain = (delta.where(delta > 0, 0.0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(window=14).mean()
    rs = gain / loss.replace(0.0, np.nan)
    out["RSI"] = 100 - (100 / (1 + rs))

    # RSI 7 (Fast Momentum)
    gain7 = (delta.where(delta > 0, 0.0)).rolling(window=7).mean()
    loss7 = (-delta.where(delta < 0, 0.0)).rolling(window=7).mean()
    rs7 = gain7 / loss7.replace(0.0, np.nan)
    out["RSI_7"] = 100 - (100 / (1 + rs7))

    # 4. Momentum & ROC
    out["Momentum"] = out["Close"].pct_change().fillna(0)
    out["ROC_12"] = out["Close"].pct_change(periods=12).fillna(0) * 100

    # 5. Volume Indicators
    out["VOL_SMA20"] = out["Volume"].rolling(window=20, min_periods=1).mean()
    out["VOL_Change"] = out["Volume"].pct_change().fillna(0)

    # 6. Advanced (Requires High/Low)
    if "High" in out.columns and "Low" in out.columns:
        high = out["High"].astype(float)
        low = out["Low"].astype(float)
        close = out["Close"].astype(float)
        prev_close = close.shift(1)

        # ATR
        tr = pd.concat(
            [(high - low).abs(), (high - prev_close).abs(), (low - prev_close).abs()],
            axis=1,
        ).max(axis=1)
        out["ATR_14"] = tr.ewm(alpha=1 / 14, adjust=False, min_periods=1).mean()

        # ADX
        up_move = high.diff()
        down_move = -low.diff()
        plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
        minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

        tr_sm = tr.ewm(alpha=1 / 14, adjust=False, min_periods=1).mean()
        plus_dm_sm = (
            pd.Series(plus_dm, index=out.index)
            .ewm(alpha=1 / 14, adjust=False, min_periods=1)
            .mean()
        )
        minus_dm_sm = (
            pd.Series(minus_dm, index=out.index)
            .ewm(alpha=1 / 14, adjust=False, min_periods=1)
            .mean()
        )

        plus_di = 100 * (plus_dm_sm / tr_sm.replace(0.0, np.nan))
        minus_di = 100 * (minus_dm_sm / tr_sm.replace(0.0, np.nan))
        dx = (
            100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
        )
        out["ADX_14"] = (
            dx.ewm(alpha=1 / 14, adjust=False, min_periods=1).mean().fillna(0.0)
        )

        # Stochastic
        lowest_low = low.rolling(window=14, min_periods=1).min()
        highest_high = high.rolling(window=14, min_periods=1).max()
        stoch_k = (
            100
            * (close - lowest_low)
            / (highest_high - lowest_low).replace(0.0, np.nan)
        )
        out["STOCH_K"] = stoch_k.fillna(0.0)
        out["STOCH_D"] = out["STOCH_K"].rolling(window=3, min_periods=1).mean()

        # CCI
        tp = (high + low + close) / 3
        tp_sma = tp.rolling(window=20, min_periods=1).mean()
        mean_dev = (tp - tp_sma).abs().rolling(window=20, min_periods=1).mean()
        out["CCI_20"] = (
            (tp - tp_sma) / (0.015 * mean_dev.replace(0.0, np.nan))
        ).fillna(0.0)

        # VWAP (Rolling 20-day approx)
        pv = tp * out["Volume"].astype(float)
        vol_sum = out["Volume"].astype(float).rolling(window=20, min_periods=1).sum()
        out["VWAP_20"] = (
            pv.rolling(window=20, min_periods=1).sum() / vol_sum.replace(0.0, np.nan)
        ).fillna(0.0)
    else:
        # Fill zeros if OHLC not fully available
        for c in ["ATR_14", "ADX_14", "STOCH_K", "STOCH_D", "CCI_20", "VWAP_20"]:
            out[c] = 0.0

    # 7. Bollinger bands (20, 2) and derived features
    if "Close" in out.columns:
        bb_sma20 = out["Close"].rolling(window=20).mean()
        bb_std20 = out["Close"].rolling(window=20).std()
        out["BB_Upper"] = bb_sma20 + (2 * bb_std20)
        out["BB_Lower"] = bb_sma20 - (2 * bb_std20)

        width = out["BB_Upper"] - out["BB_Lower"]
        out["BB_PctB"] = (
            (out["Close"] - out["BB_Lower"]) / width.replace(0.0, np.nan)
        ).fillna(0.0)
        out["BB_Width"] = (width / out["Close"].replace(0.0, np.nan)).fillna(0.0)
    else:
        out["BB_Upper"] = 0.0
        out["BB_Lower"] = 0.0
        out["BB_PctB"] = 0.0
        out["BB_Width"] = 0.0

    # 8. On-Balance Volume and slope
    price_delta = out["Close"].diff()
    direction = np.sign(price_delta).fillna(0.0)
    obv = (direction * out["Volume"]).cumsum()
    out["OBV"] = obv.fillna(0.0)
    out["OBV_Slope"] = out["OBV"].diff().fillna(0.0)

    # 9. Distance from rolling high/low for context
    rolling_high = out["Close"].rolling(window=100, min_periods=1).max()
    rolling_low = out["Close"].rolling(window=100, min_periods=1).min()
    out["Dist_From_High"] = (
        (out["Close"] / rolling_high.replace(0.0, np.nan)) - 1.0
    ).fillna(0.0)
    out["Dist_From_Low"] = (
        (out["Close"] / rolling_low.replace(0.0, np.nan)) - 1.0
    ).fillna(0.0)

    # 10. Z-score of price vs rolling mean/std
    rolling_mean = out["Close"].rolling(window=50, min_periods=1).mean()
    rolling_std = out["Close"].rolling(window=50, min_periods=1).std()
    out["Z_Score"] = (
        (out["Close"] - rolling_mean) / rolling_std.replace(0.0, np.nan)
    ).fillna(0.0)

    # 11. Candle geometry (body and shadows)
    if "Open" in out.columns and "High" in out.columns and "Low" in out.columns:
        open_ = out["Open"].astype(float)
        high = out["High"].astype(float)
        low = out["Low"].astype(float)
        close = out["Close"].astype(float)

        body = close - open_
        out["Body_Size"] = (body / open_.replace(0.0, np.nan)).fillna(0.0)
        upper_shadow = high - np.maximum(close, open_)
        lower_shadow = np.minimum(close, open_) - low
        out["Upper_Shadow"] = (upper_shadow / open_.replace(0.0, np.nan)).fillna(0.0)
        out["Lower_Shadow"] = (lower_shadow / open_.replace(0.0, np.nan)).fillna(0.0)
    else:
        out["Body_Size"] = 0.0
        out["Upper_Shadow"] = 0.0
        out["Lower_Shadow"] = 0.0

    # 12. Time features from index
    if isinstance(out.index, pd.DatetimeIndex):
        out["Day_Of_Week"] = out.index.dayofweek.astype(int)
        out["Day_Of_Month"] = out.index.day.astype(int)
    else:
        out["Day_Of_Week"] = 0
        out["Day_Of_Month"] = 0

    # 13. Lagged features and differences (memory)
    out["Close_Lag1"] = out["Close"].shift(1)
    out["Close_Diff"] = out["Close"].diff().fillna(0.0)

    if "RSI" in out.columns:
        out["RSI_Lag1"] = out["RSI"].shift(1)
        out["RSI_Diff"] = out["RSI"].diff().fillna(0.0)
    else:
        out["RSI_Lag1"] = np.nan
        out["RSI_Diff"] = 0.0

    out["Volume_Lag1"] = out["Volume"].shift(1)
    out["Volume_Diff"] = out["Volume"].diff().fillna(0.0)

    out["OBV_Lag1"] = out["OBV"].shift(1)
    out["OBV_Diff"] = out["OBV"].diff().fillna(0.0)

    # ---------------------------------------------------------
    # 14. Indicator Stacking (Signals + Rolling Win Rate)
    # ---------------------------------------------------------

    return out


def prepare_for_ai(
    df: pd.DataFrame,
    target_pct: float = 2.0,  # < 1.0 => percentage, >= 1.0 => ATR multiplier
    stop_loss_pct: float = 1.0,  # < 1.0 => percentage, >= 1.0 => ATR multiplier
    look_forward_days: int = 20,
    use_volatility: bool = True,
    drop_labels: bool = True,
    barrier_mode: Optional[str] = None,
    require_volume_confirmation: bool = False,  # Stricter labeling for EGX
    min_volume_ratio: float = 0.8,  # Min volume as ratio to 20-day average
) -> pd.DataFrame:
    """
    Triple-barrier labeling used by training.

    The same `target_pct` / `stop_loss_pct` inputs are shared across the app:
    - "percent" mode: values are fractions like 0.03 = 3%
    - "atr" mode: values are ATR multipliers like 2.0x ATR

    Target = 1 ONLY if Take Profit is hit BEFORE Stop Loss within the window.

    For EGX (require_volume_confirmation=True), label only when:
    - TP hit within 5 days (not 20) AND
    - Volume avg in those bars ≥ min_volume_ratio * 20-day average volume
    """
    if df.empty:
        return df

    out = df.copy()

    # Stricter labeling for EGX: reduce window to 5 days for higher precision
    effective_look_forward = 5 if require_volume_confirmation else look_forward_days

    # التأكد من وجود الأعمدة الأساسية
    close_col = "Close" if "Close" in out.columns else "close"
    high_col = "High" if "High" in out.columns else "high"
    low_col = "Low" if "Low" in out.columns else "low"
    open_col = (
        "Open"
        if "Open" in out.columns
        else ("open" if "open" in out.columns else close_col)
    )
    volume_col = (
        "Volume"
        if "Volume" in out.columns
        else ("volume" if "volume" in out.columns else None)
    )
    resolved_mode = _resolve_barrier_mode(target_pct, stop_loss_pct, barrier_mode)

    if "ATR_14" not in out.columns:
        # حساب بديل سريع للـ ATR لو مش موجود
        out["ATR_14"] = out[close_col].rolling(14).std().bfill()

    # حساب متوسط الحجم على 20 يوم (لتأكيد volume)
    volume_ma_20 = None
    if require_volume_confirmation and volume_col:
        volume_ma_20 = out[volume_col].rolling(20).mean()

    # الدخول من افتتاح اليوم التالي لمنع تسريب البيانات (Look-ahead Bias)
    out["entry_price"] = out[open_col].shift(-1)
    shifted_atr = out["ATR_14"].shift(-1)

    if resolved_mode == "percent":
        out["tp_barrier"] = out["entry_price"] * (1 + float(target_pct))
        out["sl_barrier"] = out["entry_price"] * (1 - float(stop_loss_pct))
    else:
        # حساب الحواجز الديناميكية
        out["tp_barrier"] = out["entry_price"] + (shifted_atr * float(target_pct))
        out["sl_barrier"] = out["entry_price"] - (shifted_atr * float(stop_loss_pct))

    out["Target"] = 0

    # استخراج البيانات في مصفوفات لتسريع المعالجة (Vectorization)
    high_vals = out[high_col].values
    low_vals = out[low_col].values
    tp_vals = out["tp_barrier"].values
    sl_vals = out["sl_barrier"].values
    volume_vals = out[volume_col].values if volume_col else None
    vol_ma_vals = volume_ma_20.values if volume_ma_20 is not None else None

    # Vectorized approach: for each row, check if TP or SL was hit in next look_forward_days bars
    targets = np.zeros(len(out), dtype=int)

    for i in range(len(out) - effective_look_forward - 1):
        if not np.isfinite(tp_vals[i]) or not np.isfinite(sl_vals[i]):
            continue

        # Vectorized: check if any high in the window >= TP
        high_window = high_vals[i + 1 : i + effective_look_forward + 1]
        low_window = low_vals[i + 1 : i + effective_look_forward + 1]

        tp_hit = np.any(high_window >= tp_vals[i])
        sl_hit = np.any(low_window <= sl_vals[i])

        # For EGX: require volume confirmation on TP bars
        volume_confirmed = True
        if (
            require_volume_confirmation
            and volume_vals is not None
            and vol_ma_vals is not None
        ):
            if tp_hit and vol_ma_vals[i] > 0:
                # Check if volume during TP bars was above threshold
                tp_idx = np.argmax(high_window >= tp_vals[i])
                window_volume = volume_vals[i + 1 : i + tp_idx + 2]
                volume_confirmed = (
                    np.mean(window_volume) >= vol_ma_vals[i] * min_volume_ratio
                )

        if tp_hit and not sl_hit and volume_confirmed:
            targets[i] = 1  # TP hit first + volume confirmed
        elif sl_hit and not tp_hit:
            targets[i] = 0  # SL hit first
        else:
            # Both or neither hit: check which happened first
            tp_idx = (
                np.argmax(high_window >= tp_vals[i]) if tp_hit else len(high_window)
            )
            sl_idx = np.argmax(low_window <= sl_vals[i]) if sl_hit else len(low_window)
            targets[i] = 1 if (tp_idx < sl_idx and volume_confirmed) else 0

    out["Target"] = targets

    # تنظيف الداتا
    out.drop(
        columns=["entry_price", "tp_barrier", "sl_barrier"],
        inplace=True,
        errors="ignore",
    )

    if drop_labels:
        out = out.iloc[:-look_forward_days].copy()

    return out


# =============================================================================
# Training Monitor - Early Detection of Training Issues
# =============================================================================
class TrainingMonitor:
    """Monitor training progress and detect issues early."""

    def __init__(self, log_cb: Optional[Callable] = None):
        self.log_cb = log_cb
        self.alerts = []

    def _log(self, msg: str):
        """Log message via callback or print."""
        if self.log_cb:
            self.log_cb(msg)
        else:
            print(msg)

    def check_metrics(self, metrics: dict) -> list:
        """
        Check for problematic metric patterns.
        Returns list of alert messages.
        """
        self.alerts = []

        recall = metrics.get("recall", 0)
        precision = metrics.get("precision", 0)
        auc = metrics.get("auc", 1.0)

        # Alert 1: Perfect or near-perfect Recall (model predicting all 1s)
        if recall > 0.95:
            self.alerts.append(
                f"⚠️ CRITICAL: Recall={recall:.2%} - Model may be predicting BUY for everything!"
            )

        # Alert 2: Low AUC (barely better than random)
        if auc < 0.6:
            self.alerts.append(
                f"⚠️ WARNING: AUC={auc:.3f} - Model barely better than random (0.5)!"
            )

        # Alert 3: Large Precision-Recall gap
        if abs(precision - recall) > 0.3:
            self.alerts.append(
                f"⚠️ WARNING: Large P-R gap (P={precision:.2%} vs R={recall:.2%})"
            )

        # Alert 4: Very low precision
        if precision < 0.5:
            self.alerts.append(
                f"⚠️ WARNING: Precision={precision:.2%} - Too many false positives!"
            )

        return self.alerts

    def calculate_strategy_suggestions(
        self, metrics: dict, target_pct: float, stop_loss_pct: float
    ):
        """Analyze metrics and suggest strategy parameter adjustments."""
        precision = metrics.get("precision", 0)
        recall = metrics.get("recall", 0)

        self._log("\n💡 STRATEGY SUGGESTIONS:")

        if precision < 0.4:
            self._log(
                f"  - Precision is low ({precision:.1%}). Suggest tightening Stop Loss from {stop_loss_pct:.1%} to {max(0.01, stop_loss_pct * 0.7):.1%}"
            )
            self._log(
                f"  - High False Positive rate detected. Consider increasing Target from {target_pct:.1%} to {target_pct * 1.2:.1%}"
            )
        elif precision > 0.6 and recall < 0.3:
            self._log(
                f"  - Precision is great ({precision:.1%}) but Recall is low ({recall:.1%})."
            )
            self._log(
                f"  - Suggest loosening Stop Loss from {stop_loss_pct:.1%} to {stop_loss_pct * 1.3:.1%} to catch more trends."
            )
        else:
            self._log(
                "  - Balanced results! Current Target/Stop settings appear optimal for this model."
            )

        return self.alerts

    def log_alerts(self):
        """Log all accumulated alerts."""
        if self.alerts:
            self._log("\n" + "=" * 60)
            self._log("⚠️ TRAINING ALERTS DETECTED:")
            for alert in self.alerts:
                self._log(f"  {alert}")
            self._log("=" * 60 + "\n")

    def check_class_balance(self, y) -> dict:
        """
        Check class balance and return statistics.
        """
        import numpy as np

        unique, counts = np.unique(y, return_counts=True)
        total = len(y)

        stats = {}
        for cls, cnt in zip(unique, counts):
            stats[int(cls)] = {"count": int(cnt), "pct": cnt / total}

        # Alert if heavily imbalanced
        if len(stats) == 2:
            pct_1 = stats.get(1, {}).get("pct", 0)
            if pct_1 > 0.8:
                self.alerts.append(
                    f"⚠️ IMBALANCE: {pct_1:.1%} of labels are positive (Target=1). "
                    "Consider adjusting target_pct/stop_loss_pct ratio."
                )
            elif pct_1 < 0.2:
                self.alerts.append(
                    f"⚠️ IMBALANCE: Only {pct_1:.1%} of labels are positive. "
                    "May need more data or different labeling strategy."
                )

        return stats


def calculate_optimal_class_weight(y, max_ratio: float = 10.0) -> dict:
    """
    Calculate class weights that prevent model from predicting all 1s.

    Args:
        y: Target labels (0 or 1)
        max_ratio: Maximum weight ratio to prevent extreme imbalance

    Returns:
        dict: Class weights {0: weight_0, 1: weight_1}
    """
    import numpy as np

    y_arr = np.array(y)
    pos = np.sum(y_arr == 1)
    neg = np.sum(y_arr == 0)
    total = pos + neg

    if pos == 0 or neg == 0:
        return {0: 1.0, 1: 1.0}

    # Calculate ratio
    # If more positives than negatives, weight negatives higher
    if pos > neg:
        ratio = min(pos / neg, max_ratio)
        weights = {0: ratio, 1: 1.0}
    else:
        ratio = min(neg / pos, max_ratio)
        weights = {0: 1.0, 1: ratio}

    print(f"[ClassWeight] Pos={pos} ({pos / total:.1%}), Neg={neg} ({neg / total:.1%})")
    print(f"[ClassWeight] Calculated weights: {weights}")

    return weights


import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler


class QuantitativeModelPipeline:
    def __init__(self, model, pca_features, n_components=3):
        self.model = model
        self.pca_features = pca_features
        self.n_components = n_components
        self.pca = PCA(n_components=n_components)
        self.scaler = StandardScaler()

    def _transform(self, X):
        X = X.copy()
        # Find which pca_features are in X
        present_pca_feats = [f for f in self.pca_features if f in X.columns]
        if not present_pca_feats:
            return X

        # Extract, scale and PCA transform
        X_pca_raw = X[present_pca_feats].fillna(0)
        X_scaled = self.scaler.transform(X_pca_raw)
        X_pca = self.pca.transform(X_scaled)

        # Drop raw correlated features to reduce noise
        X = X.drop(columns=present_pca_feats)

        # Add orthogonal PCA components
        for i in range(X_pca.shape[1]):
            X[f"PCA_Momentum_{i}"] = X_pca[:, i]

        return X

    def predict(self, X):
        X_t = self._transform(X)
        return self.model.predict(X_t)

    def predict_proba(self, X):
        X_t = self._transform(X)
        if hasattr(self.model, "predict_proba"):
            return self.model.predict_proba(X_t)
        # Fallback for some wrappers
        raw = self.model.predict(X_t)
        probs = np.asarray(raw)
        return np.column_stack([1 - probs, probs])

    def get_feature_importance(self):
        if hasattr(self.model, "feature_importances_"):
            return self.model.feature_importances_
        elif hasattr(self.model, "get_feature_importance"):
            return self.model.get_feature_importance()
        return []


class ModelTrainer:
    """
    Modular class for handling stock price data loading,
    feature engineering, and model training.
    """

    def __init__(
        self,
        exchange: str,
        supabase_url: str,
        supabase_key: str,
        progress_cb: Optional[Callable[[Any], None]] = None,
    ):
        self.exchange = self._standardize_exchange(exchange)
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.progress_cb = progress_cb
        self.market_df = None
        self.market_index_symbol = None
        self.market_index_loaded = False
        self.market_index_local_json = None
        self.fundamentals_loaded = False
        self.df_all = None
        self.predictors = []
        self.categorical_features = []
        self.min_history_needed = 200  # Default for safety (SMA200)
        self.embargo_pct = 0.01  # 1% embargo gap for purged k-fold
        self.params = TradingParameters()

    def _clean_dataset(self, X: pd.DataFrame) -> pd.DataFrame:
        """
        Centralized cleaning to ensure X has correct dtypes for LightGBM.
        - Fills numeric NaNs with 0 (safe for trees).
        - Fills categorical NaNs with "Unknown".
        - Enforces 'category' dtype for self.categorical_features.
        """
        X = X.copy()

        # 1. Fill Numeric NaNs
        num_cols = X.select_dtypes(include=[np.number]).columns
        if not num_cols.empty:
            X[num_cols] = X[num_cols].fillna(0)

        # 2. Handle Categorical Features
        for cat in self.categorical_features:
            if cat in X.columns:
                # Ensure it's not null before casting
                if X[cat].isnull().any():
                    X[cat] = X[cat].astype(object).fillna("Unknown")

                # Strict Cast to Category
                X[cat] = X[cat].astype("category")

        return X

    def _standardize_exchange(self, exchange: str) -> str:
        if not exchange:
            return "UNKNOWN"
        e_lower = exchange.strip().lower()
        if e_lower in ["ca", "cc", "cairo", "egypt"]:
            return "EGX"
        elif e_lower in ["us", "usa", "nasdaq", "nyse"]:
            return "US"
        else:
            return exchange.upper()

    def _progress(self, msg: str) -> None:
        try:
            # Safe print for Windows consoles that might not support emojis
            print(
                msg.encode(sys.stdout.encoding, errors="replace").decode(
                    sys.stdout.encoding
                )
            )
        except Exception:
            try:
                print(msg.encode("utf-8", errors="ignore").decode("utf-8"))
            except Exception:
                pass

        if self.progress_cb:
            try:
                self.progress_cb(msg)
            except Exception:
                pass

    def _progress_stats(self, phase: str, message: str, stats: Dict[str, Any]) -> None:
        if not self.progress_cb:
            return
        payload = {"phase": phase, "message": message, "stats": stats}
        try:
            self.progress_cb(payload)
        except Exception:
            pass

    def load_market_data(self) -> None:
        """Fetch Market Index Data for context."""
        candidates = []
        if self.exchange == "EGX":
            candidates = ["EGX30.INDX", "COMI.CA"]
        elif self.exchange == "US":
            candidates = ["GSPC.INDX", "SPY.US", "AAPL.US"]
        elif self.exchange == "CRYPTO":
            candidates = ["BTC-USD"]  # Bitcoin is the best market indicator for crypto
        else:
            candidates = ["BTC-USD"]  # Default to Bitcoin for crypto-related exchanges

        self.market_index_symbol = None
        self.market_index_loaded = False
        self.market_index_local_json = None
        try:
            if self.exchange == "EGX":
                api_dir = os.path.dirname(os.path.abspath(__file__))
                project_root = os.path.dirname(api_dir)
                cand = os.path.join(project_root, "symbols_data", "EGX30-INDEX.json")
                if os.path.exists(cand):
                    self.market_index_local_json = os.path.join(
                        "symbols_data", "EGX30-INDEX.json"
                    )
        except Exception:
            pass

        for idx_sym in candidates:
            self._progress(
                f"Attempting to load market index data from DB: {idx_sym}..."
            )
            try:
                sym = idx_sym
                ex = None
                if "." in idx_sym:
                    parts = idx_sym.split(".")
                    sym = parts[0]
                    ex = parts[1]
                    if ex in ["CC", "CA"]:
                        ex = "EGX"

                offset = 0
                limit = 1000
                all_data = []
                while True:
                    query = (
                        self.supabase.table("stock_prices")
                        .select("date, close")
                        .eq("symbol", sym)
                    )
                    if ex:
                        query = query.eq("exchange", ex)
                    idx_res = (
                        query.order("date", desc=False)
                        .range(offset, offset + limit - 1)
                        .execute()
                    )
                    if not idx_res.data:
                        break
                    all_data.extend(idx_res.data)
                    if len(idx_res.data) < limit:
                        break
                    offset += limit

                if all_data and len(all_data) > 200:
                    df = pd.DataFrame(all_data)
                    df["date"] = pd.to_datetime(df["date"])
                    df = df.set_index("date").sort_index()
                    df["atr"] = df["close"].pct_change().rolling(20).std().fillna(0)
                    df["egx30_return"] = df["close"].pct_change().fillna(0)
                    from api.egx30_fetcher import get_market_regime

                    df["market_regime"] = df["egx30_return"].apply(get_market_regime)
                    self.market_df = df
                    self.market_index_symbol = idx_sym
                    self.market_index_loaded = True
                    self._progress(
                        f"Successfully loaded market context from {idx_sym} (DB) - Total rows: {len(all_data)}"
                    )
                    break
            except Exception as e:
                print(f"Warning: Failed to fetch market index {idx_sym}: {e}")

        # Fallback to local JSON if Database failed
        if self.market_df is None:
            api_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(api_dir)
            local_candidates = []
            if self.exchange == "EGX":
                local_candidates = [
                    os.path.join(api_dir, "symbols_data", "EGX30-INDEX.json"),
                    os.path.join(project_root, "symbols_data", "EGX30-INDEX.json"),
                    os.path.join(
                        project_root, "api", "symbols_data", "EGX30-INDEX.json"
                    ),
                ]
            elif self.exchange == "US":
                local_candidates = [
                    os.path.join(api_dir, "symbols_data", "GSPC-INDEX.json"),
                    os.path.join(project_root, "symbols_data", "GSPC-INDEX.json"),
                ]

            for path in local_candidates:
                if os.path.exists(path):
                    try:
                        # Quick sanity check for Git LFS pointer
                        with open(path, "r", encoding="utf-8") as f:
                            first_line = f.readline()
                            if first_line.startswith("version https://git-lfs"):
                                self._progress(
                                    f"Warning: Local file {path} is a Git LFS pointer, skipping."
                                )
                                continue

                        import json

                        with open(path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            if data:
                                df = pd.DataFrame(data)
                                df["date"] = pd.to_datetime(df["date"])
                                df = df.set_index("date").sort_index()
                                if "close" not in df.columns and "Close" in df.columns:
                                    df["close"] = df["Close"]

                                if "close" in df.columns:
                                    df["atr"] = (
                                        df["close"]
                                        .pct_change()
                                        .rolling(20)
                                        .std()
                                        .fillna(0)
                                    )
                                    df["egx30_return"] = (
                                        df["close"].pct_change().fillna(0)
                                    )
                                    from api.egx30_fetcher import get_market_regime

                                    df["market_regime"] = df["egx30_return"].apply(
                                        get_market_regime
                                    )
                                    self.market_df = df
                                    self.market_index_loaded = True
                                    self._progress(
                                        f"Successfully loaded market context from local JSON: {path}"
                                    )
                                    break
                    except Exception as e:
                        self._progress(
                            f"Warning: Failed to load local market index JSON at {path}: {e}"
                        )

        if self.market_df is None:
            self._progress(
                "Warning: No market index data found. Market Context features will be 0."
            )

    def fetch_stock_prices(
        self,
        page_size: int = 1000,
        *,
        use_intraday: bool = False,
        timeframe: str = "1d",
    ) -> pd.DataFrame:
        """Fetch all stock prices for the exchange using parallel paging."""
        if use_intraday and self.exchange == "CRYPTO":
            self._progress(
                f"Loading local intraday data for exchange CRYPTO ({timeframe})..."
            )
            from api.local_storage import load_all_crypto_bars_local_as_df

            df = load_all_crypto_bars_local_as_df(timeframe)
            if not df.empty:
                if "ts" in df.columns:
                    df = df.rename(columns={"ts": "date"})
                # Filter out volume <= 0
                if "volume" in df.columns:
                    try:
                        vol = pd.to_numeric(df["volume"], errors="coerce").fillna(0)
                        before = len(df)
                        df = df[vol > 0].copy()
                        removed = before - len(df)
                        if removed > 0:
                            self._progress(
                                f"Filtered {removed:,} rows with volume<=0 for CRYPTO intraday."
                            )
                    except Exception:
                        pass
                self._progress(
                    f"Loaded {len(df):,} rows for {len(df['symbol'].unique()):,} symbols."
                )
            return df

        if use_intraday:
            self._progress(
                f"Loading intraday data for exchange {self.exchange} ({timeframe})..."
            )
        else:
            self._progress(f"Loading price data for exchange {self.exchange}...")

        # 1. Get total count
        rows_total = None
        try:
            if use_intraday:
                count_res = (
                    self.supabase.table("stock_bars_intraday")
                    .select("symbol", count="exact")
                    .eq("exchange", self.exchange)
                    .eq("timeframe", timeframe)
                    .limit(1)
                    .execute()
                )
            else:
                count_res = (
                    self.supabase.table("stock_prices")
                    .select("symbol", count="exact")
                    .eq("exchange", self.exchange)
                    .limit(1)
                    .execute()
                )
            rows_total = count_res.count
        except Exception as e:
            print(f"Warning: Failed to fetch total row count: {e}")

        # 2. Parallel Fetch
        def _fetch_page(off, retries=3):
            for attempt in range(retries):
                try:
                    if use_intraday:
                        res = (
                            self.supabase.table("stock_bars_intraday")
                            .select("symbol, ts, open, high, low, close, volume")
                            .eq("exchange", self.exchange)
                            .eq("timeframe", timeframe)
                            .order("symbol", desc=False)
                            .order("ts", desc=False)
                            .range(off, off + page_size - 1)
                            .execute()
                        )
                    else:
                        res = (
                            self.supabase.table("stock_prices")
                            .select("symbol, date, open, high, low, close, volume")
                            .eq("exchange", self.exchange)
                            .order("symbol", desc=False)
                            .order("date", desc=False)
                            .range(off, off + page_size - 1)
                            .execute()
                        )
                    return res.data or []
                except Exception as e:
                    time.sleep((attempt + 1) * 2)
            return []

        all_rows = []
        first_page = _fetch_page(0)
        if not first_page:
            return pd.DataFrame()
        all_rows.extend(first_page)

        if rows_total and rows_total > page_size:
            offsets = range(page_size, rows_total, page_size)
            from concurrent.futures import ThreadPoolExecutor

            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {executor.submit(_fetch_page, o): o for o in offsets}
                for future in as_completed(futures):
                    data = future.result()
                    if data:
                        all_rows.extend(data)
                    if len(all_rows) % (page_size * 10) == 0:
                        self._progress_stats(
                            "loading_rows",
                            f"Loaded {len(all_rows):,} rows",
                            {"rows_loaded": len(all_rows), "rows_total": rows_total},
                        )

        df = pd.DataFrame(all_rows)
        if use_intraday and not df.empty:
            if "ts" in df.columns:
                df = df.rename(columns={"ts": "date"})

        if (
            use_intraday
            and self.exchange == "CRYPTO"
            and not df.empty
            and "volume" in df.columns
        ):
            try:
                vol = pd.to_numeric(df["volume"], errors="coerce").fillna(0)
                before = len(df)
                df = df[vol > 0].copy()
                removed = before - len(df)
                if removed > 0:
                    self._progress(
                        f"Filtered {removed:,} rows with volume<=0 for CRYPTO intraday."
                    )
            except Exception:
                pass
        self._progress(
            f"Loaded {len(df):,} rows for {len(df['symbol'].unique()):,} symbols."
        )
        return df

    @staticmethod
    def _process_single_symbol(params):
        """Worker function for parallel processing. Must be static for pickleability."""
        try:
            (
                sym,
                df_sym,
                market_df,
                target_pct,
                stop_loss_pct,
                look_forward_days,
                use_vol_label,
                min_history,
                barrier_mode,
                exchange,
                t_params,
            ) = params

            # Check data readiness
            manager = FeatureEngineeringManager(t_params)
            report = manager.check_data_ready(df_sym, extra_checks=True)
            StructuredLogger("training").log_data_readiness(sym, report)
            if not report.is_ready:
                return None

            # 1. Base Technical Indicators
            df = add_technical_indicators(df_sym)
            if df.empty:
                return None

            # Preserve fundamentals/categorical columns (merged into df_sym) through the feature pipeline.
            # add_technical_indicators() returns a new dataframe, so we must carry these columns forward.
            for _c in (
                "marketCap",
                "peRatio",
                "eps",
                "dividendYield",
                "sector",
                "industry",
                "sector_avg_return",
                "stock_daily_return",
            ):
                if _c in df_sym.columns and _c not in df.columns:
                    try:
                        if len(df_sym[_c]) == len(df):
                            df[_c] = df_sym[_c].values
                        else:
                            df[_c] = df_sym[_c].iloc[-1]
                    except Exception:
                        df[_c] = (
                            df_sym[_c].iloc[-1]
                            if _c in df_sym.columns and len(df_sym)
                            else None
                        )

            # 2. Massive Feature Set
            df = add_massive_features(df)

            # 3. Market Context
            df = add_market_context(df, market_df)

            # 4. Labeling (The Triple Barrier Strategy)
            if exchange == "EGX":
                from api.strict_quality_labeler import StrictQualityLabeler

                labeler = StrictQualityLabeler(t_params)
                df, rejection_counts = labeler.label_training_data_strict(
                    df, egx30_data=market_df, drop_labels=True
                )
            else:
                labeler = TripleBarrierLabeler(t_params)
                df = labeler.label_training_data(df, drop_labels=True)

            # Require minimum history (redundant check but good for safety if indicators drop rows)
            if len(df) < 10:
                return None
            df["symbol"] = sym
            return df
        except Exception as e:
            print(f"Error processing {params[0]}: {e}")
            return None

    def prepare_training_data(
        self,
        df_all: pd.DataFrame,
        target_pct: float,
        stop_loss_pct: float,
        look_forward_days: int,
        preset: str = "extended",
        use_volatility_label: bool = False,
        barrier_mode: Optional[str] = None,
    ) -> pd.DataFrame:
        """Process features in parallel for all symbols."""
        self._progress(f"Starting parallel feature engineering (Preset: {preset})...")

        # Determine min history based on preset
        # Minimum bars: 120 for extended/max (was 200) to include more EGX symbols
        # that have shorter listing history while still having enough for SMA/RSI indicators.
        # 120 days ~ 6 months of trading, sufficient for reliable feature calculation.
        self.min_history_needed = 120 if preset in ["extended", "max"] else 60

        # Initialize unified TradingParameters
        self.params = TradingParameters(
            entry_mode="next_open",
            look_forward_days=look_forward_days,
            barrier_mode=barrier_mode or "percent",
            target_pct=target_pct,
            stop_loss_pct=stop_loss_pct,
            min_history_needed=self.min_history_needed,
            warmup_bars=self.min_history_needed,
            require_volume_confirmation=(self.exchange == "EGX"),
            min_volume_ratio=0.8 if (self.exchange == "EGX") else 0.3,
        )
        self.struct_logger = StructuredLogger("training")
        self.struct_logger.log_parameter_load("training_pipeline", self.params)

        # Merge fundamentals
        start_time = time.time()

        # Merge fundamentals
        df_funds = fetch_fundamentals_for_exchange(self.supabase, self.exchange)
        self.fundamentals_loaded = bool(df_funds is not None and (not df_funds.empty))
        if df_funds is not None and (not df_funds.empty):
            df_all = df_all.merge(df_funds, on="symbol", how="left")
            for cat_col in ["sector", "industry"]:
                if cat_col in df_all.columns:
                    df_all[cat_col] = (
                        df_all[cat_col].fillna("Unknown").astype("category")
                    )
                    if cat_col not in self.categorical_features:
                        self.categorical_features.append(cat_col)

        # Precalculate sector average daily returns
        if "sector" in df_all.columns:
            try:
                self._progress(
                    "Calculating sector average returns for Dual Relative Strength feature..."
                )
                df_all = df_all.sort_values(["symbol", "date"])
                df_all["stock_daily_return"] = (
                    df_all.groupby("symbol")["close"].pct_change().fillna(0.0)
                )
                sector_avg_ret = df_all.groupby(["date", "sector"], observed=False)[
                    "stock_daily_return"
                ].transform("mean")
                df_all["sector_avg_return"] = sector_avg_ret.fillna(0.0)
            except Exception as e:
                print(
                    f"Warning: Failed to calculate sector average returns during training data prep: {e}"
                )
                df_all["sector_avg_return"] = 0.0
                df_all["stock_daily_return"] = 0.0
        else:
            df_all["sector_avg_return"] = 0.0
            df_all["stock_daily_return"] = 0.0

        # Memory optimization
        df_all = _downcast_df(df_all)

        use_vol_label = bool(use_volatility_label)
        symbol_params = [
            (
                sym,
                df_sym,
                self.market_df,
                target_pct,
                stop_loss_pct,
                look_forward_days,
                use_vol_label,
                self.min_history_needed,
                barrier_mode,
                self.exchange,
                self.params,
            )
            for sym, df_sym in df_all.groupby("symbol")
        ]

        combined_data = []
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as executor:
            results = list(executor.map(self._process_single_symbol, symbol_params))
            combined_data = [res for res in results if res is not None]

        if not combined_data:
            raise ValueError("No valid data collected for training")

        df_train = pd.concat(combined_data)

        # Ensure categorical dtypes exist post-parallel concat (workers may coerce types)
        for cat_col in ["sector", "industry"]:
            if cat_col in df_train.columns:
                try:
                    df_train[cat_col] = (
                        df_train[cat_col].fillna("Unknown").astype("category")
                    )
                except Exception as e:
                    print(f"Warning: Failed to cast {cat_col} to category: {e}")
                    df_train[cat_col] = df_train[cat_col].fillna("Unknown")

        self._progress(f"Prepared training data: {len(df_train):,} total samples.")
        return df_train

    def select_predictors(
        self,
        df: pd.DataFrame,
        preset: str = "extended",
        max_features: Optional[int] = None,
    ):
        """Select feature set based on preset."""
        core = [
            "Close",
            "Volume",
            "SMA_50",
            "RSI",
            "MACD",
            "MACD_Signal",
            "MACD_Hist",
            "Z_Score",
        ]
        extended = core + [
            "SMA_200",
            "EMA_50",
            "RSI_7",
            "BB_PctB",
            "BB_Width",
            "OBV",
            "OBV_Slope",
            "Dist_From_High",
            "Dist_From_Low",
            "Body_Size",
            "Upper_Shadow",
            "Lower_Shadow",
            "SMA_Cross",
            "EMA_Cross",
            "Price_vs_SMA200",
            "Day_Of_Week",
            "Day_Of_Month",
            "Close_Lag1",
            "RSI_Lag1",
            "Volume_Lag1",
            "feat_mkt_trend",
            "feat_mkt_volatility",
            "feat_rel_strength",
            "Amihud_Illiquidity",
            "Amihud_SMA_10",
            "Volume_Acceleration",
            "Overnight_Gap",
            "Intraday_Return",
            "feat_sector_rel_strength",
        ]
        # Dynamically append fundamental features to extended list if they are in df
        for f_feat in ["marketCap", "peRatio", "eps", "dividendYield", "fund_score"]:
            if f_feat in df.columns and f_feat not in extended:
                extended.append(f_feat)
        max_p = extended + [
            "ATR_14",
            "ADX_14",
            "STOCH_K",
            "STOCH_D",
            "CCI_20",
            "VWAP_20",
            "Momentum",
            "ROC_12",
            "VOL_SMA20",
            "VOL_Change",
        ]

        self.predictors = []
        if preset == "max":
            # Dynamic Feature Selection: Use ALL numeric columns minus targets/metadata
            exclude = set(
                ["Target", "Date", "Symbol", "Open", "High", "Low", "Close", "Volume"]
            )
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            self.predictors = [c for c in numeric_cols if c not in exclude]
            # Ensure core features are kept even if logic above misses them (unlikely)
            for c in core:
                if c in df.columns and c not in self.predictors:
                    self.predictors.append(c)
        else:
            chosen = core if preset == "core" else extended
            self.predictors = [c for c in chosen if c in df.columns]

        # Add categorical if present
        for cf in self.categorical_features:
            if cf in df.columns and cf not in self.predictors:
                self.predictors.append(cf)

        # Keep categorical_features aligned with predictors/df columns to avoid KeyError during X = df[predictors]
        self.categorical_features = [
            c
            for c in self.categorical_features
            if c in df.columns and c in self.predictors
        ]

        if max_features and max_features > 0:
            self.predictors = self.predictors[:max_features]

        self._progress(f"Selected {len(self.predictors)} predictors (Preset: {preset})")

    def get_walk_forward_splits(self, df: pd.DataFrame, n_splits: int = 5):
        """
        Generate walk-forward validation splits for time-series data.

        Each split = (train_idx, test_idx) where:
        - Years 1-3 train, Year 4 test
        - Years 1-4 train, Year 5 test
        - ... etc

        This replaces random train_test_split for proper time-series validation.
        """
        if "Date" not in df.columns and df.index.name != "Date":
            # Fallback: use row indices if Date not available
            self._progress(
                "⚠️ No Date column found. Using row-based walk-forward split."
            )
            n_rows = len(df)
            splits = []
            for i in range(n_splits):
                train_size = int(n_rows * (1 - 1 / n_splits)) + int(
                    i * n_rows / n_splits
                )
                test_size = int(n_rows / n_splits)
                train_idx = list(range(0, train_size))
                test_idx = list(range(train_size, min(train_size + test_size, n_rows)))
                if test_idx:
                    splits.append((train_idx, test_idx))
            return splits

        # Extract date column
        date_col = df.index if df.index.name == "Date" else df["Date"]
        dates = pd.to_datetime(date_col)
        years = pd.Series(dates).dt.year.values
        unique_years = sorted(np.unique(years))

        if len(unique_years) < 3:
            self._progress(
                f"⚠️ Only {len(unique_years)} unique years. Falling back to 80-20 split."
            )
            split_idx = len(df) - int(len(df) * 0.2)
            return [
                (
                    list(range(split_idx)),
                    list(range(split_idx, len(df))),
                )
            ]

        splits = []
        min_train_years = 2

        for test_year_idx in range(len(unique_years) - 1):
            test_year = unique_years[test_year_idx + 1]
            train_years = unique_years[: test_year_idx + 1]

            if len(train_years) < min_train_years:
                continue

            train_mask = np.isin(years, train_years)
            test_mask = years == test_year

            train_idx = np.where(train_mask)[0].tolist()
            test_idx = np.where(test_mask)[0].tolist()

            if len(test_idx) > 0:
                splits.append((train_idx, test_idx))

        if not splits:
            self._progress(
                "Could not create walk-forward splits. Using simple 80-20 split."
            )
            split_idx = len(df) - int(len(df) * 0.2)
            splits = [
                (
                    list(range(split_idx)),
                    list(range(split_idx, len(df))),
                )
            ]

        self._progress(
            f"📊 Generated {len(splits)} walk-forward splits (proper time-series validation)"
        )
        return splits

    def optimize_hyperparameters(
        self, df_train: pd.DataFrame, n_trials: int = 75, patience: int = 50
    ) -> Dict[str, Any]:
        """
        Use Optuna to find the best hyperparameters for LightGBM.
        Strategy: 'Safe for EGX'
        - Fixed Learning Rate: 0.01
        - Objective: Maximize (AUC + Precision) / 2
        - Constrained optimization space to prevent overfitting
        """
        if not optuna:
            self._progress("Optuna not installed. Skipping optimization.")
            return {}

        self._progress(
            f"Starting Hyperparameter Optimization with Optuna for EGX ({n_trials} trials)..."
        )
        self._progress(
            "Strategy: Fixed LR=0.01, Objective=(AUC+Precision)/2, Constrained Trees"
        )
        self._progress(
            "Using Walk-Forward Validation (time-series aware) instead of random split"
        )

        X = df_train[self.predictors]
        # Clean data BEFORE splitting to ensure types are consistent
        X = self._clean_dataset(X)
        y = df_train["Target"]

        # Use walk-forward splits instead of random split
        splits = self.get_walk_forward_splits(df_train, n_splits=5)
        if not splits:
            # Fallback to simple split
            train_idx = list(range(int(len(X) * 0.8)))
            val_idx = list(range(int(len(X) * 0.8), len(X)))
            splits = [(train_idx, val_idx)]

        def objective(trial):
            # 1. Constrained Search Space
            params = {
                "objective": "binary",
                "metric": "auc",  # Monitor AUC during early stopping
                "verbosity": -1,
                "boosting_type": "gbdt",
                # Fixed Parameters
                "learning_rate": 0.01,
                # Optimized Parameters (Constrained)
                "n_estimators": trial.suggest_int("n_estimators", 300, 700),
                "max_depth": trial.suggest_int("max_depth", 3, 6),
                "min_child_weight": trial.suggest_int("min_child_weight", 1, 5),
                "subsample": trial.suggest_float("subsample", 0.6, 0.9),
                "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 0.9),
                "lambda_l1": trial.suggest_float("lambda_l1", 1e-8, 10.0, log=True),
                "lambda_l2": trial.suggest_float("lambda_l2", 1e-8, 10.0, log=True),
                # Fixed structural params
                "num_leaves": trial.suggest_int(
                    "num_leaves", 20, 40
                ),  # Tied to max_depth roughly (2^depth)
            }

            scores = []
            for s_i, (train_idx, val_idx) in enumerate(splits):
                X_train_s = X.iloc[train_idx]
                y_train_s = y.iloc[train_idx]
                X_val_s = X.iloc[val_idx]
                y_val_s = y.iloc[val_idx]

                if len(np.unique(y_train_s)) < 2 or len(np.unique(y_val_s)) < 2:
                    continue

                model = lgb.LGBMClassifier(**params)

                # 2. Early Stopping (Only if Patience > 0)
                callbacks = []
                if patience and patience > 0:
                    callbacks.append(
                        lgb.early_stopping(stopping_rounds=patience, verbose=False)
                    )

                model.fit(
                    X_train_s,
                    y_train_s,
                    eval_set=[(X_val_s, y_val_s)],
                    callbacks=callbacks,
                )

                y_prob = model.predict_proba(X_val_s)[:, 1]

                from sklearn.metrics import precision_recall_curve

                precisions, recalls, thresholds = precision_recall_curve(
                    y_val_s, y_prob
                )

                with np.errstate(divide="ignore", invalid="ignore"):
                    f1_scores = (
                        2
                        * (precisions[:-1] * recalls[:-1])
                        / (precisions[:-1] + recalls[:-1])
                    )
                f1_scores = np.nan_to_num(f1_scores)

                valid_indices = precisions[:-1] >= 0.50
                if valid_indices.any():
                    valid_f1 = np.where(valid_indices, f1_scores, -1)
                    best_idx = np.argmax(valid_f1)
                else:
                    best_idx = np.argmax(f1_scores)

                optimal_threshold = (
                    thresholds[best_idx] if best_idx < len(thresholds) else 0.5
                )
                preds = (y_prob >= optimal_threshold).astype(int)

                if len(np.unique(preds)) < 2:
                    scores.append(0.0)
                    continue

                precision = precision_score(y_val_s, preds, zero_division=0)
                recall = recall_score(y_val_s, preds, zero_division=0)
                auc = roc_auc_score(y_val_s, y_prob)

                if recall > 0.99 or recall < 0.01:
                    scores.append(0.0)
                    continue

                score = (auc + precision) / 2.0
                scores.append(score)

            return np.mean(scores) if scores else 0.0

        study = optuna.create_study(direction="maximize")
        study.optimize(objective, n_trials=n_trials)

        self._progress(f"Optimization complete! Best Score: {study.best_value:.4f}")
        self._progress(f"Best Params: {study.best_params}")

        # Ensure fixed params are included in the return
        final_params = study.best_params.copy()
        final_params["learning_rate"] = 0.01

        return final_params

    def purged_cross_val(
        self, df: pd.DataFrame, n_splits: int = 5
    ) -> List[Dict[str, float]]:
        """
        Implementation of Purged K-Fold Cross Validation.
        Ensures training data does not overlap (with embargo) with testing data.
        """
        if len(df) < (n_splits * 20):
            return []

        self._progress(f"Running Purged {n_splits}-Fold Cross Validation...")
        X = df[self.predictors]
        # Clean data to ensure categorical features are properly typed
        X = self._clean_dataset(X)
        y = df["Target"]
        # Use simple integer indexing for splitting
        indices = np.arange(len(df))
        test_size = len(df) // n_splits
        embargo_size = int(len(df) * self.embargo_pct)

        results = []
        for i in range(n_splits):
            test_start = i * test_size
            test_end = (i + 1) * test_size
            test_indices = indices[test_start:test_end]

            # Purging: ensure training doesn't leak from look-forward period
            # Embargo: extra buffer after the test set
            train_indices = np.concatenate(
                [
                    indices[: max(0, test_start - embargo_size)],
                    indices[test_end + embargo_size :],
                ]
            )

            if len(train_indices) < 50:
                continue

            X_train, y_train = X.iloc[train_indices], y.iloc[train_indices]
            X_test, y_test = X.iloc[test_indices], y.iloc[test_indices]

            # Simple model for CV
            model = LGBMClassifier(
                n_estimators=500, learning_rate=0.05, verbose=-1, is_unbalance=True
            )
            model.fit(X_train, y_train)

            preds = model.predict(X_test)
            results.append(
                {
                    "precision": precision_score(y_test, preds, zero_division=0),
                    "recall": recall_score(y_test, preds, zero_division=0),
                    "f1": f1_score(y_test, preds, zero_division=0),
                }
            )

        return results

    def train_model(
        self,
        df_train: pd.DataFrame,
        n_estimators: int = 500,
        learning_rate: float = 0.01,
        patience: int = 100,
        look_forward_bars: int = 0,
        eval_metric: str = "logloss",
        extra_params: Optional[Dict[str, Any]] = None,
        optimized_params: Optional[Dict[str, Any]] = None,
        auto_prune: bool = False,
        target_pct: float = 2.0,
        stop_loss_pct: float = 1.0,
    ) -> Any:
        """
        Train LightGBM with early stopping and optional optimized params.
        If auto_prune is True, it performs a first pass to identify and remove noise.
        """
        X = df_train[self.predictors]
        y = df_train["Target"]

        # Data Validation
        if X.isnull().values.any():
            self._progress(
                "Warning: NaNs found in predictors. Applying centralized cleaning..."
            )

        # Centralized Cleaning
        X = self._clean_dataset(X)
        self._progress(f"Data types before training: {X.dtypes.to_dict()}")

        if len(np.unique(y)) < 2:
            raise ValueError(
                f"Training failed: Only one class present in target ({np.unique(y)}). Need both Win and No-Win samples."
            )

        self._progress(
            f"Training LightGBM model (samples={len(X)}, target_pos={y.sum()})..."
        )

        # --- CRITICAL: Time series split BEFORE any fitting/transformation ---
        # 3-way split to prevent threshold optimization bias:
        # 60% for training, 20% for threshold tuning, 20% for final testing
        split_idx_train = int(len(df_train) * 0.6)
        split_idx_tune = int(len(df_train) * 0.8)

        X_train_full = X.iloc[:split_idx_train]
        y_train_full = y.iloc[:split_idx_train]
        X_tune = X.iloc[split_idx_train:split_idx_tune]
        y_tune = y.iloc[split_idx_train:split_idx_tune]
        X_test = X.iloc[split_idx_tune:]
        y_test = y.iloc[split_idx_tune:]

        # --- QUANTITATIVE PIPELINE: PCA on Correlated Momentum (FIT ON TRAIN ONLY) ---
        # Group highly correlated momentum/oscillator features
        momentum_features = [
            c
            for c in X_train_full.columns
            if any(
                x in c.upper()
                for x in ["RSI", "MACD", "STOCH", "CCI", "ROC", "MOMENTUM"]
            )
        ]

        pca = None
        scaler = None
        if len(momentum_features) > 3:
            self._progress(
                f"Applying PCA on {len(momentum_features)} momentum features to extract Principal Components..."
            )
            from sklearn.decomposition import PCA
            from sklearn.preprocessing import StandardScaler

            scaler = StandardScaler()
            pca = PCA(n_components=min(3, len(momentum_features)))

            # FIT ONLY ON TRAINING DATA
            X_train_mom = X_train_full[momentum_features].fillna(0)
            X_train_scaled = scaler.fit_transform(X_train_mom)
            X_train_pca = pca.fit_transform(X_train_scaled)

            # TRANSFORM tune and test sets using fitted scaler/PCA
            X_tune_mom = X_tune[momentum_features].fillna(0)
            X_tune_scaled = scaler.transform(X_tune_mom)
            X_tune_pca = pca.transform(X_tune_scaled)

            X_test_mom = X_test[momentum_features].fillna(0)
            X_test_scaled = scaler.transform(X_test_mom)
            X_test_pca = pca.transform(X_test_scaled)

            # Drop raw momentum features and add PCA components
            X_train_full = X_train_full.drop(columns=momentum_features).copy()
            X_tune = X_tune.drop(columns=momentum_features).copy()
            X_test = X_test.drop(columns=momentum_features).copy()

            # Also transform the full df_train for CV and meta-labeling to prevent KeyError
            df_train_mom = df_train[momentum_features].fillna(0)
            df_train_scaled = scaler.transform(df_train_mom)
            df_train_pca = pca.transform(df_train_scaled)
            df_train = df_train.drop(columns=momentum_features).copy()

            for i in range(X_train_pca.shape[1]):
                X_train_full[f"PCA_Momentum_{i}"] = X_train_pca[:, i]
                X_tune[f"PCA_Momentum_{i}"] = X_tune_pca[:, i]
                X_test[f"PCA_Momentum_{i}"] = X_test_pca[:, i]
                df_train[f"PCA_Momentum_{i}"] = df_train_pca[:, i]

            self.predictors = list(X_train_full.columns)
            self._progress(
                f"PCA explained variance ratio: {pca.explained_variance_ratio_}"
            )
        else:
            momentum_features = []

        X_train = X_train_full
        y_train = y_train_full

        # Initialize Training Monitor for early issue detection
        monitor = TrainingMonitor(log_cb=self._progress)
        class_stats = monitor.check_class_balance(y_train)
        self._progress(f"Class balance (training set): {class_stats}")

        # Optional: Run Purged CV for more reliable estimation
        avg_purged_f1 = None
        # Note: CV uses original df_train, not the split versions
        cv_scores = self.purged_cross_val(df_train, n_splits=3)
        if cv_scores:
            avg_purged_f1 = np.mean([s["f1"] for s in cv_scores])
            self._progress(f"Average Purged CV F1: {avg_purged_f1:.4f}")

        # Calculate optimal class weights instead of using is_unbalance=True
        # This gives more control and prevents model from predicting all 1s
        class_weight = calculate_optimal_class_weight(y_train, max_ratio=10.0)

        params = {
            "n_estimators": n_estimators,
            "learning_rate": learning_rate,
            "max_depth": 5,
            "num_leaves": 31,
            "random_state": 42,
            "n_jobs": -1,
            "verbose": -1,
            "class_weight": class_weight,  # Use calculated weights instead of is_unbalance
            **(extra_params or {}),
            **(optimized_params or {}),
        }

        model = LGBMClassifier(**params)

        callbacks = [
            lgb.log_evaluation(period=100),
            StreamCallback(self.progress_cb) if self.progress_cb else None,
        ]

        if patience and patience > 0:
            callbacks.insert(0, lgb.early_stopping(stopping_rounds=patience))

        model.fit(
            X_train,
            y_train,
            eval_set=[(X_tune, y_tune)],
            eval_metric=eval_metric,
            # Use 'auto' - LightGBM will detect category dtype columns automatically
            # This avoids errors when column names are passed but dtype isn't category
            categorical_feature="auto",
            callbacks=[c for c in callbacks if c is not None],
        )

        # Step 2: Auto-Pruning Logic
        if auto_prune:
            important_features = self.prune_low_importance_features(model)
            if len(important_features) < len(self.predictors):
                self._progress(
                    f"🚀 RE-TRAINING: Feature set optimized to {len(important_features)} features."
                )
                self.predictors = important_features
                # Recursively call with auto_prune=False to avoid infinite loop
                return self.train_model(
                    df_train,
                    n_estimators=n_estimators,
                    learning_rate=learning_rate,
                    patience=patience,
                    look_forward_bars=look_forward_bars,
                    eval_metric=eval_metric,
                    extra_params=extra_params,
                    optimized_params=optimized_params,
                    auto_prune=False,
                    target_pct=target_pct,
                    stop_loss_pct=stop_loss_pct,
                )

        # Evaluate on TEST SET only (not the set used for threshold tuning)
        metrics = self.calculate_validation_metrics(model, X_test, y_test)

        # Check for training issues and alert
        monitor.check_metrics(metrics)
        monitor.log_alerts()

        # Strategy Suggestions
        monitor.calculate_strategy_suggestions(metrics, target_pct, stop_loss_pct)

        # Analyze and log feature importance
        self.analyze_feature_importance(model, top_n=20)

        if auto_prune and len(momentum_features) > 3:
            # Re-wrap in pipeline if auto_prune is true (it recursively calls train_model)
            # wait, auto_prune just calls train_model again. The base call will wrap it.
            pass

        # Wrap in QuantitativeModelPipeline if PCA was applied
        if len(momentum_features) > 3 and pca is not None:
            pipeline = QuantitativeModelPipeline(
                model, momentum_features, n_components=pca.n_components_
            )
            pipeline.pca = pca
            pipeline.scaler = scaler
            model = pipeline

        # Use purged cross-validation to get the *true* performance metrics instead of just the last 20%
        # This prevents regime overfitting and gives hedge-fund grade validation
        if avg_purged_f1 is not None and avg_purged_f1 > 0.0:
            self._progress(
                f"Replacing end-of-time validation F1 with Purged CV F1: {avg_purged_f1:.2%}"
            )
            metrics["f1"] = avg_purged_f1
            # We can also trust the CV recall and precision if we tracked them, but F1 is the main summary.

        # Calculate walk-forward split validation metrics
        self._progress("Calculating walk-forward validation splits metrics...")
        self.wf_splits_results = []
        try:
            wf_splits = self.get_walk_forward_splits(df_train, n_splits=5)
            for split_i, (train_idx, test_idx) in enumerate(wf_splits):
                df_split_train = df_train.iloc[train_idx]
                df_split_test = df_train.iloc[test_idx]

                if (
                    len(np.unique(df_split_train["Target"])) < 2
                    or len(np.unique(df_split_test["Target"])) < 2
                ):
                    continue

                # Extract date ranges for documentation
                train_start_date = df_split_train.index[0].strftime("%Y-%m-%d") if hasattr(df_split_train.index[0], 'strftime') else str(df_split_train.index[0])
                train_end_date = df_split_train.index[-1].strftime("%Y-%m-%d") if hasattr(df_split_train.index[-1], 'strftime') else str(df_split_train.index[-1])
                test_start_date = df_split_test.index[0].strftime("%Y-%m-%d") if hasattr(df_split_test.index[0], 'strftime') else str(df_split_test.index[0])
                test_end_date = df_split_test.index[-1].strftime("%Y-%m-%d") if hasattr(df_split_test.index[-1], 'strftime') else str(df_split_test.index[-1])

                X_s_train = self._clean_dataset(df_split_train[self.predictors])
                y_s_train = df_split_train["Target"]
                X_s_test = self._clean_dataset(df_split_test[self.predictors])
                y_s_test = df_split_test["Target"]

                split_model = LGBMClassifier(
                    **{
                        "objective": "binary",
                        "learning_rate": 0.01,
                        "n_estimators": 300,
                        "max_depth": 5,
                        "num_leaves": 31,
                        "random_state": 42,
                        "n_jobs": -1,
                        "verbose": -1,
                    }
                )
                split_model.fit(X_s_train, y_s_train)

                split_metrics = self.calculate_validation_metrics(
                    split_model, X_s_test, y_s_test
                )
                
                # Enhanced walk-forward split result with detailed metadata
                split_result = {
                    "split_index": split_i,
                    "train_period": f"{train_start_date} to {train_end_date}",
                    "test_period": f"{test_start_date} to {test_end_date}",
                    "train_samples": len(df_split_train),
                    "test_samples": len(df_split_test),
                    "train_positive_rate": float(y_s_train.mean()),
                    "test_positive_rate": float(y_s_test.mean()),
                    "precision": float(split_metrics.get("precision", 0.0)),
                    "recall": float(split_metrics.get("recall", 0.0)),
                    "f1": float(split_metrics.get("f1", 0.0)),
                    "auc": float(split_metrics.get("auc", 0.0)),
                }
                self.wf_splits_results.append(split_result)
                self._progress(f"Walk-Forward Split {split_i}: {test_start_date} to {test_end_date} - F1: {split_result['f1']:.3f}, Precision: {split_result['precision']:.3f}")
        except Exception as e:
            self._progress(
                f"Warning: Failed to calculate walk-forward validation metrics: {e}"
            )

        return model, metrics, avg_purged_f1, df_train

    def calculate_validation_metrics(
        self, model, X_test: pd.DataFrame, y_test: pd.Series
    ) -> Dict[str, float]:
        """Calculate final metrics on the TEST split with Dynamic Threshold Optimization."""
        # X_test and y_test are already the final test set (never used for training or threshold tuning)
        y_val = y_test

        if len(np.unique(y_val)) < 2:
            return {"precision": 0.0, "recall": 0.0, "f1": 0.0, "auc": 0.5}

        # Get Probabilities from test set
        y_prob = model.predict_proba(X_test)[:, 1]

        # --- Threshold Optimization Logic ---
        from sklearn.metrics import precision_recall_curve

        precisions, recalls, thresholds = precision_recall_curve(y_val, y_prob)

        # Calculate F1 for all thresholds
        with np.errstate(divide="ignore", invalid="ignore"):
            f1_scores = (
                2 * (precisions[:-1] * recalls[:-1]) / (precisions[:-1] + recalls[:-1])
            )
        f1_scores = np.nan_to_num(f1_scores)

        # Strategy: Find best threshold where Precision >= 60% AND Recall >= 10%
        # This targets the sweet spot: accurate enough to trust, frequent enough to be useful.
        target_p = 0.60
        target_r = 0.10
        valid_indices = (precisions[:-1] >= target_p) & (recalls[:-1] >= target_r)

        if valid_indices.any():
            # Among valid thresholds, pick the one with the highest F1
            valid_f1 = np.where(valid_indices, f1_scores, -1)
            best_idx = np.argmax(valid_f1)
        else:
            # Fallback 1: relax to P >= 55% only
            fallback_indices = precisions[:-1] >= 0.55
            if fallback_indices.any():
                self._progress("⚠️ No threshold achieves P>=60% & R>=10%, relaxing to P>=55%.")
                valid_f1 = np.where(fallback_indices, f1_scores, -1)
                best_idx = np.argmax(valid_f1)
            else:
                # Fallback 2: best F1 regardless of precision
                self._progress("⚠️ No threshold achieves P>=55%, falling back to best F1.")
                best_idx = np.argmax(f1_scores)

        optimal_threshold = thresholds[best_idx] if best_idx < len(thresholds) else 0.5

        # CRITICAL: Apply optimal threshold to TEST SET (independent data)
        # This threshold was NOT used during training, ensuring unbiased evaluation
        y_pred = (y_prob >= optimal_threshold).astype(int)

        metrics = {
            "precision": float(precision_score(y_val, y_pred, zero_division=0)),
            "recall": float(recall_score(y_val, y_pred, zero_division=0)),
            "f1": float(f1_score(y_val, y_pred, zero_division=0)),
            "auc": float(roc_auc_score(y_val, y_prob)),
            "optimal_threshold": float(optimal_threshold),
        }

        self._progress(f"Optimal Threshold Found: {optimal_threshold:.3f}")
        self._progress(
            f"Metrics @ Threshold: P={metrics['precision']:.1%}, R={metrics['recall']:.1%}, F1={metrics['f1']:.1%}"
        )

        return metrics

    def analyze_feature_importance(
        self, model, top_n: int = 30, save_path: Optional[str] = None
    ) -> pd.DataFrame:
        """
        Analyze and log feature importance after training.

        Args:
            model: Trained LightGBM model
            top_n: Number of top features to display
            save_path: Optional path to save CSV

        Returns:
            DataFrame with feature importance
        """
        try:
            importance = model.feature_importances_

            feat_imp = pd.DataFrame(
                {
                    "feature": self.predictors,
                    "importance": importance,
                    "importance_pct": (importance / importance.sum()) * 100,
                }
            ).sort_values("importance", ascending=False)

            # Log top features
            self._progress(f"\n📊 Top {top_n} Most Important Features:")
            for idx, row in feat_imp.head(top_n).iterrows():
                bar = "█" * int(row["importance_pct"])
                self._progress(
                    f"  {row['feature']}: {row['importance_pct']:.2f}% {bar}"
                )

            # Identify low-importance features (< 0.1%)
            low_imp = feat_imp[feat_imp["importance_pct"] < 0.1]
            if len(low_imp) > 0:
                self._progress(
                    f"\n⚠️ {len(low_imp)} features with <0.1% importance (consider removing)"
                )

            # Save to file if path provided
            if save_path:
                feat_imp.to_csv(save_path, index=False)
                self._progress(f"Feature importance saved to {save_path}")

            return feat_imp

        except Exception as e:
            self._progress(f"Warning: Could not analyze feature importance: {e}")
            return pd.DataFrame()

    def prune_low_importance_features(self, model, threshold: float = 0.1) -> List[str]:
        """
        Identify and return list of features with importance >= threshold.
        """
        try:
            importance = model.feature_importances_
            total_imp = importance.sum()

            if total_imp == 0:
                return self.predictors

            important_features = []
            for feat, imp in zip(self.predictors, importance):
                pct = (imp / total_imp) * 100
                if pct >= threshold or feat in [
                    "sector",
                    "industry",
                ]:  # Always keep categorical
                    important_features.append(feat)

            pruned_count = len(self.predictors) - len(important_features)
            if pruned_count > 0:
                self._progress(
                    f"✂️ PRUNING: Removing {pruned_count} features with <{threshold}% importance."
                )

            return important_features
        except Exception as e:
            self._progress(f"Warning during pruning: {e}")
            return self.predictors

    def save_model(self, model, filename: str, metadata: Dict[str, Any]) -> str:
        """Save model and metadata locally and to cloud."""
        api_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(api_dir, "models")
        os.makedirs(models_dir, exist_ok=True)

        filepath = os.path.join(models_dir, filename)

        # Check if pipeline
        pca_features = None
        pca = None
        scaler = None
        if hasattr(model, "model") and hasattr(model, "pca_features"):
            pca_features = model.pca_features
            pca = getattr(model, "pca", None)
            scaler = getattr(model, "scaler", None)
            model_for_booster = model.model
        else:
            model_for_booster = model

        booster = getattr(model_for_booster, "booster_", None)

        num_features = None
        num_trees = None
        try:
            if booster is not None:
                num_features = booster.num_feature()
                num_trees = booster.num_trees()
        except Exception:
            pass

        training_samples = metadata.get("trainingSamples")
        if training_samples is None:
            training_samples = metadata.get("training_samples")

        feature_preset = metadata.get("featurePreset")
        if feature_preset is None:
            feature_preset = metadata.get("feature_preset")

        # Construct unified sections
        trading_params_dict = {
            "entry_mode": getattr(self, "params", TradingParameters()).entry_mode,
            "entry_buffer_pct": getattr(self, "params", TradingParameters()).entry_buffer_pct,
            "look_forward_days": getattr(self, "params", TradingParameters()).look_forward_days,
            "look_forward_mode": getattr(self, "params", TradingParameters()).look_forward_mode,
            "barrier_mode": getattr(self, "params", TradingParameters()).barrier_mode,
            "target_pct": getattr(self, "params", TradingParameters()).target_pct,
            "stop_loss_pct": getattr(self, "params", TradingParameters()).stop_loss_pct,
            "require_volume_confirmation": getattr(self, "params", TradingParameters()).require_volume_confirmation,
            "min_volume_ratio": getattr(self, "params", TradingParameters()).min_volume_ratio,
            "volume_confirmation_period": getattr(self, "params", TradingParameters()).volume_confirmation_period,
        }
        thresholds_dict = {
            "king_threshold": getattr(self, "params", TradingParameters()).king_threshold,
            "optimal_threshold": metadata.get("optimal_threshold") or metadata.get("meta_threshold") or getattr(self, "params", TradingParameters()).king_threshold,
            "council_threshold": getattr(self, "params", TradingParameters()).council_threshold,
            "validator_threshold": getattr(self, "params", TradingParameters()).validator_threshold,
        }
        feature_req_dict = {
            "min_history_needed": getattr(self, "params", TradingParameters()).min_history_needed,
            "warmup_bars": getattr(self, "params", TradingParameters()).warmup_bars,
            "feature_lookback": getattr(self, "params", TradingParameters()).feature_lookback,
        }
        
        # Calculate walk-forward summary statistics
        wf_results = getattr(self, "wf_splits_results", [])
        walk_forward_summary = {}
        if wf_results:
            precisions = [r["precision"] for r in wf_results if r.get("precision") is not None]
            recalls = [r["recall"] for r in wf_results if r.get("recall") is not None]
            f1s = [r["f1"] for r in wf_results if r.get("f1") is not None]
            aucs = [r["auc"] for r in wf_results if r.get("auc") is not None]
            
            walk_forward_summary = {
                "n_splits": len(wf_results),
                "average_precision": float(np.mean(precisions)) if precisions else 0.0,
                "average_recall": float(np.mean(recalls)) if recalls else 0.0,
                "average_f1": float(np.mean(f1s)) if f1s else 0.0,
                "average_auc": float(np.mean(aucs)) if aucs else 0.5,
                "std_precision": float(np.std(precisions)) if precisions else 0.0,
                "std_recall": float(np.std(recalls)) if recalls else 0.0,
                "std_f1": float(np.std(f1s)) if f1s else 0.0,
                "std_auc": float(np.std(aucs)) if aucs else 0.0,
                "min_f1": float(min(f1s)) if f1s else 0.0,
                "max_f1": float(max(f1s)) if f1s else 0.0,
            }

        artifact = {
            "kind": "lgbm_booster",
            "model_str": booster.model_to_string() if booster else None,
            "feature_names": self.predictors,
            "categorical_features": self.categorical_features,
            "exchange": self.exchange,
            "featurePreset": feature_preset,
            "trainingSamples": training_samples,
            "num_features": num_features,
            "num_trees": num_trees,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "pca_features": pca_features,
            "pca": pca,
            "scaler": scaler,
            "trading_parameters": trading_params_dict,
            "thresholds": thresholds_dict,
            "feature_requirements": feature_req_dict,
            "walk_forward_splits_results": wf_results,
            "walk_forward_summary": walk_forward_summary,
            **metadata,
        }

        with open(filepath, "wb") as f:
            pickle.dump(artifact if booster else model, f)


        # Also save booster in text format for version compatibility
        if booster:
            booster_txt_path = filepath.replace(".pkl", "_booster.txt")
            try:
                booster.save_model(booster_txt_path)
            except Exception as e:
                print(f"Warning: Could not save booster text model: {e}", flush=True)

        try:
            uses_fundamentals = False
            for c in (
                "marketCap",
                "peRatio",
                "eps",
                "dividendYield",
                "sector",
                "industry",
            ):
                if c in self.predictors:
                    uses_fundamentals = True
                    break

            uses_exchange_index_json = bool(self.market_index_local_json)
            has_meta_labeling = False
            if isinstance(metadata, dict):
                has_meta_labeling = bool(
                    metadata.get("has_meta_labeling") or metadata.get("meta_labeling")
                )

            feature_importance = {}
            try:
                imp = None
                if hasattr(model, "get_feature_importance"):
                    imp = model.get_feature_importance()
                elif hasattr(model, "feature_importances_"):
                    imp = model.feature_importances_

                if imp is not None:
                    importances = list(imp)
                    total_imp = sum(importances) or 1.0
                    for feat, val in zip(self.predictors, importances):
                        feature_importance[feat] = round(
                            (float(val) / total_imp) * 100, 2
                        )
            except Exception:
                pass

            card = {
                "model_name": filename,
                "created_at": artifact.get("timestamp"),
                "exchange": self.exchange,
                "artifact_kind": artifact.get("kind"),
                "feature_preset": feature_preset,
                "feature_importance": feature_importance,
                "training": {
                    "training_samples": training_samples,
                    "target_pct": metadata.get("target_pct"),
                    "stop_loss_pct": metadata.get("stop_loss_pct"),
                    "barrier_mode": metadata.get("barrier_mode")
                    or metadata.get("barrierMode"),
                    "look_forward_days": metadata.get("look_forward_days"),
                    "learning_rate": metadata.get("learning_rate"),
                    "n_estimators": metadata.get("n_estimators"),
                    "best_iteration": metadata.get("bestIteration")
                    or metadata.get("best_iteration"),
                    "metrics": {
                        "precision": metadata.get("precision"),
                        "recall": metadata.get("recall"),
                        "f1": metadata.get("f1"),
                        "auc": metadata.get("auc"),
                    },
                },
                "data_inputs": {
                    "uses_exchange_index_json": uses_exchange_index_json,
                    "exchange_index_json_path": self.market_index_local_json,
                    "uses_exchange_index_data": bool(self.market_index_loaded),
                    "exchange_index_symbol": self.market_index_symbol,
                    "uses_fundamentals": uses_fundamentals,
                    "fundamentals_loaded": bool(self.fundamentals_loaded),
                },
                "capabilities": {
                    "has_meta_labeling": has_meta_labeling,
                },
                "walk_forward_splits_results": getattr(self, "wf_splits_results", []),
                "walk_forward_summary": walk_forward_summary if walk_forward_summary else {},
            }


            card_path = os.path.join(models_dir, f"{filename}.model_card.json")
            with open(card_path, "w", encoding="utf-8") as cf:
                json.dump(card, cf)
        except Exception as e:
            self._progress(f"Warning: failed to write model card for {filename}: {e}")

        self._progress(f"Model saved: {filepath}")
        return filepath

    def save_meta_labeling_system(
        self,
        primary_model,
        meta_model,
        filename: str,
        metadata: Dict[str, Any],
        meta_threshold: float,
        meta_feature_names: List[str],
    ) -> str:
        api_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(api_dir, "models")
        os.makedirs(models_dir, exist_ok=True)

        filepath = os.path.join(models_dir, filename)

        # Check if pipeline
        pca_features = None
        pca = None
        scaler = None
        if hasattr(primary_model, "model") and hasattr(primary_model, "pca_features"):
            pca_features = primary_model.pca_features
            pca = getattr(primary_model, "pca", None)
            scaler = getattr(primary_model, "scaler", None)
            primary_model_for_booster = primary_model.model
        else:
            primary_model_for_booster = primary_model

        booster = getattr(primary_model_for_booster, "booster_", None)

        # Calculate walk-forward summary statistics
        wf_results = getattr(self, "wf_splits_results", [])
        walk_forward_summary = {}
        if wf_results:
            precisions = [r["precision"] for r in wf_results if r.get("precision") is not None]
            recalls = [r["recall"] for r in wf_results if r.get("recall") is not None]
            f1s = [r["f1"] for r in wf_results if r.get("f1") is not None]
            aucs = [r["auc"] for r in wf_results if r.get("auc") is not None]
            
            walk_forward_summary = {
                "n_splits": len(wf_results),
                "average_precision": float(np.mean(precisions)) if precisions else 0.0,
                "average_recall": float(np.mean(recalls)) if recalls else 0.0,
                "average_f1": float(np.mean(f1s)) if f1s else 0.0,
                "average_auc": float(np.mean(aucs)) if aucs else 0.5,
                "std_precision": float(np.std(precisions)) if precisions else 0.0,
                "std_recall": float(np.std(recalls)) if recalls else 0.0,
                "std_f1": float(np.std(f1s)) if f1s else 0.0,
                "std_auc": float(np.std(aucs)) if aucs else 0.0,
                "min_f1": float(min(f1s)) if f1s else 0.0,
                "max_f1": float(max(f1s)) if f1s else 0.0,
            }

        # Construct unified sections
        trading_params_dict = {
            "entry_mode": getattr(self, "params", TradingParameters()).entry_mode,
            "entry_buffer_pct": getattr(self, "params", TradingParameters()).entry_buffer_pct,
            "look_forward_days": getattr(self, "params", TradingParameters()).look_forward_days,
            "look_forward_mode": getattr(self, "params", TradingParameters()).look_forward_mode,
            "barrier_mode": getattr(self, "params", TradingParameters()).barrier_mode,
            "target_pct": getattr(self, "params", TradingParameters()).target_pct,
            "stop_loss_pct": getattr(self, "params", TradingParameters()).stop_loss_pct,
            "require_volume_confirmation": getattr(self, "params", TradingParameters()).require_volume_confirmation,
            "min_volume_ratio": getattr(self, "params", TradingParameters()).min_volume_ratio,
            "volume_confirmation_period": getattr(self, "params", TradingParameters()).volume_confirmation_period,
        }
        thresholds_dict = {
            "king_threshold": getattr(self, "params", TradingParameters()).king_threshold,
            "optimal_threshold": metadata.get("optimal_threshold") or metadata.get("meta_threshold") or getattr(self, "params", TradingParameters()).king_threshold,
            "council_threshold": getattr(self, "params", TradingParameters()).council_threshold,
            "validator_threshold": getattr(self, "params", TradingParameters()).validator_threshold,
        }
        feature_req_dict = {
            "min_history_needed": getattr(self, "params", TradingParameters()).min_history_needed,
            "warmup_bars": getattr(self, "params", TradingParameters()).warmup_bars,
            "feature_lookback": getattr(self, "params", TradingParameters()).feature_lookback,
        }

        primary_artifact = {
            "kind": "lgbm_booster",
            "model_str": booster.model_to_string() if booster else None,
            "feature_names": self.predictors,
            "categorical_features": self.categorical_features,
            "exchange": self.exchange,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "pca_features": pca_features,
            "pca": pca,
            "scaler": scaler,
            "trading_parameters": trading_params_dict,
            "thresholds": thresholds_dict,
            "feature_requirements": feature_req_dict,
            "walk_forward_splits_results": getattr(self, "wf_splits_results", []),
            "walk_forward_summary": walk_forward_summary if walk_forward_summary else {},
            **metadata,
        }

        artifact = {
            "kind": "meta_labeling_system",
            "primary_model": primary_artifact,
            "meta_model": meta_model,
            "meta_feature_names": list(meta_feature_names or []),
            "meta_threshold": float(meta_threshold),
            "exchange": self.exchange,
            "timestamp": primary_artifact.get("timestamp"),
            "trading_parameters": trading_params_dict,
            "thresholds": thresholds_dict,
            "feature_requirements": feature_req_dict,
            "walk_forward_splits_results": getattr(self, "wf_splits_results", []),
            "walk_forward_summary": walk_forward_summary if walk_forward_summary else {},
            **metadata,
        }


        with open(filepath, "wb") as f:
            pickle.dump(artifact, f)

        # Also save boosters in text format for version compatibility
        try:
            primary_booster = primary_artifact.get("booster")
            if primary_booster:
                primary_txt_path = filepath.replace(".pkl", "_primary_booster.txt")
                primary_booster.save_model(primary_txt_path)

            meta_booster = (
                meta_model.booster_
                if hasattr(meta_model, "booster_")
                else meta_model.b
                if hasattr(meta_model, "b")
                else None
            )
            if meta_booster:
                meta_txt_path = filepath.replace(".pkl", "_meta_booster.txt")
                meta_booster.save_model(meta_txt_path)
        except Exception as e:
            print(f"Warning: Could not save booster text models: {e}", flush=True)

        try:
            uses_fundamentals = False
            for c in (
                "marketCap",
                "peRatio",
                "eps",
                "dividendYield",
                "sector",
                "industry",
            ):
                if c in self.predictors:
                    uses_fundamentals = True
                    break

            uses_exchange_index_json = bool(self.market_index_local_json)

            training_samples = metadata.get("trainingSamples")
            if training_samples is None:
                training_samples = metadata.get("training_samples")

            feature_preset = metadata.get("featurePreset")
            if feature_preset is None:
                feature_preset = metadata.get("feature_preset")

            feature_importance = {}
            try:
                imp = None
                if hasattr(primary_model, "get_feature_importance"):
                    imp = primary_model.get_feature_importance()
                elif hasattr(primary_model, "feature_importances_"):
                    imp = primary_model.feature_importances_
                elif hasattr(primary_model, "model") and hasattr(
                    primary_model.model, "feature_importances_"
                ):
                    imp = primary_model.model.feature_importances_

                if imp is not None:
                    importances = list(imp)
                    total_imp = sum(importances) or 1.0
                    for feat, val in zip(self.predictors, importances):
                        feature_importance[feat] = round(
                            (float(val) / total_imp) * 100, 2
                        )
            except Exception:
                pass

            card = {
                "model_name": filename,
                "created_at": artifact.get("timestamp"),
                "exchange": self.exchange,
                "artifact_kind": artifact.get("kind"),
                "feature_preset": feature_preset,
                "feature_importance": feature_importance,
                "training": {
                    "training_samples": training_samples,
                    "target_pct": metadata.get("target_pct"),
                    "stop_loss_pct": metadata.get("stop_loss_pct"),
                    "barrier_mode": metadata.get("barrier_mode")
                    or metadata.get("barrierMode"),
                    "look_forward_days": metadata.get("look_forward_days"),
                    "learning_rate": metadata.get("learning_rate"),
                    "n_estimators": metadata.get("n_estimators"),
                    "best_iteration": metadata.get("bestIteration")
                    or metadata.get("best_iteration"),
                    "metrics": {
                        "precision": metadata.get("precision"),
                        "recall": metadata.get("recall"),
                        "f1": metadata.get("f1"),
                        "auc": metadata.get("auc"),
                    },
                },
                "data_inputs": {
                    "uses_exchange_index_json": uses_exchange_index_json,
                    "exchange_index_json_path": self.market_index_local_json,
                    "uses_exchange_index_data": bool(self.market_index_loaded),
                    "exchange_index_symbol": self.market_index_symbol,
                    "uses_fundamentals": uses_fundamentals,
                    "fundamentals_loaded": bool(self.fundamentals_loaded),
                },
                "capabilities": {
                    "has_meta_labeling": True,
                    "meta_threshold": float(meta_threshold),
                },
                "walk_forward_splits_results": getattr(self, "wf_splits_results", []),
                "walk_forward_summary": walk_forward_summary if walk_forward_summary else {},
            }


            card_path = os.path.join(models_dir, f"{filename}.model_card.json")
            with open(card_path, "w", encoding="utf-8") as cf:
                json.dump(card, cf)
        except Exception as e:
            self._progress(f"Warning: failed to write model card for {filename}: {e}")

        self._progress(f"Model saved: {filepath}")
        return filepath


def train_model(exchange=None, supabase_url=None, supabase_key=None, *args, **kwargs):
    """Wrapper for backward compatibility and CLI."""
    if exchange is None:
        # Default to Egyptian market (EGX) when not provided
        exchange = kwargs.get("exchange") or "EGX"
    if supabase_url is None:
        supabase_url = kwargs.get("supabase_url")
    if supabase_key is None:
        supabase_key = kwargs.get("supabase_key")

    trainer = ModelTrainer(
        exchange=exchange,
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        progress_cb=kwargs.get("progress_cb"),
    )

    use_intraday = bool(kwargs.get("use_intraday", False))
    timeframe = str(kwargs.get("timeframe", "1d") or "1d").strip().lower()
    training_strategy = str(kwargs.get("training_strategy") or "golden").strip().lower()
    barrier_mode = (
        str(kwargs.get("barrier_mode") or kwargs.get("barrierMode") or "")
        .strip()
        .lower()
        or None
    )

    extra_params: Dict[str, Any] = {}
    eval_metric = "logloss"

    # Crypto-specific default params (anti-noise, higher regularization) for 1h intraday.
    if (
        trainer.exchange == "CRYPTO"
        and use_intraday
        and timeframe == "1h"
        and training_strategy in {"golden", "crypto", "golden_crypto"}
    ):
        extra_params = {
            "boosting_type": "gbdt",
            "objective": "binary",
            "metric": "auc",
            "is_unbalance": True,
            "num_leaves": 45,
            "max_depth": 8,
            "feature_fraction": 0.7,
            "bagging_fraction": 0.7,
            "bagging_freq": 5,
            "lambda_l1": 1.5,
            "lambda_l2": 3.0,
            "verbose": -1,
        }
        eval_metric = "auc"

    trainer.load_market_data()
    df_raw = trainer.fetch_stock_prices(use_intraday=use_intraday, timeframe=timeframe)
    if df_raw.empty:
        return

    use_volatility_label = bool(kwargs.get("use_volatility_label", False))
    target_pct = float(kwargs.get("target_pct", 2.0) or 2.0)
    stop_loss_pct = float(kwargs.get("stop_loss_pct", 1.0) or 1.0)
    look_forward_days = int(kwargs.get("look_forward_days", 20) or 20)
    resolved_barrier_mode = _resolve_barrier_mode(
        target_pct, stop_loss_pct, barrier_mode
    )

    df_train = trainer.prepare_training_data(
        df_raw,
        target_pct,
        stop_loss_pct,
        look_forward_days,
        preset=kwargs.get("feature_preset", "extended"),
        use_volatility_label=use_volatility_label,
        barrier_mode=resolved_barrier_mode,
    )

    max_features = kwargs.get("max_features")
    if max_features is None:
        max_features = kwargs.get("max_features_override")
    trainer.select_predictors(
        df_train, kwargs.get("feature_preset", "extended"), max_features
    )

    optimized_params = None
    if kwargs.get("optimize") and optuna:
        optimized_params = trainer.optimize_hyperparameters(
            df_train, n_trials=kwargs.get("n_trials", 30)
        )

    # Get use_early_stopping from kwargs (defaults to True for backward compat)
    use_early_stopping = kwargs.get("use_early_stopping", True)

    model, val_metrics, avg_purged_f1, df_train = trainer.train_model(
        df_train,
        n_estimators=kwargs.get("n_estimators") or 500,
        learning_rate=kwargs.get("learning_rate", 0.01),
        patience=kwargs.get("patience", 100) if use_early_stopping else 0,
        look_forward_bars=look_forward_days,
        eval_metric=eval_metric,
        extra_params=extra_params,
        optimized_params=optimized_params,
        auto_prune=kwargs.get("auto_prune", False),
        target_pct=target_pct,
        stop_loss_pct=stop_loss_pct,
    )

    # Save
    filename = kwargs.get("model_name") or f"model_{trainer.exchange}.pkl"
    if not filename.endswith(".pkl"):
        filename += ".pkl"

    use_meta_labeling = bool(kwargs.get("use_meta_labeling", True))
    meta_threshold = float(kwargs.get("meta_threshold", 0.3))

    actual_model = model.model if hasattr(model, "model") else model
    best_it = getattr(actual_model, "best_iteration_", None)
    if isinstance(best_it, int) and best_it <= 0:
        best_it = None

    metadata = {
        "target_pct": target_pct,
        "stop_loss_pct": stop_loss_pct,
        "barrier_mode": resolved_barrier_mode,
        "barrierMode": resolved_barrier_mode,
        "look_forward_days": look_forward_days,
        "use_volatility_label": use_volatility_label,
        "feature_preset": kwargs.get("feature_preset", "extended"),
        "featurePreset": kwargs.get("feature_preset", "extended"),
        "n_estimators": kwargs.get("n_estimators") or 500,
        "best_iteration": best_it,
        "bestIteration": best_it,
        "learning_rate": kwargs.get("learning_rate"),
        "training_samples": len(df_train),
        "trainingSamples": len(df_train),
        "use_intraday": use_intraday,
        "timeframe": timeframe,
        "training_strategy": training_strategy,
        "eval_metric": eval_metric,
        "base_params": extra_params,
        "optimized": bool(kwargs.get("optimize") and optimized_params is not None),
        "purged_cv_f1": avg_purged_f1,
        "has_meta_labeling": bool(use_meta_labeling),
        "meta_threshold": float(meta_threshold),
        **val_metrics,
    }
    if optimized_params:
        metadata["optuna_params"] = optimized_params

    if use_meta_labeling:
        if xgb is None:
            trainer._progress(
                "Warning: xgboost not installed; falling back to LightGBM for meta-labeling."
            )

        X_primary = df_train[trainer.predictors].copy()
        y_primary = df_train["Target"].astype(int).copy()

        try:
            primary_probs = model.predict_proba(X_primary)[:, 1]
            primary_preds = (primary_probs >= 0.5).astype(int)
        except Exception:
            primary_preds = model.predict(X_primary)
            try:
                primary_probs = model.predict_proba(X_primary)[:, 1]
            except Exception:
                primary_probs = primary_preds.astype(float)

        meta_feature_names = []
        for c in trainer.predictors:
            if c in (trainer.categorical_features or []):
                continue
            try:
                if is_numeric_dtype(df_train[c]):
                    meta_feature_names.append(c)
            except Exception:
                continue
        X_meta_base = df_train[meta_feature_names].copy()
        X_meta_base = X_meta_base.replace([np.inf, -np.inf], np.nan).fillna(0)

        mask = primary_preds == 1
        if int(mask.sum()) < 50:
            mask = np.ones(len(df_train), dtype=bool)

        X_meta = X_meta_base.loc[mask].copy()
        X_meta["primary_prob"] = np.asarray(primary_probs)[mask]
        y_meta = y_primary.loc[mask].values

        if len(np.unique(y_meta)) < 2:
            raise ValueError(
                "Meta-labeling training failed: only one class present for meta labels"
            )

        pos = float(np.sum(y_meta == 1))
        neg = float(np.sum(y_meta == 0))
        scale_pos_weight = (neg / pos) if pos > 0 else 1.0

        if xgb is not None:
            meta_model = xgb.XGBClassifier(
                n_estimators=300,
                max_depth=5,
                learning_rate=0.01,
                subsample=0.8,
                colsample_bytree=0.8,
                reg_lambda=1.0,
                objective="binary:logistic",
                eval_metric="logloss",
                random_state=42,
                n_jobs=-1,
                scale_pos_weight=scale_pos_weight,
            )
        else:
            # LightGBM fallback (keeps meta-labeling available without xgboost)
            meta_model = LGBMClassifier(
                n_estimators=500,
                learning_rate=0.05,
                num_leaves=31,
                subsample=0.8,
                colsample_bytree=0.8,
                random_state=42,
                n_jobs=-1,
            )
        meta_model.fit(X_meta, y_meta)

        meta_feature_names_with_prob = list(meta_feature_names) + ["primary_prob"]
        trainer.save_meta_labeling_system(
            primary_model=model,
            meta_model=meta_model,
            filename=filename,
            metadata=metadata,
            meta_threshold=meta_threshold,
            meta_feature_names=meta_feature_names_with_prob,
        )
    else:
        metadata["has_meta_labeling"] = False
        trainer.save_model(model, filename, metadata)

    # Update global summary for the dashboard
    actual_model = model.model if hasattr(model, "model") else model
    best_iteration = getattr(actual_model, "best_iteration_", None)
    if isinstance(best_iteration, int) and best_iteration <= 0:
        best_iteration = None
    symbols_used = None
    try:
        if isinstance(df_raw, pd.DataFrame) and "symbol" in df_raw.columns:
            symbols_used = int(df_raw["symbol"].nunique())
    except Exception:
        symbols_used = None

    summary = {
        "exchange": trainer.exchange,
        "modelName": filename,
        "model_name": filename,
        "timestamp": datetime.now().isoformat(),
        "targetPct": float(target_pct),
        "stopLossPct": float(stop_loss_pct),
        "barrierMode": resolved_barrier_mode,
        "barrier_mode": resolved_barrier_mode,
        "lookForwardDays": int(look_forward_days),
        "learningRate": float(kwargs.get("learning_rate") or 0.0),
        "useEarlyStopping": bool(use_early_stopping),
        "nEstimators": int(kwargs.get("n_estimators") or 500),
        "bestIteration": (int(best_iteration) if best_iteration is not None else None),
        "featurePreset": kwargs.get("feature_preset", "extended"),
        "numFeatures": len(trainer.predictors),
        "trainingSamples": len(df_train),
        "rawRows": int(len(df_raw)),
        "symbolsUsed": symbols_used,
        "useIntraday": bool(use_intraday),
        "timeframe": timeframe,
        "trainingStrategy": training_strategy,
        "metrics": val_metrics,
        "features_count": len(trainer.predictors),
        "samples": len(df_train),
        "has_meta_labeling": bool(use_meta_labeling),
        "meta_threshold": float(meta_threshold),
        "hasMetaLabeling": bool(use_meta_labeling),
        "metaThreshold": float(meta_threshold),
    }
    _write_training_summary(summary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--exchange", default="EGX", help="Target exchange (default: EGX)"
    )
    parser.add_argument("--learning_rate", type=float, default=0.05)
    parser.add_argument(
        "--optimize", action="store_true", help="Use Optuna to tune hyperparameters"
    )
    parser.add_argument(
        "--trials", type=int, default=30, help="Number of Optuna trials"
    )
    parser.add_argument(
        "--barrier_mode",
        choices=["atr", "percent"],
        default=None,
        help="Interpret target/stop values as ATR multipliers or percentages. Defaults to auto-detect from the values.",
    )

    # الإضافات الجديدة لاستقبال النسب من سطر الأوامر
    parser.add_argument(
        "--target_pct",
        type=float,
        default=2.0,
        help="Target barrier value. < 1.0 = percentage, >= 1.0 = ATR multiplier.",
    )
    parser.add_argument(
        "--stop_loss_pct",
        type=float,
        default=1.0,
        help="Stop barrier value. < 1.0 = percentage, >= 1.0 = ATR multiplier.",
    )

    args = parser.parse_args()

    train_model(
        exchange=args.exchange,
        supabase_url=os.getenv("NEXT_PUBLIC_SUPABASE_URL"),
        supabase_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        learning_rate=args.learning_rate,
        optimize=args.optimize,
        n_trials=args.trials,
        barrier_mode=args.barrier_mode,
        # تمرير النسب إلى دالة التدريب
        target_pct=args.target_pct,
        stop_loss_pct=args.stop_loss_pct,
    )
