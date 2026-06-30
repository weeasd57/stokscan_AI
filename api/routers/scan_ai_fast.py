import os
import pickle
import time
import datetime
import random
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query

from api.symbols_local import load_symbols_for_country
from api import stock_ai
from api.acceleration_score import (
    calculate_acceleration_score,
    calculate_dynamic_risk,
    calculate_momentum_sentiment,
)
from api.stock_ai import (
    _get_exchange_bulk_data,
    _get_data_with_indicators_cached,
    _get_massive_features_cached,
    _get_model_cached,
    _set_model_cache,
    _ensure_feature_columns,
    add_technical_indicators,
    add_trade_levels,
    get_distribution_gate,
    prepare_for_ai,
    get_top_reasons,
    LGBM_PREDICTORS,
    RF_PREDICTORS,
    _PcaTransformer,
    _LgbmBoosterClassifier,
    _MetaLabelingClassifier,
)
from api.train_exchange_model import add_massive_features, add_market_context
from api.council import TheCouncil
from api.council_validator import CouncilValidator, load_council_validator_from_path
from api.market_status_gate import should_reject_new_buys

router = APIRouter(prefix="/scan/fast", tags=["scan-fast"])

# Number of parallel workers for feature calculation
MAX_WORKERS = 4

# Fundamentals cache (per exchange)
_FUNDAMENTALS_CACHE: Dict[str, Dict[str, Any]] = {}
_FUNDAMENTALS_CACHE_TTL_SECONDS = 900


def _normalize_exchange(value: str) -> str:
    ex = (value or "").strip().upper()
    if not ex:
        return ex
    for sep in ("(", " ", "/"):
        if sep in ex:
            ex = ex.split(sep)[0].strip()
    return ex


def _get_exchange_fundamentals_map(exchange: str) -> Dict[str, Dict[str, Any]]:
    stock_ai._init_supabase()
    sb = stock_ai.supabase
    if not sb:
        return {}
    ex = _normalize_exchange(exchange)
    if not ex:
        return {}
    now = time.time()
    debug_on = os.getenv("DEBUG_FUNDAMENTALS") == "1"
    cached = _FUNDAMENTALS_CACHE.get(ex)
    
    if cached and (now - cached.get("ts", 0) < _FUNDAMENTALS_CACHE_TTL_SECONDS) and not debug_on:
        return cached.get("data", {})
    if cached and debug_on:
        print(f"DEBUG FUND: cache bypass for {ex} (cached rows={len(cached.get('data', {}))})")

    try:
        if debug_on:
            try:
                url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or ""
                host = url.replace("https://", "").replace("http://", "").split("/")[0]
                res_count = sb.table("stock_fundamentals").select("symbol", count="exact").limit(1).execute()
                print(f"DEBUG FUND: table count={getattr(res_count, 'count', None)} host={host}")
            except Exception as e:
                print(f"DEBUG FUND: count query failed: {e}")

        res = (
            sb.table("stock_fundamentals")
            .select("symbol, exchange, data, fund_score")
            .filter("exchange", "ilike", f"%{ex}%")
            .limit(5000)
            .execute()
        )
        rows = res.data or []
        if debug_on:
            sample = [str(r.get("exchange")) for r in rows[:10]]
            print(f"DEBUG FUND: query ilike(%{ex}%) rows={len(rows)} sample_ex={sample}")
        if not rows:
            if debug_on:
                print(f"DEBUG FUND: no rows for exchange={ex}, trying fallback without filter")
            res = sb.table("stock_fundamentals").select("symbol, exchange, data, fund_score").execute()
            rows = res.data or []
            if debug_on:
                sample_ex = [str(r.get("exchange")) for r in rows[:10]]
                print(f"DEBUG FUND: fallback rows={len(rows)} sample_ex={sample_ex}")

        fmap: Dict[str, Dict[str, Any]] = {}
        if debug_on and rows:
            sample_ex = sorted({str(r.get("exchange") or "").strip() for r in rows[:50]})
            print(f"DEBUG FUND: sample exchanges (first 50 rows)={sample_ex}")

        for row in rows:
            row_ex = _normalize_exchange(str(row.get("exchange") or ""))
            if row_ex != ex:
                continue
            symbol = (row.get("symbol") or "").upper()
            if not symbol:
                continue
            data = row.get("data") or {}
            if isinstance(data, str):
                try:
                    import json
                    data = json.loads(data)
                except Exception:
                    data = {}
            col_fund_score = row.get("fund_score")
            fmap[symbol] = {
                "peRatio": data.get("peRatio"),
                "eps": data.get("eps"),
                "dividendYield": data.get("dividendYield"),
                "marketCap": data.get("marketCap"),
                "fund_score": col_fund_score if col_fund_score is not None else data.get("fund_score") or data.get("fundamental_score"),
            }
        _FUNDAMENTALS_CACHE[ex] = {"ts": now, "data": fmap}
        return fmap
    except Exception as e:
        print(f"DEBUG FUND: fundamentals fetch failed for {ex}: {e}")
        return {}


