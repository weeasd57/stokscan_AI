"""Read-only exploratory replay. Never publishes recommendations or messages.

Usage: python -m scripts.replay_recommendation_policy scratch/recommendation_audit_source.json --with-hf-history
"""
import argparse
import json
from collections import Counter, defaultdict
from statistics import mean

from api.recommendation_policy import evaluate_bars, positive, price_basis_matches


def add_hf_history(data):
    """Merge the versioned HF archive with the supplied recent DB tail."""
    from dotenv import load_dotenv
    load_dotenv()
    load_dotenv('web/.env.local')
    from api.hf_history_cache import load_history_snapshot, snapshot_metadata

    snapshot = load_history_snapshot('EGX')
    if snapshot.empty:
        raise RuntimeError('HF history unavailable; refusing a partial full-history comparison')
    symbols = {str(row['symbol']).upper() for row in data['recommendations']}
    first_day = min(row['created_at'][:10] for row in data['recommendations'])
    relevant = snapshot.loc[
        snapshot['symbol'].isin(symbols) & (snapshot['date'] >= first_day),
        ['symbol', 'date', 'open', 'high', 'low', 'close'],
    ].copy()
    relevant['date'] = relevant['date'].dt.strftime('%Y-%m-%d')
    by_key = {(row['symbol'], row['date'][:10]): row for row in relevant.to_dict('records')}
    for row in data['prices']:
        by_key[(row['symbol'], row['date'][:10])] = row
    return {**data, 'prices': list(by_key.values()),
            'hf_revision_metadata': snapshot_metadata('EGX')}


