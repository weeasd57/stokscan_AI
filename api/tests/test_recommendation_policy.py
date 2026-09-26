import pytest
import pandas as pd
from types import SimpleNamespace
from api.recommendation_policy import evaluate_bars, valid_candidate


def bar(day, opening=100, high=104, low=96, close=101):
    return dict(date=f"2026-09-{day:02}", open=opening, high=high, low=low, close=close)


def evaluate(bars, **kwargs):
    return evaluate_bars(entry=100, target=120, stop=90, bars=bars,
                         entry_date="2026-09-01", cursor="2026-09-01", **kwargs)


def test_exit_before_time_limit_and_gap_fill():
    result = evaluate([bar(2, 85, 89, 80, 86)], max_sessions=1)
    assert result["exit_price"] == 85
    assert result["profit_loss_pct"] == pytest.approx(-15)
    assert result["exit_reason"] == "stop_hit"


def test_first_timeout_bar_wins_even_when_job_missed_later_sessions():
    result = evaluate([bar(2), bar(5), bar(6, 110, 115, 108, 112)], max_sessions=2)
    assert result["closed_on"] == "2026-09-05"
    assert result["exit_price"] == 101
    assert result["exit_reason"] == "time_exit"


def test_entry_bar_excluded_and_both_barriers_conservative():
    result = evaluate([bar(1, 100, 130, 80, 100), bar(2, 100, 130, 80, 100)])
    assert result["closed_on"] == "2026-09-02"
    assert result["exit_price"] == 90


def test_trailing_applies_next_bar_and_never_decreases():
    result = evaluate([bar(2, 100, 112, 98, 110), bar(3, 110, 112, 108, 109),
                       bar(4, 107, 109, 105, 106)], trail_pct=.03)
    assert result["closed_on"] == "2026-09-04"
    assert result["exit_price"] == pytest.approx(106.7)
    assert len(result["adjustments"]) == 1


def test_repeated_run_does_not_process_same_bar_again():
    result = evaluate_bars(entry=100, target=120, stop=102, bars=[bar(2)],
                           entry_date="2026-09-01", cursor="2026-09-02")
    assert result["last_close"] is None


@pytest.mark.parametrize("value", [None, 0, -1, float("nan"), float("inf")])
def test_bad_entry_is_rejected(value):
    assert not valid_candidate(dict(last_close=value, target_price=120, stop_loss=90))


def test_new_candidate_geometry_does_not_restrict_legacy_profit_stop():
    assert not valid_candidate(dict(last_close=100, target_price=120, stop_loss=105))
    result = evaluate_bars(entry=100, target=120, stop=105, bars=[bar(2, 104, 106, 103, 104)],
                           entry_date="2026-09-01", cursor="2026-09-01")
    assert result["status"] == "win"


def test_invalid_data_is_not_silently_marked_reviewed():
    with pytest.raises(ValueError):
        evaluate([bar(2, high=90, low=110)])


@pytest.mark.parametrize("signal_close, expected_updates", [(100, 1), (50, 0)])
def test_daily_evaluator_closes_using_hf_archive_when_supabase_has_no_prices(
    monkeypatch, signal_close, expected_updates
):
    from api import daily_bot_run
    import api.hf_history_cache as history
    import api.recommendation_events as events

    recommendation = dict(id="rec-1", symbol="TEST", exchange="EGX", status="open",
        entry_price=100, target_price=110, stop_loss=95, last_close=100,
        created_at="2026-09-01T14:00:00+00:00", updated_at="2026-09-01T14:00:00+00:00",
        adjustments=[], rich_details={"evaluation": {"last_evaluated_date": "2026-09-01"},
            "recommendation_policy": {"max_sessions": 20}})
    archive = pd.DataFrame([
        dict(symbol="TEST", exchange="EGX", date=pd.Timestamp("2026-09-01"),
             open=signal_close, high=signal_close + 1, low=signal_close - 1,
             close=signal_close, volume=1000),
        dict(symbol="TEST", exchange="EGX", date=pd.Timestamp("2026-09-02"),
             open=100, high=112, low=99, close=111, volume=1000),
    ])

    class Query:
        def __init__(self, table):
            self.table = table
            self.fields = ""
            self.patch = None

        def select(self, fields):
            self.fields = fields
            return self

        def update(self, patch):
            self.patch = patch
            return self

        def eq(self, *_args):
            return self

        def gte(self, *_args):
            return self

        def order(self, *_args, **_kwargs):
            return self

        def execute(self):
            if self.table == "stock_prices":
                return SimpleNamespace(data=[])
            if self.patch is not None:
                recommendation.update(self.patch)
                return SimpleNamespace(data=[recommendation.copy()])
            if self.fields == "id":
                return SimpleNamespace(data=[{"id": recommendation["id"]}])
            return SimpleNamespace(data=[recommendation.copy()])

    class Client:
        def table(self, table):
            return Query(table)

    monkeypatch.setattr(daily_bot_run, "supabase", Client())
    monkeypatch.setattr(history, "load_history_snapshot", lambda _exchange: archive)
    monkeypatch.setattr(events, "record_event", lambda *_args, **_kwargs: {"id": "event-1"})
    monkeypatch.setattr(daily_bot_run, "_telegram_recommendation_writes_enabled", lambda: False)

    assert daily_bot_run.evaluate_old_recommendations() == expected_updates
    if expected_updates:
        assert recommendation["status"] == "win"
        assert recommendation["exit_price"] == 110
        assert recommendation["rich_details"]["evaluation"]["closed_on"] == "2026-09-02"
    else:
        assert recommendation["status"] == "open"
        assert "exit_price" not in recommendation
