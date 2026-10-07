"""Offline recovery, CAS races and actual midday pipeline isolation."""
import ast
import asyncio
import copy
import datetime as dt
import json
import sys
import types
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import api
from api import daily_job_scheduler as scheduler
from api import daily_recovery_state as ledger
from api import short_swings_daily as shorts
from api.daily_job_outcome import summarise_daily_steps


class MemoryDB:
    def __init__(self):
        self.rows = {}
        self.deny = False
    def table(self, name):
        return Query(self, name)


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters = db, name, []
        self.action, self.row = 'select', None
    def select(self, *_args, **_kwargs): return self
    def eq(self, key, value): self.filters.append((key, value)); return self
    def limit(self, *_args): return self
    def maybe_single(self): return self
    def insert(self, row): self.action, self.row = 'insert', copy.deepcopy(row); return self
    def update(self, row): self.action, self.row = 'update', copy.deepcopy(row); return self
    def execute(self):
        if self.db.deny: raise RuntimeError('DB unavailable')
        if self.name == 'market_cache': return types.SimpleNamespace(data=None)
        if self.action == 'insert':
            key = self.row['checkpoint_key']
            if key in self.db.rows: raise RuntimeError('Unique violation')
            self.db.rows[key] = self.row
            return types.SimpleNamespace(data=[copy.deepcopy(self.row)])
        matches = []
        for row in self.db.rows.values():
            def value(key):
                return row.get('payload', {}).get(key.split('->>')[1]) if '->>' in key else row.get(key)
            if all(value(key) == val for key, val in self.filters):
                if self.action == 'update': row.update(self.row)
                matches.append(copy.deepcopy(row))
        return types.SimpleNamespace(data=matches)


class Outcome:
    def __init__(self, ok, receipts=None, error=None):
        self.ok, self.receipts, self.error = ok, receipts or [], error
    def __bool__(self): return self.ok


@pytest.fixture
def runtime(monkeypatch):
    db = MemoryDB()
    module = types.ModuleType('api.daily_bot_run')
    calls = []
    outcomes = {'vip': Outcome(True, [{'message_id': 1}]), 'free': Outcome(True, [{'message_id': 2}])}
    for channel in ('vip', 'free'):
        def send(message, service, *, managed_delivery=False, channel=channel):
            calls.append((channel, message, managed_delivery))
            return outcomes[channel]
        setattr(module, f'_notify_{channel}_telegram', send)
    module._telegram_recommendation_writes_enabled = lambda: True
    monkeypatch.setitem(sys.modules, 'api.daily_bot_run', module)
    monkeypatch.setattr(api, 'daily_bot_run', module, raising=False)
    monkeypatch.setattr(shorts, '_get_supabase_client', lambda: db)
    monkeypatch.setattr(shorts, '_RECOVERY_DONE', set())
    monkeypatch.setattr('api.cache_invalidation.invalidate_cache_tags', lambda *_: {})
    monkeypatch.setattr(shorts, '_get_sent_cache_state', lambda *_: {'sent_entries': {}, 'sent_exits': {}})
    today = dt.datetime.now(ZoneInfo('Africa/Cairo')).date().isoformat()
    snapshot = {'status': 'ok', 'phase': 'close', 'as_of': today,
                'active_trades': [{'symbol': 'TEST', 'signal_id': f'TEST_{today}', 'signal_date': today,
                                   'is_pending_entry': True, 'reference_close': 100, 'trailing_stop': 96}],
                'closed_trades': []}
    computed = []
    def compute(*, phase): computed.append(phase); return copy.deepcopy(snapshot)
    monkeypatch.setattr(shorts, 'compute_short_swings', compute)
    return db, calls, outcomes, snapshot, computed


def expire_backoff(db):
    for row in db.rows.values():
        if row['checkpoint_key'].startswith('short_swings_run_'):
            row['payload']['retry_at'] = '2000-01-01T00:00:00Z'


