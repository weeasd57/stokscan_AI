import urllib.request
import json
import ssl

ssl_context = ssl._create_unverified_context()

supabase_url = "https://gfcmaxbtscmizsakarvc.supabase.co"
service_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmY21heGJ0c2NtaXpzYWthcnZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzg5MDI2NCwiZXhwIjoyMDgzNDY2MjY0fQ.Q4ENAx_KPqinbm_XxpQGWdOGRwVKM-0BGTyw9qD2h4E"

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
