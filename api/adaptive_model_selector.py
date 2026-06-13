#!/usr/bin/env python
"""
Adaptive Model Selector
نظام ذكي يختار الموديل الأنسب حسب ظروف السوق

Strategy:
- Bull Markets (Strong Momentum) → favor higher-upside models
- Sideways/Bear Markets → favor defensive / tighter-risk models

Author: Kiro AI
Date: 2026-06-13
"""

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, Literal, Optional, Tuple

import numpy as np
import pandas as pd


@dataclass
class RegimeInfo:
    """معلومات حالة السوق"""

    regime: Literal["STRONG_BULL", "BULL", "SIDEWAYS", "BEAR"]
    confidence: float  # 0-1
    momentum_score: float  # -100 to +100
    volatility_score: float  # 0-100
    trend_strength: float  # 0-100
    recommended_model: str  # "KING.pkl" or "model_EGX.pkl"
    reason: str


class AdaptiveModelSelector:
    """
    نظام تكيفي لاختيار الموديل الأنسب حسب ظروف السوق
    """

    def __init__(
        self,
        king_model_path: str = "api/models/KING.pkl",
        egx_model_path: str = "api/models/model_EGX.pkl",
        lookback_days: int = 60,  # فترة التحليل
        bull_momentum_threshold: float = 40.0,  # حد الصعود القوي (أكثر واقعية)
        bear_momentum_threshold: float = -10.0,  # حد الهبوط
        high_volatility_threshold: float = 35.0,  # حد التقلب العالي (أعلى لـEGX)
    ):
        self.king_model_path = king_model_path
        self.egx_model_path = egx_model_path
        self.lookback_days = lookback_days
        self.bull_momentum_threshold = bull_momentum_threshold
        self.bear_momentum_threshold = bear_momentum_threshold
        self.high_volatility_threshold = high_volatility_threshold

        # Cache للـregime الحالي (عشان مش نحسبه كل مرة)
        self._current_regime: Optional[RegimeInfo] = None
        self._last_regime_update: Optional[datetime] = None

    def detect_market_regime(
        self, index_data: pd.DataFrame, current_date: Optional[datetime] = None
    ) -> RegimeInfo:
        """
        يكشف حالة السوق الحالية

        Args:
            index_data: بيانات المؤشر (EGX30) مع columns: Close, High, Low, Volume
            current_date: التاريخ الحالي (أو آخر تاريخ في البيانات)

        Returns:
            RegimeInfo: معلومات الحالة والموديل الموصى به
        """
        if index_data is None or len(index_data) < 20:
            # بيانات غير كافية - استخدم الموديل الآمن
            return RegimeInfo(
                regime="SIDEWAYS",
                confidence=0.3,
                momentum_score=0.0,
                volatility_score=50.0,
                trend_strength=0.0,
                recommended_model=self.egx_model_path,
                reason="Insufficient data - using safe model",
            )

        # استخدم آخر lookback_days يوم حتى current_date فقط.
        # مهم: لا نستخدم أي بيانات بعد current_date حتى لا يحصل look-ahead bias.
        index_data = index_data.sort_index().copy()
        if current_date:
            current_ts = pd.to_datetime(current_date).tz_localize(None)
            idx = pd.DatetimeIndex(index_data.index).tz_localize(None)
            index_data.index = idx
            cutoff = current_ts - timedelta(days=self.lookback_days)
            recent_data = index_data[
                (index_data.index >= cutoff) & (index_data.index <= current_ts)
            ].copy()
        else:
            recent_data = index_data.tail(self.lookback_days).copy()

        if len(recent_data) < 20:
            return RegimeInfo(
                regime="SIDEWAYS",
                confidence=0.3,
                momentum_score=0.0,
                volatility_score=50.0,
                trend_strength=0.0,
                recommended_model=self.egx_model_path,
                reason="Insufficient recent data",
            )

        # 1. حساب Momentum (معدل التغير)
        first_price = recent_data["Close"].iloc[0]
        last_price = recent_data["Close"].iloc[-1]
        momentum_pct = ((last_price / first_price) - 1) * 100

        # Annualize momentum للمقارنة
        days_in_period = len(recent_data)
        annualized_momentum = momentum_pct * (252 / days_in_period)

        # 2. حساب Volatility (التقلب)
        returns = recent_data["Close"].pct_change().dropna()
        volatility = returns.std() * np.sqrt(252) * 100  # Annualized volatility %

        # 3. حساب Trend Strength (قوة الاتجاه)
        # باستخدام ADX-like calculation
        sma_20 = recent_data["Close"].rolling(20).mean()
        sma_50 = (
            recent_data["Close"].rolling(50).mean()
            if len(recent_data) >= 50
            else sma_20
        )

        # المسافة بين السعر والـSMA
        price_above_sma20 = (
            (last_price > sma_20.iloc[-1]) if not pd.isna(sma_20.iloc[-1]) else False
        )
        price_above_sma50 = (
            (last_price > sma_50.iloc[-1]) if not pd.isna(sma_50.iloc[-1]) else False
        )

        # Trend strength score (0-100)
        trend_score = 0.0
        if price_above_sma20:
            trend_score += 30
        if price_above_sma50:
            trend_score += 30
        if not returns.empty and len(returns) >= 20:
            positive_days = (returns > 0).sum() / len(returns)
            trend_score += positive_days * 40  # Max 40 points

        # 4. تحديد الـRegime
        regime = self._classify_regime(
            momentum=annualized_momentum,
            volatility=volatility,
            trend_strength=trend_score,
        )

        # 5. اختيار الموديل
        if regime in ["STRONG_BULL", "BULL"]:
            recommended_model = self.king_model_path
            reason = f"Bull market detected (momentum: {annualized_momentum:.1f}%) - using KING for high returns"
        else:
            recommended_model = self.egx_model_path
            reason = f"Non-bull market (momentum: {annualized_momentum:.1f}%) - using model_EGX for stability"

        # 6. حساب Confidence
        confidence = self._calculate_confidence(
            momentum=annualized_momentum,
            volatility=volatility,
            trend_strength=trend_score,
            data_points=len(recent_data),
        )

        regime_info = RegimeInfo(
            regime=regime,
            confidence=confidence,
            momentum_score=annualized_momentum,
            volatility_score=volatility,
            trend_strength=trend_score,
            recommended_model=recommended_model,
            reason=reason,
        )

        # Cache النتيجة
        self._current_regime = regime_info
        self._last_regime_update = datetime.now()

        return regime_info

    def _classify_regime(
        self, momentum: float, volatility: float, trend_strength: float
    ) -> Literal["STRONG_BULL", "BULL", "SIDEWAYS", "BEAR"]:
        """
        يصنف حالة السوق بناءً على المؤشرات
        """
        # Strong Bull: زخم قوي جداً (>60%) + اتجاه واضح + تقلب معتدل
        if (
            momentum > 60.0
            and trend_strength > 60
            and volatility < self.high_volatility_threshold
        ):
            return "STRONG_BULL"

        # Bull: زخم إيجابي معتدل (>25%) + اتجاه صاعد
        if momentum > 25.0 and trend_strength > 40:
            return "BULL"

        # Bear: زخم سلبي
        if momentum < self.bear_momentum_threshold:
            return "BEAR"

        # Sideways: كل ما عدا ذلك (momentum بين -10% و +25%)
        return "SIDEWAYS"

    def _calculate_confidence(
        self,
        momentum: float,
        volatility: float,
        trend_strength: float,
        data_points: int,
    ) -> float:
        """
        يحسب مدى الثقة في تصنيف الحالة (0-1)
        """
        confidence = 0.0

        # 1. Data quality (max 0.3)
        if data_points >= self.lookback_days:
            confidence += 0.3
        else:
            confidence += 0.3 * (data_points / self.lookback_days)

        # 2. Signal strength (max 0.4)
        momentum_strength = min(abs(momentum) / 30.0, 1.0)  # Normalize to 30% momentum
        confidence += 0.4 * momentum_strength

        # 3. Trend clarity (max 0.3)
        trend_clarity = trend_strength / 100.0
        confidence += 0.3 * trend_clarity

        return min(confidence, 1.0)

    def get_recommended_model(
        self,
        index_data: pd.DataFrame,
        current_date: Optional[datetime] = None,
        force_refresh: bool = False,
    ) -> Tuple[str, RegimeInfo]:
        """
        يرجع الموديل الموصى به مع معلومات الحالة

        Args:
            index_data: بيانات المؤشر
            current_date: التاريخ الحالي
            force_refresh: يجبر إعادة حساب الحالة

        Returns:
            (model_path, regime_info)
        """
        # استخدم الـcache إذا كان حديث (أقل من ساعة)
        if (
            not force_refresh
            and self._current_regime is not None
            and self._last_regime_update is not None
        ):
            time_since_update = datetime.now() - self._last_regime_update
            if time_since_update < timedelta(hours=1):
                return self._current_regime.recommended_model, self._current_regime

        # احسب الحالة من جديد
        regime_info = self.detect_market_regime(index_data, current_date)
        return regime_info.recommended_model, regime_info

    def should_switch_model(
        self,
        current_model: str,
        index_data: pd.DataFrame,
        current_date: Optional[datetime] = None,
        min_confidence: float = 0.6,
    ) -> Tuple[bool, Optional[str], Optional[RegimeInfo]]:
        """
        يحدد إذا كان يجب تغيير الموديل الحالي

        Args:
            current_model: المسار للموديل الحالي
            index_data: بيانات المؤشر
            current_date: التاريخ الحالي
            min_confidence: الحد الأدنى للثقة المطلوب للتبديل

        Returns:
            (should_switch, new_model_path, regime_info)
        """
        recommended_model, regime_info = self.get_recommended_model(
            index_data, current_date, force_refresh=True
        )

        # لا تبدل إلا إذا:
        # 1. الموديل الموصى به مختلف
        # 2. مستوى الثقة عالي
        if (
            recommended_model != current_model
            and regime_info.confidence >= min_confidence
        ):
            return True, recommended_model, regime_info

        return False, None, regime_info

    def get_regime_summary(
        self,
        index_data: pd.DataFrame,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> pd.DataFrame:
        """
        يحلل الأنظمة عبر فترة زمنية

        Returns:
            DataFrame مع columns: date, regime, model, momentum, volatility
        """
        full_data = index_data.sort_index().copy()
        full_idx = pd.DatetimeIndex(full_data.index).tz_localize(None)
        full_data.index = full_idx

        if start_date:
            range_start = pd.to_datetime(start_date).tz_localize(None)
        else:
            range_start = full_data.index[0]

        if end_date:
            range_end = pd.to_datetime(end_date).tz_localize(None)
        else:
            range_end = full_data.index[-1]

        # حلل كل شهر. نمرر كامل الداتا التاريخية لـ detect_market_regime
        # لكنه داخلياً سيستخدم فقط البيانات السابقة للتاريخ الحالي.
        results = []
        dates = pd.date_range(
            start=range_start,
            end=range_end,
            freq="MS",  # Month Start
        )

        for date in dates:
            regime_info = self.detect_market_regime(full_data, date)
            results.append(
                {
                    "date": date,
                    "regime": regime_info.regime,
                    "recommended_model": regime_info.recommended_model.split("/")[
                        -1
                    ],  # اسم الملف فقط
                    "momentum": regime_info.momentum_score,
                    "volatility": regime_info.volatility_score,
                    "trend_strength": regime_info.trend_strength,
                    "confidence": regime_info.confidence,
                    "reason": regime_info.reason,
                }
            )

        return pd.DataFrame(results)


def _safe_model_name(name: str) -> str:
    value = (name or "").strip().replace("\\", "/")
    return value.split("/")[-1]


def _load_model_card(models_dir: str, model_name: str) -> dict[str, Any]:
    card_path = os.path.join(models_dir, f"{model_name}.model_card.json")
    if not os.path.exists(card_path):
        return {}
    try:
        with open(card_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _as_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def discover_model_candidates(
    models_dir: str,
    exchange: Optional[str] = None,
    model_names: Optional[Iterable[str]] = None,
) -> list[dict[str, Any]]:
    """
    Builds a candidate pool from local model files and optional model cards.
    Council / validator models are excluded because the selector should pick
    tradable primary models only.
    """
    normalized_exchange = (exchange or "").strip().upper() or None

    if model_names:
        names = [_safe_model_name(name) for name in model_names if name]
    else:
        try:
            names = [
                fn
                for fn in os.listdir(models_dir)
                if fn.lower().endswith(".pkl")
            ]
        except Exception:
            names = []

    seen: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for name in sorted(names):
        safe_name = _safe_model_name(name)
        if not safe_name or safe_name in seen:
            continue
        seen.add(safe_name)

        model_path = os.path.join(models_dir, safe_name)
        if not os.path.exists(model_path):
            continue

        normalized_name = safe_name.replace(".pkl", "").upper()
        card = _load_model_card(models_dir, safe_name)
        card_exchange = (
            str(card.get("exchange") or "").strip().upper() or None
        )
        model_type = str(
            card.get("model_type") or card.get("type") or ""
        ).strip()

        if model_type == "council_validator":
            continue
        if "COUNCIL" in normalized_name or "VALIDATOR" in normalized_name:
            continue
        if normalized_exchange and card_exchange and card_exchange != normalized_exchange:
            continue

        candidates.append(
            {
                "name": safe_name,
                "path": model_path,
                "normalized_name": normalized_name,
                "exchange": card_exchange,
                "target_pct": _as_float(card.get("target_pct")),
                "stop_loss_pct": _as_float(card.get("stop_loss_pct")),
                "buy_threshold": _as_float(card.get("buyThreshold")),
                "meta_threshold": _as_float(card.get("meta_threshold")),
                "look_forward_days": _as_float(card.get("look_forward_days")),
                "card": card,
            }
        )

    return candidates


def _score_candidate_for_regime(candidate: dict[str, Any], regime: str) -> float:
    """
    Score models using both metadata and filename hints.
    This keeps the selector open to any number of models instead of hard-coding 2.
    """
    target_pct = candidate.get("target_pct")
    stop_loss_pct = candidate.get("stop_loss_pct")
    threshold = candidate.get("buy_threshold")
    meta_threshold = candidate.get("meta_threshold")
    look_forward_days = candidate.get("look_forward_days")
    name = candidate.get("normalized_name", "")

    score = 0.0
    if target_pct is not None:
        score += min(max(target_pct, 0.0), 1.0) * 100.0
    if stop_loss_pct is not None:
        score -= min(max(stop_loss_pct, 0.0), 1.0) * 50.0
    if threshold is not None:
        score += min(max(threshold, 0.0), 1.0) * 20.0
    if meta_threshold is not None:
        score += min(max(meta_threshold, 0.0), 1.0) * 10.0
    if look_forward_days is not None:
        score += min(max(look_forward_days, 0.0), 90.0) * 0.05

    bull_keywords = ("KING", "BULL", "MOMO", "MOMENTUM", "GROWTH", "ALPHA", "AGGR")
    defensive_keywords = ("SAFE", "DEF", "DEFENSIVE", "VALUE", "LOWVOL", "EGX", "STABLE")

    if regime in ("STRONG_BULL", "BULL"):
        if any(token in name for token in bull_keywords):
            score += 35.0
        if any(token in name for token in defensive_keywords):
            score -= 10.0
        if target_pct is not None:
            score += min(max(target_pct, 0.0), 1.0) * 120.0
    else:
        if any(token in name for token in defensive_keywords):
            score += 30.0
        if any(token in name for token in bull_keywords):
            score -= 8.0
        if stop_loss_pct is not None:
            score -= min(max(stop_loss_pct, 0.0), 1.0) * 80.0
        if target_pct is not None:
            score -= min(max(target_pct, 0.0), 1.0) * 30.0

    return score


def recommend_model_from_pool(
    index_data: pd.DataFrame,
    models_dir: str,
    exchange: Optional[str] = None,
    current_date: Optional[datetime] = None,
    model_names: Optional[Iterable[str]] = None,
    selector: Optional[AdaptiveModelSelector] = None,
) -> tuple[str, RegimeInfo, list[dict[str, Any]]]:
    """
    Returns the recommended model path from an arbitrary pool of local models.
    """
    selector = selector or AdaptiveModelSelector()
    regime_info = selector.detect_market_regime(index_data, current_date)
    candidates = discover_model_candidates(
        models_dir=models_dir,
        exchange=exchange,
        model_names=model_names,
    )

    if not candidates:
        return regime_info.recommended_model, regime_info, []

    chosen = max(
        candidates,
        key=lambda item: _score_candidate_for_regime(item, regime_info.regime),
    )
    regime_info.recommended_model = chosen["path"]
    regime_info.reason = (
        f"{regime_info.reason}. Adaptive pool picked {chosen['name']} "
        f"from {len(candidates)} candidate model(s)."
    )
    return chosen["path"], regime_info, candidates


def test_selector():
    """
    اختبار سريع للـSelector
    """
    print("🧪 Testing Adaptive Model Selector...")

    # بيانات وهمية للاختبار
    dates = pd.date_range("2022-01-01", "2024-12-31", freq="D")

    # Simulate bull market in 2022-2023, sideways in 2024
    prices_2022 = np.linspace(10000, 14000, 365)  # +40% bull
    prices_2023 = np.linspace(14000, 20000, 365)  # +43% bull
    prices_2024 = np.linspace(20000, 21000, 366)  # +5% sideways

    prices = np.concatenate([prices_2022, prices_2023, prices_2024])

    # Add noise
    noise = np.random.normal(0, 100, len(prices))
    prices = prices + noise

    df = pd.DataFrame(
        {
            "Close": prices,
            "High": prices * 1.02,
            "Low": prices * 0.98,
            "Volume": np.random.randint(1000000, 5000000, len(prices)),
        },
        index=dates,
    )

    # Test
    selector = AdaptiveModelSelector()

    # Test each year
    for year in [2022, 2023, 2024]:
        test_date = datetime(year, 6, 1)
        regime = selector.detect_market_regime(df, test_date)

        print(f"\n📅 {year}-06-01:")
        print(f"   Regime: {regime.regime}")
        print(f"   Model: {regime.recommended_model.split('/')[-1]}")
        print(f"   Momentum: {regime.momentum_score:.1f}%")
        print(f"   Confidence: {regime.confidence:.1%}")
        print(f"   Reason: {regime.reason}")

    print("\n✅ Test complete!")


if __name__ == "__main__":
    test_selector()
