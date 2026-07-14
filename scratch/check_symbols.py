import os
import sys

sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    if not _supabase:
        print("Supabase not initialized")
        sys.exit(1)

    print("Querying stocks table for country='Egypt'...")
    res = _supabase.table("stocks").select("symbol,name").eq("country", "Egypt").limit(10).execute()
    for row in res.data:
        print(f"Stocks Symbol: {row.get('symbol')} | Name: {row.get('name')}")
        
    print("\nQuerying stock_technical_indicators table...")
    res2 = _supabase.table("stock_technical_indicators").select("symbol,exchange").limit(10).execute()
    for row in res2.data:
        print(f"Indicator Symbol: {row.get('symbol')} | Exchange: {row.get('exchange')}")
        
except Exception as e:
    import traceback
    traceback.print_exc()
