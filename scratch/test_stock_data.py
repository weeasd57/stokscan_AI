import os
import json
import urllib.request
import sys
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
load_dotenv("web/.env.local")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "https://gfcmaxbtscmizsakarvc.supabase.co")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")

headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
}

def query_table(endpoint, description):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"\n=== {description} ===")
            if data:
                print(f"Total rows retrieved: {len(data)}")
                print("First row data:")
                print(json.dumps(data[0], indent=2, ensure_ascii=False))
            else:
                print("Table is empty")
    except Exception as e:
        print(f"❌ Failed to query {description}: {e}")
        if hasattr(e, "read"):
            print("Response:", e.read().decode("utf-8"))

if __name__ == "__main__":
    query_table("stocks?select=*&limit=3", "stocks")
    query_table("stock_prices?select=*&limit=3", "stock_prices")
    query_table("scan_results?select=symbol,name,last_close&limit=3", "scan_results")
    query_table("stock_fundamentals?select=symbol,name,fund_score&limit=3", "stock_fundamentals")