def test_competing_insert_and_compare_and_set_only_one_wins():
    db = MemoryDB()
    first = ledger.replace_checkpoint(db, 'event', {'status': 'pending'}, None)
    assert first
    assert ledger.replace_checkpoint(db, 'event', {'status': 'dispatching'}, None) is None
    old = ledger.read_checkpoint(db, 'event')
    winner = ledger.replace_checkpoint(db, 'event', {'status': 'dispatching'}, old)
    assert winner
    assert ledger.replace_checkpoint(db, 'event', {'status': 'dispatching'}, old) is None
    assert db.rows['event']['payload']['_version'] == winner['payload']['_version']


def test_verified_rejection_retries_only_failed_channel_without_recompute(runtime):
    db, calls, outcomes, _, computed = runtime
    outcomes['free'] = Outcome(False, error={'error_code': 429})
    assert shorts.run_daily_short_swings(trigger='scheduled')['status'] == 'partial'
    assert [call[0] for call in calls] == ['vip', 'free']
    expire_backoff(db)
    outcomes['free'] = Outcome(True, [{'message_id': 3}])
    assert shorts.run_daily_short_swings(trigger='retry')['success']
    assert [call[0] for call in calls] == ['vip', 'free', 'free']
    assert computed == ['close']
    assert all(call[2] for call in calls)
    assert shorts.run_daily_short_swings(trigger='scheduled')['status'] == 'noop'
    assert len(calls) == 3


@pytest.mark.parametrize('outcome', [Outcome(False, error={'description': 'Timeout'}),
                                    Outcome(True), Outcome(False, [{'message_id': 1}], {'error_code': 429})])
def test_uncertain_or_partial_delivery_is_never_resent(runtime, outcome):
    db, calls, outcomes, _, _ = runtime
    outcomes['vip'] = outcome
    assert not shorts.run_daily_short_swings()['success']
    expire_backoff(db)
    assert not shorts.run_daily_short_swings()['success']
    assert [call[0] for call in calls].count('vip') == 1


def test_compute_failure_recovers_after_backoff_with_max_four_attempts(runtime, monkeypatch):
    db, calls, _, snapshot, _ = runtime
    def broken(**_): raise ValueError('mixed dates')
    monkeypatch.setattr(shorts, 'compute_short_swings', broken)
    assert shorts.run_daily_short_swings()['status'] == 'failed'
    assert shorts.run_daily_short_swings()['status'] == 'waiting'
    expire_backoff(db)
    monkeypatch.setattr(shorts, 'compute_short_swings', lambda **_: snapshot)
    assert shorts.run_daily_short_swings()['success']
    assert len(calls) == 2


def test_retry_exhaustion_and_stale_source_send_nothing(runtime):
    db, calls, _, snapshot, computed = runtime
    snapshot['as_of'] = '2000-01-01'
    for _ in range(4):
        assert not shorts.run_daily_short_swings()['success']
        expire_backoff(db)
    assert shorts.run_daily_short_swings()['status'] == 'waiting'
    assert len(computed) == 4 and calls == []


def test_database_read_error_fails_closed(runtime):
    db, calls, _, _, computed = runtime
    db.deny = True
    assert shorts.run_daily_short_swings()['status'] == 'checkpoint_unavailable'
    assert not calls and not computed


def test_stale_running_attempt_can_resume_but_dispatching_event_cannot(runtime):
    db, calls, _, snapshot, _ = runtime
    today = snapshot['as_of']
    ledger.replace_checkpoint(db, f'short_swings_run_{today}_close', {
        'status': 'running', 'started_at': '2000-01-01T00:00:00Z', 'attempts': 1}, None)
    key = shorts._delivery_key(today, 'entry', snapshot['active_trades'][0], 'vip')
    ledger.replace_checkpoint(db, key, {'status': 'dispatching'}, None)
    assert shorts.run_daily_short_swings()['status'] == 'partial'
    assert [call[0] for call in calls] == ['free']


