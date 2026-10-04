import datetime as dt
import pytest
from api.recommendation_policy import candidate_assessment, resolve_signal_reference, profit_protection_stop, evaluate_bars


def history():
    return [dict(date=(dt.date(2026, 9, 15)+dt.timedelta(days=i)).isoformat(),
                 open=110, high=111, low=109, close=110, volume=1000) for i in range(20)]


POLICY = dict(version="atr_profit_protection_v1", effective_from="2026-10-04")


def test_reference_uses_last_actual_session_not_publication_date():
    assert resolve_signal_reference(7.58, [dict(date="2026-08-26", close=7.58)], "2026-08-28")["price_date"] == "2026-08-26"


def test_latest_reference_mismatch_never_searches_older_matching_close():
    bars = [dict(date="2026-09-14", close=100), dict(date="2026-09-15", close=50)]
    result = resolve_signal_reference(100, bars, "2026-09-16")
    assert not result["ok"] and result["reason"] == "incompatible_price_basis"


def test_explicit_missing_and_stale_references_rejected():
    bars = [dict(date="2026-09-01", close=100)]
    assert resolve_signal_reference(100, bars, "2026-09-03", "2026-09-02")["reason"] == "missing_explicit_signal_bar"
    assert resolve_signal_reference(100, bars, "2026-09-30")["reason"] == "stale_signal_reference"
    assert resolve_signal_reference(100, [dict(date="2026-10-04", close=100)], "2026-09-30")["reason"] == "missing_signal_history"


def test_candidate_rejection_preserves_prices_and_actual_rr():
    row = dict(symbol="X", last_close=100, target_price=110, stop_loss=90)
    result = candidate_assessment(row)
    assert result["risk_reward"] == 1 and not result["accepted"]
    assert result["entry"] == 100 and result["reason"] == "risk_reward_below_minimum"
    assert candidate_assessment(dict(last_close=100, target_price=120, stop_loss=105))["reason"] == "invalid_price_geometry"


def test_atr_protection_no_lookahead_no_lower_stop():
    bars = history()
    adjustment = profit_protection_stop(100, 90, bars, "2026-10-04", POLICY)
    assert adjustment["new_stop"] == 105
    assert adjustment["effective_after"] == "2026-10-04"
    assert profit_protection_stop(100, 106, bars, "2026-10-04", POLICY) is None
    assert profit_protection_stop(100, 90, bars, "2026-10-03", POLICY) is None
    bars.append(dict(date="2026-10-05", open=500, high=500, low=500, close=500, volume=1000))
    assert profit_protection_stop(100, 90, bars, "2026-10-04", POLICY)["new_stop"] == 105


def test_no_volume_or_insufficient_history_never_raises_stop():
    bars = history()
    assert profit_protection_stop(100, 90, bars[:14], "2026-10-04", POLICY) is None
    bars[-1]["volume"] = 0
    assert profit_protection_stop(100, 90, bars, "2026-10-04", POLICY) is None


def test_activation_on_reviewed_close_and_repeat_are_idempotent():
    args = dict(entry=100, target=150, stop=90, bars=history(), entry_date="2026-09-15",
                cursor="2026-10-04", profit_protection=POLICY)
    result = evaluate_bars(**args)
    assert len(result["adjustments"]) == 1 and result["status"] == "open"
    args["stop"] = result["stop_loss"]
    assert evaluate_bars(**args)["adjustments"] == []


def test_new_stop_only_triggers_next_session_and_gap_fills():
    bars = history()
    bars[-1].update(open=102, low=101, high=111)
    result = evaluate_bars(entry=100, target=150, stop=90, bars=bars,
        entry_date="2026-09-15", cursor="2026-10-03", profit_protection=POLICY)
    assert result["status"] == "open" and result["stop_loss"] > 101
    bars.append(dict(date="2026-10-05", open=101, high=104, low=100, close=102, volume=1000))
    next_result = evaluate_bars(entry=100, target=150, stop=result["stop_loss"], bars=bars,
        entry_date="2026-09-15", cursor="2026-10-04", profit_protection=POLICY)
    assert next_result["exit_price"] == 101 and next_result["closed_on"] == "2026-10-05"