class FastScanResult(Dict[str, Any]):
    pass


def _load_model(model_name: str):
    """Load a model artifact, supporting meta_labeling_system, lgbm_booster, and legacy formats.
    Uses the same loading logic as stock_ai.py to ensure PCA support.
    """
    models_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models"))
    model_path = model_name if os.path.isabs(model_name) else os.path.join(models_dir, model_name)

    cached = _get_model_cached(model_path)
    if cached:
        return cached

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}")
    with open(model_path, "rb") as f:
        artifact = pickle.load(f)

    predictors: Optional[List[str]] = None
    is_lgbm = False
    model = artifact

    try:
        import lightgbm as lgb
        import xgboost as xgb_mod
    except Exception:
        lgb = None
        xgb_mod = None

    # ── meta_labeling_system artifact (NEW format) ──────────────────────────
    if isinstance(artifact, dict) and artifact.get("kind") == "meta_labeling_system":
        if lgb is None:
            raise ValueError("lightgbm is required to load meta_labeling_system artifacts")

        primary_art = artifact.get("primary_model")
        if not isinstance(primary_art, dict) or primary_art.get("kind") != "lgbm_booster":
            raise ValueError("Invalid meta_labeling_system artifact: missing primary_model")

        model_str = primary_art.get("model_str")
        if not isinstance(model_str, str) or not model_str.strip():
            raise ValueError("Invalid meta_labeling_system artifact: missing primary model_str")

        booster = lgb.Booster(model_str=model_str)

        # PCA extraction
        pca = primary_art.get("pca")
        scaler = primary_art.get("scaler")
        pca_features = primary_art.get("pca_features")
        pca_transformer = None
        if pca is not None and scaler is not None and pca_features:
            pca_transformer = _PcaTransformer(pca, scaler, pca_features)

        primary_clf = _LgbmBoosterClassifier(booster, 0.5, pca_transformer=pca_transformer)

        f_names = primary_art.get("feature_names")
        if isinstance(f_names, list) and f_names:
            if pca_features:
                predictors = [c for c in f_names if not c.startswith("PCA_Momentum_")] + list(pca_features)
            else:
                predictors = f_names
        else:
            try:
                predictors = list(booster.feature_name())
            except Exception:
                predictors = LGBM_PREDICTORS

        meta_model = artifact.get("meta_model")
        meta_feature_names = artifact.get("meta_feature_names") or []
        meta_threshold = artifact.get("meta_threshold", 0.7)

        model = _MetaLabelingClassifier(primary_clf, meta_model, meta_feature_names, meta_threshold)
        is_lgbm = True

    # ── lgbm_booster artifact ────────────────────────────────────────────────
    elif isinstance(artifact, dict) and artifact.get("kind") == "lgbm_booster":
        if lgb is None:
            raise ValueError("lightgbm is required to load lgbm_booster artifacts")

        model_str = artifact.get("model_str")
        if not isinstance(model_str, str) or not model_str.strip():
            raise ValueError("Invalid lgbm_booster artifact: missing model_str")

        booster = lgb.Booster(model_str=model_str)

        # PCA extraction
        pca = artifact.get("pca")
        scaler = artifact.get("scaler")
        pca_features = artifact.get("pca_features")
        pca_transformer = None
        if pca is not None and scaler is not None and pca_features:
            pca_transformer = _PcaTransformer(pca, scaler, pca_features)

        threshold = artifact.get("threshold", 0.5)
        model = _LgbmBoosterClassifier(
            booster,
            threshold if isinstance(threshold, (int, float)) else 0.5,
            pca_transformer=pca_transformer
        )
        is_lgbm = True

        f_names = artifact.get("feature_names")
        if isinstance(f_names, list) and f_names:
            if pca_features:
                predictors = [c for c in f_names if not c.startswith("PCA_Momentum_")] + list(pca_features)
            else:
                predictors = f_names
        else:
            try:
                predictors = list(booster.feature_name())
            except Exception:
                predictors = LGBM_PREDICTORS

    # ── legacy dict with primary_model key ──────────────────────────────────
    elif isinstance(artifact, dict) and "primary_model" in artifact:
        predictors = artifact.get("predictors")
        is_lgbm = artifact.get("is_lgbm", False)
        artifact = artifact["primary_model"]
        model = artifact

    # ── standard sklearn-like object ────────────────────────────────────────
    else:
        try:
            is_lgbm = lgb is not None and (
                isinstance(artifact, lgb.Booster) or "lightgbm" in type(artifact).__module__
            )
        except Exception:
            is_lgbm = False

        if hasattr(artifact, "feature_names_"):
            predictors = list(getattr(artifact, "feature_names_") or [])
        if predictors is None and hasattr(artifact, "feature_name_"):
            predictors = list(getattr(artifact, "feature_name_"))
        if predictors is None and hasattr(artifact, "feature_names_in_"):
            predictors = list(getattr(artifact, "feature_names_in_"))
        if predictors is None and hasattr(artifact, "predictors"):
            try:
                predictors = list(getattr(artifact, "predictors"))
            except Exception:
                predictors = None

    # Extract optimal_threshold_by_regime from artifact if present
    optimal_threshold_by_regime = None
    if isinstance(artifact, dict):
        optimal_threshold_by_regime = artifact.get("optimal_threshold_by_regime")

    # Final fallback to defaults
    if predictors is None or len(predictors) == 0:
        predictors = LGBM_PREDICTORS if is_lgbm else RF_PREDICTORS

    if optimal_threshold_by_regime is not None and model is not None:
        try:
            model.optimal_threshold_by_regime = optimal_threshold_by_regime
        except Exception:
            pass

    _set_model_cache(model_path, model, predictors, is_lgbm)
    return _get_model_cached(model_path)


