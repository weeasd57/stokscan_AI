"""Report execution health without changing the market-data completion contract."""


def summarise_daily_steps(steps):
    latest = {step.get('step'): step for step in steps if isinstance(step, dict)}
    failed = [step for step in latest.values() if step.get('status') in ('failed', 'started')]
    return {
        'outcome': 'partial' if failed else 'completed',
        'failed_steps': [step['step'] for step in failed],
        'error': '; '.join(f"{step['step']}: {step.get('details') or 'Stage did not finish'}" for step in failed)[:1500] or None,
    }


def social_reports_outcome(result):
    if result.get('skipped'):
        return True, 'Skipped - ' + result.get('reason', 'Not eligible'), 0
    reports = result.get('reports') or {}
    images = result.get('images') or {}
    ready = [kind for kind, report in reports.items() if report.get('status') == 'ready']
    failures = [f"{kind}: {report.get('error') or report.get('reason') or report.get('status')}"
                for kind, report in reports.items() if report.get('status') not in ('ready', 'skipped')]
    if not reports:
        failures.append('No report results returned')
    failures.extend(f"{kind} image: {state}" for kind, state in images.items() if state not in ('ready', 'cached', 'skipped'))
    return not failures, '; '.join(failures) if failures else f"{len(ready)} verified reports ready", len(ready)


def scheduler_result_status(result):
    if isinstance(result, dict) and result.get('outcome') in ('completed', 'partial', 'failed'):
        return result['outcome']
    return 'completed'
