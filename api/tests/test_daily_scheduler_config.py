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