class _BoosterWrapper:
    """Wrapper to give LightGBM Booster a sklearn-like predict interface."""
    def __init__(self, booster, threshold: float = 0.45): # Match stock_ai
        self.booster = booster
        self.threshold = threshold

    def predict(self, X):
        import numpy as np
        raw = self.booster.predict(X)
        return (np.asarray(raw) >= self.threshold).astype(int)

    @property
    def feature_importances_(self):
        try:
            return self.booster.feature_importance()
        except Exception:
            return []

    def predict_proba(self, X):
        import numpy as np
        raw = self.booster.predict(X)
        probs = np.asarray(raw)
        # Return 2-column format: [prob_class_0, prob_class_1]
        return np.column_stack([1 - probs, probs])


def _is_stock_active(df: pd.DataFrame, max_stale_days: int = 30) -> Tuple[bool, str]:
    """
    Check if a stock is still actively trading based on recent price data.
    Returns (is_active, reason).
    """
    if df is None or df.empty:
        return False, "No price data"

    last_row = df.iloc[-1]
    last_close = float(last_row.get("Close", last_row.get("close", 0)))
    if last_close <= 0:
        return False, f"Last close is zero ({last_close})"

    # Check last date
    last_date = None
    if isinstance(df.index, pd.DatetimeIndex):
        last_date = df.index[-1]
    elif "date" in df.columns:
        last_date = pd.to_datetime(df["date"].iloc[-1], errors="coerce")
    elif "timestamp" in df.columns:
        last_date = pd.to_datetime(df["timestamp"].iloc[-1], errors="coerce")

    if last_date is not None:
        days_since = (pd.Timestamp.now() - last_date).days
        if days_since > max_stale_days:
            return False, f"Last data {days_since} days ago (>{max_stale_days})"

    # Check recent volume (last 5 days)
    recent_volume = df.tail(5).get("Volume", df.tail(5).get("volume", pd.Series([0])))
    recent_volume = pd.to_numeric(recent_volume, errors="coerce").fillna(0)
    if recent_volume.sum() == 0:
        return False, "Zero trading volume in last 5 days"

    return True, "Active"


