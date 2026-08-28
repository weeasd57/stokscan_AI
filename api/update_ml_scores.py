import os
import sys

project_root = os.path.abspath(os.path.dirname(__file__) + '/..')
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_root, '.env'))
load_dotenv(os.path.join(project_root, 'web', '.env.local'), override=True)

from api.stock_ai import _init_supabase, _get_thread_local_supabase
from api.routers.scan_ai_fast import fast_scan

def update_all_scores():
    print('[ML_SCORES] Starting update of raw AI scores via fast_scan pipeline (unfiltered)...')
    _init_supabase(force=True)
    sb = _get_thread_local_supabase()
    
    print('[ML_SCORES] Running fast_scan for KING model across all stocks...')
    try:
        king_results = fast_scan(
            country='Egypt',
            limit=500,
            min_precision=0.0,
            buy_threshold=0.0,
            model_name='KING.bin',
            return_raw_prob=True
        )
    except Exception as e:
        print(f"Error running KING scan: {e}")
        king_results = {}
        
    print('[ML_SCORES] Running fast_scan for EGX model across all stocks...')
    try:
        egx_results = fast_scan(
            country='Egypt',
            limit=500,
            min_precision=0.0,
            buy_threshold=0.0,
            model_name='model_EGX.bin',
            return_raw_prob=True
        )
    except Exception as e:
        print(f"Error running EGX scan: {e}")
        egx_results = {}
        
    king_map = {r.get('symbol'): r for r in king_results.get('results', []) if isinstance(r, dict)}
    egx_map = {r.get('symbol'): r for r in egx_results.get('results', []) if isinstance(r, dict)}
    
    all_symbols = set(king_map.keys()).union(set(egx_map.keys()))
    if not all_symbols:
        print('[ML_SCORES] No results found from fast_scan. Aborting DB update.')
        return
        
    print(f'[ML_SCORES] Updating raw ML scores for {len(all_symbols)} stocks in DB...')
    success_count = 0
    
    for sym in all_symbols:
        k_res = king_map.get(sym, {})
        e_res = egx_map.get(sym, {})
        
        k_score = k_res.get('precision')
        e_score = e_res.get('precision')
        
        if k_score is not None or e_score is not None:
            try:
                update_payload = {}
                if k_score is not None:
                    update_payload['king_ai_score'] = round(float(k_score), 4)
                if e_score is not None:
                    update_payload['egx_ai_score'] = round(float(e_score), 4)
                    
                res = sb.table('stock_technical_indicators').update(update_payload).eq('symbol', sym).eq('exchange', 'EGX').execute()
                if res.data:
                    success_count += len(res.data)
            except Exception as e:
                print(f"Update error for {sym}: {e}")
            
    print(f'[ML_SCORES] Successfully updated raw ML scores for {success_count} stocks.')

if __name__ == '__main__':
    update_all_scores()
