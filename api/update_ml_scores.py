import os
import sys
import datetime as dt
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd

project_root = os.path.abspath(os.path.dirname(__file__) + '/..')
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_root, '.env'))
load_dotenv(os.path.join(project_root, 'web', '.env.local'), override=True)

import api.stock_ai as stock_ai
from api.stock_ai import _init_supabase, _get_thread_local_supabase, _get_exchange_bulk_data, add_massive_features
from api.routers.scan_ai_fast import _load_model

def get_model_prob(model, df, predictors):
    try:
        available = [p for p in predictors if p in df.columns]
        if hasattr(model, 'predict_proba'):
            return float(model.predict_proba(df[available])[0][1])
        else:
            return float(model.predict(df[available])[0])
    except Exception:
        return None

def update_all_scores():
    print('[ML_SCORES] Starting update of AI scores in stock_technical_indicators...')
    _init_supabase(force=True)
    sb = stock_ai.supabase
    if not sb:
        print('[ML_SCORES] Failed to init supabase.')
        return

    print('[ML_SCORES] Loading models...')
    king_model = _load_model('KING.pkl')
    egx_model = _load_model('model_EGX.pkl')

    king_predictors = getattr(king_model, 'lgbm_predictors', None) or stock_ai.LGBM_PREDICTORS
    egx_predictors = getattr(egx_model, 'lgbm_predictors', None) or stock_ai.LGBM_PREDICTORS

    print('[ML_SCORES] Pre-fetching bulk data for EGX...')
    bulk_data = _get_exchange_bulk_data('EGX', bypass_min_limit=True)
    
    symbols = list(bulk_data.keys())
    if not symbols:
        print('[ML_SCORES] No active symbols found in bulk data.')
        return

    print(f'[ML_SCORES] Processing {len(symbols)} symbols...')

    all_updates = []

    def _process(sym):
        try:
            df = bulk_data[sym].copy()
            if df.empty or len(df) < 50:
                return None
                
            feat_df = add_massive_features(df)
            if feat_df.empty:
                return None
            
            latest_row = feat_df.iloc[[-1]].copy()
            
            king_prob = get_model_prob(king_model, latest_row, king_predictors)
            egx_prob = get_model_prob(egx_model, latest_row, egx_predictors)
            
            date_val = latest_row['Date'].dt.strftime('%Y-%m-%d').iloc[0] if 'Date' in latest_row else feat_df.index[-1].strftime('%Y-%m-%d')
            
            return {
                'symbol': sym,
                'date': date_val,
                'king_ai_score': king_prob,
                'egx_ai_score': egx_prob
            }
        except Exception as e:
            print(f"Error {sym}: {e}")
            return None

    # Run sequentially for safety and debugging
    for sym in symbols:
        res = _process(sym)
        if res:
            all_updates.append(res)
                
    print(f'[ML_SCORES] Generated scores for {len(all_updates)} symbols. Updating DB...')
    
    if all_updates:
        success_count = 0
        for upd in all_updates:
            if upd['king_ai_score'] is None and upd['egx_ai_score'] is None:
                continue
            try:
                # Find the latest date in DB for this symbol
                date_res = sb.table('stock_technical_indicators').select('date').eq('symbol', upd['symbol']).eq('exchange', 'EGX').order('date', desc=True).limit(1).execute()
                if date_res.data:
                    db_date = date_res.data[0]['date']
                    sb.table('stock_technical_indicators').update({
                        'king_ai_score': upd['king_ai_score'],
                        'egx_ai_score': upd['egx_ai_score']
                    }).eq('symbol', upd['symbol']).eq('exchange', 'EGX').eq('date', db_date).execute()
                    success_count += 1
                else:
                    print(f"No existing record in DB for {upd['symbol']}")
            except Exception as e:
                print(f"Update error for {upd['symbol']}: {e}")
                pass
                
        print(f'[ML_SCORES] Successfully updated {success_count} rows.')

if __name__ == '__main__':
    update_all_scores()