def test_zero_volume_bar_cannot_execute_stop_or_consume_holding_session():
    result = evaluate_bars(entry=100, target=120, stop=90, bars=[dict(date="2026-10-04", open=80, high=80, low=80, close=80, volume=0)],
        entry_date="2026-09-01", cursor="2026-09-01", max_sessions=1)
    assert result["status"] == "open" and result["last_close"] is None


def test_no_buy_notice_without_market_block_is_delivered_once(monkeypatch):
    from api import daily_bot_run as job
    payload, sent = {}, []
    monkeypatch.setenv("TELEGRAM_MARKET_HOLD_ALERTS_ENABLED", "true")
    monkeypatch.setattr(job, "_daily_cache_payload", lambda key: payload)
    monkeypatch.setattr(job, "_mark_daily_cache_payload", lambda key, value: payload.update(value))
    monkeypatch.setattr(job, "_notify_vip_telegram", lambda message, kind: sent.append(message) or True)
    monkeypatch.setattr(job, "_notify_free_telegram", lambda message, kind: sent.append(message) or True)
    gate = dict(blocked=False, no_buy_reason="لم يستوفِ المرشح نسبة العائد للمخاطرة")
    assert job._send_market_buy_hold(gate, "2026-10-04")
    assert job._send_market_buy_hold(gate, "2026-10-04")
    assert len(sent) == 2 and gate["no_buy_reason"] in sent[0]


def test_history_repair_is_delta_only_and_bounded_per_day(monkeypatch):
    import pandas as pd
    from types import SimpleNamespace
    import tvDatafeed
    from api.recommendation_data import repair_history
    bars = pd.DataFrame([dict(symbol="X", exchange="EGX", date=pd.Timestamp("2026-09-01"),
        open=100, high=101, low=99, close=100, volume=10)])
    source = bars.drop(columns=["symbol", "exchange"]).set_index("date")
    source.index.name = "datetime"
    monkeypatch.setattr(tvDatafeed.TvDatafeed, "get_hist", lambda *args, **kwargs: source)
    saved, writes = {}, []
    class Query:
        def __init__(self, table): self.table, self.patch = table, None
        def select(self, *args): return self
        def eq(self, *args): return self
        def maybe_single(self): return self
        def upsert(self, patch, **kwargs): self.patch = patch; return self
        def execute(self):
            if self.patch is not None:
                writes.append((self.table, self.patch))
                if self.table == "market_cache": saved.update(self.patch)
            return SimpleNamespace(data=saved.copy() if self.table == "market_cache" else [])
    client = SimpleNamespace(table=Query)
    rec = dict(symbol="X", exchange="EGX", entry_price=100, created_at="2026-09-02", rich_details={})
    _, report = repair_history(client, rec, bars, "2026-10-04")
    assert report["status"] == "verified" and report["rows_added"] == 0
    assert not [w for w in writes if w[0] == "stock_prices"]
    source.loc[pd.Timestamp("2026-10-04")] = [110, 111, 109, 110, 20]
    _, report = repair_history(client, rec, bars, "2026-10-04")
    assert report["rows_added"] == 0  # same day does not call the source again
    saved.clear()
    _, report = repair_history(client, rec, bars, "2026-10-05")
    delta = [w[1] for w in writes if w[0] == "stock_prices"][-1]
    assert report["rows_added"] == 1 and len(delta) == 1 and delta[0]["date"] == "2026-10-04"
    assert isinstance(delta[0]["volume"], int)


def test_history_repair_rejects_incompatible_source_without_upserts(monkeypatch):
    import pandas as pd
    from types import SimpleNamespace
    import tvDatafeed
    from api.recommendation_data import repair_history
    source = pd.DataFrame([dict(open=50, high=51, low=49, close=50, volume=100)], index=pd.DatetimeIndex(["2026-09-01"], name="datetime"))
    monkeypatch.setattr(tvDatafeed.TvDatafeed, "get_hist", lambda *args, **kwargs: source)
    writes = []
    class Query:
        def __init__(self, table): self.table = table
        def select(self, *args): return self
        def eq(self, *args): return self
        def maybe_single(self): return self
        def upsert(self, patch, **kwargs): writes.append(self.table); return self
        def execute(self): return SimpleNamespace(data=None)
    _, report = repair_history(SimpleNamespace(table=Query), dict(symbol="X", entry_price=100, created_at="2026-09-02"), pd.DataFrame(), "2026-10-04")
    assert report["status"] == "failed" and report["reason"] == "incompatible_price_basis"
    assert "stock_prices" not in writes
