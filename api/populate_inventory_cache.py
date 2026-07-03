import os
import sys

# Set project root path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, project_root)

from api.stock_ai import _init_supabase, supabase, get_supabase_inventory
from api.symbols_local import save_to_supabase_cache

def main():
    print("[*] Initializing Supabase client...")
    _init_supabase()
    if not supabase:
        print("[-] Supabase client initialization failed.")
        sys.exit(1)
        
    print("[*] Computing inventory stats from Supabase...")
    data = get_supabase_inventory()
    print(f"[+] Computed stats for {len(data)} exchanges.")
    
    print("[*] Saving inventory to Supabase market_cache...")
    save_to_supabase_cache("inventory", data)
    print("[+] Done!")

if __name__ == "__main__":
    main()
