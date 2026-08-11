"""
Shared model utilities for backtest_radar and live_bot.
Extracted common booster alignment functions to avoid code duplication.

Usage:
    from api.model_utils import (
        reset_booster_cats,
        reset_nested_boosters,
        get_primary_booster,
        align_pandas_categories_to_booster,
        align_for_king,
    )
"""

import os

import pandas as pd
import numpy as np


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------

def safe_model_path(model_name: str, models_dir: str, allowed_ext=(".pkl",)) -> str:
    """
    Resolve a user-supplied model name to a path strictly inside models_dir.

    Prevents path traversal (e.g. "../../secret.pkl" or absolute paths) before
    the file is opened/deserialized. Raises ValueError for invalid names.

    Rules:
      - Directory components are stripped (basename only).
      - Names containing an extension must end with one of allowed_ext.
      - Extension-less names (e.g. "THE_COUNCIL") are allowed for conventions.
      - The resolved path must stay within models_dir (realpath containment).
    """
    if not isinstance(model_name, str) or not model_name.strip():
        raise ValueError("Invalid model name")

    name = os.path.basename(model_name.strip())
    if not name or name.startswith("."):
        raise ValueError("Invalid model name")

    if "." in name and not any(name.lower().endswith(ext) for ext in allowed_ext):
        raise ValueError(
            f"Model files must have one of these extensions: {', '.join(allowed_ext)}"
        )

    base = os.path.realpath(models_dir)
    path = os.path.realpath(os.path.join(base, name))
    if path == base or not path.startswith(base + os.sep):
        raise ValueError("Invalid model path")
    return path


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _log(msg: str, logger=None):
    """Unified logging: use provided logger or fall back to print."""
    if logger:
        logger(msg)
    else:
        print(msg, flush=True)


