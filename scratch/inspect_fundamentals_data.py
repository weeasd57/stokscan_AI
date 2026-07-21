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

def inspect_data():
    url = f"{SUPABASE_URL}/rest/v1/stock_fundamentals?select=symbol,name,data&limit=3"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for item in data:
                print(f"Symbol: {item['symbol']}")
                print(f"Name: {item['name']}")
                data_val = item.get('data')
                if data_val:
                    # If it's a string, try parsing it
                    if isinstance(data_val, str):
                        try:
                            data_val = json.loads(data_val)
                        except:
                            pass
                    print("Data keys/preview:")
                    if isinstance(data_val, dict):
                        print(list(data_val.keys()))
                        print("Price/Close keys:")
                        print({k: v for k, v in data_val.items() if 'price' in k.lower() or 'close' in k.lower() or 'valuation' in k.lower()})
                    else:
                        print(str(data_val)[:200])
                else:
                    print("Data is None")
                print("-" * 50)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    inspect_data()
