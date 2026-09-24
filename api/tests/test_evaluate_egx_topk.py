import pandas as pd
import pytest

from api.evaluate_egx_topk import evaluate_topk
from api.trading_config import TradingParameters
from api.unified_labeling import TripleBarrierLabeler


def test_daily_topk_uses_next_open_and_entry_session_exit():
    days = pd.date_range("2026-01-04", periods=3, freq="D")
    history = pd.DataFrame(
        [
            {"symbol": symbol, "date": day, "open": 100.0, "high": high,
             "low": low, "close": 100.0, "volume": 100_000}
            for symbol, highs, lows in (
                ("A", [101.0, 101.0, 101.0], [99.0, 90.0, 99.0]),
                ("B", [101.0, 110.0, 101.0], [99.0, 99.0, 99.0]),
            )
            for day, high, low in zip(days, highs, lows)
        ]
    )
    signals = pd.DataFrame({
        "Date": [days[0], days[0]], "symbol": ["A", "B"],
        "score": [0.9, 0.8], "ATR_14": [2.0, 2.0], "Target": [0, 1],
    })
    params = TradingParameters(
        entry_mode="next_open", look_forward_days=2, barrier_mode="atr_multiplier",
        target_pct=3.0, stop_loss_pct=2.0, require_volume_confirmation=False,
    )

    result = evaluate_topk(signals, history, params, top_k=1, cost_bps=40)

    assert result["trades"] == 1
    assert result["target_hit_rate"] == 0.0
    assert result["mean_gross_return_pct"] == pytest.approx(-4.0)
    assert result["mean_net_return_pct"] == pytest.approx(-4.4)
    assert result["trade_log"][0]["entry_date"] == "2026-01-05"
    assert result["trade_log"][0]["exit_date"] == "2026-01-05"
    assert result["extreme_price_change_trades"] == 0

    random_a = evaluate_topk(signals, history, params, top_k=1, random_seed=42)
    random_b = evaluate_topk(
        signals.assign(score=[0.1, 0.9]), history, params,
        top_k=1, random_seed=42,
    )
    assert [trade["symbol"] for trade in random_a["trade_log"]] == [
        trade["symbol"] for trade in random_b["trade_log"]
    ]
    assert random_a["mean_net_return_pct"] == random_b["mean_net_return_pct"]


def test_daily_topk_respects_concurrent_position_limit():
    days = pd.date_range("2026-01-04", periods=8, freq="D")
    history = pd.DataFrame(
        [
            {"symbol": symbol, "date": day, "open": 100.0, "high": 100.0,
             "low": 100.0, "close": 100.0, "volume": 100_000}
            for symbol in ("A", "B", "C") for day in days
        ]
    )
    signals = pd.DataFrame(
        [{"Date": day, "symbol": symbol, "score": 1.0 - i / 10,
          "ATR_14": 1.0, "Target": 0}
         for day in days[:4] for i, symbol in enumerate(("A", "B", "C"))]
    )
    params = TradingParameters(
        entry_mode="next_open", look_forward_days=3, barrier_mode="percent",
        target_pct=0.10, stop_loss_pct=0.05, require_volume_confirmation=False,
    )

    result = evaluate_topk(
        signals, history, params, top_k=3, max_concurrent_positions=1,
    )

    assert result["trades"] == 2
    assert result["max_concurrent_positions"] == 1
    assert result["capacity_blocked_signals"] > 0
    assert result["trade_log"][0]["exit_date"] <= result["trade_log"][1]["signal_date"]


def test_gap_through_stop_uses_open_price():
    params = TradingParameters(
        look_forward_days=2, barrier_mode="percent", target_pct=0.10,
        stop_loss_pct=0.05, require_volume_confirmation=False,
    )
    outcome = TripleBarrierLabeler(params).backtest_trade(
        100.0, 1.0,
        [{"open": 100.0, "high": 102.0, "low": 99.0, "close": 100.0},
         {"open": 90.0, "high": 95.0, "low": 89.0, "close": 92.0}],
    )

    assert outcome.outcome == "SL_HIT"
    assert outcome.exit_price == 90.0
    assert outcome.exit_bars == 1


def test_zero_volume_entry_cannot_be_filled():
    days = pd.date_range("2026-01-04", periods=3, freq="D")
    history = pd.DataFrame([
        {"symbol": symbol, "date": day, "open": 100.0,
         "high": 101.0, "low": 99.0, "close": 100.0,
         "volume": 0 if symbol == "A" and day == days[1] else 100_000}
        for symbol in ("A", "B") for day in days
    ])
    signals = pd.DataFrame({
        "Date": [days[0], days[0]], "symbol": ["A", "B"],
        "score": [0.9, 0.8], "ATR_14": [1.0, 1.0], "Target": [0, 0],
    })
    params = TradingParameters(
        entry_mode="next_open", look_forward_days=2, barrier_mode="percent",
        target_pct=0.10, stop_loss_pct=0.05, require_volume_confirmation=False,
    )
    result = evaluate_topk(signals, history, params, top_k=1)
    assert result["skipped_invalid_signals"] == 1
    assert result["trade_log"][0]["symbol"] == "B"


def test_extreme_close_jump_is_flagged_in_sensitivity_metric():
    days = pd.date_range("2026-01-04", periods=3, freq="D")
    history = pd.DataFrame([
        {"symbol": "A", "date": days[0], "open": 100.0,
         "high": 101.0, "low": 99.0, "close": 100.0, "volume": 100_000},
        {"symbol": "A", "date": days[1], "open": 100.0,
         "high": 101.0, "low": 99.0, "close": 100.0, "volume": 100_000},
        {"symbol": "A", "date": days[2], "open": 160.0,
         "high": 161.0, "low": 159.0, "close": 160.0, "volume": 100_000},
    ])
    signals = pd.DataFrame({
        "Date": [days[0]], "symbol": ["A"], "score": [0.9],
        "ATR_14": [1.0], "Target": [1],
    })
    params = TradingParameters(
        entry_mode="next_open", look_forward_days=2, barrier_mode="percent",
        target_pct=0.10, stop_loss_pct=0.05,
        require_volume_confirmation=False,
    )
    result = evaluate_topk(signals, history, params, top_k=1)
    assert result["extreme_price_change_trades"] == 1
    assert result["trades_excluding_extreme_price_changes"] == 0
    assert result["mean_net_return_pct_excluding_extreme_price_changes"] is None
    assert result["trade_log"][0]["extreme_price_change"] is True