def _process_symbol(
    sym: str,
    ex: str,
    name: str,
    df,
    model,
    predictors: List[str],
    min_precision: float,
    target_pct: float = 2.0,
    stop_loss_pct: float = 1.0,
    look_forward_days: int = 20,
    buy_threshold: float = 0.45,
    fundamentals_map: Optional[Dict[str, Dict[str, Any]]] = None,
    council: Optional[TheCouncil] = None,
    market_df: Optional[pd.DataFrame] = None,
    validator: Optional[CouncilValidator] = None,
    sector_returns_df: Optional[pd.DataFrame] = None,
) -> Optional[Dict[str, Any]]:
    """Process a single symbol - called in parallel."""
    try:
        raw = df
        if len(raw) > 500:
            raw = raw.iloc[-500:].copy()

        # 🚫 Skip delisted/suspended stocks
        is_active, reason = _is_stock_active(raw)
        if not is_active:
            return None
        
        # 1. Technical Indicators (Fast + Massive) - Using Cached Versions
        feat = _get_data_with_indicators_cached(sym, ex or "EGX", raw, add_technical_indicators)
        
        # Merge fundamentals and sector returns BEFORE massive features to match training pipeline
        feat['symbol'] = sym
        symbol_sector = "Unknown"
        if fundamentals_map:
            fund = fundamentals_map.get(sym.upper()) or fundamentals_map.get(sym)
            if fund:
                # Map fundamentals to columns expected by the models (assign to reduce fragmentation)
                fund_data = {key: fund.get(key) for key in ["peRatio", "eps", "dividendYield", "marketCap", "fund_score"]}
                feat = feat.assign(**fund_data)
                symbol_sector = fund.get("sector", "Unknown") or "Unknown"
        
        feat["sector"] = symbol_sector
        
        if sector_returns_df is not None and not sector_returns_df.empty:
            sec_df = sector_returns_df[sector_returns_df["sector"] == symbol_sector]
            if not sec_df.empty:
                sec_df = sec_df.rename(columns={"daily_return": "sector_avg_return"}).copy()
                
                feat = feat.reset_index()
                idx_col = "timestamp" if "timestamp" in feat.columns else "date" if "date" in feat.columns else "index"
                if idx_col in feat.columns:
                    feat["date_only"] = pd.to_datetime(feat[idx_col]).dt.date
                    feat = feat.merge(sec_df[["date_only", "sector_avg_return"]], on="date_only", how="left")
                    feat = feat.drop(columns=["date_only"])
                    feat = feat.set_index(idx_col)
                else:
                    feat["date_only"] = pd.to_datetime(feat.index).dt.date
                    feat = feat.merge(sec_df[["date_only", "sector_avg_return"]], on="date_only", how="left")
                    feat = feat.drop(columns=["date_only"])

        feat = _get_massive_features_cached(sym, ex or "EGX", feat)

        # 2. Market Context
        if market_df is not None:
            feat = add_market_context(feat, market_df)
        
        # 4. Labeling & Candidate Prep
        candidate = prepare_for_ai(feat, target_pct=target_pct, stop_loss_pct=stop_loss_pct, look_forward_days=look_forward_days, drop_labels=False)
        
        if len(candidate) < 60:
            return None
        
        # We only care about the last row for the real-time scan
        candidate = candidate.iloc[[-1]].copy()

        _ensure_feature_columns(candidate, predictors)
        available_predictors = [p for p in predictors if p in candidate.columns]

        if os.getenv("DEBUG_FUNDAMENTALS") == "1" and random.random() < 0.02:
            r = candidate.iloc[0]
            sample = {
                "peRatio": r.get("peRatio") if "peRatio" in r else None,
                "eps": r.get("eps") if "eps" in r else None,
                "dividendYield": r.get("dividendYield") if "dividendYield" in r else None,
                "marketCap": r.get("marketCap") if "marketCap" in r else None,
                "fund_score": r.get("fund_score") if "fund_score" in r else None,
            }
            present = [k for k, v in sample.items() if v not in (None, "", 0, 0.0)]
            print(f"DEBUG FUND: {sym}.{ex} present={present} sample={sample}")
        
        if not available_predictors:
            return None
        
        prob = None
        if hasattr(model, "predict_proba"):
            try:
                prob = float(model.predict_proba(candidate[available_predictors])[0][1])
                pred = 1 if prob >= buy_threshold else 0
            except Exception:
                pred = int(model.predict(candidate[available_predictors])[0])
        else:
            pred = int(model.predict(candidate[available_predictors])[0])
        
        precision = prob if prob is not None else 0.5

        # Optional validator gating (trained on base-model BUY candidates)
        validator_score = None
        if validator is not None and precision is not None:
            try:
                import numpy as np

                validator_score = float(
                    validator.predict_proba(candidate, primary_conf=np.asarray([float(precision)]))[0][1]
                )
            except Exception:
                validator_score = None
        
        # Phase 2: Council Filtering
        council_score = 0.0
        consensus_ratio = ""
        detailed_votes = {}
        if council:
            # get_consensus returns a numpy array for each row
            scores = council.get_consensus(candidate)
            if len(scores) > 0:
                council_score = float(scores[0])
            
            votes = council.get_detailed_votes(candidate)
            detailed_votes = {m: float(v[0]) for m, v in votes.items() if len(v) > 0}
            
            # Consensus Ratio string e.g. "2/4"
            passing_votes = sum(1 for v in detailed_votes.values() if v >= 0.55)
            total_voters = len(detailed_votes)
            consensus_ratio = f"{passing_votes}/{total_voters}"

        # Debug logging for BUY predictions or interesting scores
        if pred == 1 or council_score > 0.4:
            debug_msg = f"DEBUG SCAN: {sym} | radar_prob={precision:.3f} | council={council_score:.2f} [{consensus_ratio}]"
            if pred == 1:
                debug_msg += " | [OK] RADAR BUY"
            if council_score >= 0.55:
                debug_msg += " | [OK] COUNCIL PASS"
            try:
                print(debug_msg)
                if detailed_votes:
                    print(f"   Votes: {detailed_votes}")
            except Exception:
                pass
        
        # Filter logic: Must pass Radar Buy (pred=1) and validator if provided
        if pred == 1:
            if validator is not None and validator_score is not None:
                try:
                    if float(validator_score) < float(getattr(validator, "approval_threshold", 0.5)):
                        return None
                except Exception:
                    pass
            
            distribution_gate = get_distribution_gate(candidate.iloc[-1])
            if distribution_gate["blocked"]:
                print(
                    f"[FILTER] Rejecting {sym} due to {distribution_gate['reason']} "
                    f"(MM_Distribution={distribution_gate['mm_distribution']:.0f}, "
                    f"CMF={distribution_gate['cmf_20']:.2f})"
                )
                return None

            news_sentiment = stock_ai._get_latest_news_sentiment(sym)
            if news_sentiment.get("negative_flag") == 1:
                print(
                    f"[SENTIMENT_VETO] Rejecting {sym} due to negative news "
                    f"sentiment ({news_sentiment.get('sentiment_score', 0.0)})"
                )
                return None

            last_close = float(candidate.iloc[-1]["Close"])

            # ── Acceleration Score + Dynamic Risk ──
            accel_score = calculate_acceleration_score(candidate)
            
            # Extract ATR, ADX, R_VOL for dynamic risk fine-tuning
            atr_val = float(candidate.iloc[-1].get("ATR_14", 0)) if "ATR_14" in candidate.columns else 0
            adx_val = float(candidate.iloc[-1].get("ADX_14", 0)) if "ADX_14" in candidate.columns else 0
            r_vol_val = float(candidate.iloc[-1].get("R_VOL", 1.0)) if "R_VOL" in candidate.columns else 1.0
            
            dynamic_risk = calculate_dynamic_risk(
                score=accel_score,
                last_close=last_close,
                atr=atr_val,
                adx=adx_val,
                r_vol=r_vol_val,
            )
            tp = dynamic_risk["target_price"]
            sl = dynamic_risk["stop_loss"]
            
            # Convert numpy types to native Python types for JSON serialization
            features_list = candidate[available_predictors].iloc[0].tolist()
            # Ensure all values are JSON-serializable (not numpy types)
            features_list = [float(f) if hasattr(f, 'item') else f for f in features_list]
            
            # Calculate AI Scores (using new acceleration-based scoring)
            technical_score = accel_score  # Use acceleration score as technical score
            fundamental_score = _calculate_fundamental_score(candidate)
            sentiment_score = calculate_momentum_sentiment(candidate)
            if news_sentiment.get("news_count", 0) > 0:
                sentiment_score = stock_ai.rescale_news_sentiment(float(news_sentiment.get("sentiment_score", 0.0)))
            ai_score = _calculate_ai_score(float(precision), buy_threshold)
            
            return {
                "symbol": sym,
                "exchange": ex,
                "name": name,
                "precision": float(precision),
                "ai_score": ai_score,
                "last_close": last_close,
                "target_price": round(tp, 2),
                "stop_loss": round(sl, 2),
                "signal": "BUY",
                "top_reasons": get_top_reasons(model, available_predictors),
                "features": features_list,
                "technical_score": technical_score,
                "fundamental_score": fundamental_score,
                "sentiment_score": sentiment_score,
                "news_sentiment": news_sentiment,
                "acceleration_score": accel_score,
                "risk_profile": dynamic_risk.get("risk_profile", ""),
                "risk_profile_ar": dynamic_risk.get("risk_profile_ar", ""),
                "target_pct": dynamic_risk.get("target_pct", 0.0),
                "stop_loss_pct": dynamic_risk.get("stop_loss_pct", 0.0),
                "council_score": round(council_score * 100, 1),
                "consensus_ratio": consensus_ratio,
                "detailed_votes": detailed_votes,
                "validator_score": (round(float(validator_score) * 100, 1) if validator_score is not None else None),
                "distribution_gate": distribution_gate,
            }
        return None
    except Exception as e:
        msg = str(e)
        # Silently skip assets with categorical mismatch or known data-type issues
        if "categorical_feature do not match" in msg:
            return None

        # Log other exceptions for debugging (occasionally)
        import random
        if random.random() < 0.05:
            try:
                print(f"DEBUG SCAN ERROR: {sym} | {msg}")
            except Exception:
                pass
        return None


