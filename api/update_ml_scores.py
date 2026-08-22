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
    print('[ML_SCORES] Starting update of AI scores via fast_scan pipeline...')
    _init_supabase(force=True)
    sb = _get_thread_local_supabase()
    
    print('[ML_SCORES] Running fast_scan for KING model...')
    try:
        king_results = fast_scan(country='Egypt', limit=300, model_name='KING.pkl', buy_threshold=0.0, return_raw_prob=True)
    except Exception as e:
        print(f"Error running KING scan: {e}")
        king_results = {}
        
    print('[ML_SCORES] Running fast_scan for EGX model...')
    try:
        egx_results = fast_scan(country='Egypt', limit=300, model_name='model_EGX.pkl', buy_threshold=0.0, return_raw_prob=True)
    except Exception as e:
        print(f"Error running EGX scan: {e}")
        egx_results = {}
        
    king_map = {r.get('symbol'): r for r in king_results.get('results', []) if isinstance(r, dict)}
    egx_map = {r.get('symbol'): r for r in egx_results.get('results', []) if isinstance(r, dict)}
    
    all_symbols = set(king_map.keys()).union(set(egx_map.keys()))
    if not all_symbols:
        print('[ML_SCORES] No results found from fast_scan. Aborting DB update.')
        return
        
    print(f'[ML_SCORES] Updating {len(all_symbols)} symbols in DB...')
    success_count = 0
    
    for sym in all_symbols:
        k_res = king_map.get(sym, {})
        e_res = egx_map.get(sym, {})
        
        # fallback to the date from the other model if one is missing
        date_str = k_res.get('date') or e_res.get('date')
        if not date_str:
            continue
            
        k_score = k_res.get('precision')
        e_score = e_res.get('precision')
        
        try:
            # Match exactly the date from fast_scan, as it's guaranteed to be the latest trading day in the DB
            sb.table('stock_technical_indicators').update({
                'king_ai_score': k_score,
                'egx_ai_score': e_score
            }).eq('symbol', sym).eq('exchange', 'EGX').eq('date', date_str).execute()
            success_count += 1
        except Exception as e:
            print(f"Update error for {sym}: {e}")
            pass
            
    print(f'[ML_SCORES] Successfully updated {success_count} rows.')

if __name__ == '__main__':
    update_all_scores()
