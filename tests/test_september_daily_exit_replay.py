from scripts.september_daily_exit_replay import original_levels
from scripts.swing_exit_experiment import Policy, simulate
from tests.test_swing_exit_experiment import fixture_frames


def test_uses_first_original_levels_not_updated_targets():
    row = dict(stop_loss=105, target_price=140, adjustments=[
        dict(timestamp="2026-09-03", old_stop=100, old_target=130),
        dict(timestamp="2026-09-02", old_stop=95, old_target=120)])
    assert original_levels(row) == (95, 120)


def test_month_end_keeps_unmatured_positions_marked():
    dates, frames = fixture_frames()
    run = simulate(frames, [dict(symbol="AAA", date=dates[-1])],
                   Policy("trend"), dates[0], dates[-1], maturity_buffer=0)
    assert len(run["trades"]) == 0
    assert run["metrics"]["open_at_end"] == 1
    assert run["open_positions"][0]["entry_date"] == dates[-1]


def test_same_bar_stop_and_target_uses_conservative_stop_first():
    dates, frames = fixture_frames()
    frames["AAA"][dates[0]].high = 112
    frames["AAA"][dates[0]].low = 92
    run = simulate(frames, [dict(symbol="AAA", date=dates[0], stop_price=95, target_price=110)],
                   Policy("published_levels20", extend=False, max_sessions=20),
                   dates[0], dates[-1], maturity_buffer=0)
    assert run["trades"][0]["reason"] == "stop"
    assert run["trades"][0]["pnl_cash"] < 0
