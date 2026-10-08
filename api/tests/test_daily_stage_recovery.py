import json
from datetime import datetime, timezone
import pytest

from api.daily_stage_recovery import plan_recovery, retry_failed_daily_stages, ORDER, MIDDAY


@pytest.mark.parametrize('stored', [json.dumps([]), []])
def test_append_step_matches_jsonb_value_not_serialized_array(stored):
    from api.daily_stage_recovery import append_step
    from types import SimpleNamespace
    row = {'id': 'cas-test', 'steps': stored}

    class Query:
        def __init__(self):
            self.filters = {}
            self.payload = None
        def update(self, payload): self.payload = payload; return self
        def eq(self, key, value): self.filters[key] = value; return self
        def execute(self):
            # PostgREST parses the filter as JSONB: strings and arrays differ.
            assert json.loads(self.filters['steps']) == row['steps']
            row.update(self.payload)
            return SimpleNamespace(data=[dict(row)])

    class Client:
        def table(self, name): return Query()

    job = dict(row)
    result = append_step(Client(), job, {'step': 'sync_prices', 'status': 'started'})
    assert result[0]['recovery_attempt'] == 1
    assert json.loads(row['steps']) == result


@pytest.mark.parametrize('lease_status,error,attempt,expected_calls', [
    ('audit_failed', None, False, 1),
    ('failed', 'Stale recovery checkpoint', False, 1),
    ('failed', 'Provider failed', False, 0),
    ('failed', 'Stale recovery checkpoint', True, 0),
])
def test_only_unexecuted_audit_leases_can_be_repaired(monkeypatch, lease_status, error, attempt, expected_calls):
    import api.daily_stage_recovery as recovery
    from types import SimpleNamespace
    steps = [{'step': 'sync_prices', 'status': 'success'},
             {'step': 'calculate_indicators', 'status': 'success'},
             {'step': 'short_swings_daily', 'status': 'failed'}]
    if attempt:
        steps[-1]['recovery_attempt'] = 1
    job = {'id': 'lease-test', 'status': 'failed', 'steps': json.dumps(steps)}
    class Query:
        def select(self, *args): return self
        def eq(self, *args): return self
        def gte(self, *args): return self
        def lt(self, *args): return self
        def order(self, *args, **kwargs): return self
        def limit(self, *args): return self
        def execute(self): return SimpleNamespace(data=[job])
    monkeypatch.setattr('api.stock_ai._init_supabase', lambda: None)
    monkeypatch.setattr('api.stock_ai.supabase', SimpleNamespace(table=lambda _: Query()))
    monkeypatch.setattr('api.daily_job_scheduler._due_phase', lambda _: 'midday')
    monkeypatch.setattr(recovery, '_FINISHED', set())
    monkeypatch.setattr(recovery, 'read_checkpoint', lambda *args: {'payload': {'status': lease_status, 'error': error}})
    monkeypatch.setattr(recovery, 'replace_checkpoint', lambda *args: {'payload': {}})
    def append(client, row, step):
        current = json.loads(row['steps'])
        current.append({**step, 'recovery_attempt': 1})
        row['steps'] = json.dumps(current)
        return current
    monkeypatch.setattr(recovery, 'append_step', append)
    calls = []
    def execute(*args):
        calls.append(args[0])
        return {'success': False, 'details': 'Bounded test failure'}
    monkeypatch.setattr(recovery, 'execute_stage', execute)
    recovery.retry_failed_daily_stages(datetime(2026, 10, 7, 12, 20, tzinfo=timezone.utc))
    assert len(calls) == expected_calls


def test_plan_recovery_midday_never_includes_recommendations():
    # Sync prices failure cascades to indicators, ML, heatmap, gate, and swings,
    # but MUST NOT include any recommendation stages in midday.
    steps = [
        {"step": "sync_prices", "status": "failed"},
    ]
    planned = plan_recovery(steps, "midday")
    assert "sync_prices" in planned
    assert "calculate_indicators" in planned
    assert "short_swings_daily" in planned
    assert "evaluate_recommendations" not in planned
    assert "generate_recommendations" not in planned
    assert "update_positions" not in planned
    assert all(stage in MIDDAY for stage in planned)


def test_plan_recovery_close_includes_recommendations():
    # In close run, cascading from sync_prices includes evaluate_recommendations
    steps = [
        {"step": "sync_prices", "status": "failed"},
    ]
    planned = plan_recovery(steps, "close")
    assert "sync_prices" in planned
    assert "calculate_indicators" in planned
    assert "evaluate_recommendations" in planned
    assert "short_swings_daily" in planned


