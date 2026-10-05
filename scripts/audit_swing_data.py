"""Offline cached OHLC audit. No price adjustments, network calls or replay writes.

Run with python -B scripts/audit_swing_data.py; prints JSON unless --output is set.
Missing sessions are inferred from broad observed coverage, not an exchange calendar.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date
import gzip
import hashlib
import json
import math
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = Path('C:/Users/MR__CODER__/.cache/huggingface/hub/datasets--weeasdwee--egx-historical-prices/snapshots/85643e5bf12a6ce0b2f62b63fa0ffcfc1b422628/prices/EGX/stock_prices.json.gz')
FIELDS = ('open', 'high', 'low', 'close', 'volume')


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def issues(row):
    o, h, l, c, v = [number(row.get(k)) for k in FIELDS]
    found = []
    if any(x is None or x <= 0 for x in (o, h, l, c)):
        found.append('nonpositive_or_nonfinite_ohlc')
    else:
        if h < l:
            found.append('high_below_low')
        if not l <= o <= h:
            found.append('open_outside_range')
        if not l <= c <= h:
            found.append('close_outside_range')
    if v is None or v < 0:
        found.append('invalid_volume')
    elif v == 0:
        found.append('zero_volume')
    elif not v.is_integer():
        found.append('fractional_volume')
    return found


def valid(row):
    return not (set(issues(row)) - {'zero_volume', 'fractional_volume'})


def compact(row):
    return {k: row.get(k) for k in ('symbol', 'date', *FIELDS)}


def summary(rows):
    counts = Counter()
    dates = [r['date'] for r in rows]
    keys = Counter((r['symbol'], r['date']) for r in rows)
    invalid = 0
    for r in rows:
        counts.update(issues(r))
        invalid += not valid(r)
    return dict(rows=len(rows), symbols=len({r['symbol'] for r in rows}),
                first_date=min(dates) if dates else None, last_date=max(dates) if dates else None,
                invalid_rows=invalid, issue_counts=dict(counts),
                duplicate_extra_rows=sum(n-1 for n in keys.values()))


def opening_semantics(raw, research_path):
    """Measure raw field relationships and saved trade paths; never run a backtest."""
    import importlib.util
    import numpy as np
    import pandas as pd

    df = pd.DataFrame(raw).sort_values(['symbol', 'date']).reset_index(drop=True)
    for k in FIELDS:
        df[k] = pd.to_numeric(df[k], errors='coerce')
    group = df.groupby('symbol', sort=False)
    df['previous_close'] = group.close.shift()
    df['previous_date'] = group.date.shift()
    df['open_gap_pct'] = 100*(df.open/df.previous_close-1)
    df['close_open_pct'] = 100*(df.close/df.open-1)
    df['exact_previous_close'] = df.open.eq(df.previous_close)
    df['prior_turnover20'] = group.apply(lambda g: (g.close*g.volume).rolling(20).mean().shift(), include_groups=False).reset_index(level=0, drop=True)
    df['prior_positive20'] = group.volume.transform(lambda s: s.gt(0).rolling(20).sum().shift())
    global_dates = sorted(df.date.unique())
    next_date = dict(zip(global_dates, global_dates[1:]))
    df['consecutive_global_session'] = df.previous_date.map(next_date).eq(df.date)

    def distribution(s):
        s = s[np.isfinite(s)]
        if not len(s):
            return {}
        return dict(n=len(s), mean=float(s.mean()), std=float(s.std(ddof=0)),
                    percentiles={str(q): float(s.quantile(q/100)) for q in (0, 1, 5, 25, 50, 75, 95, 99, 100)},
                    abs_percentiles={str(q): float(s.abs().quantile(q/100)) for q in (50, 90, 95, 99)},
                    absolute_buckets=dict(exact_zero=int(s.eq(0).sum()),
                        nonzero_le_1bp=int((s.abs().gt(0)&s.abs().le(.01)).sum()),
                        above_1bp_le_10bp=int((s.abs().gt(.01)&s.abs().le(.1)).sum()),
                        above_10bp_le_1pct=int((s.abs().gt(.1)&s.abs().le(1)).sum()),
                        above_1pct_le_2pct=int((s.abs().gt(1)&s.abs().le(2)).sum()),
                        above_2pct_le_5pct=int((s.abs().gt(2)&s.abs().le(5)).sum()),
                        above_5pct=int(s.abs().gt(5).sum())))

    def stats(g):
        g = g.loc[g.previous_close.gt(0)]
        n = len(g)
        count = int(g.exact_previous_close.sum())
        return dict(pairs=n, exact_open_equals_previous_close=count,
                    exact_pct=100*count/n if n else None,
                    within_relative_1e_6=int((g.open/g.previous_close-1).abs().le(1e-6).sum()),
                    open_equals_close=int(g.open.eq(g.close).sum()),
                    open_equals_high=int(g.open.eq(g.high).sum()), open_equals_low=int(g.open.eq(g.low).sum()),
                    high_low_equal_body_endpoints=int((g.high.eq(g[['open','close']].max(axis=1)) & g.low.eq(g[['open','close']].min(axis=1))).sum()),
                    previous_close_outside_range=int((g.previous_close.lt(g.low)|g.previous_close.gt(g.high)).sum()),
                    consecutive_global_session_pairs=int(g.consecutive_global_session.sum()),
                    gap=distribution(g.open_gap_pct), close_to_open=distribution(g.close_open_pct))

    recent = df.loc[df.date.ge('2021-01-01')]
    by_year = {year: stats(g) for year,g in df.groupby(df.date.str[:4])}
    by_month = {month: stats(g) for month,g in recent.groupby(recent.date.str[:7])}
    per_symbol = {symbol: stats(g) for symbol,g in recent.groupby('symbol')}
    streaks = []
    for symbol, g in recent.groupby('symbol'):
        best, start, length = (0, None, None), None, 0
        for r in g.itertuples():
            if r.exact_previous_close:
                start = start if length else r.date
                length += 1
                if length > best[0]:
                    best = (length, start, r.date)
            else:
                length = 0
        streaks.append(dict(symbol=symbol, exact_pair_streak=best[0], start=best[1], end=best[2]))
    report = json.loads(research_path.read_text(encoding='utf-8'))
    engine_path = ROOT / 'scripts/swing_research_validation.py'
    engine_hash = hashlib.sha256(engine_path.read_bytes()).hexdigest()
    spec = importlib.util.spec_from_file_location('offline_research_source', engine_path)
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    # load_data is inspected, deterministic and local-only. Do not call main/run.
    # Reuse the already loaded rows by reproducing its feature-only function in memory.
    import unittest.mock
    with unittest.mock.patch.object(engine.gzip, 'open'), unittest.mock.patch.object(engine.json, 'load', return_value=raw):
        frames, signals, breadth, quality = engine.load_data(ARCHIVE)
    selected = report['selection']['config']
    es = [s for s in signals[selected['family']] if not selected['gate'] or breadth.get(s['signal_date'], 0) >= .60]
    lookup = df.set_index(['symbol','date'])
    entry_screen, trade_paths = {}, {}
    windows = {'2025': ('2025-01-01','2025-12-31'), '2026_jan_aug': ('2026-01-01','2026-08-31'),
               'september_partial': ('2026-09-01','2026-09-24')}
    for label, (start, end) in windows.items():
        candidates = [s for s in es if start <= s['date'] <= end]
        executable, missing, rejected = [], [], []
        for s in candidates:
            b = frames[s['symbol']].get(s['date'])
            if b is None or b.volume <= 0 or b.high == b.low:
                missing.append(s)
                continue
            row = dict(**s, next_open=float(b.open), gap_pct=100*(b.open/s['close']-1))
            executable.append(row)
            if not .95 <= b.open/s['close'] <= 1.02:
                rejected.append(row)
        entry_screen[label] = dict(signals=len(candidates), executable_bar_count=len(executable),
            unavailable_bar_count=len(missing), exact_next_open_equals_signal_close=sum(r['next_open']==r['close'] for r in executable),
            gap_distribution=distribution(pd.Series([r['gap_pct'] for r in executable], dtype=float)),
            rejected=rejected, stored_rejection_count=report['tests'][label]['base']['metrics']['skipped'].get('opening_price_outside_band',0))
        rows = []
        for t in report['tests'][label]['base']['trades']:
            b = lookup.loc[(t['symbol'],t['entry_date'])]
            x = lookup.loc[(t['symbol'],t['exit_date'])]
            path = df.loc[df.symbol.eq(t['symbol']) & df.date.between(t['entry_date'],t['exit_date'])]
            expected = [d for d in global_dates if t['entry_date']<=d<=t['exit_date']]
            rows.append(dict(**t, entry_bar={k: b[k] for k in FIELDS}, entry_previous_close=b.previous_close,
                entry_gap_pct=b.open_gap_pct, entry_close_open_pct=b.close_open_pct,
                entry_open_equals_previous_close=bool(b.exact_previous_close),
                exit_open_equals_previous_close=bool(x.exact_previous_close),
                observed_path_bars=len(path), exact_open_path_bars=int(path.exact_previous_close.sum()),
                missing_global_sessions=sorted(set(expected)-set(path.date)),
                open_gap_over_5pct_dates=path.loc[path.open_gap_pct.abs().gt(5),'date'].tolist(),
                close_open_over_20pct_dates=path.loc[path.close_open_pct.abs().gt(20),'date'].tolist()))
        trade_paths[label] = dict(closed_trades=len(rows),
            exact_entry_count=sum(r['entry_open_equals_previous_close'] for r in rows),
            exact_exit_count=sum(r['exit_open_equals_previous_close'] for r in rows),
            observed_path_bars=sum(r['observed_path_bars'] for r in rows),
            exact_open_path_bars=sum(r['exact_open_path_bars'] for r in rows),
            trades_with_missing_sessions=sum(bool(r['missing_global_sessions']) for r in rows),
            gross_profit_exact_entry=sum(max(r['pnl'],0) for r in rows if r['entry_open_equals_previous_close']),
            gross_profit_all=sum(max(r['pnl'],0) for r in rows),
            entry_close_open_distribution=distribution(pd.Series([r['entry_close_open_pct'] for r in rows])), rows=rows)
    examples = recent.loc[recent.symbol.isin(['COMI','ETEL','FWRY','SWDY']) & recent.date.between('2025-01-01','2025-01-09'),
                          ['symbol','date',*FIELDS,'previous_close','open_gap_pct','close_open_pct']].to_dict('records')
    metadata_path = ARCHIVE.parent / 'metadata.json'
    return dict(research_path=str(research_path), research_sha256=hashlib.sha256(research_path.read_bytes()).hexdigest(),
        stored_price_sha256=report['price_sha256'], stored_engine_sha256=report['script_sha256'],
        current_engine_sha256=engine_hash, engine_hash_matches_saved=engine_hash==report['script_sha256'],
        feature_reconstruction_quality=quality, selected_config=selected,
        snapshot_metadata=json.loads(metadata_path.read_text(encoding='utf-8')),
        by_year=by_year, by_month_since_2021=by_month, by_symbol_since_2021=per_symbol,
        positive_volume_nonflat_since_2021=stats(recent.loc[recent.volume.gt(0)&recent.high.gt(recent.low)]),
        liquid_prior_20bars_since_2021=stats(recent.loc[recent.prior_turnover20.ge(2_000_000)&recent.prior_positive20.ge(18)]),
        consecutive_global_sessions_since_2021=stats(recent.loc[recent.consecutive_global_session]),
        longest_exact_streaks=sorted(streaks,key=lambda x:x['exact_pair_streak'],reverse=True)[:20],
        local_examples=examples, selected_signal_entry_screen=entry_screen, saved_trade_paths=trade_paths,
        source_evidence=[
            dict(path='api/tradingview_integration.py', finding='Yahoo fallback substitutes adjclose for close alone, preserving quote open/high/low; this is a mixed-basis code path, not proof any specific archive row used it.'),
            dict(path='api/hf_history_cache.py', finding='Snapshot normalizer removes inconsistent OHLC rows; exported schema omits provider, raw close, adjusted close and adjustment factors.'),
            dict(path='api/migrate_egx_history.py', finding='Migration merges archived/live/snapshot sources, validates each and exports price columns without _source provenance.')],
        limitations=['Numeric exact equality uses parsed numbers, no rounding; relative tolerance is reported separately.',
            'Previous close is previous observed symbol bar; global-consecutive subset is reported separately.',
            'OHLC endpoint consistency cannot prove first-trade semantics or recover intraday event order.',
            'No independent exchange/provider raw response available here to establish fabrication or adjusted/raw lineage.',
            'Signal reconstruction uses current reviewed load_data; check engine hash match. No strategy grid, simulation or optimization rerun.',
            'Exact-open P&L exposure is not estimated erroneous P&L; corrected returns cannot be inferred.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prices', type=Path, default=ARCHIVE)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--research-only', action='store_true', help='Append opening-semantics audit to existing output; preserve earlier audit sections.')
    args = parser.parse_args()
    paths = {k: ROOT / f'scratch/september_daily_{k}_2026-10-06.json'
             for k in ('source', 'tail', 'exit_results')}
    inputs = {k: json.loads(p.read_text(encoding='utf-8')) for k, p in paths.items()}
    with gzip.open(args.prices, 'rt', encoding='utf-8') as f:
        raw = json.load(f)
    if args.research_only:
        out = json.loads(args.output.read_text(encoding='utf-8')) if args.output and args.output.exists() else {}
        result = opening_semantics(raw, ROOT / 'scratch/swing_research_validation_2026-10-06.json')
        with args.prices.open('rb') as f:
            result['current_archive_sha256'] = hashlib.file_digest(f, 'sha256').hexdigest()
        result['archive_hash_matches_saved'] = result['current_archive_sha256'] == result['stored_price_sha256']
        out['opening_semantics_audit'] = result
        encoded = json.dumps(out, indent=2, ensure_ascii=True, allow_nan=False,
                             default=lambda x: x.item() if hasattr(x, 'item') else str(x))
        if args.output:
            args.output.write_text(encoded+'\n', encoding='utf-8')
            print(json.dumps(dict(archive_hash_match=result['archive_hash_matches_saved'],
                                 engine_hash_match=result['engine_hash_matches_saved'],
                                 selected_signal_entry_screen=result['selected_signal_entry_screen'])))
        else:
            print(encoded)
        return
    tail, replay = inputs['tail'], inputs['exit_results']
    symbols = {r['symbol'] for r in inputs['source']['recommendations']}
    provenance = {}
    for name, path in {'archive': args.prices, **paths}.items():
        with path.open('rb') as f:
            digest = hashlib.file_digest(f, 'sha256').hexdigest()
        provenance[name] = dict(path=str(path), bytes=path.stat().st_size,
                                sha256=digest)
    sept = lambda r: '2026-09-01' <= r['date'] <= '2026-09-30'
    archive_index = {(r['symbol'], r['date']): r for r in raw}
    overlaps = []
    for r in tail:
        old = archive_index.get((r['symbol'], r['date']))
        if old:
            overlaps.append(dict(symbol=r['symbol'], date=r['date'],
                                 different_fields=[k for k in FIELDS if number(old.get(k)) != number(r.get(k))]))
    # Same validity and keep-last intent as prepare_prices; conflicts are reported separately.
    combined = raw + tail
    index = {(r['symbol'], r['date']): r for r in combined if valid(r)}
    groups = defaultdict(list)
    coverage = defaultdict(set)
    for (s, d), r in sorted(index.items()):
        groups[s].append(r)
        coverage[d].add(s)
    september_dates = sorted(d for d, ss in coverage.items() if d.startswith('2026-09') and len(ss) >= 20)
    anomalies = [dict(**compact(r), issues=issues(r), origin=origin)
                 for origin, rows in [('archive', raw), ('tail', tail)]
                 for r in rows if '2026-06-01' <= r['date'] <= '2026-10-05' and issues(r)]
    jumps = []
    moderate = []
    volume_spikes = []
    history_counts = Counter()
    for s, rows in groups.items():
        for i, cur in enumerate(rows):
            if not sept(cur) or i < 20:
                continue
            baseline = median(float(r['volume']) for r in rows[i-20:i])
            if baseline > 0 and float(cur['volume']) / baseline >= 20:
                volume_spikes.append(dict(**compact(cur), prior_20_observed_bar_median_volume=baseline,
                                          volume_multiple=float(cur['volume'])/baseline))
        for prev, cur in zip(rows, rows[1:]):
            pc = float(prev['close'])
            gap = float(cur['open']) / pc - 1
            ret = float(cur['close']) / pc - 1
            if '2026-09-01' <= cur['date'] <= '2026-09-30' and (abs(gap) >= .10 or abs(ret) >= .10):
                moderate.append(dict(symbol=s, date=cur['date'], previous_date=prev['date'],
                                     open_gap_pct=100*gap, close_return_pct=100*ret,
                                     current=compact(cur)))
            if abs(gap) >= .25 or abs(ret) >= .25:
                history_counts['events'] += 1
                if '2026-08-01' <= cur['date'] <= '2026-10-05':
                    jumps.append(dict(symbol=s, date=cur['date'], previous_date=prev['date'],
                                      previous_close=pc, open_gap_pct=100*gap, close_return_pct=100*ret,
                                      previous=compact(prev), current=compact(cur),
                                      calendar_gap_days=(date.fromisoformat(cur['date'])-date.fromisoformat(prev['date'])).days))
    missing = []
    for s in sorted(symbols):
        rows = groups.get(s, [])
        observed = {r['date'] for r in rows}
        missing.append(dict(symbol=s, missing_inferred_sessions=[d for d in september_dates if d not in observed],
                            september_bars=sum(sept(r) for r in rows)))
    invalid_keys = {(r['symbol'], r['date']) for r in anomalies if set(r['issues']) - {'zero_volume', 'fractional_volume'}}
    zero_keys = {(r['symbol'], r['date']) for r in anomalies if 'zero_volume' in r['issues']}
    jump_keys = {(r['symbol'], r['date']) for r in jumps}
    impact = []
    for run in replay['runs']:
        details = []
        totals = Counter()
        for t in run['trades']:
            s, start, end = t['symbol'], t['entry_date'], t['exit_date']
            flags = {}
            for name, keys in [('discontinuity', jump_keys), ('invalid_raw_bar', invalid_keys), ('zero_volume', zero_keys)]:
                ds = sorted(d for sym, d in keys if sym == s and start <= d <= end)
                if ds:
                    flags[name] = ds
            absent = [d for d in september_dates if start <= d <= end and (s, d) not in index]
            if absent:
                flags['missing_inferred_session'] = absent
            loss = max(0, -t['pnl_cash'])
            totals['gross_realized_losses'] += loss
            if flags:
                totals['flagged_trade_count'] += 1
                totals['flagged_gross_losses'] += loss
                totals['flagged_net_pnl'] += t['pnl_cash']
                for name in flags:
                    totals[name + '_loss'] += loss
                details.append(dict(**t, flags=flags))
        impact.append(dict(policy=run['policy'], through=run['through'], original_metrics=run['metrics'],
                           overlap_totals=dict(totals), flagged_trades=details))
        impact[-1]['moderate_move_overlaps_not_proven_defects'] = [
            dict(symbol=t['symbol'], entry_date=t['entry_date'], exit_date=t['exit_date'], pnl_cash=t['pnl_cash'],
                 events=[j for j in moderate if j['symbol'] == t['symbol'] and t['entry_date'] <= j['date'] <= t['exit_date']])
            for t in run['trades'] if any(j['symbol'] == t['symbol'] and t['entry_date'] <= j['date'] <= t['exit_date'] for j in moderate)]
    archive_sep24 = sorted(coverage.get('2026-09-24', set()))
    archive_sep23 = coverage.get('2026-09-23', set())
    missing_sep24 = sorted(archive_sep23 - set(archive_sep24))
    coverage_cutoff = dict(september24_symbols=archive_sep24, prior_session_symbols_missing=missing_sep24,
                          prior_session_symbols_missing_count=len(missing_sep24),
                          cohort_missing_count=sum('2026-09-24' in r['missing_inferred_sessions'] for r in missing),
                          inferred_sessions=len(september_dates),
                          cohort_missing_symbol_sessions=sum(len(r['missing_inferred_sessions']) for r in missing),
                          cohort_symbols_with_missing=sum(bool(r['missing_inferred_sessions']) for r in missing))
    # Price-basis checks against saved recommendation and adjustment observations.
    observations = []
    missing_signal_dates = []
    for rec in inputs['source']['recommendations']:
        publication = rec['created_at'][:10]
        if (rec['symbol'], publication) not in index:
            earlier = [r for r in groups.get(rec['symbol'], []) if r['date'] <= publication]
            missing_signal_dates.append(dict(symbol=rec['symbol'], publication_date=publication,
                                             latest_observed_date=earlier[-1]['date'] if earlier else None))
        checkpoints = [(rec['created_at'][:10], rec['entry_price'], 'recommendation')]
        adjustments = rec.get('adjustments') or []
        if isinstance(adjustments, str):
            adjustments = json.loads(adjustments)
        checkpoints += [(a['timestamp'][:10], a['current_price'], 'adjustment') for a in adjustments if a.get('current_price')]
        for d, price, kind in checkpoints:
            bar = index.get((rec['symbol'], d))
            if bar and abs(float(price)/float(bar['close'])-1) > .02:
                observations.append(dict(symbol=rec['symbol'], date=d, kind=kind, saved_price=price,
                                         cached_close=bar['close'], difference_pct=100*(float(price)/float(bar['close'])-1)))
    out = dict(provenance=provenance,
               methodology=dict(discontinuity_threshold_pct=25, missing_session_min_symbols=20,
                   invalid_rule='Finite positive OHLC, low <= open/close <= high, finite nonnegative volume.',
                   loss_attribution='Overlapping gross realized losses are exposure to suspect data, NOT proven erroneous losses or a corrected return. Categories overlap.',
                   calendar='Observed sessions only; absent bars may reflect suspension, listing coverage or missing records. No external exchange calendar.',
                   adjustments='No corporate actions inferred or applied; a 25% gap/return is a screening flag only.'),
               archive=summary(raw), archive_september=summary([r for r in raw if sept(r)]),
               tail=summary(tail), combined_september=summary([r for r in combined if sept(r)]),
               replay_input=summary([r for r in combined if r['symbol'] in symbols and '2026-06-01' <= r['date'] <= '2026-10-05']),
               tail_overlaps=overlaps, all_history_discontinuity_counts=dict(history_counts),
               recent_discontinuities=jumps, september_10pct_move_screen=moderate,
               september_volume_20x_screen=volume_spikes,
               recent_row_anomalies=anomalies, coverage_cutoff=coverage_cutoff,
               september_coverage={d: len(ss) for d, ss in sorted(coverage.items()) if d.startswith('2026-09')},
               cohort_missing_bars=missing, saved_price_disagreements=observations,
               recommendations_missing_publication_day_bar=missing_signal_dates, replay_loss_overlap=impact,
               limitations=['No remote reads; source/tail are cached observations, not independent corporate-action confirmation.',
                            'Holding-period overlap does not capture every effect on prior liquidity or EMA history.',
                            '10% price moves and 20x median volume are screens, not established data defects. Volume baseline uses 20 observed bars, not calendar sessions.',
                            'No adjusted or exclusion-based counterfactual portfolio computed; cash and capacity interactions preclude simply subtracting flagged losses.',
                            'No open-position loss attribution; verify original_metrics.open_at_end before interpreting realized-only totals.'])
    encoded = json.dumps(out, indent=2, ensure_ascii=True, allow_nan=False)
    if args.output:
        args.output.write_text(encoded + '\n', encoding='utf-8')
        print(json.dumps({k:out[k] for k in ('archive','archive_september','tail','replay_input')}))
        print(json.dumps([dict(policy=x['policy'], through=x['through'], totals=x['overlap_totals']) for x in impact]))
    else:
        print(encoded)


if __name__ == '__main__':
    main()
