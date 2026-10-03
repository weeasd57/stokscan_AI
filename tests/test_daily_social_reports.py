import json
from datetime import datetime
from unittest.mock import patch
import pytest

from api.daily_social_reports import generate_daily_social_reports, REPORT_KINDS


class Response:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return b'{"status":"ready"}'


STEPS = [{'step': s, 'status': 'success'} for s in
         ('sync_prices', 'calculate_indicators', 'accumulation_scan', 'refresh_market_status')]


@pytest.fixture(autouse=True)
def trading_day():
    with patch('api.daily_social_reports.datetime') as clock:
        clock.now.return_value = datetime(2026, 10, 4, 18, 0)
        yield


def test_scheduled_run_generates_each_kind_once():
    calls = []
    def opener(request, timeout):
        calls.append(json.loads(request.data))
        assert timeout == 130
        return Response()
    with patch.dict('os.environ', {'REVALIDATE_SECRET': 'test-only'}):
        result = generate_daily_social_reports('job-id', STEPS, opener=opener)
    assert [c['kind'] for c in calls] == list(REPORT_KINDS)
    assert all(c['job_run_id'] == 'job-id' for c in calls)
    assert len(result['reports']) == 4


def test_failed_data_does_not_generate():
    result = generate_daily_social_reports('job-id', [], opener=lambda *_: (_ for _ in ()).throw(AssertionError()))
    assert result['skipped']


def test_dry_run_and_manual_do_not_generate():
    assert generate_daily_social_reports('job-id', STEPS, dry_run=True)['skipped']
    assert generate_daily_social_reports('job-id', STEPS, trigger='manual')['skipped']


def test_provider_failure_does_not_retry_or_stop_other_reports():
    calls = []
    def opener(request, timeout):
        calls.append(json.loads(request.data)['kind'])
        raise TimeoutError()
    with patch.dict('os.environ', {'REVALIDATE_SECRET': 'test-only'}):
        result = generate_daily_social_reports('job-id', STEPS, opener=opener)
    assert calls == list(REPORT_KINDS)
    assert all(r['status'] == 'failed' for r in result['reports'].values())


def test_real_daily_hook_attaches_images_without_additional_llm_calls():
    client = object()
    with patch.dict('os.environ', {'REVALIDATE_SECRET': 'test-only'}), \
         patch('api.social_report_images.attach_report_images', return_value={'stock': 'ready'}) as attach:
        result = generate_daily_social_reports('job-id', STEPS, opener=lambda *args, **kwargs: Response(), client=client)
    attach.assert_called_once_with(client, '2026-10-04', 'job-id')
    assert result['images']['stock'] == 'ready'