def test_plan_recovery_indicator_failure_cascades_properly():
    # Indicator failure in midday affects ML, heatmap, and swings, but NOT recommendations
    steps = [
        {"step": "sync_prices", "status": "success"},
        {"step": "calculate_indicators", "status": "failed"},
    ]
    midday_planned = plan_recovery(steps, "midday")
    assert "calculate_indicators" in midday_planned
    assert "ml_scores_update" in midday_planned
    assert "precompute_heatmap" in midday_planned
    assert "short_swings_daily" in midday_planned
    assert "evaluate_recommendations" not in midday_planned
    assert "generate_recommendations" not in midday_planned

    # In close run, indicator failure cascades to recommendations as well
    close_planned = plan_recovery(steps, "close")
    assert "evaluate_recommendations" in close_planned
    assert "generate_recommendations" in close_planned


def test_plan_recovery_isolated_short_swings_failure():
    steps = [
        {"step": "sync_prices", "status": "success"},
        {"step": "calculate_indicators", "status": "success"},
        {"step": "short_swings_daily", "status": "failed"},
    ]
    planned = plan_recovery(steps, "midday")
    assert planned == ["short_swings_daily"]


def test_recovery_withholds_stages_if_price_sync_incomplete(monkeypatch):
    import api.daily_stage_recovery as recovery_mod

    recorded_steps = [
        {"step": "sync_prices", "status": "failed"},
        {"step": "calculate_indicators", "status": "failed"},
    ]
    job_row = {
        "id": "job-test-price-fail",
        "status": "failed",
        "steps": json.dumps(recorded_steps),
        "started_at": "2026-10-08T09:15:00+00:00",
    }
    checkpoints = {}

    class MockTable:
        def __init__(self, name):
            self.name = name
            self._key = None
            self._version = None
        def select(self, *args): return self
        def eq(self, col, val):
            if col == "checkpoint_key": self._key = val
            return self
        def gte(self, *args): return self
        def lt(self, *args): return self
        def order(self, *args, **kwargs): return self
        def limit(self, *args): return self
        def single(self): return self
        def insert(self, row):
            checkpoints[row["checkpoint_key"]] = row
            return self
        def update(self, payload):
            if self.name == "daily_job_runs":
                job_row.update(payload)
            elif self.name == "short_swing_checkpoints" and self._key:
                checkpoints[self._key] = {"checkpoint_key": self._key, "payload": payload, "computed_at": "2026-10-08T09:20:00Z"}
            return self
        def execute(self):
            if self.name == "daily_job_runs":
                return type("R", (), {"data": [job_row]})()
            if self.name == "short_swing_checkpoints":
                row = checkpoints.get(self._key)
                return type("R", (), {"data": [row] if row else []})()
            return type("R", (), {"data": []})()

    class MockClient:
        def table(self, name): return MockTable(name)

    monkeypatch.setattr(recovery_mod, "_FINISHED", set())
    monkeypatch.setattr("api.stock_ai._init_supabase", lambda: None)
    monkeypatch.setattr("api.stock_ai.supabase", MockClient())
    monkeypatch.setattr("api.daily_job_scheduler._due_phase", lambda _now: "midday")

    # Mock execute_stage: sync_prices fails
    def mock_execute(name, phase, job_id, previous):
        if name == "sync_prices":
            return {"success": False, "count": 0, "details": "Failed to sync"}
        return {"success": True, "count": 1, "details": "Ok"}

    monkeypatch.setattr(recovery_mod, "execute_stage", mock_execute)

    now = datetime(2026, 10, 8, 12, 20, tzinfo=timezone.utc)
    result = retry_failed_daily_stages(now)

    updated_steps = json.loads(job_row["steps"])
    indicator_steps = [s for s in updated_steps if s.get("step") == "calculate_indicators" and s.get("recovery_attempt") == 1 and s.get("status") == "failed"]
    assert len(indicator_steps) > 0
    assert "Price sync incomplete; dependent recovery withheld" in indicator_steps[0]["details"]