def _extract_booster(obj):
    """
    Extract the raw LightGBM Booster from any known wrapper type.
    Returns None if no booster is found.
    """
    return (
        getattr(obj, "_Booster", None)
        or getattr(obj, "booster_", None)
        or getattr(obj, "booster",  None)
        or getattr(obj, "b",        None)   # PrimaryWrapper used in backtest_radar
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def reset_booster_cats(obj, logger=None):
    """
    Reset categorical state on a single booster/wrapper to prevent
    LightGBM's "train and valid dataset categorical_feature do not match" error.
    """
    try:
        booster = _extract_booster(obj)
        if booster is None:
            return
        if hasattr(booster, "pandas_categorical"):
            booster.pandas_categorical = None
        if hasattr(booster, "categorical_feature"):
            booster.categorical_feature = "auto"
    except Exception as e:
        _log(f"DEBUG: Could not reset booster cats: {e}", logger)


def reset_nested_boosters(obj, logger=None, _depth: int = 0):
    """
    Recursively reset booster categories in nested model structures.

    Handles unlimited nesting depth (capped at 4 levels to prevent infinite
    loops on circular references).  Covers PrimaryWrapper (.b), sklearn-style
    wrappers (.booster_ / ._Booster), and meta-labeling containers
    (.primary_model / .meta_model / .model).
    """
    if _depth > 4:
        return

    reset_booster_cats(obj, logger=logger)

    for attr in ("primary_model", "meta_model", "model", "b"):
        child = getattr(obj, attr, None)
        # Guard against self-references or already-visited nodes
        if child is not None and child is not obj:
            reset_nested_boosters(child, logger=logger, _depth=_depth + 1)


def get_primary_booster(obj):
    """
    Best-effort extraction of the underlying LightGBM Booster used for
    primary predictions. Walks one level into .primary_model first, then
    tries common wrapper attribute names.

    Returns the raw lgb.Booster or None.
    """
    try:
        pm = getattr(obj, "primary_model", None)
        target = pm if pm is not None else obj
        return _extract_booster(target)
    except Exception:
        return None


def align_pandas_categories_to_booster(
    X_in: pd.DataFrame,
    cat_cols: list,
    booster,
    cat_cols_order: list,
) -> pd.DataFrame:
    """
    Coerce prediction-time Categorical columns to exactly match the category
    levels stored in the training booster.

    This prevents LightGBM from raising:
        "train and valid dataset categorical_feature do not match"

    Unknown categories are mapped to NaN, which LightGBM treats as missing (-1).

    Args:
        X_in:           Input DataFrame (will NOT be mutated).
        cat_cols:       Categorical column names present in X_in.
        booster:        Raw lgb.Booster that has .pandas_categorical set.
        cat_cols_order: The ordered list of categorical feature names used
                        at training time (positional match with pandas_categorical).

    Returns:
        A copy of X_in with aligned Categorical dtypes, or X_in unchanged if
        alignment is not possible.
    """
    if X_in is None or X_in.empty or not cat_cols:
        return X_in

    if booster is None or not hasattr(booster, "pandas_categorical"):
        return X_in

    train_cats = getattr(booster, "pandas_categorical", None)
    if not isinstance(train_cats, list) or not train_cats:
        return X_in

    if not cat_cols_order or len(train_cats) != len(cat_cols_order):
        return X_in

    mapping = {col: train_cats[i] for i, col in enumerate(cat_cols_order)}
    out = X_in.copy()

    for c in cat_cols:
        if c not in out.columns or c not in mapping:
            continue
        try:
            categories = [str(v) for v in mapping[c]]
            out[c] = pd.Categorical(out[c].astype(str), categories=categories)
        except Exception:
            # Coercion failed — keep original column intact
            pass

    return out


def align_for_king(
    X_src: pd.DataFrame,
    king_artifact,
    logger=None,
) -> pd.DataFrame:
    """
    Align input DataFrame to match the KING model's expected features and dtypes.

    Steps:
      1. Validate artifact type — warn loudly on unexpected input (no silent swallowing).
      2. Subset / zero-fill to the exact feature list saved in the artifact.
      3. Coerce categorical columns using align_pandas_categories_to_booster
         so prediction categories match training categories exactly.
      4. Coerce remaining columns to numeric; replace inf/NaN with 0.

    Args:
        X_src:         Raw feature DataFrame.
        king_artifact: Model metadata dict  {"kind": "meta_labeling_system",
                       "primary_model": {"feature_names": [...], ...}}
                       OR any object — non-dict inputs are handled gracefully
                       with an explicit warning instead of silent fallback.
        logger:        Optional callable for logging (e.g. self._log in LiveBot).

    Returns:
        Aligned DataFrame ready for KING predictions.
    """
    # ── Input validation ──────────────────────────────────────────────────
    if not isinstance(X_src, pd.DataFrame):
        X_src = pd.DataFrame(X_src)

    if not isinstance(king_artifact, dict):
        _log(
            f"WARNING: align_for_king received non-dict artifact "
            f"({type(king_artifact).__name__}). Returning cleaned input as-is.",
            logger,
        )
        return X_src.replace([np.inf, -np.inf], np.nan).fillna(0)

    if king_artifact.get("kind") != "meta_labeling_system":
        _log(
            f"WARNING: align_for_king expected kind='meta_labeling_system', "
            f"got '{king_artifact.get('kind')}'. Returning cleaned input as-is.",
            logger,
        )
        return X_src.replace([np.inf, -np.inf], np.nan).fillna(0)

    # ── Feature alignment ─────────────────────────────────────────────────
    try:
        pm   = king_artifact.get("primary_model") or {}
        feats = list(pm.get("feature_names")        or [])
        cats  = list(pm.get("categorical_features") or [])

        if not feats:
            return X_src.replace([np.inf, -np.inf], np.nan).fillna(0)

        Xk = X_src.copy()

        # Zero-fill any feature the model expects but is missing from the data
        missing = [c for c in feats if c not in Xk.columns]
        if missing:
            _log(f"DEBUG: align_for_king zero-filling {len(missing)} missing features: {missing[:5]}{'...' if len(missing) > 5 else ''}", logger)
        for c in missing:
            Xk[c] = 0

        Xk = Xk[feats]

        # ── Categorical alignment (use shared helper) ──────────────────
        primary_booster = get_primary_booster(king_artifact)
        if primary_booster is not None and cats:
            Xk = align_pandas_categories_to_booster(
                X_in=Xk,
                cat_cols=cats,
                booster=primary_booster,
                cat_cols_order=cats,
            )
        else:
            # Fallback: simple category coercion without level alignment
            for col in cats:
                if col in Xk.columns:
                    Xk[col] = (
                        Xk[col]
                        .astype(str)
                        .replace(["nan", "None", ""], "Unknown")
                        .fillna("Unknown")
                        .astype("category")
                    )

        # ── Numeric coercion for non-categorical columns ───────────────
        non_cat = [c for c in Xk.columns if c not in set(cats)]
        for col in non_cat:
            if not pd.api.types.is_numeric_dtype(Xk[col]):
                Xk[col] = pd.to_numeric(Xk[col], errors="coerce")

        Xk = Xk.replace([np.inf, -np.inf], np.nan)
        if non_cat:
            Xk[non_cat] = Xk[non_cat].fillna(0)

        return Xk

    except Exception as e:
        _log(f"ERROR in align_for_king: {e}", logger)
        return X_src.replace([np.inf, -np.inf], np.nan).fillna(0)