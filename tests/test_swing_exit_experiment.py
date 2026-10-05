from types import SimpleNamespace

from scripts.swing_exit_experiment import Policy, extend_allowed, next_exit, simulate, stop_fill


def test_gap_stop_uses_worse_open():
    assert stop_fill(90, 89, 96) == 90


def test_normal_stop_fills_level():
    assert stop_fill(100, 95, 96) == 96


def test_no_stop_hit():
    assert stop_fill(100, 98, 96) is None


def test_five_session_fixed_exit():
    assert next_exit(None, 100, 4, Policy("fixed", extend=False)) is None
    assert next_exit(None, 100, 5, Policy("fixed", extend=False)) == "five_session_review"


def test_strong_trend_extends_not_forced_profit_target():
    bar = SimpleNamespace(close=106, ema5=105, ema10=103, previous_ema10=102)
    assert extend_allowed(bar, 100, .02)
    assert next_exit(bar, 100, 5, Policy("trend")) is None


def test_weak_trend_exits_and_hard_limit_applies():
    bar = SimpleNamespace(close=101, ema5=101, ema10=103, previous_ema10=104)
    assert next_exit(bar, 100, 5, Policy("trend")) == "five_session_review"
    assert next_exit(bar, 100, 7, Policy("trend")) == "trend_break"
    assert next_exit(bar, 100, 15, Policy("trend")) == "max_time"


def fixture_frames(count=35):
    import pandas as pd
    dates = pd.bdate_range("2025-01-01", periods=count).strftime("%Y-%m-%d").tolist()
    bars = {day: SimpleNamespace(date=day, open=100., high=101., low=99., close=100.,
                                 volume=100000, previous_turnover=10_000_000., previous_close=100.,
                                 bar_index=i, ema5=100., ema10=100., previous_ema10=100.)
            for i, day in enumerate(dates)}
    return dates, {"AAA": bars}


def test_five_completed_sessions_exit_next_open_and_include_costs():
    dates, frames = fixture_frames()
    result = simulate(frames, [{"symbol":"AAA", "date":dates[0]}],
                      Policy("fixed", extend=False, max_sessions=5), dates[0], dates[-1])
    trade = result["trades"][0]
    assert trade["exit_date"] == dates[5]
    assert trade["sessions"] == 5
    assert trade["pnl_cash"] < 0  # flat prices still lose execution costs
    assert result["metrics"]["final_equity"] == round(100000 + trade["pnl_cash"], 2)


def test_today_close_trail_cannot_hit_today_low_retroactively():
    dates, frames = fixture_frames()
    frames["AAA"][dates[0]].close = 110
    frames["AAA"][dates[0]].high = 110
    # Initial stop <99; raised close-based trail >99 must wait until tomorrow.
    result = simulate(frames, [{"symbol":"AAA", "date":dates[0]}],
                      Policy("trend"), dates[0], dates[-1])
    assert result["trades"][0]["exit_date"] == dates[1]


def test_overlapping_same_symbol_not_funded_by_future_exit():
    dates, frames = fixture_frames()
    result = simulate(frames, [{"symbol":"AAA", "date":dates[0]},
                              {"symbol":"AAA", "date":dates[1]}],
                      Policy("fixed", extend=False, max_sessions=5), dates[0], dates[-1])
    assert len(result["trades"]) == 1
    assert result["metrics"]["skipped"]["position_capacity"] == 1


def test_simultaneous_positions_respect_cash_and_capacity():
    dates, frames = fixture_frames()
    bars = frames["AAA"]
    frames = {f"S{i}":bars for i in range(6)}
    result = simulate(frames, [{"symbol":s, "date":dates[0]} for s in frames],
                      Policy("fixed", extend=False, max_sessions=5), dates[0], dates[-1])
    assert len(result["trades"]) == 5
    assert result["metrics"]["max_observed_exposure_pct"] <= 50
    assert result["metrics"]["cash_at_end"] > 0


def test_missing_symbol_bar_does_not_reset_market_session_clock():
    dates, frames = fixture_frames()
    frames["BBB"] = dict(frames["AAA"])
    del frames["AAA"][dates[2]]
    result = simulate(frames, [{"symbol":"AAA", "date":dates[0]}],
                      Policy("fixed", extend=False, max_sessions=5), dates[0], dates[-1])
    assert result["trades"][0]["exit_date"] == dates[5]
