import requests

keywords = [
    "Arafa", "Incolease", "Wadi", "Kom Ombo", "Cairo Investment", "QNB", "Alahli", "Diagnostics Holdings", "Odin", "Atlas", "Egypt"
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
        url = f"https://symbol-search.tradingview.com/symbol_search/?text={kw}&type=&exchange=EGX"
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        
        if isinstance(data, list) and data:
            print(f"Results for keyword '{kw}':")
            for item in data[:4]:  # Top 4 matches
                print(f"  - Ticker: {item.get('symbol')} | Exchange: {item.get('exchange')} | Country: {item.get('country')} | Desc: {item.get('description')}")
        else:
            # Try searching globally without exchange=EGX filter
            url_global = f"https://symbol-search.tradingview.com/symbol_search/?text={kw}&type=&exchange="
            resp_global = requests.get(url_global, headers=headers, timeout=10)
            resp_global.raise_for_status()
            data_global = resp_global.json()
            if isinstance(data_global, list) and data_global:
                print(f"Results for keyword '{kw}' (GLOBAL):")
                for item in data_global[:4]:
                    print(f"  - Ticker: {item.get('symbol')} | Exchange: {item.get('exchange')} | Country: {item.get('country')} | Desc: {item.get('description')}")
            else:
                print(f"Results for keyword '{kw}': No matches at all")
            
    except Exception as e:
        print(f"Results for keyword '{kw}': ERROR: {e}")
