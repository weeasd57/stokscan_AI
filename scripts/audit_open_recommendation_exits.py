"""Read-only preview of the next public EGX recommendation evaluation.

Reads the same HF archive and Supabase correction tail as the daily evaluator.
It never updates Supabase or sends Telegram messages.
"""
import json
from collections import Counter

import pandas as pd
from dotenv import load_dotenv

from api.hf_history_cache import load_history_snapshot, merge_snapshot_with_live, snapshot_metadata
from api.recommendation_policy import evaluate_bars, price_basis_matches


def main():
    load_dotenv()
    load_dotenv('web/.env.local')
    import api.stock_ai as stock_ai
    stock_ai._init_supabase()
    client = stock_ai.supabase
    if client is None:
        raise RuntimeError('Supabase client unavailable')
    recs = (client.table('scan_results')
        .select('id,symbol,exchange,status,created_at,updated_at,entry_price,target_price,stop_loss,rich_details')
        .eq('is_public', True).eq('exchange', 'EGX').eq('status', 'open').execute().data or [])
    archive = load_history_snapshot('EGX')
    by_symbol = ({symbol: group for symbol, group in
                  archive.loc[archive.symbol.isin({r['symbol'] for r in recs})].groupby('symbol')}
                 if not archive.empty else {})
    summary = Counter()
    projected = []
    review_symbols = []
    for rec in recs:
        symbol = rec['symbol']
        entry_day = rec['created_at'][:10]
        live = (client.table('stock_prices').select('date,open,high,low,close,volume')
            .eq('symbol', symbol).eq('exchange', 'EGX').gte('date', entry_day)
            .order('date', desc=False).execute().data or [])
        bars = merge_snapshot_with_live(by_symbol.get(symbol), live)
        if bars.empty:
            summary['missing_history'] += 1
            continue
        bars = bars.loc[bars.date >= pd.Timestamp(entry_day)].copy()
        if bars.empty:
            summary['missing_entry_onward'] += 1
            review_symbols.append(symbol)
            continue
        signal_bar = bars.loc[bars.date == pd.Timestamp(entry_day)]
        if signal_bar.empty or not price_basis_matches(rec['entry_price'], signal_bar.iloc[0]['close']):
            summary['missing_or_incompatible_entry_close'] += 1
            review_symbols.append(symbol)
            continue
        latest_day = bars.date.max().strftime('%Y-%m-%d')
        details = rec.get('rich_details') if isinstance(rec.get('rich_details'), dict) else {}
        policy = details.get('recommendation_policy') or {}
        cursor = (details.get('evaluation') or {}).get('last_evaluated_date') or min(
            rec['updated_at'][:10], latest_day)
        bars['date'] = bars.date.dt.strftime('%Y-%m-%d')
        try:
            result = evaluate_bars(entry=rec['entry_price'], target=rec['target_price'],
                stop=rec['stop_loss'], bars=bars.to_dict('records'), entry_date=entry_day,
                cursor=cursor, max_sessions=policy.get('max_sessions'),
                trail_pct=policy.get('trail_pct'))
        except (TypeError, ValueError):
            summary['invalid_levels_or_bars'] += 1
            continue
        if result['last_close'] is None:
            summary['no_new_bar'] += 1
        elif result['status'] == 'open':
            summary['would_update_open'] += 1
        else:
            summary['would_close'] += 1
            projected.append(dict(symbol=symbol, exit_day=result['closed_on'],
                reason=result['exit_reason'], gross_return_pct=round(result['profit_loss_pct'], 3)))
    print(json.dumps(dict(open_recommendations=len(recs),
        hf_snapshot=snapshot_metadata('EGX'), summary=dict(summary),
        review_symbols=sorted(set(review_symbols)), projected_closures=projected),
        ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
