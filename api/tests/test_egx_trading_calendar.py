from datetime import datetime, date
from zoneinfo import ZoneInfo

from api.egx_trading_calendar import is_egx_session
from api import daily_job_scheduler as scheduler


def test_confirmed_exchange_closure(monkeypatch):
    monkeypatch.delenv('EGX_HOLIDAY_DATES', raising=False)
    assert is_egx_session(date(2026, 10, 6))
    assert not is_egx_session(date(2026, 10, 8))
    assert not is_egx_session(date(2026, 10, 9))
    assert not is_egx_session(date(2026, 10, 10))
    assert is_egx_session(date(2026, 10, 11))


def test_both_phases_and_recovery_skip_holiday(monkeypatch):
    monkeypatch.delenv('EGX_HOLIDAY_DATES', raising=False)
    monkeypatch.setattr(scheduler, '_scheduler_state', {**scheduler._scheduler_state, 'enabled': True})
    for hour in (12, 17, 19):
        assert scheduler._due_phase(datetime(2026, 10, 8, hour, 20, tzinfo=ZoneInfo('Africa/Cairo'))) is None


def test_next_run_skips_closure_and_weekend(monkeypatch):
    monkeypatch.delenv('EGX_HOLIDAY_DATES', raising=False)
    monkeypatch.setattr(scheduler, '_now_cairo', lambda: datetime(2026, 10, 8, 10, tzinfo=ZoneInfo('Africa/Cairo')))
    monkeypatch.setattr(scheduler, '_scheduler_state', {**scheduler._scheduler_state,
        'active_days': [0, 1, 2, 3, 6], 'midday_run_time': '12:15', 'run_time': '17:00'})
    assert scheduler._compute_next_run() == '2026-10-11T12:15:00+03:00'


def test_extra_confirmed_date(monkeypatch):
    monkeypatch.setenv('EGX_HOLIDAY_DATES', '2026-10-11')
    assert not is_egx_session(date(2026, 10, 11))
