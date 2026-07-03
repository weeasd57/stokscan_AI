import os
import sys
import json
from datetime import datetime, timezone

# Add root folder to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.stock_ai import _init_supabase, supabase

def upload_file_to_cache(filepath, cache_key):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return False
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            payload = json.load(f)
        
        _init_supabase()
        if supabase:
            data = {
                "cache_key": cache_key,
                "country": "Egypt",
                "payload": payload,
                "computed_at": datetime.now(timezone.utc).isoformat()
            }
            supabase.table("market_cache").upsert(data).execute()
            print(f"Successfully uploaded {filepath} to Supabase under cache_key '{cache_key}'")
            return True
        else:
            print("Supabase client not available.")
    except Exception as e:
        print(f"Failed to upload {filepath}: {e}")
    return False

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 1. market_status
    status_path = os.path.join(base_dir, "api", "symbols_data", "market_status.json")
    upload_file_to_cache(status_path, "market_status_Egypt")
    
    # 2. macro_history_cache
    macro_path = os.path.join(base_dir, "symbols_data", "macro_history_cache.json")
    if not os.path.exists(macro_path):
        macro_path = os.path.join(base_dir, "api", "symbols_data", "macro_history_cache.json")
    upload_file_to_cache(macro_path, "macro_history_cache")
    
    # 3. hedge_scan_cache
    hedge_path = os.path.join(base_dir, "symbols_data", "hedge_scan_cache.json")
    if not os.path.exists(hedge_path):
        hedge_path = os.path.join(base_dir, "api", "symbols_data", "hedge_scan_cache.json")
    upload_file_to_cache(hedge_path, "hedge_scan_cache")

if __name__ == "__main__":
    main()
