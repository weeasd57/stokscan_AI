"""Small offline fixtures for the standalone frozen-protocol engine."""
import copy
import gzip
import json
from types import SimpleNamespace

import pandas as pd
import pytest

from scripts.swing_research_validation import load_data, run


def market(count=20, symbols=("AAA",)):
    dates = pd.bdate_range("2025-01-01", periods=count).strftime("%Y-%m-%d").tolist()
    frames = {s: {d: SimpleNamespace(open=100., high=101., low=99., close=100.,
                                   volume=100000., prevclose=100., ema5=100.,
                                   ema10=100., prevema10=100.) for d in dates} for s in symbols}
    return dates, frames


def entry(symbol, day):
    return dict(symbol=symbol, date=day, close=100., turnover=10_000_000., atr_pct=.02)


def replay(frames, entries, dates, **kwargs):
    return run(frames, entries, dict(exit="fixed5_atr"), dates[0], dates[-1], cost=0, **kwargs)


def write_prices(tmp_path, rows, name="prices"):
    path = tmp_path / (name + ".json.gz")
    with gzip.open(path, "wt", encoding="utf-8") as stream:
        json.dump(rows, stream)
    return path


def test_signals_use_completed_close_and_are_invariant_to_future_prices(tmp_path):
    dates = pd.bdate_range("2023-01-01", periods=165).strftime("%Y-%m-%d").tolist()
    rows = []
    for i, day in enumerate(dates):
        close = 100 + .5*i
        rows.append(dict(symbol="AAA", date=day, open=close-.1, high=close+.2,
                         low=close-.2, close=close, volume=200000 if i % 5 == 0 else 100000))
    altered = copy.deepcopy(rows)
    for row in altered[146:]:
        for key in ("open", "high", "low", "close"):
            row[key] *= 2
        row["volume"] *= 3
    _, original, _, _ = load_data(write_prices(tmp_path, rows))
    _, changed, _, _ = load_data(write_prices(tmp_path, altered, "altered"))
    assert original["breakout"]  # ensure the causality test is not vacuous
    following = dict(zip(dates, dates[1:]))
    for family, signals in original.items():
        assert all(s["date"] == following[s["signal_date"]] for s in signals)
        before = lambda ss: [s for s in ss if s["signal_date"] <= dates[145]]
        assert before(signals) == before(changed[family])


@pytest.mark.parametrize("field", ["open", "high", "low", "close", "volume"])
@pytest.mark.parametrize("value", ["NaN", "inf", "-inf"])
def test_nonfinite_ohlcv_is_removed(tmp_path, field, value):
    rows = [dict(symbol="AAA", date="2025-01-01", open=100, high=101, low=99,
                 close=100, volume=100000)]
    bad = dict(rows[0], date="2025-01-02")
    bad[field] = value
    frames, _, _, quality = load_data(write_prices(tmp_path, rows + [bad]))
    assert quality["invalid_rows_removed"] == 1
    assert list(frames["AAA"]) == ["2025-01-01"]


@pytest.mark.parametrize("locked_day", [0, 1])
def test_sale_lock_remembers_stop_even_after_price_recovers(locked_day):
    dates, frames = market()
    frames["AAA"][dates[locked_day]].low = 90
    frames["AAA"][dates[2]].open = 101
    result = replay(frames, [entry("AAA", dates[0])], dates)
    trade = result["trades"][0]
    assert trade["exit_date"] == dates[2]
    assert trade["reason"] == "stop_during_sale_lock"
    assert trade["pnl"] == 100


def test_locked_stop_waits_for_first_tradable_eligible_open():
    dates, frames = market(symbols=("AAA", "CAL"))
    frames["AAA"][dates[0]].low = 90
    del frames["AAA"][dates[2]]
    frames["AAA"][dates[3]].open = 90
    frames["AAA"][dates[3]].low = 89
    result = replay(frames, [entry("AAA", dates[0])], dates)
    assert result["trades"][0]["exit_date"] == dates[3]
    assert result["trades"][0]["pnl"] == -1000


@pytest.mark.parametrize("unavailable", ["missing", "zero_volume", "single_price"])
def test_fixed5_deadline_survives_unavailable_review_bar(unavailable):
    dates, frames = market(symbols=("AAA", "CAL"))
    if unavailable == "missing":
        del frames["AAA"][dates[4]]
    elif unavailable == "zero_volume":
        frames["AAA"][dates[4]].volume = 0
    else:
        frames["AAA"][dates[4]].high = frames["AAA"][dates[4]].low = 100
    result = replay(frames, [entry("AAA", dates[0])], dates)
    assert result["trades"][0]["exit_date"] == dates[5]
    assert result["trades"][0]["sessions"] == 5


def test_receivables_count_as_equity_but_cannot_fund_entries_before_due_open():
    dates, frames = market(count=14, symbols=tuple(f"S{i:02d}" for i in range(11)))
    entries = [entry(f"S{i:02d}", dates[0]) for i in range(5)]
    entries += [entry(f"S{i:02d}", dates[5]) for i in range(5, 10)]
    entries += [entry("S10", dates[6]), entry("S10", dates[7])]
    # Release capacity while all sale proceeds remain unsettled. Sale-lock
    # behavior is tested separately; retain the default two-session cash delay.
    for i in range(5, 10):
        frames[f"S{i:02d}"][dates[6]].open = 90
        frames[f"S{i:02d}"][dates[6]].low = 89
    result = replay(frames, entries, dates, min_sell_age=0)
    last = [t for t in result["trades"] if t["symbol"] == "S10"]
    assert len(last) == 1 and last[0]["entry_date"] == dates[7]
    assert result["metrics"]["skipped"]["cash_or_exposure"] == 1
    assert all(r["equity"] == 100000 for r in result["equity"][:6])
    assert all(r["equity"] == 95000 for r in result["equity"][6:])
    assert result["metrics"]["unsettled_cash"] == 9500


def test_missing_next_open_entry_is_not_delayed():
    dates, frames = market(symbols=("AAA", "CAL"))
    del frames["AAA"][dates[0]]
    result = replay(frames, [entry("AAA", dates[0])], dates)
    assert result["trades"] == []
    assert result["metrics"]["open_at_end"] == 0
    assert result["metrics"]["skipped"]["no_executable_bar"] == 1


def test_unexecutable_single_price_bar_still_marks_known_price_loss():
    dates, frames = market(count=2)
    bar = frames["AAA"][dates[1]]
    bar.open = bar.high = bar.low = bar.close = 90
    result = replay(frames, [entry("AAA", dates[0])], dates)
    assert result["trades"] == []  # no fill under the frozen execution convention
    assert result["equity"][-1]["equity"] == 99000