def _calculate_ai_score(prob: float, buy_threshold: float = 0.5) -> int:
    """Map model prediction probability to a simplified score from 1 to 10."""
    try:
        if prob >= buy_threshold:
            # Scale [buy_threshold, 1.0] -> [6, 10]
            denom = (1.0 - buy_threshold)
            if denom <= 0: denom = 0.01
            scaled = 6 + (prob - buy_threshold) / denom * 4
            return int(round(min(max(scaled, 6), 10)))
        else:
            # Scale [0.0, buy_threshold) -> [1, 5]
            denom = buy_threshold
            if denom <= 0: denom = 0.01
            scaled = 1 + (prob / denom) * 4
            return int(round(min(max(scaled, 1), 5)))
    except Exception:
        return 5


def _calculate_sentiment_score(row) -> int:
    """Calculate sentiment score using momentum-first philosophy.
    
    Delegates to the acceleration_score module for consistency.
    High RSI is rewarded (strong momentum), not penalized.
    """
    return calculate_momentum_sentiment(row)


def _calculate_technical_score(row) -> int:
    """Calculate technical score using Acceleration Score methodology.
    
    Delegates to the acceleration_score module for consistency.
    This uses momentum-first philosophy: high RSI = strong momentum (good),
    not overbought (bad). TYCN had RSI=96 and gained +72.8%.
    """
    return calculate_acceleration_score(row)