def replay(data):
    prices = defaultdict(list)
    for bar in data['prices']:
        prices[bar['symbol']].append(bar)
    excluded = Counter()
    outputs = defaultdict(list)
    common_cohort = defaultdict(list)
    common_30_session_cohort = defaultdict(list)
    no_adjustment_cohort = defaultdict(list)
    with_adjustment_cohort = defaultdict(list)
    matured_models = Counter()
    matured_examples = []
    next_open_pairs = []
    next_open_exclusions = Counter()
    for row in data['recommendations']:
        day = row['created_at'][:10]
        bars = sorted(prices[row['symbol']], key=lambda x: x['date'])
        # Require the entry session in the supplied history; do not count a
        # truncated tail as the complete holding period.
        signal_bar = next((b for b in bars if b['date'][:10] == day), None)
        if signal_bar is None:
            excluded['no_entry_session'] += 1
            continue
        if not price_basis_matches(row.get('entry_price'), signal_bar.get('close')):
            excluded['mixed_price_basis'] += 1
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
                                           ('fixed10', 10, None), ('fixed30', 30, None),
                                           ('trail3pct20', 20, .03)]:
                outcomes[name] = evaluate_bars(entry=entry, target=target, stop=stop,
                    bars=bars, entry_date=day, cursor=day, max_sessions=sessions, trail_pct=trail)
        except (ValueError, TypeError):
            excluded['invalid_ohlc'] += 1
            continue
        for name, result in outcomes.items():
            outputs[name].append(result)
        # Only compare returns on the SAME positions after the full 20-session
        # observation window. Open, immature positions cannot enter a return
        # comparison as if their outcomes were known.
        subsequent = [b for b in bars if b['date'][:10] > day]
        if len(subsequent) >= 20:
            matured_models[str(row.get('model_name') or 'unknown')] += 1
            matured_examples.append(dict(symbol=row['symbol'], entry_date=day,
                entry=entry, original_stop=stop, original_target=target,
                exit_day=outcomes['fixed20']['closed_on'],
                exit_reason=outcomes['fixed20']['exit_reason'],
                gross_pct=round(outcomes['fixed20']['profit_loss_pct'], 3)))
            for name, result in outcomes.items():
                if name != 'fixed30':
                    common_cohort[name].append(result)
                    destination = with_adjustment_cohort if adjustments else no_adjustment_cohort
                    destination[name].append(result)
            next_open = positive(subsequent[0].get('open'))
            if next_open is None:
                next_open_exclusions['missing_next_open'] += 1
            elif not stop < next_open < target:
                next_open_exclusions['next_open_outside_setup'] += 1
            else:
                try:
                    at_open = evaluate_bars(entry=next_open, target=target, stop=stop,
                        bars=bars, entry_date=day, cursor=day, max_sessions=20)
                    next_open_pairs.append(dict(reference=outcomes['fixed20']['profit_loss_pct'],
                        actual_open=at_open['profit_loss_pct'],
                        gap_pct=(next_open/entry-1)*100,
                        rr=(target-next_open)/(next_open-stop)))
                except (ValueError, TypeError):
                    next_open_exclusions['invalid_next_open_path'] += 1
        else:
            excluded['immature_for_20_session_comparison'] += 1
        if len(subsequent) >= 30:
            for name, result in outcomes.items():
                common_30_session_cohort[name].append(result)
    summary = {}
    for name, results in outputs.items():
        closed = [r for r in results if r['exit_price'] is not None]
        summary[name] = dict(eligible=len(results), closed=len(closed),
            open=len(results)-len(closed),
            mean_closed_gross_pct=round(mean(r['profit_loss_pct'] for r in closed), 3) if closed else None,
            loss_count=sum(r['status'] == 'loss' for r in closed),
            mean_closed_sessions=round(mean(r['sessions_held'] for r in closed), 2) if closed else None,
            reasons=dict(Counter(r['exit_reason'] for r in closed)))
    def comparable_summary(cohort):
        comparable = {}
        for name, results in cohort.items():
            returns = sorted(r['profit_loss_pct'] for r in results)
            comparable[name] = dict(trades=len(results), closed=sum(r['exit_price'] is not None for r in results),
                mean_gross_pct=round(mean(returns), 3),
                median_gross_pct=round((returns[(len(returns)-1)//2] + returns[len(returns)//2])/2, 3),
                mean_net_40bps_scenario_pct=round(mean(returns)-0.4, 3),
                losses=sum(value < 0 for value in returns),
                severe_losses_10pct=sum(value <= -10 for value in returns),
                extreme_gains_50pct=sum(value >= 50 for value in returns),
                minimum_gross_pct=round(min(returns), 3),
                maximum_gross_pct=round(max(returns), 3),
                mean_sessions=round(mean(r['sessions_held'] for r in results), 2),
                reasons=dict(Counter(r['exit_reason'] for r in results)),
                time_exits_positive=sum(r['exit_reason']=='time_exit' and r['profit_loss_pct']>0 for r in results),
                time_exits_negative=sum(r['exit_reason']=='time_exit' and r['profit_loss_pct']<0 for r in results))
        return comparable
    open_comparison = (dict(trades=len(next_open_pairs),
        mean_close_reference_pct=round(mean(p['reference'] for p in next_open_pairs), 3),
        mean_next_open_entry_pct=round(mean(p['actual_open'] for p in next_open_pairs), 3),
        mean_gap_pct=round(mean(p['gap_pct'] for p in next_open_pairs), 3),
        reference_losses=sum(p['reference'] < 0 for p in next_open_pairs),
        next_open_losses=sum(p['actual_open'] < 0 for p in next_open_pairs),
        next_open_rr_below_1_5=sum(p['rr'] < 1.5 for p in next_open_pairs),
        exclusions=dict(next_open_exclusions)) if next_open_pairs else None)
    return dict(source_recommendations=len(data['recommendations']),
        source_price_bars=len(data['prices']), hf_revision_metadata=data.get('hf_revision_metadata'),
        exclusions=dict(excluded), policies=summary,
        common_20_session_cohort=comparable_summary(common_cohort),
        common_30_session_cohort=comparable_summary(common_30_session_cohort),
        common_20_session_without_recorded_adjustments=comparable_summary(no_adjustment_cohort),
        common_20_session_with_recorded_adjustments=comparable_summary(with_adjustment_cohort),
        matured_20_session_models=dict(matured_models),
        next_open_20_session_comparison=open_comparison,
        worst_fixed20_examples=sorted(matured_examples, key=lambda x: x['gross_pct'])[:5],
        limitations=[
            'Exploratory in-sample replay, NOT out-of-sample evidence or portfolio returns.',
            'Original levels reconstructed from first adjustment; old refreshes may have overwritten them.',
            'Entry-session coverage does not prove all later market sessions are present.',
            'Entries whose signal-day close differs by over 2% are excluded as incompatible price bases; this does not validate all corporate actions or dividends.',
            'No measured execution costs, liquidity, dividends, or capital allocation.',
            'Closed-only means have different sets; use common_20_session_cohort for paired comparisons.',
            'The 40 bps round-trip cost is a scenario, not a measured Egyptian brokerage cost.',
            'No complete rejected-candidate snapshots: cannot retrospectively validate the new ranking/capacity selection.'
        ])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('--with-hf-history', action='store_true')
    args = parser.parse_args()
    with open(args.source, encoding='utf-8') as source:
        data = json.load(source)
    if args.with_hf_history:
        data = add_hf_history(data)
    print(json.dumps(replay(data), indent=2))
