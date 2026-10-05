"""Frozen-protocol local price-only experiments. No service/database writes."""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np
import pandas as pd


def load_data(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        raw = pd.DataFrame(json.load(f))
    raw = raw.loc[raw.date.between('2021-01-01', '2026-09-24')].copy()
    cols = ['open', 'high', 'low', 'close', 'volume']
    raw[cols] = raw[cols].apply(pd.to_numeric, errors='coerce')
    valid = (np.isfinite(raw[cols]).all(axis=1) & raw[cols[:4]].gt(0).all(axis=1) & raw.volume.ge(0)
             & raw.high.ge(raw[['open', 'low', 'close']].max(axis=1))
             & raw.low.le(raw[['open', 'high', 'close']].min(axis=1)))
    invalid = int((~valid).sum())
    raw = raw.loc[valid].sort_values(['symbol', 'date']).drop_duplicates(['symbol', 'date'])
    frames, signals, breadth = {}, defaultdict(list), defaultdict(list)
    dates = sorted(raw.date.unique())
    next_date = dict(zip(dates, dates[1:]))
    for symbol, g in raw.groupby('symbol'):
        g = g.copy()
        c = g.close
        g['prevclose'] = c.shift()
        for n in (5, 10, 20, 50):
            g[f'ema{n}'] = c.ewm(span=n, adjust=False).mean()
        g['prevema10'] = g.ema10.shift()
        g['atr'] = pd.concat([g.high-g.low, (g.high-c.shift()).abs(),
                             (g.low-c.shift()).abs()], axis=1).max(axis=1).rolling(14).mean()
        g['turnover'] = (c*g.volume).rolling(20).mean()
        g['priorhigh20'] = g.high.rolling(20).max().shift()
        g['rv'] = g.volume / g.volume.rolling(20).mean().shift()
        g['mom5'] = c.pct_change(5, fill_method=None)
        g['base'] = ((np.arange(len(g)) >= 120) & (g.turnover >= 2_000_000)
                     & (g.volume.gt(0).rolling(20).sum() >= 18)
                     & (c.pct_change(fill_method=None).abs().rolling(20).max() <= .20))
        g['trend'] = (c > g.ema50) & (g.ema20 > g.ema50)
        g['breakout'] = g.base & g.trend & (c > g.priorhigh20) & (g.rv >= 1.2)
        g['pullback'] = (g.base & g.trend & (g.low <= g.ema10*1.01)
                         & (c > g.ema10) & (c > c.shift()) & (c <= g.ema10*1.03))
        g['momentum'] = g.base & g.trend & g.mom5.between(.02, .08) & (g.rv >= 1.2)
        frames[symbol] = {b.date: b for b in g.itertuples(index=False)}
        for b in g.itertuples(index=False):
            if b.base:
                breadth[b.date].append(bool(b.close > b.ema50))
            day = next_date.get(b.date)
            if not day:
                continue
            for family in ('breakout', 'pullback', 'momentum', 'eligible'):
                if getattr(b, 'base' if family == 'eligible' else family):
                    signals[family].append(dict(symbol=symbol, signal_date=b.date, date=day,
                                                close=b.close, turnover=b.turnover,
                                                atr_pct=b.atr/b.close))
    breadth = {d: float(np.mean(v)) for d, v in breadth.items() if len(v) >= 20}
    return frames, signals, breadth, dict(rows=len(raw), symbols=len(frames),
                                         invalid_rows_removed=invalid, first=dates[0], last=dates[-1])


def run(frames, entries, config, start, end, cost=.001, min_sell_age=2, cash_delay=2):
    dates = sorted({d for bars in frames.values() for d in bars if start <= d <= end})
    signals = defaultdict(list)
    for s in entries:
        if start <= s['date'] <= end:
            signals[s['date']].append(s)
    cash, receivables, pos, trades, curve = 100_000., [], {}, [], []
    skips, warnings = Counter(), Counter()
    def sell(symbol, day, price, age, reason, index):
        nonlocal cash
        p = pos.pop(symbol)
        proceeds = p['shares'] * price * (1-cost) ** 2
        if cash_delay:
            receivables.append((index+cash_delay, proceeds))
        else:
            cash += proceeds
        trades.append(dict(symbol=symbol, entry_date=p['date'], exit_date=day,
                           sessions=age, pnl=proceeds-p['cost'],
                           net_pct=100*(proceeds/p['cost']-1), reason=reason))
    for i, day in enumerate(dates):
        cash += sum(v for due, v in receivables if due <= i)
        receivables = [(due, v) for due, v in receivables if due > i]
        for symbol in list(pos):
            p, b = pos[symbol], frames[symbol].get(day)
            if b is None or b.volume <= 0 or b.high == b.low:
                warnings['untradable_position_sessions'] += 1
                continue
            age = i-p['index']
            # Elapsed deadlines do not depend on receiving yesterday's bar.
            if age >= 15 or (config['exit'] == 'fixed5_atr' and age >= 5):
                p['pending'] = p['pending'] or 'elapsed_time_deadline'
            elif age >= 5 and not p['pending']:
                prior = frames[symbol].get(dates[i-1]) if i else None
                if prior is None or prior.volume <= 0 or prior.high == prior.low:
                    p['pending'] = 'missing_review_bar'
            if abs(b.open/b.prevclose-1) > .25:
                warnings['large_gap_position_sessions'] += 1
            if age >= min_sell_age and (b.open <= p['stop'] or p['pending']):
                sell(symbol, day, b.open, age, 'gap_stop' if b.open <= p['stop'] else p['pending'], i)
        unsettled = sum(v for _, v in receivables)
        exposure = sum(p['shares']*(frames[s][day].open if day in frames[s] else p['last']) for s,p in pos.items())
        eq = cash+unsettled+exposure
        for s in sorted(signals[day], key=lambda x:(-x['turnover'], x['symbol'])):
            symbol = s['symbol']
            b = frames[symbol].get(day)
            if b is None or b.volume <= 0 or b.high == b.low:
                skips['no_executable_bar'] += 1
                continue
            if not .95 <= b.open/s['close'] <= 1.02:
                skips['opening_price_outside_band'] += 1
                continue
            if symbol in pos or len(pos) >= 5:
                skips['capacity'] += 1
                continue
            alloc = max(0, min(eq*.1, eq*.5-exposure, cash, s['turnover']*.01))
            fill = b.open*(1+cost)
            shares = int(alloc/(fill*(1+cost)))
            if not shares:
                skips['cash_or_exposure'] += 1
                continue
            paid = shares*fill*(1+cost)
            cash -= paid
            exposure += shares*b.open
            stop = .05 if config['exit'] == 'trend_fixed' else float(np.clip(1.5*s['atr_pct'], .03, .08))
            trail = .04 if config['exit'] == 'trend_fixed' else float(np.clip(2*s['atr_pct'], .03, .10))
            pos[symbol] = dict(date=day, index=i, shares=shares, cost=paid, entry=fill,
                               stop=fill*(1-stop), trail=trail, peak=fill, last=fill, pending=None)
        for symbol in list(pos):
            p, b = pos[symbol], frames[symbol].get(day)
            if b is None:
                continue
            p['last'] = b.close
            age = i-p['index']
            executable = b.volume > 0 and b.high > b.low
            if b.low <= p['stop']:
                if age >= min_sell_age and executable:
                    sell(symbol, day, min(b.open, p['stop']), age, 'stop', i)
                    continue
                p['pending'] = 'stop_during_sale_lock'
                warnings['stop_during_sale_lock'] += 1
            if not executable:
                warnings['untradable_position_sessions'] += 1
                continue
            trend = (b.close >= p['entry']*1.02 and b.close > b.ema10
                     and b.ema5 > b.ema10 and b.ema10 > b.prevema10)
            if not p['pending']:
                if age+1 >= 15:
                    p['pending'] = 'max_time'
                elif age+1 >= 5 and (config['exit'] == 'fixed5_atr' or not trend):
                    p['pending'] = 'review_or_trend_break'
            p['peak'] = max(p['peak'], b.close)
            if config['exit'] != 'fixed5_atr' and b.close >= p['entry']*1.02:
                p['stop'] = max(p['stop'], p['peak']*(1-p['trail']))
        eq = cash+sum(v for _,v in receivables)+sum(p['shares']*p['last'] for p in pos.values())
        curve.append(dict(date=day, equity=eq))
    values = np.array([100_000.]+[r['equity'] for r in curve])
    wins = sum(max(t['pnl'], 0) for t in trades)
    losses = -sum(min(t['pnl'], 0) for t in trades)
    monthly, previous = {}, 100_000.
    for month in sorted({r['date'][:7] for r in curve}):
        last = [r['equity'] for r in curve if r['date'].startswith(month)][-1]
        monthly[month] = round(100*(last/previous-1), 3)
        previous = last
    metrics = dict(return_pct=round(100*(values[-1]/100_000-1), 3),
                   max_drawdown_pct=round(100*float((1-values/np.maximum.accumulate(values)).max()), 3),
                   trades=len(trades), average_hold=round(float(np.mean([t['sessions'] for t in trades])), 3) if trades else 0,
                   win_rate_pct=round(100*sum(t['pnl']>0 for t in trades)/len(trades), 2) if trades else 0,
                   profit_factor=round(wins/losses, 3) if losses else None,
                   extended=sum(t['sessions']>5 for t in trades), open_at_end=len(pos),
                   unsettled_cash=round(sum(v for _,v in receivables), 2),
                   warnings=dict(warnings), skipped=dict(skips))
    return dict(metrics=metrics, monthly=monthly, trades=trades, equity=curve,
                open_symbols=list(pos))


def qualifies(m, count):
    return bool(m['return_pct'] > 0 and m['trades'] >= count and 3 <= m['average_hold'] <= 8
                and m['max_drawdown_pct'] <= 15)


def bootstrap(curve, seed=20261006):
    """Circular 20-session block resampling; not a multiple-testing correction."""
    x = np.diff(np.log(np.array([100_000.]+[r['equity'] for r in curve])))
    rng = np.random.default_rng(seed)
    samples = []
    for _ in range(2000):
        starts = rng.integers(0, len(x), size=int(np.ceil(len(x)/20)))
        indices = ((starts[:,None]+np.arange(20)) % len(x)).ravel()[:len(x)]
        samples.append(100*np.expm1(x[indices].sum()))
    return dict(return_95pct_interval=np.quantile(samples, [.025, .975]).round(3).tolist(),
                probability_nonpositive=float(np.mean(np.array(samples)<=0)), block=20, draws=2000)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--prices', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    frames, signals, breadth, quality = load_data(args.prices)
    configs = [dict(family=f, gate=g, exit=e) for f in ('breakout','pullback','momentum')
               for g in (False,True) for e in ('fixed5_atr','trend_atr','trend_fixed')]
    def entries(c):
        return [s for s in signals[c['family']] if not c['gate'] or breadth.get(s['signal_date'],0)>=.60]
    grid = []
    for c in configs:
        es = entries(c)
        dev = run(frames, es, c, '2022-01-01','2023-12-31')['metrics']
        val = run(frames, es, c, '2024-01-01','2024-12-31')['metrics']
        grid.append(dict(config=c, development=dev, validation=val,
                         eligible=qualifies(dev,50) and qualifies(val,25),
                         score=min(dev['return_pct']-dev['max_drawdown_pct'], val['return_pct']-val['max_drawdown_pct'])))
    eligible = [r for r in grid if r['eligible']]
    chosen = max(eligible or grid, key=lambda r:r['score'])
    # Selection frozen here; diagnostic leader if no eligible strategy, never a qualified winner.
    c, es = chosen['config'], entries(chosen['config'])
    tests = {}
    for label, begin, end in [('2025','2025-01-01','2025-12-31'),('2026_jan_aug','2026-01-01','2026-08-31'),
                              ('september_partial','2026-09-01','2026-09-24')]:
        base = run(frames,es,c,begin,end)
        stress = run(frames,es,c,begin,end,cost=.002)
        fixed = run(frames,es,dict(c,exit='fixed5_atr'),begin,end)
        tests[label] = dict(base=base, stress=stress['metrics'], fixed5=fixed['metrics'])
    combined = run(frames,es,c,'2025-01-01','2026-08-31')
    contribution = Counter()
    for t in combined['trades']:
        contribution[t['symbol']] += t['pnl']
    top2 = [s for s,_ in contribution.most_common(2)]
    excluded = run(frames,[s for s in es if s['symbol'] not in top2],c,'2025-01-01','2026-08-31')
    faster = run(frames,es,c,'2025-01-01','2026-08-31',min_sell_age=0,cash_delay=0)
    # Diagnostic, not a new selection step: matched daily opportunity counts,
    # random eligible tickers, then identical prior-turnover execution ranking.
    available = defaultdict(list)
    for s in signals['eligible']:
        available[s['date']].append(s)
    counts = Counter(s['date'] for s in es)
    random_metrics = []
    for seed in range(20):
        rng, sampled = np.random.default_rng(20261006+seed), []
        for day, count in sorted(counts.items()):
            pool = available[day]
            if pool:
                sampled.extend(pool[j] for j in rng.choice(len(pool), min(count,len(pool)),replace=False))
        random_metrics.append(run(frames,sampled,c,'2025-01-01','2026-08-31')['metrics'])
    passed = (bool(eligible) and all(qualifies(tests[k]['base']['metrics'],1) and tests[k]['stress']['return_pct']>0
                                    for k in ('2025','2026_jan_aug'))
              and combined['metrics']['trades']>=100 and excluded['metrics']['return_pct']>0)
    output = dict(protocol='docs/swing-research-protocol-2026-10-06.md',
                  price_sha256=hashlib.sha256(args.prices.read_bytes()).hexdigest(),
                  script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  data_quality=quality, signal_counts={k:len(v) for k,v in signals.items()},
                  grid=grid, qualifying_count=len(eligible), selection=chosen,
                  selection_status='qualified' if eligible else 'diagnostic_only_no_qualifier',
                  tests=tests, combined=combined, bootstrap=bootstrap(combined['equity']),
                  concentration=dict(top_two=top2, pnl_by_symbol=dict(contribution), without_top_two=excluded['metrics']),
                  immediate_sale_and_reuse_sensitivity=faster['metrics'],
                  matched_random_ticker_baseline=random_metrics,
                  numeric_paper_gates_pass=passed,
                  caveat='Numerical gates alone do not resolve price adjustments, survivor universe, historical execution eligibility or truly prospective validation.')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(output,indent=2,ensure_ascii=False, allow_nan=False,
                                     default=lambda x:x.item() if isinstance(x,np.generic) else str(x)),encoding='utf-8')
    serial = lambda x:x.item() if isinstance(x,np.generic) else str(x)
    print(json.dumps({k:output[k] for k in ('data_quality','signal_counts','qualifying_count','selection_status','selection','numeric_paper_gates_pass','bootstrap')},ensure_ascii=True,default=serial))
    print(json.dumps({k:{'base':v['base']['metrics'],'stress':v['stress'],'fixed5':v['fixed5']} for k,v in tests.items()},default=serial))


if __name__ == '__main__':
    main()
