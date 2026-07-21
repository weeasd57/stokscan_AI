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

def test_scan_results():
    url = f"{SUPABASE_URL}/rest/v1/scan_results?select=symbol,name,last_close&last_close=not.is.null&limit=250"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"✅ Success! Retrieved {len(data)} records from scan_results.")
            if data:
                print("First 5 records:")
                for item in data[:5]:
                    print(f"- {item['symbol']} ({item.get('name') or ''}): {item['last_close']} EGP")
    except Exception as e:
        print("❌ Failed:", e)
        if hasattr(e, "read"):
            print("Response:", e.read().decode("utf-8"))

if __name__ == "__main__":
    test_scan_results()
