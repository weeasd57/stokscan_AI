import urllib.parse
import requests
import pandas as pd
import datetime as dt

# Set env to avoid error in sync
import os
os.environ["CF_PROXY_URL"] = "https://yahoo-proxy.weeessd57.workers.dev"

url = "https://query1.finance.yahoo.com/v8/finance/chart/ACRO.CA?range=1y&interval=1d"
cf_proxy = os.getenv("CF_PROXY_URL")
url = f"{cf_proxy}?url={urllib.parse.quote(url)}"

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0",
    "Accept": "*/*"
})

r = session.get(url, timeout=15)
chart_res = r.json().get("chart", {}).get("result")
data = chart_res[0]
timestamps = data.get("timestamp")
indicators = data.get("indicators", {})
quote_list = indicators.get("quote", [])
quote = quote_list[0]
opens = quote.get("open", [])
highs = quote.get("high", [])
lows = quote.get("low", [])
closes = quote.get("close", [])
volumes = quote.get("volume", [])

# Check for adjclose
adjclose_list = indicators.get("adjclose", [])
if adjclose_list and adjclose_list[0] and "adjclose" in adjclose_list[0]:
    closes = adjclose_list[0]["adjclose"]
    
df_new = pd.DataFrame({
    "ts": pd.to_datetime(timestamps, unit="s"),
    "open": opens,
    "high": highs,
    "low": lows,
    "close": closes,
    "volume": volumes
})

print(f"Initial len: {len(df_new)}")
df_new_dropped = df_new.dropna(subset=["close", "open", "high", "low"], how="any")
print(f"Dropped len: {len(df_new_dropped)}")

start_date = dt.date(2026, 2, 12)
end_date = dt.date(2026, 7, 5)
df_new_dropped['ts'] = pd.to_datetime(df_new_dropped['ts'])
df_filtered = df_new_dropped[df_new_dropped['ts'].dt.date >= start_date]
df_filtered = df_filtered[df_filtered['ts'].dt.date <= end_date]
print(f"Filtered len: {len(df_filtered)}")

# Test sync_df_to_supabase call
from api.stock_ai import sync_df_to_supabase, _init_supabase
_init_supabase()
ok, msg = sync_df_to_supabase("ACRO.EGX", df_filtered, timeframe="1d")
print(f"Sync result: {ok}, {msg}")
