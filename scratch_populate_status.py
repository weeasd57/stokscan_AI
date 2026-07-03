import os
import sys

# Add root folder to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.free_data_provider import get_market_status_free
from api.stock_ai import _init_supabase, supabase
from datetime import datetime, timezone

def run():
    print("Fetching market status using free provider...")
    res_data = get_market_status_free(period="6mo")
    print(f"Fetched. Keys in res_data: {list(res_data.keys())}")
    
    _init_supabase()
    if supabase:
        print("Upserting to market_cache...")
        data = {
            "cache_key": "market_status_Egypt",
            "country": "Egypt",
            "payload": res_data,
            "computed_at": datetime.now(timezone.utc).isoformat()
        }
        supabase.table("market_cache").upsert(data).execute()
        print("Successfully populated market_status_Egypt!")
    else:
        print("Supabase connection not initialized.")

if __name__ == "__main__":
    run()
