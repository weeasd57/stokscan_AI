import json
import logging
import os
import pickle
from typing import Any, Dict, List, Optional, Tuple

import lightgbm as lgb
import numpy as np
import pandas as pd

from api.model_utils import align_pandas_categories_to_booster, reset_booster_cats

# Get logger for uvicorn/fastapi visibility
logger = logging.getLogger("uvicorn.error")

if os.getenv("COUNCIL_DEBUG_LOG", "").strip().lower() in ("1", "true", "yes"):
    DEBUG_LOG = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "council_debug.log"
    )
    fh = logging.FileHandler(DEBUG_LOG, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
    logger.addHandler(fh)
    logger.info("COUNCIL: File logging initialized.")


class TheCouncil:
    """
    Consensus-based noise reduction for stock opportunities.
    Implements Phase 2: Ensemble Filtering with Weighted Soft Voting.
    """

    def __init__(
        self, models_dict: Dict[str, Any], weights: Optional[Dict[str, float]] = None
    ):
        """
        :param models_dict: Dictionary mapping model names to loaded model objects.
        :param weights: Dictionary mapping model names to their voting weights.
        """
        self.models = models_dict
        if weights is None:
            # Equal weight by default
            count = len(models_dict)
            w = 1.0 / count if count > 0 else 1.0
            self.weights = {name: w for name in models_dict.keys()}
        else:
            self.weights = weights

        self.threshold = 0.5

    @staticmethod
    def get_categorical_features(artifact: dict) -> List[str]:
        # Try to find categorical features in the artifact
        metadata = artifact.get("metadata", {})
        return metadata.get("categorical_features", []) or artifact.get(
            "categorical_features", []
        )

    def _align_X_for_artifact(self, X: pd.DataFrame, artifact: Any) -> pd.DataFrame:
        """
        Align X to the feature expectations of a saved artifact dict or model object.
        Supports:
        - meta_labeling_system (uses primary_model.feature_names + categorical_features)
        - lgbm_booster (uses feature_names + categorical_features)
        - direct model objects (recursively inspects primary_model, booster, feature_name, feature_names_in_)
        """
        if not isinstance(X, pd.DataFrame):
            X = pd.DataFrame(X)
        df = X.copy()

        required: List[str] = []
        categorical_features: List[str] = []

        if isinstance(artifact, dict):
            kind = (artifact.get("kind") or "").strip().lower()
            if kind == "meta_labeling_system":
                primary_art = artifact.get("primary_model") or {}
                required = list(primary_art.get("feature_names") or [])
                categorical_features = list(primary_art.get("categorical_features") or [])
            elif kind == "lgbm_booster":
                required = list(artifact.get("feature_names") or [])
                categorical_features = list(artifact.get("categorical_features") or [])
            elif kind == "council_validator":
                primary_art = artifact.get("primary_model") or {}
                required = list(
                    primary_art.get("feature_names") or artifact.get("feature_names") or []
                )
                categorical_features = list(
                    primary_art.get("categorical_features")
                    or artifact.get("categorical_features")
                    or []
                )
        elif artifact is not None:
            # Recursively inspect the model object to find feature names
            def extract_feats(m):
                req, cats = [], []
                if hasattr(m, "primary_model"):
                    r, c = extract_feats(m.primary_model)
                    req.extend(r)
                    cats.extend(c)
                elif hasattr(m, "booster"):
                    r, c = extract_feats(m.booster)
                    req.extend(r)
                    cats.extend(c)
                elif hasattr(m, "feature_name"):
                    try:
                        req.extend(list(m.feature_name()))
                    except Exception:
                        pass
                elif hasattr(m, "feature_names_in_"):
                    try:
                        req.extend(list(m.feature_names_in_))
                    except Exception:
                        pass
                return req, cats

            required, categorical_features = extract_feats(artifact)

        if not required:
            # Best-effort sanitize: drop non-numeric/non-float columns that might break boosters
            out = df.copy()
            # Drop known string columns that aren't features
            for col in ["symbol", "exchange", "name", "date", "signal", "fund_score"]:
                if col in out.columns:
                    out = out.drop(columns=[col])

            num_cols = out.select_dtypes(include=[np.number]).columns
            obj_cols = out.select_dtypes(exclude=[np.number, "bool"]).columns
            if len(obj_cols) > 0:
                out = out.drop(columns=obj_cols)

            if len(num_cols) > 0:
                out[num_cols] = (
                    out[num_cols].replace([np.inf, -np.inf], np.nan).fillna(0)
                )
            return out

        cat_set = set(categorical_features or [])
        missing = [c for c in required if c not in df.columns]
        for c in missing:
            df[c] = "Unknown" if c in cat_set else 0

        df = df[required]

        cat_cols = [c for c in categorical_features if c in df.columns]
        if cat_cols:
            for c in cat_cols:
                # Force to category type to satisfy Booster requirements and avoid mismatch
                df[c] = (
                    df[c]
                    .astype(str)
                    .replace(["nan", "None", ""], "Unknown")
                    .fillna("Unknown")
                    .astype("category")
                )

        non_cat_cols = [c for c in df.columns if c not in cat_cols]
        for col in non_cat_cols:
            if not pd.api.types.is_numeric_dtype(df[col]):
                df[col] = pd.to_numeric(df[col], errors="coerce")
        if non_cat_cols:
            df[non_cat_cols] = (
                df[non_cat_cols].replace([np.inf, -np.inf], np.nan).fillna(0)
            )

        return df

    @staticmethod
    def _predict_p1(model: Any, X: pd.DataFrame) -> np.ndarray:
        """
        Return class-1 probability for a model/artifact on aligned X.
        """

        def _coerce_X_numeric(df: pd.DataFrame) -> pd.DataFrame:
            out = df.copy()
            for col in out.columns:
                try:
                    if out[col].dtype.name == "category" or out[col].dtype == object:
                        out[col] = (
                            out[col].astype("category").cat.codes.astype("float32")
                        )
                    else:
                        if not pd.api.types.is_numeric_dtype(out[col]):
                            out[col] = pd.to_numeric(out[col], errors="coerce")
                except Exception:
                    out[col] = pd.to_numeric(out[col], errors="coerce")
            out = out.replace([np.inf, -np.inf], np.nan).fillna(0)
            return out

        def _predict_raw(m: Any, df: pd.DataFrame) -> np.ndarray:
            if hasattr(m, "predict_proba"):
                probs = m.predict_proba(df)
                return (
                    probs[:, 1]
                    if getattr(probs, "ndim", 1) == 2
                    else np.asarray(probs).reshape(-1)
                )
            return np.asarray(m.predict(df)).astype(float)

        try:
            return _predict_raw(model, X)
        except Exception as e:
            msg = str(e)
            if "categorical_feature" not in msg or "do not match" not in msg:
                raise

            # Recovery path (best-effort): reset booster categorical state and retry on numeric-only frame.
            try:
                reset_booster_cats(model)
                for attr in ["primary_model", "meta_model", "model"]:
                    child = getattr(model, attr, None)
                    if child is not None:
                        reset_booster_cats(child)
            except Exception:
                pass

            Xn = _coerce_X_numeric(X)
            try:
                return _predict_raw(model, Xn)
            except Exception:
                # Final fallback: zero votes instead of crashing the whole council.
                return np.zeros(len(Xn), dtype=float)

    @staticmethod
    def _find_model_data(d: Any) -> Tuple[Optional[dict], Any]:
        """Recursively find a dictionary containing 'model_str' or a predict-capable object."""
        if isinstance(d, lgb.Booster) or hasattr(d, "predict"):
            return {}, d
        if not isinstance(d, dict):
            return None, None
        if "model_str" in d:
            return d, d["model_str"]
        # Common keys where models/boosters might be nested
        for key in ["primary_model", "model", "booster", "lgbm_booster"]:
            if key in d:
                res_data, res_obj = TheCouncil._find_model_data(d[key])
                if res_obj:
                    # If we found a model-str directly, res_data is {}, so use parent d if available
                    return (res_data if res_data else d), res_obj
        return None, None

    def get_consensus(self, X: pd.DataFrame) -> np.ndarray:
        """
        Compute Weighted Soft Voting Consensus Strength.
        ConsensusStrength = Σ(probability × weight)
        """
        if X.empty:
            return np.array([])

        total_weighted_prob = np.zeros(len(X))
        total_weight = 0.0

        lgbm_preds = []
        xgb_preds = []
        other_preds = []

        for name, weight in self.weights.items():
            if weight <= 0:
                continue

            model = self.models.get(name)
            if model is None:
                continue

            try:
                p1 = None
                if isinstance(model, dict):
                    # 1. Check for meta-labeling system
                    kind = (model.get("kind") or "").strip().lower()
                    if kind == "meta_labeling_system":
                        try:
                            from api.backtest_radar import reconstruct_meta_model

                            wrapper = reconstruct_meta_model(model)
                            if wrapper:
                                X_aligned = self._align_X_for_artifact(X, model)
                                p1 = wrapper.predict_proba(X_aligned)[:, 1]
                        except Exception as meta_ex:
                            logger.error(
                                f"COUNCIL: Meta-model reconstruction failed for {name}: {meta_ex}"
                            )

                    # 2. Search for Booster
                    if p1 is None:
                        model_data, m_obj = self._find_model_data(model)
                        if m_obj:
                            X_aligned = self._align_X_for_artifact(X, model_data)

                            if isinstance(m_obj, str):
                                # LightGBM string booster
                                booster = lgb.Booster(model_str=m_obj)
                                cats = self.get_categorical_features(model_data)
                                if cats:
                                    for c in cats:
                                        if c in X_aligned.columns:
                                            X_aligned[c] = X_aligned[c].astype(
                                                "category"
                                            )
                                    X_aligned = align_pandas_categories_to_booster(
                                        X_aligned, cats, booster, cats
                                    )
                                p1 = np.asarray(booster.predict(X_aligned)).astype(
                                    float
                                )
                            elif isinstance(m_obj, lgb.Booster):
                                # Direct LightGBM booster
                                cats = self.get_categorical_features(model_data)
                                if cats:
                                    for c in cats:
                                        if c in X_aligned.columns:
                                            X_aligned[c] = X_aligned[c].astype(
                                                "category"
                                            )
                                    X_aligned = align_pandas_categories_to_booster(
                                        X_aligned, cats, m_obj, cats
                                    )
                                p1 = np.asarray(m_obj.predict(X_aligned)).astype(float)
                            else:
                                # Generic model (RandomForest, etc.)
                                p1 = self._predict_p1(m_obj, X_aligned)

                    if p1 is None:
                        logger.error(
                            f"COUNCIL ERROR: Model {name} has no recognized booster or meta-model"
                        )
                        continue
                else:
                    # Direct model object
                    X_aligned = self._align_X_for_artifact(X, model)
                    p1 = self._predict_p1(model, X_aligned)

                if p1 is not None and len(p1) > 0:
                    logger.info(
                        f"COUNCIL TRACE: model={name} weight={weight:.4f} avg_p1={np.mean(p1):.4f}"
                    )
                    total_weighted_prob += p1 * weight
                    total_weight += weight

                    # Track model predictions by type to enforce ensemble agreement
                    model_type = "other"
                    if isinstance(model, dict):
                        kind = (model.get("kind") or "").strip().lower()
                        if "lgb" in kind or "meta" in kind:
                            model_type = "lgbm"
                        elif "xgb" in kind:
                            model_type = "xgb"
                    else:
                        model_str = str(type(model)).lower()
                        if "lgb" in model_str or "lightgbm" in model_str:
                            model_type = "lgbm"
                        elif "xgb" in model_str or "xgboost" in model_str:
                            model_type = "xgb"

                    if model_type == "lgbm":
                        lgbm_preds.append(p1)
                    elif model_type == "xgb":
                        xgb_preds.append(p1)
                    else:
                        other_preds.append(p1)

            except Exception as e:
                logger.error(f"COUNCIL ERROR: Model {name} failed: {e}")

        if total_weight == 0:
            logger.error("COUNCIL ERROR: Total weight is zero, check model loading")
            return np.zeros(len(X))

        consensus = total_weighted_prob / total_weight

        # Enforce consensus between LightGBM and XGBoost if both are present in the council
        if len(lgbm_preds) > 0 and len(xgb_preds) > 0:
            logger.info("COUNCIL: Enforcing strict consensus between LightGBM and XGBoost models.")
            for i in range(len(X)):
                lgbm_buy = any(p[i] >= 0.5 for p in lgbm_preds)
                xgb_buy = any(p[i] >= 0.5 for p in xgb_preds)
                # If they do not both agree on a BUY, override consensus to 0.0
                if not (lgbm_buy and xgb_buy):
                    consensus[i] = 0.0

        return consensus

    def get_detailed_votes(self, X: pd.DataFrame) -> Dict[str, np.ndarray]:
        """
        Returns individual scores for each model in the council.
        """
        votes = {}
        for name, weight in self.weights.items():
            if weight <= 0:
                continue
            model = self.models.get(name)
            if model is None:
                continue
            try:
                if isinstance(model, dict):
                    kind = (model.get("kind") or "").strip().lower()
                    if kind == "meta_labeling_system":
                        from api.backtest_radar import reconstruct_meta_model

                        wrapper = reconstruct_meta_model(model)
                        if wrapper is None:
                            raise ValueError(
                                "Failed to reconstruct meta_labeling_system"
                            )
                        X_aligned = self._align_X_for_artifact(X, model)
                        votes[name] = wrapper.predict_proba(X_aligned)[:, 1]
                    elif kind == "lgbm_booster" or kind == "council_validator":
                        model_str = model.get("model_str") or (
                            model.get("primary_model") or {}
                        ).get("model_str")
                        if model_str:
                            booster = lgb.Booster(model_str=model_str)
                            X_aligned = self._align_X_for_artifact(X, model)
                            cats = self.get_categorical_features(
                                model
                            ) or self.get_categorical_features(
                                model.get("primary_model") or {}
                            )
                            if cats:
                                for c in cats:
                                    if c in X_aligned.columns:
                                        X_aligned[c] = X_aligned[c].astype("category")
                                X_aligned = align_pandas_categories_to_booster(
                                    X_aligned, cats, booster, cats
                                )
                            votes[name] = np.asarray(booster.predict(X_aligned)).astype(
                                float
                            )
                        else:
                            votes[name] = np.zeros(len(X))
                    else:
                        votes[name] = np.zeros(len(X))
                else:
                    X_aligned = self._align_X_for_artifact(X, model)
                    votes[name] = self._predict_p1(model, X_aligned)
            except Exception:
                votes[name] = np.zeros(len(X))
        return votes

    def filter(self, X: pd.DataFrame) -> pd.DataFrame:
        """Returns only rows that pass the consensus threshold."""
        scores = self.get_consensus(X)
        return X[scores >= self.threshold]
