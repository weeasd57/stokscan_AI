import os
import sys

# Add project root to python path
sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    res = _supabase.table("scan_results").select("symbol,is_public,status").execute()
    for row in res.data:
        print(f"Symbol: {row.get('symbol')} | Status: {row.get('status')} | Public: {row.get('is_public')}")
except Exception as e:
    print(e)
