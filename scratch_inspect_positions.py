import os
import sys

# Add project root to python path
sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    if not _supabase:
        print("Supabase not initialized")
        sys.exit(1)

    print("Fetching positions for user...")
    res = _supabase.table("positions").select("*").execute()
    
    if res.data:
        print(f"Loaded {len(res.data)} rows:")
        for row in res.data:
            print(f"ID: {row.get('id')} | Symbol: {row.get('symbol')} | Status: {row.get('status')} | Price: {row.get('entry_price')} | User: {row.get('user_id') or row.get('profile_id')}")
    else:
        print("No positions found")
except Exception as e:
    import traceback
    traceback.print_exc()
