import json
from datetime import datetime, timedelta, timezone

from api import daily_job_scheduler as scheduler


def test_weekday_conversion_round_trip():
    # Sunday-Thursday in the browser is retained as Sunday-Thursday internally.
    browser_days = [0, 1, 2, 3, 4]
    assert scheduler._python_days_to_js(scheduler._js_days_to_python(browser_days)) == browser_days


def test_schedule_update_persists_via_write_path(monkeypatch):
    calls = []

    class Query:
        def upsert(self, payload, **kwargs):
            calls.append((payload, kwargs))
            return self

        def execute(self):
            return object()

    class Client:
        def table(self, _name):
            return Query()

    monkeypatch.setattr("api.stock_ai._init_supabase", lambda: None)
    monkeypatch.setattr("api.stock_ai.supabase", Client())
    monkeypatch.setattr(scheduler, "_save_config", lambda: None)

    result = scheduler.update_scheduler_config({"active_days": [0, 1, 2, 3, 4], "run_time": "17:15"})
    assert result["active_days"] == [0, 1, 2, 3, 4]
    assert result["run_time"] == "17:15"
    assert calls[0][0]["payload"]["active_days"] == [0, 1, 2, 3, 4]
    assert calls[0][1]["returning"] == "minimal"


def test_run_last_activity_uses_the_latest_step_heartbeat():
    started = "2026-09-23T14:00:00+00:00"
    latest = "2026-09-23T14:45:00+00:00"
    assert scheduler._run_last_activity_at({
        "started_at": started,
        "steps": json.dumps([{"timestamp": "2026-09-23T14:15:00+00:00"}, {"timestamp": latest}]),
    }) == datetime.fromisoformat(latest)


def test_stale_running_row_is_marked_failed_and_does_not_block_recovery(monkeypatch):
    updates = []
    old_started = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()

    class Query:
        def select(self, *_args): return self
        def eq(self, *_args): return self
        def gte(self, *_args): return self
        def lt(self, *_args): return self
        def in_(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def limit(self, *_args): return self
        def update(self, payload):
            updates.append(payload)
            return self
        def execute(self):
            return type("Result", (), {"data": [{"id": "stale-run", "status": "running", "started_at": old_started, "steps": []}]})()

    class Client:
        def table(self, _name): return Query()

    monkeypatch.setattr("api.stock_ai._init_supabase", lambda: None)
    monkeypatch.setattr("api.stock_ai.supabase", Client())

    assert scheduler._daily_job_ran_today(datetime.now(timezone.utc).date().isoformat()) is False
    assert updates and updates[0]["status"] == "failed"