def test_midday_monitors_active_positions_without_announcing_pending_entries(runtime):
    _, calls, _, snapshot, _ = runtime
    snapshot['phase'] = 'midday'
    snapshot['active_trades'].append({'symbol': 'HELD', 'signal_id': 'held-prior-session',
        'is_pending_entry': False, 'entry_price': 100, 'current_price': 101, 'trailing_stop': 96, 'price_date': snapshot['as_of']})
    assert shorts.run_daily_short_swings(phase='midday')['success']
    assert len(calls) == 1 and calls[0][0] == 'vip'
    assert 'متابعة' in calls[0][1] and 'TEST' not in calls[0][1]


@pytest.mark.parametrize('time,phase', [('12:14', None), ('12:15', 'midday'), ('13:00', 'midday'),
                                       ('14:30', None), ('16:00', None), ('17:00', 'close'), ('22:00', 'close')])
def test_due_slots_and_restart_windows(monkeypatch, time, phase):
    monkeypatch.setattr(scheduler, '_scheduler_state', {**scheduler._scheduler_state,
                         'enabled': True, 'midday_run_time': '12:15', 'run_time': '17:00', 'active_days': [0,1,2,3,6]})
    now = dt.datetime.fromisoformat(f'2026-10-07T{time}:00').replace(tzinfo=ZoneInfo('Africa/Cairo'))
    assert scheduler._due_phase(now) == phase
    assert scheduler._due_phase(now + dt.timedelta(days=2)) is None  # Friday


def test_midday_and_close_ledgers_are_independent(monkeypatch):
    seen = []
    class LedgerQuery:
        def select(self, *_): return self
        def eq(self, field, value):
            if field == 'job_type': seen.append(value)
            return self
        def __getattr__(self, name):
            if name == 'execute': return lambda: types.SimpleNamespace(data=[])
            return lambda *args, **kwargs: self
    client = types.SimpleNamespace(table=lambda *_: LedgerQuery())
    module = types.SimpleNamespace(supabase=client, _init_supabase=lambda: None)
    monkeypatch.setitem(sys.modules, 'api.stock_ai', module)
    assert not scheduler._daily_job_ran_today('2026-10-07', 'midday')
    assert not scheduler._daily_job_ran_today('2026-10-07', 'close')
    assert seen == ['daily_midday', 'daily_bot']


def test_next_run_uses_cairo_dst_and_both_slots(monkeypatch):
    monkeypatch.setattr(scheduler, '_scheduler_state', {**scheduler._scheduler_state,
                         'midday_run_time': '12:15', 'run_time': '17:00', 'active_days': [0,1,2,3,6]})
    for now, expected in [('2026-10-07T12:00:00', '2026-10-07T12:15:00+03:00'),
                          ('2026-10-07T13:00:00', '2026-10-07T17:00:00+03:00'),
                          ('2026-11-04T13:00:00', '2026-11-04T17:00:00+02:00')]:
        monkeypatch.setattr(scheduler, '_now_cairo', lambda: dt.datetime.fromisoformat(now).replace(tzinfo=ZoneInfo('Africa/Cairo')))
        assert scheduler._compute_next_run() == expected


