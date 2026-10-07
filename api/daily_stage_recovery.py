"""Resume failed daily stages once, without replaying successful stages/reports."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from api.daily_recovery_state import read_checkpoint, replace_checkpoint, utc_now, parse_timestamp
from api.daily_job_outcome import summarise_daily_steps

_FINISHED = set()
ORDER = ('sync_prices', 'calculate_indicators', 'ml_scores_update', 'precompute_heatmap',
         'refresh_market_status_for_gate', 'update_positions', 'evaluate_recommendations',
         'generate_recommendations', 'short_swings_daily')
MIDDAY = set(ORDER) - {'update_positions', 'evaluate_recommendations', 'generate_recommendations'}

REQUIRES_PRICES = {'calculate_indicators', 'ml_scores_update', 'precompute_heatmap',
                   'refresh_market_status_for_gate', 'update_positions',
                   'evaluate_recommendations', 'generate_recommendations', 'short_swings_daily'}
REQUIRES_INDICATORS = {'ml_scores_update', 'precompute_heatmap', 'short_swings_daily',
                       'evaluate_recommendations', 'generate_recommendations'}


def clear_egx_candle_cache():
    import sys
    router = sys.modules.get('api.routers.bot')
    cache = getattr(router, 'candle_cache', {})
    for key in list(cache):
        if len(key) >= 4 and str(key[3]).upper() == 'EGX':
            cache.pop(key, None)


def plan_recovery(steps, phase):
    latest = {s['step']: s for s in steps if isinstance(s, dict) and s.get('step')}
    allowed = MIDDAY if phase == 'midday' else set(ORDER)
    failed = {name for name, s in latest.items()
              if s.get('status') in {'failed', 'started'} and name in allowed}
    # Refresh derived data after repairing incomplete prices; otherwise old
    # indicators can be tagged as fresh alongside the repaired price snapshot.
    if 'sync_prices' in failed:
        failed.update({'calculate_indicators', 'ml_scores_update', 'precompute_heatmap',
                       'refresh_market_status_for_gate', 'short_swings_daily'} & allowed)
        if phase == 'close':
            failed.add('evaluate_recommendations')
    if 'calculate_indicators' in failed:
        failed.update({'ml_scores_update', 'precompute_heatmap', 'short_swings_daily'} & allowed)
        if phase == 'close':
            failed.update({'evaluate_recommendations', 'generate_recommendations'} & allowed)
    return [name for name in ORDER if name in failed]


def execute_stage(name, phase, job_id, previous):
    """Reuse production operations; each runner is an offline-mockable boundary."""
    from api import daily_bot_run as bot
    if name == 'sync_prices':
        symbols = bot._filter_active_symbols(bot._fetch_egx_symbols())
        selected = previous.get('failed_symbols') or [f'{s}.EGX' for s in symbols]
        result = bot.get_smart_sync().sync_exchange_prices('EGX', selected, max_days=365, refresh_latest=True)
        bot.stock_ai.clear_exchange_bulk_cache('EGX')
        clear_egx_candle_cache()
        failed = [sym for sym, res in result.get('results', {}).items() if not res.get('success')]
        return {'success': bool(selected) and result.get('success') == len(selected),
                'count': result.get('success', 0), 'details': f"Recovered {result.get('success',0)}/{len(selected)} prices",
                'failed_symbols': failed}
    if name == 'calculate_indicators':
        from concurrent.futures import ThreadPoolExecutor
        symbols = bot._filter_active_symbols(bot._fetch_egx_symbols())
        bulk = bot.stock_ai._get_exchange_bulk_data('EGX', bypass_min_limit=True, cache_ttl_seconds=7200)
        failures, rows = [], []
        def calculate(symbol):
            try:
                return bot.calculate_indicators_for_symbol(symbol, 'EGX', bulk.get(symbol.upper())), None
            except Exception as error:
                return [], str(error)
        with ThreadPoolExecutor(max_workers=15) as pool:
            for symbol, (records, error) in zip(symbols, pool.map(calculate, symbols)):
                if error: failures.append(symbol)
                rows.extend(records)
        if rows: bot._batch_upsert_indicators(rows, batch_size=200)
        return {'success': bool(symbols) and not failures, 'count': len(symbols)-len(failures),
                'details': f'{len(rows)} indicator records; {len(failures)} failures'}
    if name == 'ml_scores_update':
        from api.update_ml_scores import update_all_scores
        update_all_scores(bulk_cache_ttl_seconds=7200)
        return {'success': True, 'details': 'Updated ML scores', 'count': 0}
    elif name == 'precompute_heatmap':
        ok, message = bot.update_market_heatmap()
        return {'success': ok, 'details': message, 'count': 0}
    elif name == 'refresh_market_status_for_gate':
        ok, message = bot._refresh_market_status_cache()
        return {'success': ok, 'details': message, 'count': 0}
    elif name == 'update_positions':
        bot.update_open_portfolio_positions()
        return {'success': True, 'details': 'Updated portfolio positions', 'count': 0}
    elif name == 'evaluate_recommendations':
        result = bot.evaluate_old_recommendations(return_report=True)
        return {'success': not (result['blocked'] or result['errors']),
                'details': json.dumps(result, ensure_ascii=False), 'count': result['evaluated']}
    elif name == 'generate_recommendations':
        from api.daily_job_scheduler import get_scheduler_state
        gate = bot.should_reject_new_buys()
        if gate.get('blocked'):
            return {'success': True, 'details': 'Skipped - '+str(gate.get('reason')), 'count': 0}
        count = asyncio.run(bot.generate_daily_recommendations(model_name=get_scheduler_state().get('model_filter', 'adaptive'),
                           bulk_cache_ttl_seconds=7200, run_context=gate))
        return {'success': True, 'details': f'Recovered generation: {count} recommendations', 'count': count or 0}
    elif name == 'short_swings_daily':
        from api.short_swings_daily import run_daily_short_swings
        result = run_daily_short_swings(trigger='retry', phase=phase, job_run_id=job_id)
        return {'success': result.get('success', False), 'details': result.get('message',''), 'count': result.get('count',0)}
    else:
        raise ValueError('Unsupported recovery stage')


def append_step(client, job, step):
    # Verify writes instead of reporting a recovery that was never recorded.
    previous = job.get('steps') or '[]'
    steps = json.loads(previous) if isinstance(previous, str) else list(previous)
    steps.append({**step, 'sequence': len(steps)+1, 'timestamp': utc_now().isoformat(), 'recovery_attempt': 1})
    encoded = json.dumps(steps)
    health = summarise_daily_steps(steps)
    updated = (client.table('daily_job_runs').update({'steps': encoded, 'error': health['error']})
               .eq('id', job['id']).eq('steps', previous).execute())
    if not updated.data:
        current = client.table('daily_job_runs').select('steps').eq('id', job['id']).single().execute()
        current_steps_raw = (current.data or {}).get('steps') or '[]'
        steps = json.loads(current_steps_raw) if isinstance(current_steps_raw, str) else list(current_steps_raw)
        steps.append({**step, 'sequence': len(steps)+1, 'timestamp': utc_now().isoformat(), 'recovery_attempt': 1})
        encoded = json.dumps(steps)
        health = summarise_daily_steps(steps)
        updated = (client.table('daily_job_runs').update({'steps': encoded, 'error': health['error']})
                   .eq('id', job['id']).eq('steps', current_steps_raw).execute())
        if not updated.data:
            raise RuntimeError('Daily recovery audit write lost to a concurrent update')
    job['steps'] = encoded
    return steps


def retry_failed_daily_stages(now):
    """One durable attempt per failed stage/job; only the currently due phase."""
    from api.daily_job_scheduler import _due_phase
    from api import stock_ai
    phase = _due_phase(now)
    if not phase:
        return None
    stock_ai._init_supabase()
    client = stock_ai.supabase
    if not client:
        return None
    start = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    query = (client.table('daily_job_runs').select('id,status,steps,started_at')
             .eq('job_type', 'daily_midday' if phase == 'midday' else 'daily_bot')
             .gte('started_at', start.isoformat()).lt('started_at', (start+timedelta(days=1)).isoformat())
             .order('started_at', desc=True).limit(1).execute())
    job = (query.data or [None])[0]
    if not job or job.get('status') == 'running':
        return None
    identity = f"{job['id']}:{phase}"
    if identity in _FINISHED:
        return None

    steps = json.loads(job['steps']) if isinstance(job.get('steps'), str) else job.get('steps') or []
    planned = plan_recovery(steps, phase)
    if not planned:
        _FINISHED.add(identity)
        return None

    latest = {s.get('step'): s for s in steps if isinstance(s, dict) and s.get('step')}
    changed = []
    for name in planned:
        # Also survives restarts through both the job audit and durable CAS.
        if latest.get(name, {}).get('recovery_attempt'):
            continue
        key = f"daily_stage_retry_{job['id']}_{name}"
        existing = read_checkpoint(client, key)
        if existing:
            existing_payload = existing.get('payload') or {}
            if existing_payload.get('status') == 'running':
                comp = parse_timestamp(existing.get('computed_at'))
                if comp and (utc_now() - comp) > timedelta(minutes=15):
                    replace_checkpoint(client, key, {**existing_payload, 'status': 'failed', 'error': 'Stale recovery checkpoint'}, existing)
            continue
        claim = replace_checkpoint(client, key, {'status': 'running', 'stage': name, 'phase': phase, 'attempts': 1}, None)
        if not claim:
            continue
        append_step(client, job, {'step': name, 'status': 'started', 'details': 'Independent one-time stage recovery'})
        # Market-data consumers must not run over a still-incomplete price sync or indicator calculation.
        if name in REQUIRES_PRICES and latest.get('sync_prices', {}).get('status') != 'success':
            result = {'success': False, 'details': 'Price sync incomplete; dependent recovery withheld', 'count': 0}
        elif name in REQUIRES_INDICATORS and latest.get('calculate_indicators', {}).get('status') != 'success':
            result = {'success': False, 'details': 'Indicators incomplete; dependent recovery withheld', 'count': 0}
        else:
            try:
                result = execute_stage(name, phase, job['id'], latest.get(name, {}))
            except Exception as error:
                result = {'success': False, 'details': str(error)[:400], 'count': 0}
        status = 'success' if result.get('success') else 'failed'
        append_step(client, job, {'step': name, 'status': status, **{k: v for k, v in result.items() if k != 'success'}})
        latest[name] = {'status': status}
        if status == 'success':
            changed.append(name)
        replace_checkpoint(client, key, {'status': status, 'attempts': 1, 'stage': name, 'phase': phase}, claim)
    if changed:
        from api.cache_invalidation import select_cache_tags, invalidate_cache_tags
        all_steps = json.loads(job['steps']) if isinstance(job['steps'], str) else job['steps']
        tags = select_cache_tags(all_steps, changed_steps=changed)
        inv_result = invalidate_cache_tags(tags)
        if inv_result.get('error'):
            print(f"[DAILY-RECOVERY] Cache invalidation failed: {inv_result['error']}")
    _FINISHED.add(identity)
    return {'phase': phase, 'recovered': changed, 'planned': planned}