def test_recovery_withholds_stages_if_indicator_calc_incomplete(monkeypatch):
    import api.daily_stage_recovery as recovery_mod

    recorded_steps = [
        {"step": "sync_prices", "status": "success"},
        {"step": "calculate_indicators", "status": "failed"},
        {"step": "short_swings_daily", "status": "failed"},
    ]
    job_row = {
        "id": "job-test-ind-fail",
        "status": "failed",
        "steps": json.dumps(recorded_steps),
        "started_at": "2026-10-08T09:15:00+00:00",
    }
    checkpoints = {}

    class MockTable:
        def __init__(self, name):
            self.name = name
            self._key = None
        def select(self, *args): return self
        def eq(self, col, val):
            if col == "checkpoint_key": self._key = val
            return self
        def gte(self, *args): return self
        def lt(self, *args): return self
        def order(self, *args, **kwargs): return self
        def limit(self, *args): return self
        def single(self): return self
        def insert(self, row):
            checkpoints[row["checkpoint_key"]] = row
            return self
        def update(self, payload):
            if self.name == "daily_job_runs":
                job_row.update(payload)
            elif self.name == "short_swing_checkpoints" and self._key:
                checkpoints[self._key] = {"checkpoint_key": self._key, "payload": payload, "computed_at": "2026-10-08T09:20:00Z"}
            return self
        def execute(self):
            if self.name == "daily_job_runs":
                return type("R", (), {"data": [job_row]})()
            if self.name == "short_swing_checkpoints":
                row = checkpoints.get(self._key)
                return type("R", (), {"data": [row] if row else []})()
            return type("R", (), {"data": []})()

    class MockClient:
        def table(self, name): return MockTable(name)

    monkeypatch.setattr(recovery_mod, "_FINISHED", set())
    monkeypatch.setattr("api.stock_ai._init_supabase", lambda: None)
    monkeypatch.setattr("api.stock_ai.supabase", MockClient())
    monkeypatch.setattr("api.daily_job_scheduler._due_phase", lambda _now: "midday")

    # Mock execute_stage: calculate_indicators fails
    def mock_execute(name, phase, job_id, previous):
        if name == "calculate_indicators":
            return {"success": False, "count": 0, "details": "Indicator calculation error"}
        return {"success": True, "count": 1, "details": "Ok"}

    monkeypatch.setattr(recovery_mod, "execute_stage", mock_execute)

    now = datetime(2026, 10, 8, 12, 20, tzinfo=timezone.utc)
    result = retry_failed_daily_stages(now)

    updated_steps = json.loads(job_row["steps"])
    swings_steps = [s for s in updated_steps if s.get("step") == "short_swings_daily" and s.get("recovery_attempt") == 1 and s.get("status") == "failed"]
    assert len(swings_steps) > 0
    assert "Indicators incomplete; dependent recovery withheld" in swings_steps[0]["details"]


def test_recovery_single_attempt_enforced(monkeypatch):
    import api.daily_stage_recovery as recovery_mod

    # A step that already has recovery_attempt: 1 must be skipped
    recorded_steps = [
        {"step": "sync_prices", "status": "success"},
        {"step": "calculate_indicators", "status": "failed", "recovery_attempt": 1},
    ]
    job_row = {
        "id": "job-test-single-attempt",
        "status": "failed",
        "steps": json.dumps(recorded_steps),
        "started_at": "2026-10-08T09:15:00+00:00",
    }

    class MockTable:
        def __init__(self, name): self.name = name
        def select(self, *args): return self
        def eq(self, *args): return self
        def gte(self, *args): return self
        def lt(self, *args): return self
        def order(self, *args, **kwargs): return self
        def limit(self, *args): return self
        def single(self): return self
        def execute(self):
            return type("R", (), {"data": [job_row]})()

    class MockClient:
        def table(self, name): return MockTable(name)

    monkeypatch.setattr(recovery_mod, "_FINISHED", set())
    monkeypatch.setattr("api.stock_ai._init_supabase", lambda: None)
    monkeypatch.setattr("api.stock_ai.supabase", MockClient())
    monkeypatch.setattr("api.daily_job_scheduler._due_phase", lambda _now: "midday")

    executed_stages = []
    def mock_execute(name, phase, job_id, previous):
        executed_stages.append(name)
        return {"success": True, "count": 1, "details": "Ok"}

    monkeypatch.setattr(recovery_mod, "execute_stage", mock_execute)

    now = datetime(2026, 10, 8, 12, 20, tzinfo=timezone.utc)
    result = retry_failed_daily_stages(now)

    assert "calculate_indicators" not in executed_stages
