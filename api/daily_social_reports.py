"""Generate four verified reports through the website's canonical LLM responder.

Called only after the daily data job is completed. No Facebook publishing or
LLM keys are duplicated here; reports are persisted once per session/type.
"""
import json
import os
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

REPORT_KINDS = ('stock', 'accumulation', 'market', 'follow_up')


def generate_daily_social_reports(job_run_id, steps, trigger='scheduled', dry_run=False, opener=None, client=None):
    date = datetime.now(ZoneInfo('Africa/Cairo'))
    latest = {s.get('step'): s.get('status') for s in steps}
    if dry_run or trigger != 'scheduled' or date.weekday() in (4, 5):
        return {'skipped': True, 'reason': 'Not a scheduled trading-day run'}
    if any(latest.get(s) != 'success' for s in ('sync_prices', 'calculate_indicators')):
        return {'skipped': True, 'reason': 'Essential data steps failed'}
    origin = (os.getenv('WEB_ORIGIN') or 'https://egxbots.com').rstrip('/')
    secret = os.getenv('REVALIDATE_SECRET') or os.getenv('ADMIN_SECRET_KEY')
    if not secret:
        return {'skipped': True, 'reason': 'Shared web authentication not configured'}
    endpoint = origin + '/api/social/daily-reports'
    results = {}
    for kind in REPORT_KINDS:
        if kind == 'accumulation' and latest.get('accumulation_scan') != 'success':
            results[kind] = {'status': 'skipped', 'reason': 'Accumulation scan failed'}
            continue
        if kind == 'market' and latest.get('refresh_market_status') != 'success':
            results[kind] = {'status': 'skipped', 'reason': 'Market refresh failed'}
            continue
        request = urllib.request.Request(endpoint, method='POST',
            data=json.dumps({'date': date.date().isoformat(), 'kind': kind, 'job_run_id': job_run_id}).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secret})
        try:
            with (opener or urllib.request.urlopen)(request, timeout=130) as response:
                results[kind] = json.loads(response.read().decode())
        except Exception as error:
            # Never retry an ambiguous timeout: the server may still be generating.
            results[kind] = {'status': 'failed', 'error': type(error).__name__}
    images = {}
    if client is not None:
        from api.social_report_images import attach_report_images
        images = attach_report_images(client, date.date().isoformat(), job_run_id)
    return {'date': date.date().isoformat(), 'reports': results, 'images': images}
