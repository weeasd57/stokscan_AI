#!/usr/bin/env python
"""
Real Adaptive Model Selection Backtest
اختبار حقيقي للنظام التكيفي لاختيار الموديل

ماذا يفعل هذا السكريبت؟
- يسحب بيانات EGX والأسهم من Supabase فقط.
- يسحب بيانات EGX30 من Supabase فقط.
- يجهّز نفس الـ features المستخدمة في الباك تست الفعلي.
- يشغّل الموديلات فعلياً: KING.pkl و model_EGX.pkl.
- يختار الموديل المناسب عند تاريخ كل صفقة حسب حالة السوق بدون look-ahead.
- يقارن أداء النظام التكيفي أمام كل موديل ثابت.

مهم:
- لا توجد بيانات وهمية.
- لا توجد عوائد مكتوبة يدوياً.
- لو Supabase غير متاح أو الداتا ناقصة، الاختبار يفشل بصراحة.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

import numpy as np
import pandas as pd
from dotenv import load_dotenv

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))
load_dotenv(project_root / ".env")
load_dotenv(project_root / "web" / ".env.local", override=True)

import api.stock_ai as stock_ai
from api.adaptive_model_selector import AdaptiveModelSelector
from api.backtest_radar import load_model, run_radar_simulation
from api.trading_config import TradingParameters
from api.train_exchange_model import (
    add_market_context,
    add_massive_features,
    add_technical_indicators,
    fetch_fundamentals_for_exchange,
)
from api.unified_features import FeatureEngineeringManager

FEATURE_BUFFER_DAYS = 365
SIM_BUFFER_DAYS = 90
DEFAULT_MODELS = ("KING.pkl", "model_EGX.pkl")


# =============================================================================
# Supabase loading
# =============================================================================


def require_supabase():
    """Initialize and return the Supabase client. Fail loudly if unavailable."""
    stock_ai._init_supabase(force=True)
    if stock_ai.supabase is None:
        raise RuntimeError(
            "Supabase client is not initialized. Check NEXT_PUBLIC_SUPABASE_URL "
            "and SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY."
        )
    return stock_ai.supabase


def _fetch_paginated(build_query, page_size: int = 1000) -> list[dict]:
    """Fetch all rows from a Supabase query builder factory."""
    rows: list[dict] = []
    offset = 0

    while True:
        res = build_query().range(offset, offset + page_size - 1).execute()
        page = res.data or []
        if not page:
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    return rows


def _normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """Return a DataFrame with both lowercase and title-case OHLCV columns."""
    if df.empty:
        return df

    out = df.copy()
    out.columns = [str(c).strip() for c in out.columns]
    lower_map = {c.lower(): c for c in out.columns}

    if "date" in lower_map:
        out[lower_map["date"]] = pd.to_datetime(out[lower_map["date"]], errors="coerce")
        out = out.dropna(subset=[lower_map["date"]]).set_index(lower_map["date"])
    elif "ts" in lower_map:
        out[lower_map["ts"]] = pd.to_datetime(out[lower_map["ts"]], errors="coerce")
        out = out.dropna(subset=[lower_map["ts"]]).set_index(lower_map["ts"])
    elif not isinstance(out.index, pd.DatetimeIndex):
        out.index = pd.to_datetime(out.index, errors="coerce")
        out = out[~out.index.isna()]

    out = out.sort_index()
    out.index = pd.DatetimeIndex(out.index).tz_localize(None)

    # Find lowercase source columns; if open/high/low missing, use close fallback.
    lower_map = {c.lower(): c for c in out.columns}
    close_src = lower_map.get("close") or lower_map.get("Close".lower())
    if close_src is None:
        raise ValueError("OHLCV data has no close column")

    for raw_col in ["open", "high", "low", "close", "volume"]:
        src = lower_map.get(raw_col)
        if src is None:
            if raw_col == "volume":
                out[raw_col] = 0.0
            else:
                out[raw_col] = pd.to_numeric(out[close_src], errors="coerce")
        else:
            out[raw_col] = pd.to_numeric(out[src], errors="coerce")

    out["Open"] = out["open"]
    out["High"] = out["high"]
    out["Low"] = out["low"]
    out["Close"] = out["close"]
    out["Volume"] = out["volume"]
    return out


def load_index_data_from_supabase(
    start_date: str,
    end_date: str,
    *,
    lookback_buffer_days: int = 120,
) -> pd.DataFrame:
    """Load EGX30 index data strictly from Supabase."""
    sb = require_supabase()
    start_dt = pd.to_datetime(start_date) - timedelta(days=lookback_buffer_days)
    end_dt = pd.to_datetime(end_date)

    candidates: Tuple[Tuple[str, str], ...] = (
        ("EGX30", "INDX"),
        ("EGX30.INDX", "EGX"),
        ("EGX30-INDEX", "EGX"),
        ("EGX30", "EGX"),
    )

    print(f"📊 Loading EGX30 from Supabase: {start_dt.date()} → {end_dt.date()}")

    for symbol, exchange in candidates:

        def build_query(symbol=symbol, exchange=exchange):
            return (
                sb.table("stock_prices")
                .select("date,open,high,low,close,volume")
                .eq("symbol", symbol)
                .eq("exchange", exchange)
                .gte("date", start_dt.strftime("%Y-%m-%d"))
                .lte("date", end_dt.strftime("%Y-%m-%d"))
                .order("date", desc=False)
            )

        rows = _fetch_paginated(build_query)
        if rows:
            df = _normalize_ohlcv(pd.DataFrame(rows))
            if len(df) >= 20:
                print(f"   ✅ EGX30 loaded as {symbol}/{exchange}: {len(df)} rows")
                return df

    raise RuntimeError(
        "Could not load EGX30 index from Supabase. Tried: "
        + ", ".join(f"{s}/{e}" for s, e in candidates)
    )


def load_exchange_data_from_supabase(
    exchange: str,
    start_date: str,
    end_date: str,
) -> Dict[str, pd.DataFrame]:
    """Load exchange stock prices strictly from Supabase."""
    require_supabase()
    buffer_start = (
        pd.to_datetime(start_date) - timedelta(days=FEATURE_BUFFER_DAYS)
    ).strftime("%Y-%m-%d")

    print(
        f"📥 Loading {exchange} stock data from Supabase: {buffer_start} → {end_date}"
    )
    data_map = stock_ai._get_exchange_bulk_data(
        exchange,
        from_date=buffer_start,
        to_date=end_date,
        bypass_min_limit=True,
    )
    if not data_map:
        raise RuntimeError(f"No {exchange} stock data returned from Supabase")

    normalized: Dict[str, pd.DataFrame] = {}
    for symbol, df in data_map.items():
        if df is None or df.empty:
            continue
        try:
            normalized[str(symbol).upper()] = _normalize_ohlcv(df)
        except Exception as exc:
            print(f"   ⚠️ Skipping {symbol}: failed to normalize OHLCV ({exc})")

    if not normalized:
        raise RuntimeError(f"No usable {exchange} OHLCV data after normalization")

    print(f"   ✅ Loaded {len(normalized)} symbols from Supabase")
    return normalized


def load_fundamentals_from_supabase(exchange: str) -> pd.DataFrame:
    sb = require_supabase()
    if exchange.upper() == "CRYPTO":
        return pd.DataFrame()

    print(f"📚 Loading fundamentals for {exchange} from Supabase...")
    try:
        df_funds = fetch_fundamentals_for_exchange(sb, exchange.upper())
        if df_funds is not None and not df_funds.empty:
            print(f"   ✅ Loaded fundamentals: {len(df_funds)} rows")
            return df_funds
    except Exception as exc:
        print(f"   ⚠️ Fundamentals failed: {exc}")
    return pd.DataFrame()


# =============================================================================
# Model and feature preparation
# =============================================================================


def load_required_models(
    models_dir: Path, model_names: Iterable[str]
) -> Dict[str, Any]:
    models: Dict[str, Any] = {}
    for model_name in model_names:
        path = models_dir / model_name
        if not path.exists():
            raise FileNotFoundError(f"Model not found: {path}")
        print(f"🤖 Loading model: {model_name}")
        model_obj = load_model(str(path))
        if model_obj is None:
            raise RuntimeError(f"Failed to load model: {path}")
        models[model_name] = model_obj
    return models


def model_threshold(model_obj: Any) -> float:
    params = TradingParameters.from_model_artifact(model_obj)
    threshold = params.king_threshold

    if isinstance(model_obj, dict):
        threshold = (
            model_obj.get("optimal_threshold")
            or model_obj.get("meta_threshold")
            or model_obj.get("king_threshold")
            or threshold
        )
        pm: Dict[str, Any] = (
            model_obj.get("primary_model")
            if isinstance(model_obj.get("primary_model"), dict)
            else {}
        )
        threshold = pm.get("optimal_threshold") or pm.get("meta_threshold") or threshold

    try:
        return float(threshold)
    except Exception:
        return 0.5


def prepare_symbol_features(
    data_map: Dict[str, pd.DataFrame],
    market_df: pd.DataFrame,
    df_funds: pd.DataFrame,
    start_dt: pd.Timestamp,
    end_dt: pd.Timestamp,
    *,
    symbols: Optional[set[str]] = None,
    max_symbols: Optional[int] = None,
) -> Dict[str, pd.DataFrame]:
    """Prepare feature frames once and reuse them for all models."""
    params = TradingParameters()
    fem = FeatureEngineeringManager(params)
    prepared: Dict[str, pd.DataFrame] = {}

    selected_symbols = sorted(data_map.keys())
    if symbols:
        selected_symbols = [s for s in selected_symbols if s.upper() in symbols]
    if max_symbols and max_symbols > 0:
        selected_symbols = selected_symbols[:max_symbols]

    sim_buffer_start = start_dt - timedelta(days=SIM_BUFFER_DAYS)

    print(f"🧱 Preparing features for {len(selected_symbols)} symbols...")

    for idx, symbol in enumerate(selected_symbols, start=1):
        df = data_map[symbol]
        if df.empty or len(df) < 60:
            continue

        try:
            readiness = fem.check_data_ready(df)
            if not readiness.is_ready:
                continue

            original_index = pd.DatetimeIndex(df.index).tz_localize(None)

            df_feat = add_technical_indicators(df)
            if df_feat.empty:
                continue
            if len(df_feat) == len(df):
                df_feat.index = original_index

            df_feat = add_massive_features(df_feat)
            if market_df is not None and not market_df.empty:
                df_feat = add_market_context(df_feat, market_df)

            df_feat["symbol"] = symbol
            if df_funds is not None and not df_funds.empty:
                df_feat = df_feat.join(
                    df_funds.set_index("symbol"), on="symbol", how="left"
                )

            if len(df_feat) == len(df):
                df_feat.index = original_index

            fund_score_raw = (
                df_feat["fund_score"] if "fund_score" in df_feat.columns else None
            )
            df_feat = df_feat.replace([np.inf, -np.inf], np.nan).fillna(0)
            if fund_score_raw is not None:
                df_feat["fund_score"] = fund_score_raw

            idx_clean = pd.DatetimeIndex(df_feat.index).tz_localize(None)
            df_feat.index = idx_clean
            mask = (df_feat.index >= sim_buffer_start) & (df_feat.index <= end_dt)
            df_sim = df_feat.loc[mask].copy()

            # Need enough buffered bars for indicators and trade simulation.
            if len(df_sim) >= 30 and (df_sim.index >= start_dt).any():
                prepared[symbol] = df_sim

        except Exception as exc:
            print(f"   ⚠️ {symbol}: feature preparation failed ({exc})")

        if idx % 25 == 0:
            print(
                f"   Progress: {idx}/{len(selected_symbols)} symbols, prepared={len(prepared)}"
            )

    if not prepared:
        raise RuntimeError("No symbols were prepared successfully")

    print(f"   ✅ Prepared {len(prepared)} symbols")
    return prepared


# =============================================================================
# Backtesting and metrics
# =============================================================================


def _normalize_trade_dates(trades: pd.DataFrame) -> pd.DataFrame:
    out = trades.copy()
    if "Entry_Date" in out.columns:
        out["Entry_Datetime"] = pd.to_datetime(out["Entry_Date"], errors="coerce")
    elif "Date" in out.columns:
        out["Entry_Datetime"] = pd.to_datetime(
            out["Date"], dayfirst=True, errors="coerce"
        )
    else:
        out["Entry_Datetime"] = pd.NaT

    if "Exit_Date" in out.columns:
        out["Exit_Datetime"] = pd.to_datetime(out["Exit_Date"], errors="coerce")
    else:
        out["Exit_Datetime"] = out["Entry_Datetime"]

    return out.dropna(subset=["Entry_Datetime"]).sort_values("Entry_Datetime")


def accepted_trades(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty:
        return trades.copy()
    status = trades.get("Status", "Accepted")
    if not isinstance(status, pd.Series):
        return trades.copy()
    return trades[
        status.fillna("Accepted").astype(str).str.lower().eq("accepted")
    ].copy()


def to_naive_timestamp(
    value: Any, fallback: Optional[pd.Timestamp] = None
) -> pd.Timestamp:
    ts = pd.to_datetime(value, errors="coerce")
    if pd.isna(ts):
        return fallback if fallback is not None else pd.NaT
    ts = pd.Timestamp(ts)
    if ts.tzinfo is not None:
        return ts.tz_convert(None)
    return ts.tz_localize(None)


def calculate_metrics(trades: pd.DataFrame, capital: float) -> Dict[str, float]:
    if trades is None or trades.empty:
        return {
            "trades": 0,
            "win_rate": 0.0,
            "profit_pct": 0.0,
            "net_profit": 0.0,
            "final_capital": capital,
            "avg_return_per_trade": 0.0,
        }

    executed = accepted_trades(trades)
    if executed.empty:
        return {
            "trades": 0,
            "win_rate": 0.0,
            "profit_pct": 0.0,
            "net_profit": 0.0,
            "final_capital": capital,
            "avg_return_per_trade": 0.0,
        }

    pnl_src = (
        executed["PnL_Pct"]
        if "PnL_Pct" in executed.columns
        else pd.Series(0.0, index=executed.index)
    )
    size_src = (
        executed["Size_Multiplier"]
        if "Size_Multiplier" in executed.columns
        else pd.Series(1.0, index=executed.index)
    )
    pnl = pd.Series(
        pd.to_numeric(pnl_src, errors="coerce"), index=executed.index
    ).fillna(0.0)
    size_mult = pd.Series(
        pd.to_numeric(size_src, errors="coerce"), index=executed.index
    ).fillna(1.0)
    position_cash = (capital / 10.0) * size_mult
    profit_cash = position_cash * pnl
    net_profit = float(profit_cash.sum())
    trade_count = int(len(executed))
    win_rate = float((pnl > 0).sum() / trade_count * 100) if trade_count else 0.0

    return {
        "trades": trade_count,
        "win_rate": win_rate,
        "profit_pct": float(net_profit / capital * 100),
        "net_profit": net_profit,
        "final_capital": float(capital + net_profit),
        "avg_return_per_trade": float(pnl.mean() * 100) if trade_count else 0.0,
    }


def run_static_model_backtest(
    model_name: str,
    model_obj: Any,
    prepared_data: Dict[str, pd.DataFrame],
    start_dt: pd.Timestamp,
    end_dt: pd.Timestamp,
    *,
    capital: float,
    min_volume_ratio: float,
    use_rsi_filter: bool,
    use_trend_filter: bool,
    use_market_regime: bool,
    trading_mode: str,
    adaptive_exits: bool,
    quiet: bool,
) -> Tuple[pd.DataFrame, Dict[str, float]]:
    threshold = model_threshold(model_obj)
    all_logs: list[pd.DataFrame] = []

    print(f"\n▶️ Running real backtest for {model_name} | threshold={threshold:.4f}")

    for idx, (symbol, df_sim) in enumerate(prepared_data.items(), start=1):
        try:
            res = run_radar_simulation(
                df_sim,
                model_obj,
                council=None,
                threshold=threshold,
                sim_start_dt=start_dt,
                sim_end_dt=end_dt,
                quiet=quiet,
                capital=int(capital),
                min_volume_ratio=min_volume_ratio,
                use_rsi_filter=use_rsi_filter,
                use_trend_filter=use_trend_filter,
                use_market_regime=use_market_regime,
                trading_mode=trading_mode,
                adaptive_exits=adaptive_exits,
            )
            if isinstance(res, dict) and res.get("Trades Log") is not None:
                log = res["Trades Log"]
                if isinstance(log, pd.DataFrame) and not log.empty:
                    log = log.copy()
                    log["Model"] = model_name
                    log["Source_Symbol"] = symbol
                    all_logs.append(log)
        except Exception as exc:
            print(f"   ⚠️ {model_name}/{symbol}: backtest failed ({exc})")

        if idx % 25 == 0:
            print(f"   {model_name}: processed {idx}/{len(prepared_data)} symbols")

    if all_logs:
        trades = _normalize_trade_dates(pd.concat(all_logs, ignore_index=True))
    else:
        trades = pd.DataFrame()

    metrics = calculate_metrics(trades, capital)
    print_metrics(model_name, metrics)
    return trades, metrics


def build_adaptive_trades(
    static_trades: Dict[str, pd.DataFrame],
    selector: AdaptiveModelSelector,
    index_df: pd.DataFrame,
    capital: float,
) -> Tuple[pd.DataFrame, Dict[str, float], pd.DataFrame]:
    """
    Build executed adaptive trades from real static model trade candidates.

    The selector is evaluated at each trade entry date using only index history
    up to that date. A trade is kept only if its model matches the recommended
    model at that entry date.
    """
    candidates = []
    regime_rows = []

    for model_name, trades in static_trades.items():
        if trades is None or trades.empty:
            continue
        executed = accepted_trades(_normalize_trade_dates(trades))
        if executed.empty:
            continue
        candidates.append(executed)

    if not candidates:
        empty = pd.DataFrame()
        return empty, calculate_metrics(empty, capital), empty

    all_candidates = pd.concat(candidates, ignore_index=True)
    selected_rows = []

    for _, row in all_candidates.iterrows():
        entry_dt = to_naive_timestamp(row["Entry_Datetime"])
        if pd.isna(entry_dt):
            continue
        regime = selector.detect_market_regime(index_df, entry_dt.to_pydatetime())
        recommended_model = Path(regime.recommended_model).name

        regime_rows.append(
            {
                "date": entry_dt,
                "symbol": row.get("Symbol") or row.get("Source_Symbol"),
                "candidate_model": row.get("Model"),
                "recommended_model": recommended_model,
                "regime": regime.regime,
                "confidence": regime.confidence,
                "momentum": regime.momentum_score,
                "volatility": regime.volatility_score,
                "trend_strength": regime.trend_strength,
                "accepted_by_adaptive": row.get("Model") == recommended_model,
                "reason": regime.reason,
            }
        )

        if row.get("Model") == recommended_model:
            enriched = row.copy()
            enriched["Adaptive_Regime"] = regime.regime
            enriched["Adaptive_Confidence"] = regime.confidence
            enriched["Adaptive_Momentum"] = regime.momentum_score
            enriched["Adaptive_Volatility"] = regime.volatility_score
            enriched["Adaptive_Recommended_Model"] = recommended_model
            enriched["Adaptive_Reason"] = regime.reason
            selected_rows.append(enriched)

    if not selected_rows:
        empty = pd.DataFrame()
        return empty, calculate_metrics(empty, capital), pd.DataFrame(regime_rows)

    adaptive = pd.DataFrame(selected_rows)
    adaptive = _normalize_trade_dates(adaptive)

    # Prevent overlapping trades on the same symbol after merging candidates.
    adaptive = adaptive.sort_values(
        ["Entry_Datetime", "Radar_Score"], ascending=[True, False], na_position="last"
    )
    kept = []
    last_exit_by_symbol: Dict[str, pd.Timestamp] = {}

    for _, row in adaptive.iterrows():
        symbol = str(row.get("Symbol") or row.get("Source_Symbol") or "UNKNOWN")
        entry_dt = to_naive_timestamp(row["Entry_Datetime"])
        exit_dt = to_naive_timestamp(row.get("Exit_Datetime"), fallback=entry_dt)
        if pd.isna(entry_dt):
            continue

        last_exit = last_exit_by_symbol.get(symbol)
        if last_exit is not None and entry_dt <= last_exit:
            continue

        kept.append(row)
        last_exit_by_symbol[symbol] = exit_dt

    adaptive_final = pd.DataFrame(kept) if kept else pd.DataFrame()
    metrics = calculate_metrics(adaptive_final, capital)
    return adaptive_final, metrics, pd.DataFrame(regime_rows)


# =============================================================================
# Reporting
# =============================================================================


def print_metrics(label: str, metrics: Dict[str, float]) -> None:
    print(
        f"   {label:16s} | trades={metrics['trades']:4.0f} | "
        f"win={metrics['win_rate']:5.1f}% | "
        f"profit={metrics['profit_pct']:+8.2f}% | "
        f"final={metrics['final_capital']:,.0f} EGP"
    )


def print_comparison(
    static_metrics: Dict[str, Dict[str, float]], adaptive_metrics: Dict[str, float]
) -> None:
    print("\n" + "=" * 100)
    print("📊 REAL ADAPTIVE MODEL SELECTION RESULTS")
    print("=" * 100)
    for model_name, metrics in static_metrics.items():
        print_metrics(model_name, metrics)
    print("-" * 100)
    print_metrics("ADAPTIVE", adaptive_metrics)

    best_static_name, best_static = max(
        static_metrics.items(), key=lambda item: item[1].get("profit_pct", -999999)
    )
    improvement = adaptive_metrics["profit_pct"] - best_static["profit_pct"]

    print("-" * 100)
    print(f"Best static model: {best_static_name} ({best_static['profit_pct']:+.2f}%)")
    print(f"Adaptive vs best static: {improvement:+.2f} percentage points")

    if improvement > 2:
        print("✅ النظام التكيفي أفضل بوضوح على الاختبار الحقيقي")
    elif improvement > 0:
        print("✅ النظام التكيفي أفضل قليلاً على الاختبار الحقيقي")
    elif improvement > -2:
        print("⚠️ النظام التكيفي قريب جداً من أفضل موديل ثابت")
    else:
        print("❌ النظام التكيفي أسوأ من أفضل موديل ثابت — محتاج ضبط قواعد الاختيار")
    print("=" * 100)


def save_outputs(
    output_dir: Path,
    regime_summary: pd.DataFrame,
    static_trades: Dict[str, pd.DataFrame],
    static_metrics: Dict[str, Dict[str, float]],
    adaptive_trades: pd.DataFrame,
    adaptive_metrics: Dict[str, float],
    adaptive_decisions: pd.DataFrame,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    regime_summary.to_csv(output_dir / f"regime_summary_{stamp}.csv", index=False)
    adaptive_decisions.to_csv(
        output_dir / f"adaptive_decisions_{stamp}.csv", index=False
    )
    adaptive_trades.to_csv(output_dir / f"adaptive_trades_{stamp}.csv", index=False)

    for model_name, trades in static_trades.items():
        safe_name = model_name.replace(".pkl", "").replace(" ", "_")
        trades.to_csv(
            output_dir / f"static_{safe_name}_trades_{stamp}.csv", index=False
        )

    summary = {
        "static_metrics": static_metrics,
        "adaptive_metrics": adaptive_metrics,
    }
    with open(output_dir / f"summary_{stamp}.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\n💾 Saved real adaptive test outputs to: {output_dir}")


# =============================================================================
# Main
# =============================================================================


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Real adaptive model selection backtest"
    )
    parser.add_argument("--exchange", default="EGX")
    parser.add_argument("--start", default="2022-01-01")
    parser.add_argument("--end", default="2024-12-31")
    parser.add_argument("--capital", type=float, default=100000.0)
    parser.add_argument("--models-dir", default=str(project_root / "api" / "models"))
    parser.add_argument("--king-model", default="KING.pkl")
    parser.add_argument("--egx-model", default="model_EGX.pkl")
    parser.add_argument(
        "--max-symbols", type=int, default=None, help="Optional quick-test limit"
    )
    parser.add_argument(
        "--symbols", default=None, help="Comma-separated symbols for targeted test"
    )
    parser.add_argument("--output-dir", default="adaptive_test_results")
    parser.add_argument("--min-volume-ratio", type=float, default=0.3)
    parser.add_argument("--no-rsi-filter", action="store_true")
    parser.add_argument("--use-trend-filter", action="store_true")
    parser.add_argument("--no-market-regime", action="store_true")
    parser.add_argument(
        "--trading-mode", default="hybrid", choices=["hybrid", "aggressive"]
    )
    parser.add_argument("--adaptive-exits", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--no-save", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    start_dt = pd.to_datetime(args.start).tz_localize(None)
    end_dt = pd.to_datetime(args.end).tz_localize(None)
    exchange = args.exchange.strip().upper()
    models_dir = Path(args.models_dir)

    print("=" * 100)
    print("🧪 REAL ADAPTIVE MODEL SELECTION TEST")
    print("=" * 100)
    print(f"Exchange: {exchange}")
    print(f"Period:   {start_dt.date()} → {end_dt.date()}")
    print(f"Capital:  {args.capital:,.0f} EGP")
    print("Data:     Supabase only")
    print("=" * 100)

    models = load_required_models(models_dir, (args.king_model, args.egx_model))

    selector = AdaptiveModelSelector(
        king_model_path=str(models_dir / args.king_model),
        egx_model_path=str(models_dir / args.egx_model),
    )

    index_df = load_index_data_from_supabase(args.start, args.end)
    data_map = load_exchange_data_from_supabase(exchange, args.start, args.end)
    df_funds = load_fundamentals_from_supabase(exchange)

    selected_symbols = None
    if args.symbols:
        selected_symbols = {
            s.strip().upper() for s in args.symbols.split(",") if s.strip()
        }

    prepared = prepare_symbol_features(
        data_map,
        index_df,
        df_funds,
        start_dt,
        end_dt,
        symbols=selected_symbols,
        max_symbols=args.max_symbols,
    )

    regime_summary = selector.get_regime_summary(index_df, start_dt, end_dt)

    print("\n📈 Regime distribution:")
    if not regime_summary.empty:
        for regime, count in regime_summary["regime"].value_counts().items():
            pct = count / len(regime_summary) * 100
            print(f"   {regime:12s}: {count:3d} months ({pct:5.1f}%)")

    static_trades: Dict[str, pd.DataFrame] = {}
    static_metrics: Dict[str, Dict[str, float]] = {}

    for model_name, model_obj in models.items():
        trades, metrics = run_static_model_backtest(
            model_name,
            model_obj,
            prepared,
            start_dt,
            end_dt,
            capital=args.capital,
            min_volume_ratio=args.min_volume_ratio,
            use_rsi_filter=not args.no_rsi_filter,
            use_trend_filter=args.use_trend_filter,
            use_market_regime=not args.no_market_regime,
            trading_mode=args.trading_mode,
            adaptive_exits=args.adaptive_exits,
            quiet=not args.verbose,
        )
        static_trades[model_name] = trades
        static_metrics[model_name] = metrics

    adaptive_trades, adaptive_metrics, adaptive_decisions = build_adaptive_trades(
        static_trades,
        selector,
        index_df,
        args.capital,
    )

    print_comparison(static_metrics, adaptive_metrics)

    if not args.no_save:
        save_outputs(
            Path(args.output_dir),
            regime_summary,
            static_trades,
            static_metrics,
            adaptive_trades,
            adaptive_metrics,
            adaptive_decisions,
        )

    return static_metrics, adaptive_metrics


if __name__ == "__main__":
    main()
