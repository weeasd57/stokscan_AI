import os
import sys
import json
import datetime as dt

# Set project root path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, project_root)

from api.stock_ai import _init_supabase, supabase

def upload_file_to_supabase(cache_key: str, filename_prefix: str, country: str = None):
    # Search specifically in api/symbols_data
    base = os.path.join(project_root, "api", "symbols_data")
    if not os.path.exists(base):
        print(f"[-] Base directory {base} does not exist.")
        return False
        
    candidates = [f for f in os.listdir(base) if f.startswith(filename_prefix) and f.endswith(".json")]
    if not candidates:
        print(f"[-] File for prefix '{filename_prefix}' not found in {base}.")
        return False
    
    # Sort and pick latest
    candidates.sort(reverse=True)
    path = os.path.join(base, candidates[0])
    
    print(f"[*] Reading {path}...")
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        print(f"[-] Failed to parse JSON from {path}: {e}")
        return False
        
    print(f"[*] Uploading '{cache_key}' (size: {len(payload)} items) to Supabase market_cache...")
    try:
        data = {
            "cache_key": cache_key,
            "payload": payload,
            "computed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        if country:
            data["country"] = country
            
        supabase.table("market_cache").upsert(data).execute()
        print(f"[+] Successfully uploaded '{cache_key}' to Supabase market_cache.")
        return True
    except Exception as e:
        print(f"[-] Error uploading '{cache_key}': {e}")
        return False

def main():
    print("[*] Initializing Supabase client...")
    _init_supabase()
    if not supabase:
        print("[-] Supabase client initialization failed.")
        sys.exit(1)
        
    # Upload exchanges_list
    upload_file_to_supabase("exchanges_list", "exchanges_list")
    
    # Upload country_summary
    upload_file_to_supabase("country_summary", "country_summary")
    
    # Upload all_symbols_by_country
    upload_file_to_supabase("all_symbols_by_country", "all_symbols_by_country")
    
    # Upload country symbols
    countries = ["Egypt", "USA", "UK", "Canada", "Brazil", "Argentina"]
    for country in countries:
        upload_file_to_supabase(f"symbols_{country}", f"{country}_all_symbols", country)

if __name__ == "__main__":
    main()