def _calculate_fundamental_score(row) -> int:
    """Calculate fundamental score (0-10) based on key fundamentals."""
    score = 0
    try:
        r = row.iloc[0] if hasattr(row, 'iloc') else row

        fund_fields = ["peRatio", "eps", "dividendYield", "marketCap", "fund_score", "fundamental_score"]
        has_any = False
        for f in fund_fields:
            if f in r:
                v = r.get(f)
                if v not in (None, "", 0, 0.0):
                    has_any = True
                    break
        if not has_any:
            if os.getenv("DEBUG_FUNDAMENTALS") == "1" and random.random() < 0.02:
                print("DEBUG FUND: no fundamentals in row -> score 0")
            return 0
        
        # PE Ratio (0-3 points): Lower is better
        pe = float(r.get("peRatio", 0)) if "peRatio" in r else 0
        if 0 < pe <= 15:
            score += 3
        elif 15 < pe <= 25:
            score += 2
        elif 25 < pe <= 40:
            score += 1
        
        # EPS (0-3 points): Positive earnings
        eps = float(r.get("eps", 0)) if "eps" in r else 0
        if eps > 1:
            score += 3
        elif eps > 0:
            score += 2
        elif eps > -0.5:
            score += 1
        
        # Dividend Yield (0-2 points)
        div_yield = float(r.get("dividendYield", 0)) if "dividendYield" in r else 0
        if div_yield > 3:
            score += 2
        elif div_yield > 1:
            score += 1
        
        # Market Cap (0-2 points): Larger = more stable
        mkt_cap = float(r.get("marketCap", 0)) if "marketCap" in r else 0
        if mkt_cap > 10_000_000_000:  # > 10B
            score += 2
        elif mkt_cap > 1_000_000_000:  # > 1B
            score += 1
            
    except Exception:
        pass
    
    return min(10, max(0, score))


