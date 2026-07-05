import urllib.parse
import requests
import os

url = "https://query1.finance.yahoo.com/v8/finance/chart/ACRO.CA?range=1y&interval=1d"
cf_proxy = "https://yahoo-proxy.weeessd57.workers.dev"

url = f"{cf_proxy}?url={urllib.parse.quote(url)}"
print(f"URL: {url}")

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0",
    "Accept": "*/*"
})

try:
    r = session.get(url, timeout=15)
    print(f"Status: {r.status_code}")
    if r.status_code != 200:
        print("FAILED Status")
        
    chart_res = r.json().get("chart", {}).get("result")
    if not chart_res:
        print("FAILED chart_res")
        
    data = chart_res[0]
    timestamps = data.get("timestamp")
    if not timestamps:
        print("FAILED timestamps")
        
    indicators = data.get("indicators", {}).get("quote", [{}])[0]
    opens = indicators.get("open", [])
    if not opens:
        print("FAILED opens")
    print("SUCCESS!")
    print(f"Len timestamps: {len(timestamps) if timestamps else 0}")
except Exception as e:
    print(f"Exception: {e}")
