from api.daily_job_outcome import summarise_daily_steps, social_reports_outcome, scheduler_result_status


def test_failed_short_stage_is_partial_not_a_successful_scheduler_run():
    health = summarise_daily_steps([
        {'step': 'sync_prices', 'status': 'success'},
        {'step': 'short_swings_daily', 'status': 'failed', 'details': 'Mixed date types'},
    ])
    assert health['outcome'] == 'partial'
    assert health['failed_steps'] == ['short_swings_daily']
    assert 'short_swings_daily: Mixed date types' in health['error']
    assert scheduler_result_status(health) == 'partial'


def test_recovered_step_and_skipped_steps_do_not_leave_false_failure():
    health = summarise_daily_steps([
        {'step': 'prices', 'status': 'failed'},
        {'step': 'prices', 'status': 'success'},
        {'step': 'weekly_report', 'status': 'skipped'},
    ])
    assert health == {'outcome': 'completed', 'failed_steps': [], 'error': None}


def test_interrupted_stage_is_not_success():
    assert summarise_daily_steps([{'step': 'prices', 'status': 'started'}])['outcome'] == 'partial'
    assert scheduler_result_status({'outcome': 'failed'}) == 'failed'


def test_scheduler_counts_partial_delivery_as_unhealthy(monkeypatch):
    from api import daily_job_scheduler as scheduler
    monkeypatch.setattr(scheduler, '_scheduler_state', {
        **scheduler._scheduler_state, 'total_runs': 0, 'total_failed': 0,
    })
    monkeypatch.setattr(scheduler, '_run_history', [])
    scheduler._record_run('fixture', scheduler_result_status({'outcome': 'partial'}))
    assert scheduler._scheduler_state['last_run_status'] == 'partial'
    assert scheduler._scheduler_state['total_failed'] == 1


def test_report_rejection_and_image_failure_are_recorded():
    ok, details, count = social_reports_outcome({'reports': {
        'stock': {'status': 'failed', 'error': 'Verification failed'},
        'market': {'status': 'ready'},
    }, 'images': {'market': 'failed'}})
    assert not ok and count == 1
    assert 'stock: Verification failed' in details and 'market image: failed' in details


def test_cached_images_and_missing_previous_report_are_safe_skips():
    assert social_reports_outcome({'reports': {'market': {'status': 'ready'},
        'follow_up': {'status': 'skipped'}}, 'images': {'market': 'cached'}})[0]
    assert social_reports_outcome({'skipped': True, 'reason': 'Manual run'}) == (True, 'Skipped - Manual run', 0)
    assert not social_reports_outcome({})[0]


def test_report_stage_keeps_completed_data_contract_and_persists_failure_details():
    # Execute the real nested persistence functions without importing providers
    # or running the daily data job. Reports require the completed data contract.
    import ast
    import datetime
    import json
    import time
    import types
    from pathlib import Path
    job = next(node for node in ast.parse(Path('api/daily_bot_run.py').read_text()).body
               if isinstance(node, ast.AsyncFunctionDef) and node.name == 'run_daily_job')
    wrapper = ast.parse('def bind():\n    job_status="running"\n    steps_log=[]\n    active_steps={}\n').body[0]
    wrapper.body.extend(node for node in job.body if isinstance(node, ast.FunctionDef)
                        and node.name in ('_persist_job', '_append_step_log', '_record_step'))
    wrapper.body.extend(ast.parse('return _persist_job, _record_step').body)
    saved = []
    class Query:
        def upsert(self, row): saved.append(row); return self
        def execute(self): pass
    namespace = {'dt': datetime, 'time': time, 'json': json, 'summarise_daily_steps': summarise_daily_steps,
                 'stock_ai': types.SimpleNamespace(supabase=types.SimpleNamespace(table=lambda _: Query())),
                 'job_run_id': 'fixture', 'job_start_time': '2026-10-07T14:00:00Z',
                 'total_symbols': 1, 'trigger': 'scheduled', 'phase': 'close', 'Optional': __import__('typing').Optional,
                 'Dict': __import__('typing').Dict, 'Any': __import__('typing').Any}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapper], type_ignores=[])), '<daily-functions>', 'exec'), namespace)
    persist, record = namespace['bind']()
    persist('completed')
    record('daily_social_reports', False, 'stock: Verification failed', 0)
    assert saved[-1]['status'] == 'completed' and saved[-1]['completed_at']
    assert saved[-1]['error'] == 'daily_social_reports: stock: Verification failed'
    assert json.loads(saved[-1]['steps'])[-1]['status'] == 'failed'