def test_actual_midday_job_never_touches_ordinary_recommendations(monkeypatch):
    # Execute the actual function, replacing only external/provider boundaries.
    tree = ast.parse(Path('api/daily_bot_run.py').read_text(encoding='utf-8'))
    job = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run_daily_job')
    saved, forbidden, invalidations = [], [], []
    class Persist:
        def upsert(self, row): saved.append(copy.deepcopy(row)); return self
        def execute(self): return None
    stock = types.SimpleNamespace(supabase=types.SimpleNamespace(table=lambda *_: Persist()),
        clear_exchange_bulk_cache=lambda *_: None, _get_exchange_bulk_data=lambda *a, **k: {})
    def prohibited(*args, **kwargs):
        forbidden.append(True)
        raise AssertionError('Ordinary recommendation operation executed at midday')
    replacements = {
        'api.update_ml_scores': types.SimpleNamespace(update_all_scores=lambda **_: None),
        'api.news_sentiment_engine': types.SimpleNamespace(process_exchange_news=lambda *_: (True,1)),
        'api.corporate_actions_engine': types.SimpleNamespace(process_exchange_corporate_actions=lambda *a, **k: (True,1)),
        'api.short_swings_daily': types.SimpleNamespace(run_daily_short_swings=lambda **_: {'success': True}),
        'api.cache_invalidation': types.SimpleNamespace(invalidate_daily_cache=lambda steps: invalidations.append(copy.deepcopy(steps))),
    }
    for name, module in replacements.items(): monkeypatch.setitem(sys.modules, name, module)
    import time
    from typing import Optional, Dict, Any
    namespace = {'dt': dt, 'uuid': uuid, 'time': time, 'asyncio': asyncio, 'json': json,
        'pd': types.SimpleNamespace(DataFrame=object), 'stock_ai': stock, 'ZoneInfo': ZoneInfo,
        '_init_supabase': lambda: None, 'summarise_daily_steps': summarise_daily_steps,
        'Optional': Optional, 'Dict': Dict, 'Any': Any, '_should_run_weekly_inventory': lambda *_: False,
        '_fetch_egx_symbols': lambda: ['TEST'], '_filter_active_symbols': lambda values: values,
        'get_smart_sync': lambda: types.SimpleNamespace(sync_exchange_prices=lambda *a, **k: {'success': 1}),
        'calculate_indicators_for_symbol': lambda *_: [], '_batch_upsert_indicators': lambda *a, **k: None,
        'update_market_heatmap': lambda: (True,'ok'), '_refresh_market_status_cache': lambda: (True,'ok'),
        'update_open_portfolio_positions': prohibited, 'evaluate_old_recommendations': prohibited,
        'generate_daily_recommendations': prohibited, 'retry_pending_recommendation_telegram_events': prohibited,
        '_send_daily_market_outlook': prohibited, 'generate_weekly_performance_report': prohibited}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[job],type_ignores=[])), '<actual-daily-job>', 'exec'), namespace)
    result = asyncio.run(namespace['run_daily_job'](trigger='scheduled', phase='midday'))
    assert result['outcome'] == 'completed' and saved[-1]['job_type'] == 'daily_midday'
    assert invalidations and not forbidden
    assert not {'evaluate_recommendations','generate_recommendations','daily_social_reports','daily_market_outlook'} & {
        step['step'] for step in json.loads(saved[-1]['steps'])}


def test_managed_telegram_timeout_does_not_enter_untracked_background_queue():
    from api.telegram_bot import TelegramBot
    from unittest.mock import patch
    bot = TelegramBot('fake-token')
    with patch.object(bot, '_call_api', return_value={'ok': False, 'description': 'Timeout after 30s'}):
        assert not bot.send_notification('single', chat_id='12345', wait_for_delivery=True,
                                         retry_failed=False, mirror_to_vip=False)
    assert list(bot._channel_queue) == [] and list(bot._queue) == []


def test_current_archive_candle_is_replaced_and_midday_breakout_is_not_final(monkeypatch, tmp_path):
    import pandas as pd
    from api import short_swings_engine as engine
    today = dt.datetime.now(ZoneInfo('Africa/Cairo')).date()
    dates = pd.bdate_range(end=today, periods=90)
    if dates[-1].date() != today: pytest.skip('Fixture needs a weekday')
    rows = []
    for i, day in enumerate(dates):
        close = 100 + i * .6
        rows.append({'symbol': 'TEST', 'exchange': 'EGX', 'date': day,
                     'open': close-.1, 'high': close+.2, 'low': close-.2, 'close': close, 'volume': 100000})
    # Snapshot already contains today's *partial* candle. REST must replace it.
    live = {**rows[-1], 'date': today.isoformat(), 'open': 154, 'high': 160.2,
            'low': 153, 'close': 160, 'volume': 300000}
    read_filters = []
    class Prices:
        def select(self, *_): return self
        def eq(self, *_): return self
        def gte(self, field, value): read_filters.append((field,value)); return self
        def range(self, *_): return self
        def execute(self): return types.SimpleNamespace(data=[live])
    monkeypatch.setitem(sys.modules, 'api.stock_ai', types.SimpleNamespace(_init_supabase=lambda: None,
                        supabase=types.SimpleNamespace(table=lambda *_: Prices())))
    monkeypatch.setattr('api.hf_history_cache.load_history_snapshot', lambda *_: pd.DataFrame(rows))
    monkeypatch.setattr(engine, 'CACHE_PATHS', [tmp_path/'shorts.json'])
    monkeypatch.setattr(engine, 'load_stock_metadata', lambda: {})
    midday = engine.compute_short_swings(phase='midday')
    close = engine.compute_short_swings(phase='close')
    assert ('date', today.isoformat()) in read_filters
    assert not midday['session_complete']
    assert not any(t['is_pending_entry'] for t in midday['active_trades'])
    pending = [t for t in close['active_trades'] if t['is_pending_entry']]
    assert len(pending) == 1 and pending[0]['reference_close'] == 160


