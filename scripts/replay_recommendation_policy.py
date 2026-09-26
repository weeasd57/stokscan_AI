"""Read-only exploratory replay. Never publishes recommendations or messages.

Usage: python -m scripts.replay_recommendation_policy scratch/recommendation_audit_source.json
"""
import json
import sys
from collections import Counter, defaultdict
from statistics import mean

from api.recommendation_policy import evaluate_bars, positive


def replay(data):
    prices = defaultdict(list)
    for bar in data['prices']:
        prices[bar['symbol']].append(bar)
    excluded = Counter()
    outputs = defaultdict(list)
    for row in data['recommendations']:
        day = row['created_at'][:10]
        bars = sorted(prices[row['symbol']], key=lambda x: x['date'])
        # Require the entry session in the supplied history; do not count a
        # truncated tail as the complete holding period.
        if not any(b['date'][:10] == day for b in bars):
            excluded['no_entry_session'] += 1
            continue
        adjustments = row.get('adjustments') or []
        if isinstance(adjustments, str):
            adjustments = json.loads(adjustments)
        adjustments = sorted(adjustments, key=lambda x: x.get('timestamp', ''))
        entry = positive(row.get('entry_price'))
        target, stop = row.get('target_price'), row.get('stop_loss')
        for key, fallback in [('old_target', target), ('old_stop', stop)]:
            value = next((a[key] for a in adjustments if positive(a.get(key))), fallback)
            if key == 'old_target':
                target = positive(value)
            else:
                stop = positive(value)
        if not entry or not target or not stop or not stop < entry < target:
            excluded['unrecoverable_original_levels'] += 1
            continue
        outcomes = {}
        try:
            for name, sessions, trail in [('fixed20', 20, None), ('fixed15', 15, None),
                                           ('fixed10', 10, None), ('trail3pct20', 20, .03)]:
                outcomes[name] = evaluate_bars(entry=entry, target=target, stop=stop,
                    bars=bars, entry_date=day, cursor=day, max_sessions=sessions, trail_pct=trail)
        except (ValueError, TypeError):
            excluded['invalid_ohlc'] += 1
            continue
        for name, result in outcomes.items():
            outputs[name].append(result)
    summary = {}
    for name, results in outputs.items():
        closed = [r for r in results if r['exit_price'] is not None]
        summary[name] = dict(eligible=len(results), closed=len(closed),
            open=len(results)-len(closed),
            mean_closed_gross_pct=round(mean(r['profit_loss_pct'] for r in closed), 3) if closed else None,
            loss_count=sum(r['status'] == 'loss' for r in closed),
            mean_closed_sessions=round(mean(r['sessions_held'] for r in closed), 2) if closed else None,
            reasons=dict(Counter(r['exit_reason'] for r in closed)))
    return dict(source_recommendations=len(data['recommendations']),
        source_price_bars=len(data['prices']), exclusions=dict(excluded), policies=summary,
        limitations=[
            'Exploratory in-sample replay, NOT out-of-sample evidence or portfolio returns.',
            'Original levels reconstructed from first adjustment; old refreshes may have overwritten them.',
            'Entry-session coverage does not prove all later market sessions are present.',
            'No execution costs, liquidity, dividends, adjusted-price validation, or capital allocation.',
            'Different exit horizons leave different open sets: closed-only means are not comparable performance claims.',
            'No complete rejected-candidate snapshots: cannot retrospectively validate the new ranking/capacity selection.'
        ])


if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8') as source:
        print(json.dumps(replay(json.load(source)), indent=2))