@router.get("")
def fast_scan(
    country: str = "Egypt",
    limit: int = 200,
    min_precision: float = 0.5,
    model_name: str = "model_EGX.pkl",
    from_date: str = None,
    to_date: str = None,
    target_pct: float = 2.0,
    stop_loss_pct: float = 1.0,
    look_forward_days: int = 20,
    buy_threshold: float = 0.60,
    council_model: Optional[str] = None,
    validator_model: Optional[str] = None,
):
    start = time.time()
    
    # Calculate default from_date as 300 days ago for performance optimization
    if from_date is None:
        from_date = (datetime.date.today() - datetime.timedelta(days=300)).isoformat()
    
    try:
        symbols_data = load_symbols_for_country(country)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load symbols: {e}")

    # Warm bulk cache for all exchanges in this country
    exchanges = {_normalize_exchange(str(row.get("Exchange", ""))) for row in symbols_data if isinstance(row, dict)}
    bulk_map: Dict[str, Dict[str, Any]] = {}
    fundamentals_map_by_ex: Dict[str, Dict[str, Any]] = {}
    for ex in exchanges:
        if not ex:
            continue
        bulk_map[ex] = _get_exchange_bulk_data(ex, from_date=from_date, to_date=to_date, bypass_min_limit=True)
        fundamentals_map_by_ex[ex] = _get_exchange_fundamentals_map(ex)

    if os.getenv("DEBUG_FUNDAMENTALS") == "1":
        for ex, fmap in fundamentals_map_by_ex.items():
            any_count = 0
            for _, v in (fmap or {}).items():
                if any(vv not in (None, "", 0, 0.0) for vv in (v or {}).values()):
                    any_count += 1
            print(f"DEBUG FUND: exchange={ex} fundamentals={len(fmap or {})} with_any={any_count}")

    model_entry = _load_model(model_name)
    if not model_entry:
        raise HTTPException(status_code=400, detail=f"Model '{model_name}' not loaded")
    model, predictors, _ = model_entry
    if not predictors:
        raise HTTPException(status_code=400, detail="Model predictors not found")

    market_gate = should_reject_new_buys() if country == "Egypt" else {"blocked": False, "reason": "market gate not applicable"}
    if market_gate.get("blocked"):
        duration = time.time() - start
        print(f"[MARKET_GATE] Fast scan blocked: {market_gate.get('reason')}")
        return {
            "results": [],
            "scanned_count": 0,
            "duration_seconds": round(duration, 2),
            "model": model_name,
            "limit": limit,
            "min_precision": min_precision,
            "market_gate": market_gate,
        }

    # Prepare Market Context (EGX30 index)
    market_df = None
    if country == "Egypt":
        import json
        try:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            index_path = os.path.join(base_dir, "symbols_data", "EGX30-INDEX.json")
            if os.path.exists(index_path):
                with open(index_path, "r") as f:
                    idx_data = json.load(f)
                market_df = pd.DataFrame(idx_data)
                market_df['date'] = pd.to_datetime(market_df['date'])
                market_df.set_index('date', inplace=True)
                print("DEBUG SCAN: Market context (EGX30) loaded from JSON.")
        except Exception as e:
            print(f"DEBUG SCAN: Failed to load market context from JSON: {e}")
            
        if market_df is None or market_df.empty:
            try:
                from api.stock_ai import _init_supabase, supabase
                _init_supabase()
                if supabase:
                    print("DEBUG SCAN: Loading EGX30 index from Supabase...")
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
                        market_df = pd.DataFrame(all_data)
                        market_df["date"] = pd.to_datetime(market_df["date"])
                        market_df = market_df.set_index("date").sort_index()
                        print(f"DEBUG SCAN: Loaded {len(market_df)} EGX30 index rows from Supabase.")
            except Exception as db_err:
                print(f"DEBUG SCAN: Failed to load market context from Supabase: {db_err}")

    # Resolve dynamic threshold based on market regime (Bull/Bear)
    regime_thresholds = getattr(model, "optimal_threshold_by_regime", None)
    if regime_thresholds and isinstance(regime_thresholds, dict) and country == "Egypt":
        active_regime = "bull"  # Default
        if market_df is not None and not market_df.empty:
            try:
                mkt_df_sorted = market_df.sort_index()
                close_col = "close" if "close" in mkt_df_sorted.columns else ("Close" if "Close" in mkt_df_sorted.columns else None)
                if close_col and len(mkt_df_sorted) >= 50:
                    latest_close = float(mkt_df_sorted[close_col].iloc[-1])
                    latest_sma50 = float(mkt_df_sorted[close_col].rolling(50).mean().iloc[-1])
                    if latest_close < latest_sma50:
                        active_regime = "bear"
                    print(f"DEBUG SCAN: Market Regime determined as {active_regime.upper()} (Close={latest_close:.2f}, SMA50={latest_sma50:.2f})")
            except Exception as e:
                print(f"WARNING SCAN: Failed to determine active market regime: {e}")
        
        calibrated_threshold = regime_thresholds.get(active_regime)
        if calibrated_threshold:
            print(f"DEBUG SCAN: Dynamically overriding buy_threshold with model's calibrated {active_regime.upper()} threshold: {calibrated_threshold}")
            buy_threshold = calibrated_threshold

    # Initialize Council if requested
    council = None
    if council_model and council_model.lower() not in ["none", "null", ""]:
        print(f"DEBUG SCAN: Initializing Council with {council_model}")
        try:
            # Load council model
            council_entry = _load_model(council_model)
            if council_entry:
                c_model, _, _ = council_entry
                # Build council dictionary using actual file names
                # AI Model (e.g. KING 👑.pkl) + Council Model (e.g. The_Council_Validator.pkl)
                # No more static names like 'collector' or 'king'
                council_models = {
                    model_name: model,
                    council_model: c_model
                }
                council = TheCouncil(models_dict=council_models)
        except Exception as e:
            print(f"DEBUG SCAN: Failed to init council: {e}")

    # Optional Council Validator (gates Radar BUYs)
    validator: Optional[CouncilValidator] = None
    if validator_model and validator_model.lower() not in ["none", "null", ""]:
        try:
            models_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models"))
            safe_name = os.path.basename(str(validator_model))
            v_path = safe_name if os.path.isabs(str(validator_model)) else os.path.join(models_dir, safe_name)
            validator = load_council_validator_from_path(v_path)
            if validator is not None:
                print(f"DEBUG SCAN: Loaded validator: {safe_name}")
            else:
                print(f"DEBUG SCAN: Validator not loaded: {safe_name}")
        except Exception as e:
            print(f"DEBUG SCAN: Failed to load validator: {e}")

    # Prepare symbols to process
    symbols_to_process = []
    for row in symbols_data:
        if len(symbols_to_process) >= limit:
            break
        if not isinstance(row, dict):
            continue
        sym = str(row.get("Code", row.get("Symbol", ""))).upper()
        ex = _normalize_exchange(str(row.get("Exchange", "")))
        name = str(row.get("Name", sym))
        if not sym or not ex:
            continue

        df_map = bulk_map.get(ex.upper(), {})
        df = df_map.get(sym)
        if df is None or df.empty:
            continue
        
        symbols_to_process.append((sym, ex, name, df))

    scanned = len(symbols_to_process)
    results: List[FastScanResult] = []

    # Precalculate sector returns if any model expects sector relative strength
    uses_sector_rel = "feat_sector_rel_strength" in predictors
    sector_returns_df = pd.DataFrame()
    if uses_sector_rel:
        try:
            print("Calculating sector average returns for fast scan...")
            all_list = []
            for sym, ex, name, df in symbols_to_process:
                fmap = fundamentals_map_by_ex.get(ex.upper(), {})
                fund = fmap.get(sym.upper()) or fmap.get(sym) or {}
                sector = fund.get("sector", "Unknown") or "Unknown"
                
                temp = df.copy()
                temp["symbol"] = sym
                temp["sector"] = sector
                all_list.append(temp)
            if all_list:
                df_all_scan = pd.concat(all_list)
                df_all_scan = df_all_scan.reset_index()
                date_col = "date" if "date" in df_all_scan.columns else "timestamp" if "timestamp" in df_all_scan.columns else "index"
                if date_col in df_all_scan.columns:
                    df_all_scan["date_only"] = pd.to_datetime(df_all_scan[date_col]).dt.date
                    df_all_scan = df_all_scan.sort_values(["symbol", "date_only"])
                    df_all_scan["daily_return"] = df_all_scan.groupby("symbol")["close"].pct_change().fillna(0.0)
                    sector_returns_df = df_all_scan.groupby(["date_only", "sector"], observed=False)["daily_return"].mean().reset_index()
                    print(f"Calculated sector average returns for {len(sector_returns_df)} date-sector combinations in fast scan.")
        except Exception as e:
            print(f"Warning: Failed to calculate sector returns in fast scan: {e}")

    # Process symbols in parallel using ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(
                _process_symbol, sym, ex, name, df, model, predictors, min_precision,
                target_pct, stop_loss_pct, look_forward_days, buy_threshold, 
                fundamentals_map_by_ex.get(ex.upper()), council, market_df, validator,
                sector_returns_df
            ): sym
            for sym, ex, name, df in symbols_to_process
        }
        
        for future in as_completed(futures):
            result = future.result()
            if result:
                results.append(result)

    results.sort(key=lambda x: x.get("precision", 0), reverse=True)
    duration = time.time() - start
    return {
        "results": results,
        "scanned_count": scanned,
        "duration_seconds": round(duration, 2),
        "model": model_name,
        "limit": limit,
        "min_precision": min_precision,
        "market_gate": market_gate,
    }


