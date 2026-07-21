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

def test_query():
    # Test stock_fundamentals table
    url = f"{SUPABASE_URL}/rest/v1/stock_fundamentals?select=*"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print("✅ stock_fundamentals query successful!")
            if data:
                print("First record:", data[0].keys())
    except urllib.error.HTTPError as e:
        print("❌ stock_fundamentals failed:", e.code)
        print("Response:", e.read().decode("utf-8"))

    # Test stocks table
    url_stocks = f"{SUPABASE_URL}/rest/v1/stocks?select=*"
    req_stocks = urllib.request.Request(url_stocks, headers=headers)
    try:
        with urllib.request.urlopen(req_stocks, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print("✅ stocks query successful!")
            if data:
                print("First record:", data[0].keys())
    except urllib.error.HTTPError as e:
        print("❌ stocks failed:", e.code)
        print("Response:", e.read().decode("utf-8"))

if __name__ == "__main__":
    test_query()
