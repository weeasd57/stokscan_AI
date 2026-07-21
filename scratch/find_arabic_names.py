import os
import json
import urllib.request
import re
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

def check_arabic_names():
    # Fetch stocks
    url = f"{SUPABASE_URL}/rest/v1/stocks?select=symbol,name&limit=250"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            stocks = json.loads(resp.read().decode("utf-8"))
            arabic_pattern = re.compile(r'[\u0600-\u06FF]')
            arabic_stocks = [s for s in stocks if s.get('name') and arabic_pattern.search(s['name'])]
            
            print(f"Total stocks retrieved: {len(stocks)}")
            print(f"Stocks with Arabic names: {len(arabic_stocks)}")
            if arabic_stocks:
                print("Examples of Arabic stock names:")
                for s in arabic_stocks[:5]:
                    print(f"- {s['symbol']}: {s['name']}")
            else:
                print("No stocks have Arabic names in 'name' field.")
                print("First 5 stocks:")
                for s in stocks[:5]:
                    print(f"- {s['symbol']}: {s['name']}")
    except Exception as e:
        print(f"Error querying stocks: {e}")

if __name__ == "__main__":
    check_arabic_names()
