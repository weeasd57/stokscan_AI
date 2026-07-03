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

    print("Fetching scan_results...")
    res = _supabase.table("scan_results").select("id,symbol,signal,precision,status,profit_loss_pct,created_at").order("created_at", desc=True).limit(50).execute()
    
    if res.data:
        print(f"Loaded {len(res.data)} rows:")
        for row in res.data:
            if row.get("symbol") in ["MAAL", "ACAMD", "COSG"]:
                print(f"Symbol: {row.get('symbol')} | Signal: {row.get('signal')} | Precision: {row.get('precision')} | Status: {row.get('status')} | PL: {row.get('profit_loss_pct')}% | Created: {row.get('created_at')}")
    else:
        print("No rows found")
except Exception as e:
    import traceback
    traceback.print_exc()
