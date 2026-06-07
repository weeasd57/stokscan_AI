import requests

keywords = [
    "Assiut", "Farasha", "Inter-Cairo", "Inter Cairo", "Orange Egypt", "Orange", "Orascom Investment", "Premium Health", "Emerald Real"
]

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.tradingview.com',
    'Referer': 'https://www.tradingview.com/'
}

print("Searching TradingView by keywords:")
print("-" * 80)

for kw in keywords:
    try:
        url = f"https://symbol-search.tradingview.com/symbol_search/?text={kw}&type=&exchange="
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        
        if isinstance(data, list) and data:
            print(f"Results for keyword '{kw}':")
            for item in data[:4]:  # Top 4 matches
                print(f"  - Ticker: {item.get('symbol')} | Exchange: {item.get('exchange')} | Country: {item.get('country')} | Desc: {item.get('description')}")
        else:
            print(f"Results for keyword '{kw}': No matches")
            
    except Exception as e:
        print(f"Results for keyword '{kw}': ERROR: {e}")
