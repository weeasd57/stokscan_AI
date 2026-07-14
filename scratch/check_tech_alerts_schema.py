import os
import sys

sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    if not _supabase:
        print("Supabase not initialized")
        sys.exit(1)

    print("Fetching one row from technical_alerts...")
    res = _supabase.table("technical_alerts").select("*").limit(1).execute()
    if res.data:
        row = res.data[0]
        print("Columns in technical_alerts:")
        for col in sorted(row.keys()):
            print(f"  - {col}")
    else:
        # If no rows, let's look at table definition via public schemas if possible, or just print empty
        print("No technical alerts found in the database. Creating a mock query to verify columns might fail, but let's query column names using a dummy insert that fails or check schema.")
        
except Exception as e:
    import traceback
    traceback.print_exc()
