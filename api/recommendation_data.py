"""Bounded, daily-only repair of missing recommendation price history."""
import datetime as dt
import pandas as pd

from api.hf_history_cache import _normalise_frame, merge_snapshot_with_live
from api.recommendation_policy import resolve_signal_reference


def repair_history(client, rec, current, today):
    """One source attempt per symbol/day, only when the evaluator needs repair."""
    symbol = rec['symbol']
    key = f"recommendation_history_repair_{symbol}"
    try:
        row = client.table('market_cache').select('payload').eq('cache_key', key).eq('country', 'Egypt').maybe_single().execute().data
        if isinstance(row, dict) and (row.get('payload') or {}).get('date') == today and (row.get('payload') or {}).get('repair_version') == 1:
            return current, row['payload']
    except Exception:
        pass
    report = {'date': today, 'symbol': symbol, 'source': 'TradingView', 'status': 'failed', 'rows_added': 0, 'repair_version': 1}
    try:
        from tvDatafeed import TvDatafeed, Interval
        raw = TvDatafeed().get_hist(symbol=symbol, exchange=rec.get('exchange', 'EGX'),
                                  interval=Interval.in_daily, n_bars=150)
        if raw is None or raw.empty:
            raise ValueError('source_returned_no_history')
        frame = raw.reset_index().rename(columns={'datetime': 'date'})
        frame['date'] = pd.to_datetime(frame['date']).dt.normalize()
        frame['symbol'], frame['exchange'] = symbol, rec.get('exchange', 'EGX')
        frame = _normalise_frame(frame)
        published = str(rec['created_at'])[:10]
        first = pd.Timestamp(published) - pd.Timedelta(days=60)
        frame = frame.loc[(frame.date >= first) & (frame.date <= pd.Timestamp(today))]
        bars = frame.assign(date=frame.date.dt.strftime('%Y-%m-%d')).to_dict('records')
        # Supabase volume is bigint; pandas/TradingView often emits 0.0.
        for bar in bars:
            bar['volume'] = int(bar['volume'])
        details = rec.get('rich_details') if isinstance(rec.get('rich_details'), dict) else {}
        reference = resolve_signal_reference(rec['entry_price'], bars, published,
            (details.get('entry_snapshot') or {}).get('price_date'))
        if not reference['ok']:
            raise ValueError(reference['reason'])
        existing = current.assign(date=current.date.dt.strftime('%Y-%m-%d')).to_dict('records') if not current.empty else []
        known = {r['date']: r for r in existing}
        delta = [r for r in bars if r['date'] not in known or any(
            float(r[k]) != float(known[r['date']][k]) for k in ('open','high','low','close','volume'))]
        if delta:
            client.table('stock_prices').upsert(delta, on_conflict='symbol,exchange,date').execute()
        current = merge_snapshot_with_live(current, bars)
        report.update(status='verified', rows_added=len(delta), reference=reference,
                      latest_date=frame.date.max().date().isoformat())
    except Exception as error:
        report['reason'] = str(error)[:200]
    try:
        client.table('market_cache').upsert(dict(cache_key=key, country='Egypt', payload=report,
            computed_at=dt.datetime.now(dt.timezone.utc).isoformat()), on_conflict='cache_key,country').execute()
    except Exception as error:
        print(f"[EVALUATE] Repair checkpoint unavailable for {symbol}: {type(error).__name__}")
    print(f"[EVALUATE] History repair {symbol}: {report}")
    return current, report
