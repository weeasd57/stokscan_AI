import os
import sys

# Add project root to python path
sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    res = _supabase.table("stock_fundamentals").select("symbol,data").in_("symbol", ["ACAMD", "COSG"]).execute()
    if res.data:
        for row in res.data:
            print(f"Symbol: {row.get('symbol')} | Data: {row.get('data')}")
    else:
        print("No fundamentals found for ACAMD/COSG")
except Exception as e:
    print(e)