def test_forced_price_refresh_bypasses_same_date_skip_with_small_incremental_fetch(monkeypatch):
    import pandas as pd
    from api import tradingview_integration as tv
    calls, writes = [], []
    intervals = types.SimpleNamespace(**{name: name for name in ['in_1_minute','in_5_minute','in_15_minute',
                     'in_30_minute','in_1_hour','in_4_hour','in_daily']})
    today = dt.date.today()
    class TV:
        def get_hist(self, **kwargs):
            calls.append(kwargs)
            return pd.DataFrame([{'open':100,'high':101,'low':99,'close':100.5,'volume':100000}],
                                index=pd.DatetimeIndex([today],name='datetime'))
    class Cloud:
        def __getattr__(self, name):
            if name == 'execute': return lambda: types.SimpleNamespace(data=[{'date':today.isoformat()}],count=500)
            return lambda *a, **k: self
    module = types.SimpleNamespace(_last_trading_day=lambda value: value, _init_supabase=lambda: None,
               _get_thread_local_supabase=lambda: types.SimpleNamespace(table=lambda *_: Cloud()),
               sync_df_to_supabase=lambda *a, **k: (writes.append(a) is None, 'written'))
    monkeypatch.setitem(sys.modules,'api.stock_ai',module)
    monkeypatch.setitem(sys.modules,'tvDatafeed',types.SimpleNamespace(TvDatafeed=TV,Interval=intervals))
    monkeypatch.setenv('TRADINGVIEW_REQUEST_DELAY','0')
    assert tv.fetch_tradingview_prices('TEST.EGX')[0] and not calls
    assert tv.fetch_tradingview_prices('TEST.EGX',refresh_latest=True)[0]
    assert len(calls) == 1 and calls[0]['n_bars'] == 10 and writes


def test_new_checkpoint_table_has_no_client_access():
    migration = next(Path('supabase/migrations').glob('*_short_swing_checkpoints.sql')).read_text().lower()
    assert 'enable row level security' in migration
    assert 'revoke all on public.short_swing_checkpoints from public, anon, authenticated' in migration
    assert 'grant select, insert, update on public.short_swing_checkpoints to service_role' in migration


def test_upgrade_retry_resumes_only_recorded_short_failure(runtime, monkeypatch):
    db, calls, _, _, computed = runtime
    original_table = db.table
    job = {'id': 'prior-job', 'status': 'completed', 'steps': json.dumps([
        {'step': 'sync_prices', 'status': 'success'},
        {'step': 'short_swings_daily', 'status': 'failed'}])}
    class JobQuery:
        def select(self, *_): return self
        def eq(self, *_): return self
        def gte(self, *_): return self
        def lt(self, *_): return self
        def order(self, *_, **__): return self
        def limit(self, *_): return self
        def update(self, patch): job.update(patch); return self
        def execute(self): return types.SimpleNamespace(data=[copy.deepcopy(job)])
    monkeypatch.setattr(db, 'table', lambda name: JobQuery() if name == 'daily_job_runs' else original_table(name))
    assert shorts.retry_incomplete_short_swings('close')['success']
    assert computed == ['close']
    assert len(calls) == 2
    assert job['status'] == 'completed'
    assert json.loads(job['steps'])[-1]['status'] == 'success'
    assert shorts.retry_incomplete_short_swings('close') is None
    assert len(calls) == 2
