"""Offline adversarial audit; strict xfails identify unfixed engine defects."""
import copy
import gzip
import json

import pytest

from scripts.swing_exit_experiment import Policy, prepare_entries, prepare_prices, simulate
from tests.test_swing_exit_experiment import fixture_frames


def run(frames, dates, entries, policy=None):
    return simulate(frames, entries, policy or Policy("fixed5", extend=False, max_sessions=5),
                    dates[0], dates[-1], commission=0, slippage=0, maturity_buffer=0)


@pytest.mark.parametrize("missing", [True, False], ids=["missing-bar", "zero-volume"])
@pytest.mark.xfail(strict=True, reason="Time deadline is only scheduled on tradable closes")
def test_elapsed_time_exit_executes_at_first_available_open(missing):
    dates, frames = fixture_frames()
    frames["BBB"] = copy.deepcopy(frames["AAA"])
    if missing:
        del frames["AAA"][dates[4]]
    else:
        frames["AAA"][dates[4]].volume = 0
    result = run(frames, dates, [{"symbol": "AAA", "date": dates[0]}])
    assert result["trades"][0]["exit_date"] == dates[5]


@pytest.mark.xfail(strict=True, reason="NaN recorded entry bypasses compatibility comparison")
def test_nonfinite_recorded_entry_is_rejected():
    dates, frames = fixture_frames()
    sources = [dict(model_name="audit", id="synthetic", threshold=.5,
                    entries=[dict(symbol="AAA", entry_date=dates[20], recorded_entry="NaN")])]
    eligible, _ = prepare_entries(sources, frames)
    assert eligible["audit"] == []


@pytest.mark.xfail(strict=True, reason="Positive infinity passes OHLC and volume validation")
def test_nonfinite_ohlcv_is_rejected(tmp_path):
    path = tmp_path / "prices.json.gz"
    rows = [dict(symbol="AAA", date="2025-01-01", open=100, high=101, low=99,
                 close=100, volume=10000),
            dict(symbol="AAA", date="2025-01-02", open="inf", high="inf", low="inf",
                 close="inf", volume="inf")]
    with gzip.open(path, "wt", encoding="utf-8") as stream:
        json.dump(rows, stream)
    frames, quality = prepare_prices(path, {"AAA"})
    assert quality["invalid_rows"] == 1
    assert "2025-01-02" not in frames["AAA"]


def test_intraday_stop_cannot_release_capacity_for_same_open_entry():
    dates, base = fixture_frames()
    frames = {f"S{i}": copy.deepcopy(base["AAA"]) for i in range(6)}
    frames["S0"][dates[1]].low = 90
    entries = [dict(symbol=f"S{i}", date=dates[0]) for i in range(5)]
    entries.append(dict(symbol="S5", date=dates[1]))
    result = run(frames, dates, entries)
    assert result["metrics"]["skipped"]["position_capacity"] == 1
    assert not any(t["symbol"] == "S5" for t in result["trades"])


def test_gap_stop_does_release_capacity_for_same_open_entry():
    dates, base = fixture_frames()
    frames = {f"S{i}": copy.deepcopy(base["AAA"]) for i in range(6)}
    bar = frames["S0"][dates[1]]
    bar.open, bar.low = 90, 89
    entries = [dict(symbol=f"S{i}", date=dates[0]) for i in range(5)]
    entries.append(dict(symbol="S5", date=dates[1]))
    result = run(frames, dates, entries)
    assert any(t["symbol"] == "S5" for t in result["trades"])


def test_future_prices_do_not_rewrite_completed_equity_prefix():
    dates, frames = fixture_frames()
    altered = copy.deepcopy(frames)
    for day in dates[8:]:
        bar = altered["AAA"][day]
        bar.open, bar.high, bar.low, bar.close = 200, 210, 190, 205
    entries = [dict(symbol="AAA", date=dates[0])]
    original = run(frames, dates, entries, Policy("trend", max_sessions=15))
    changed = run(altered, dates, entries, Policy("trend", max_sessions=15))
    assert original["equity"][:8] == changed["equity"][:8]


def test_unadjusted_split_is_warning_only_and_still_distorts_pnl():
    dates, frames = fixture_frames()
    for day in dates[1:]:
        bar = frames["AAA"][day]
        bar.open, bar.high, bar.low, bar.close = 50, 51, 49, 50
        bar.previous_close = 100 if day == dates[1] else 50
    result = run(frames, dates, [dict(symbol="AAA", date=dates[0])])
    assert result["metrics"]["data_warnings"]["potential_corporate_action"] == 1
    assert result["trades"][0]["net_pct"] == -50


def test_pending_close_exit_ignores_later_intraday_stop():
    dates, frames = fixture_frames()
    frames["AAA"][dates[5]].low = 50
    result = run(frames, dates, [dict(symbol="AAA", date=dates[0])])
    assert result["trades"][0]["reason"] == "max_time"
    assert result["trades"][0]["net_pct"] == 0
