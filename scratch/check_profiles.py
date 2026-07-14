import os
import sys

sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    if not _supabase:
        print("Supabase not initialized")
        sys.exit(1)

    print("Fetching one row from profiles...")
    res = _supabase.table("profiles").select("*").limit(1).execute()
    if res.data:
        row = res.data[0]
        print("Columns in profiles:")
        for col in sorted(row.keys()):
            print(f"  - {col}")
    else:
        print("No profiles found")
        
except Exception as e:
    import traceback
    traceback.print_exc()
