import sys
import pandas as pd
import datetime
sys.path.insert(0, r'c:\Users\MR__CODER__\Desktop\stokscan_AI')

from dotenv import load_dotenv
import os
project_root = r'c:\Users\MR__CODER__\Desktop\stokscan_AI'
load_dotenv(os.path.join(project_root, '.env'))
load_dotenv(os.path.join(project_root, 'web', '.env.local'), override=True)

from api.routers.scan_ai_fast import fast_scan
from api.stock_ai import _get_thread_local_supabase, _init_supabase

def run_test():
    print("Initializing Supabase...")
    _init_supabase(force=True)
    sb = _get_thread_local_supabase()
    
    print("Fetching TMGH price history...")
    res = sb.table('stock_prices').select('date, close').eq('symbol', 'TMGH').execute()
    df_prices = pd.DataFrame(res.data)
    df_prices['date'] = pd.to_datetime(df_prices['date']).dt.strftime('%Y-%m-%d')
    df_prices = df_prices.set_index('date')

    dates = pd.date_range(start='2026-06-01', end='2026-06-20')
    results = []
    
    for d in dates:
        d_str = d.strftime('%Y-%m-%d')
        if d_str not in df_prices.index:
            continue # Not a trading day or no data
            
        print(f"Scanning {d_str}...", flush=True)
        # fast_scan already prevents lookahead because it internally slices data up to 'to_date'
        scan_res = fast_scan(country='Egypt', to_date=d_str, limit=300, model_name='KING.pkl', buy_threshold=0.0, return_raw_prob=True)
        results_list = scan_res.get('results', []) if isinstance(scan_res, dict) else []
        aalr_res = [r for r in results_list if isinstance(r, dict) and r.get('symbol') == 'TMGH']
        
        if not aalr_res:
            print(f"  -> TMGH not in scan results for {d_str}")
            continue
            
        prob = aalr_res[0].get('precision', 0.0)
        close = df_prices.loc[d_str]['close']
        
        # Calculate future change
        future_dates = sorted([x for x in df_prices.index if x > d_str])
        if len(future_dates) >= 5:
            future_price = df_prices.loc[future_dates[4]]['close']
            pct_change = ((future_price - close) / close) * 100
        else:
            future_price = 0
            pct_change = 0
            
        results.append({
            'Date': d_str,
            'Close': close,
            'KING Confidence': f"{prob*100:.1f}%",
            '5-Day Future': future_price,
            '5-Day Change': f"{pct_change:+.2f}%"
        })

    print("\n\n=== FINAL RESULTS ===")
    df_results = pd.DataFrame(results)
    print(df_results.to_string(index=False))

if __name__ == '__main__':
    run_test()
