import os
import sys

project_root = os.path.abspath(os.path.dirname(__file__) + '/..')
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_root, '.env'))
load_dotenv(os.path.join(project_root, 'web', '.env.local'), override=True)

from api.stock_ai import _init_supabase, _get_thread_local_supabase

def check_scores():
    _init_supabase(force=True)
    sb = _get_thread_local_supabase()
    
    res = sb.table('stock_technical_indicators').select('symbol, date, king_ai_score, egx_ai_score, close').order('king_ai_score', desc=True).limit(5).execute()
    print('--- Top 5 by KING AI Score ---')
    for r in res.data:
        print(f"{r['symbol']} | {r['date']} | KING: {r['king_ai_score']} | EGX: {r['egx_ai_score']} | Close: {r['close']}")

    res2 = sb.table('stock_technical_indicators').select('symbol, date, king_ai_score, egx_ai_score, close').order('egx_ai_score', desc=True).limit(5).execute()
    print('\n--- Top 5 by EGX AI Score ---')
    for r in res2.data:
        print(f"{r['symbol']} | {r['date']} | KING: {r['king_ai_score']} | EGX: {r['egx_ai_score']} | Close: {r['close']}")

if __name__ == '__main__':
    check_scores()
