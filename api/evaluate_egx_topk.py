"""Evaluate a saved EGX candidate as a daily, capacity-limited trade selector.

Run from the repository root:
    python -m api.evaluate_egx_topk --model model_EGX_candidate_v2_20260924.pkl

This is an offline diagnostic. It does not select or publish a live model.
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from api.train_exchange_model import ModelTrainer
from api.trading_config import TradingParameters
from api.unified_labeling import TripleBarrierLabeler


def score_candidate(frame: pd.DataFrame, artifact: dict, trainer: ModelTrainer) -> np.ndarray:
    """Apply the saved preprocessing and exact feature order used at fit time."""
    features = list(artifact["feature_names"])
    work = frame.copy()
    momentum = list(artifact.get("pca_features") or [])
    if momentum:
        scaler = artifact.get("scaler")
        pca = artifact.get("pca")
        if scaler is None or pca is None:
            raise ValueError("Candidate has PCA features without its fitted scaler/PCA")
        components = pca.transform(scaler.transform(work[momentum].fillna(0)))
        for component in range(components.shape[1]):
            work[f"PCA_Momentum_{component}"] = components[:, component]
    missing = sorted(set(features) - set(work.columns))
    if missing:
        raise ValueError(f"Candidate features absent from the history: {missing}")
    trainer.categorical_features = list(artifact.get("categorical_features") or [])
    X = trainer._clean_dataset(work[features])
    booster = lgb.Booster(model_str=artifact["model_str"])
    return np.asarray(booster.predict(X), dtype=float)


def evaluate_topk(
    signals: pd.DataFrame,
    history: pd.DataFrame,
    params: TradingParameters,
    *,
    top_k: int = 3,
    max_concurrent_positions: int = 5,
    cost_bps: float = 40.0,
    random_seed: int | None = None,
) -> dict:
    """Simulate up to top_k distinct, non-overlapping symbols per session.

    ``signals`` includes only dates from a locked test period.  A score is
    observed after the signal close; fills begin at the following open. Each
    trade uses its signal-day ATR and exactly ``look_forward_days`` bars,
    including the entry session. ``cost_bps`` is an explicit round-trip cost
    scenario, not a claim about an exchange's actual fee schedule.
    """
    if top_k < 1 or max_concurrent_positions < 1 or cost_bps < 0:
        raise ValueError("top_k and max_concurrent_positions must be positive; cost_bps non-negative")
    if signals.empty:
        raise ValueError("No signals to evaluate")

    price_frames = {
        symbol: rows.sort_values("date").reset_index(drop=True)
        for symbol, rows in history.groupby("symbol", observed=True)
    }
    labeler = TripleBarrierLabeler(params)
    rng = np.random.default_rng(random_seed) if random_seed is not None else None
    blocked_until: dict[str, pd.Timestamp] = {}
    active_positions: dict[str, pd.Timestamp] = {}
    trades: list[dict] = []
    skipped = 0
    capacity_blocked = 0
    sessions = 0

    for session, group in signals.groupby("Date", sort=True):
        sessions += 1
        signal_date = pd.Timestamp(session)
        active_positions = {
            symbol: exit_date
            for symbol, exit_date in active_positions.items()
            if exit_date > signal_date
        }
        ordered = (
            group.iloc[rng.permutation(len(group))]
            if rng is not None else group.sort_values("score", ascending=False)
        )
        selected = 0
        for signal in ordered.itertuples(index=False):
            if selected >= top_k:
                break
            if len(active_positions) >= max_concurrent_positions:
                capacity_blocked += 1
                break
            symbol = str(signal.symbol)
            if blocked_until.get(symbol, pd.Timestamp.min) >= signal_date:
                continue
            prices = price_frames.get(symbol)
            if prices is None:
                skipped += 1
                continue
            signal_pos = int(prices["date"].searchsorted(signal_date))
            if signal_pos >= len(prices) or pd.Timestamp(prices.at[signal_pos, "date"]) != signal_date:
                skipped += 1
                continue
            entry_pos = signal_pos + 1
            end_pos = entry_pos + int(params.look_forward_days)
            if end_pos > len(prices):
                skipped += 1
                continue
            entry = float(prices.at[entry_pos, "open"])
            entry_volume = float(prices.at[entry_pos, "volume"])
            atr = float(signal.ATR_14)
            if (not np.isfinite(entry) or entry <= 0 or
                    not np.isfinite(entry_volume) or entry_volume <= 0 or
                    not np.isfinite(atr) or atr <= 0):
                skipped += 1
                continue
            bars = prices.iloc[entry_pos:end_pos][["open", "high", "low", "close", "volume"]].to_dict("records")
            outcome = labeler.backtest_trade(entry, atr, bars, max_bars=params.look_forward_days)
            exit_pos = entry_pos + int(outcome.exit_bars)
            exit_date = pd.Timestamp(prices.at[exit_pos, "date"])
            closes = pd.to_numeric(
                prices.iloc[signal_pos:exit_pos + 1]["close"], errors="coerce"
            )
            extreme_price_change = bool(closes.pct_change().abs().gt(0.50).any())
            blocked_until[symbol] = exit_date
            active_positions[symbol] = exit_date
            gross = float(outcome.pnl_pct) / 100.0
            trades.append({
                "signal_date": str(signal_date.date()),
                "entry_date": str(pd.Timestamp(prices.at[entry_pos, "date"]).date()),
                "exit_date": str(exit_date.date()),
                "symbol": symbol,
                "score": float(signal.score),
                "entry_volume": entry_volume,
                "extreme_price_change": extreme_price_change,
                "target": int(signal.Target),
                "outcome": outcome.outcome,
                "gross_return": gross,
                "net_return": gross - cost_bps / 10_000.0,
            })
            selected += 1

    if not trades:
        raise ValueError("No valid trades in the test period")
    returns = np.array([trade["net_return"] for trade in trades], dtype=float)
    gross = np.array([trade["gross_return"] for trade in trades], dtype=float)
    ordinary_returns = np.array([
        trade["net_return"] for trade in trades if not trade["extreme_price_change"]
    ], dtype=float)
    return {
        "sessions": sessions,
        "trades": len(trades),
        "skipped_invalid_signals": skipped,
        "capacity_blocked_signals": capacity_blocked,
        "max_concurrent_positions": max_concurrent_positions,
        "cost_bps": float(cost_bps),
        "mean_gross_return_pct": float(gross.mean() * 100),
        "mean_net_return_pct": float(returns.mean() * 100),
        "trades_excluding_extreme_price_changes": int(len(ordinary_returns)),
        "mean_net_return_pct_excluding_extreme_price_changes": (
            float(ordinary_returns.mean() * 100) if len(ordinary_returns) else None
        ),
        "extreme_price_change_trades": int(len(trades) - len(ordinary_returns)),
        "median_net_return_pct": float(np.median(returns) * 100),
        "net_win_rate": float((returns > 0).mean()),
        "target_hit_rate": float(np.mean([trade["outcome"] == "TP_HIT" for trade in trades])),
        "positive_label_rate": float(np.mean([trade["target"] for trade in trades])),
        "trade_log": trades,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Candidate filename in api/models")
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--max-positions", type=int, default=5)
    parser.add_argument("--cost-bps", type=float, default=40.0)
    parser.add_argument("--random-runs", type=int, default=5)
    args = parser.parse_args()

    models_dir = Path(__file__).resolve().parent / "models"
    model_path = (models_dir / Path(args.model).name).resolve()
    if model_path.parent != models_dir or model_path.suffix != ".pkl":
        raise ValueError("Model must be a .pkl file inside api/models")
    with model_path.open("rb") as handle:
        artifact = pickle.load(handle)
    if not isinstance(artifact, dict) or artifact.get("kind") != "lgbm_booster":
        raise ValueError("This evaluator needs a saved LightGBM candidate artifact")
    if not artifact.get("test_start_date") or not artifact.get("test_end_date"):
        raise ValueError("Candidate lacks a documented locked test period")

    trainer = ModelTrainer(
        exchange="EGX",
        supabase_url=os.getenv("NEXT_PUBLIC_SUPABASE_URL"),
        supabase_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
    )
    trainer.load_market_data()
    history = trainer.fetch_stock_prices()
    frame = trainer.prepare_training_data(
        history,
        target_pct=float(artifact["target_pct"]),
        stop_loss_pct=float(artifact["stop_loss_pct"]),
        look_forward_days=int(artifact["look_forward_days"]),
        barrier_mode=str(artifact["barrier_mode"]),
    )
    start = pd.Timestamp(artifact["test_start_date"])
    end = pd.Timestamp(artifact["test_end_date"])
    frame = frame.loc[(frame["Date"] >= start) & (frame["Date"] <= end)].copy()
    frame["score"] = score_candidate(frame, artifact, trainer)
    frame = frame.loc[(frame["Volume"] >= 10_000) & np.isfinite(frame["score"])].copy()
    signals = frame[["Date", "symbol", "score", "ATR_14", "Target"]]

    params = TradingParameters.from_model_artifact(artifact)
    # The EGX training target treats volume as a soft feature; match that
    # policy here even for artifacts created before the metadata was fixed.
    params.require_volume_confirmation = False
    selected = evaluate_topk(
        signals, history, params, top_k=args.top_k,
        max_concurrent_positions=args.max_positions, cost_bps=args.cost_bps,
    )
    random_results = [
        evaluate_topk(
            signals, history, params, top_k=args.top_k,
            max_concurrent_positions=args.max_positions,
            cost_bps=args.cost_bps, random_seed=seed,
        )
        for seed in range(args.random_runs)
    ]
    report = {
        "model": model_path.name,
        "test_start_date": str(start.date()),
        "test_end_date": str(end.date()),
        "top_k": args.top_k,
        "max_concurrent_positions": args.max_positions,
        "round_trip_cost_bps": args.cost_bps,
        "eligible_signal_rows": len(signals),
        "eligible_positive_label_rate": float(signals["Target"].mean()),
        "candidate": {key: value for key, value in selected.items() if key != "trade_log"},
        "candidate_trade_log": selected["trade_log"],
        "random_baseline_runs": [
            {key: value for key, value in result.items() if key != "trade_log"}
            for result in random_results
        ],
        "random_mean_net_return_pct": float(np.mean([r["mean_net_return_pct"] for r in random_results])),
        "candidate_excess_over_random_pct_per_trade": float(
            selected["mean_net_return_pct"] - np.mean([r["mean_net_return_pct"] for r in random_results])
        ),
        "cost_sensitivity_mean_net_return_pct": {
            str(bps): float(selected["mean_gross_return_pct"] - bps / 100.0)
            for bps in (20, 40, 60)
        },
    }
    output = models_dir / f"{model_path.name}.daily_topk.json"
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"Report saved: {output}")


if __name__ == "__main__":
    main()
