import os
import sys

sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    if not _supabase:
        print("Supabase not initialized")
        sys.exit(1)

    print("Fetching one row from user_settings...")
    res = _supabase.table("user_settings").select("*").limit(1).execute()
    if res.data:
        row = res.data[0]
        print("Columns in user_settings:")
        for col in sorted(row.keys()):
            print(f"  - {col}")
    else:
        print("No user_settings found")
        
    print("\nFetching all rows from bot_subscriptions...")
    res2 = _supabase.table("bot_subscriptions").select("*").execute()
    if res2.data:
        print(f"bot_subscriptions rows ({len(res2.data)}):")
        for idx, row in enumerate(res2.data):
            print(f"Row {idx+1}:")
            for col in sorted(row.keys()):
                print(f"  - {col}: {row[col]}")
    else:
        print("No bot_subscriptions found")
        
except Exception as e:
    import traceback
    traceback.print_exc()