@router.get("/evaluate/{batch_id}")
def evaluate_scan(batch_id: str):
    """
    Refresh performance for a specific scan by iterating through historical price data
    from the 'to_date' (Scan Reference Date) until now.
    Checks for Target Price or Stop Loss hits chronologically.
    """
    stock_ai._init_supabase()
    sb = stock_ai.supabase
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase not initialized")

    try:
        # 1. Fetch results for this batch
        res = sb.table("scan_results").select("*").eq("batch_id", batch_id).execute()
        results = res.data
        if not results:
            return {"count": 0, "message": "No results found for this batch"}

        updated_count = 0
        for r in results:
            # We skip results that are already closed (win/loss) if they have an exit_price
            # However, the user might want a re-evaluation if data changed, so we'll re-evaluate all
            
            symbol = r["symbol"]
            exchange = r.get("exchange", "EGX")
            entry_price = float(r["entry_price"]) if r.get("entry_price") else float(r["last_close"])
            target_price = float(r["target_price"]) if r.get("target_price") else None
            stop_loss = float(r["stop_loss"]) if r.get("stop_loss") else None
            start_date = r.get("to_date") # Evaluation starts from the Scan Reference Date
            
            if not start_date:
                # Fallback to created_at if to_date is missing
                start_date = r["created_at"].split("T")[0]

            # 2. Fetch all historical prices for this symbol from start_date to now
            # Ordered by date ASCENDING for chronological check
            p_res = sb.table("stock_prices")\
                .select("date,high,low,close")\
                .eq("symbol", symbol)\
                .eq("exchange", exchange)\
                .gte("date", start_date)\
                .order("date", desc=False)\
                .execute()
            
            prices = p_res.data
            if not prices:
                continue

            status = "open"
            exit_price = None
            pl_pct = 0.0
            found_event = False

            # 3. Iterate day by day
            eps = 0.00001
            current_stop = float(stop_loss) if stop_loss else None
            for p in prices:
                hi = float(p["high"]) if p.get("high") else float(p["close"])
                lo = float(p["low"]) if p.get("low") else float(p["close"])
                dt = p["date"]

                # Check Stop Loss Hit (Loss) - Prioritize loss on same-day hits for conservative evaluation
                if current_stop is not None and lo <= (current_stop + eps):
                    exit_price = current_stop
                    pl_pct = ((current_stop - entry_price) / entry_price) * 100
                    status = "win" if pl_pct >= 0 else "loss"
                    found_event = True
                    break

                # Check Target Hit (Win)
                if target_price and hi >= (target_price - eps):
                    status = "win"
                    exit_price = target_price
                    pl_pct = ((target_price - entry_price) / entry_price) * 100
                    found_event = True
                    break

                # Trailing Stop (effective next bar; avoids ambiguous intraday ordering)
                if current_stop is not None:
                    be_price = float(entry_price)
                    lock_price = float(entry_price * 1.05)
                    if hi >= float(entry_price * 1.08) and current_stop < lock_price:
                        current_stop = lock_price
                    elif hi >= float(entry_price * 1.05) and current_stop < be_price:
                        current_stop = be_price

            # 4. If neither hit, calculate current P/L based on latest close
            if not found_event and prices:
                latest = prices[-1]
                current_price = float(latest["close"])
                status = "open"
                exit_price = current_price
                pl_pct = ((current_price - entry_price) / entry_price) * 100

            # 5. Update Supabase
            sb.table("scan_results").update({
                "exit_price": exit_price,
                "profit_loss_pct": round(pl_pct, 4),
                "status": status,
                "updated_at": datetime.datetime.utcnow().isoformat()
            }).eq("id", r["id"]).execute()
            updated_count += 1

        return {"count": updated_count, "message": f"Successfully evaluated {updated_count} results chronologically."}
    except Exception as e:
        print(f"Error evaluating scan performance: {e}")
        raise HTTPException(status_code=500, detail=str(e))
