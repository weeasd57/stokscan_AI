import urllib.request
import json
import os
import ssl

from dotenv import load_dotenv

load_dotenv()

ssl_context = ssl.create_default_context()

supabase_url = os.environ["SUPABASE_URL"]
service_key = os.getenv("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]

def query_supabase(table, query_params):
    url = f"{supabase_url}/rest/v1/{table}?{query_params}"
    req = urllib.request.Request(url, headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req, context=ssl_context) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"Error querying {table}:", e)
        return None

print("--- Querying stocks table for ABUK ---")
stocks = query_supabase("stocks", "symbol=eq.ABUK&select=*")
print("Stocks data:", stocks)

print("\n--- Querying stock_prices table for ABUK ---")
prices = query_supabase("stock_prices", "symbol=eq.ABUK&order=date.desc&limit=1")
print("Prices data:", prices)

print("\n--- Querying stock_technical_indicators table for ABUK ---")
indicators = query_supabase("stock_technical_indicators", "symbol=eq.ABUK&order=date.desc&limit=1")
print("Indicators data:", indicators)

print("\n--- Querying scan_results table for ABUK ---")
scans = query_supabase("scan_results", "symbol=eq.ABUK&order=created_at.desc&limit=1")
print("Scans data:", scans)
