import requests
import json

url = "http://localhost:3000/api/scan/technical"

tests = [
    {
        "name": "Stochastic Bullish Divergence",
        "payload": {
            "country": "Egypt",
            "limit": 100,
            "divergence_type": "BULLISH",
            "divergence_indicator": "STOCH",
            "divergence_min_strength": 0.3
        }
    },
    {
        "name": "MACD Bearish Divergence",
        "payload": {
            "country": "Egypt",
            "limit": 100,
            "divergence_type": "BEARISH",
            "divergence_indicator": "MACD",
            "divergence_min_strength": 0.3
        }
    },
    {
        "name": "Any Bearish Divergence",
        "payload": {
            "country": "Egypt",
            "limit": 100,
            "divergence_type": "BEARISH",
            "divergence_indicator": "ANY",
            "divergence_min_strength": 0.3
        }
    }
]

for test in tests:
    print(f"\n--- Running test: {test['name']} ---")
    payload = test["payload"]
    try:
        response = requests.post(url, json=payload)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", [])
            print(f"Results Count: {len(results)}")
            
            for idx, item in enumerate(results):
                print(f"  {idx+1}. Symbol: {item.get('symbol')} | Date: {item.get('date')} | RSI: {item.get('rsi_divergence')} | MACD: {item.get('macd_divergence')} | STOCH: {item.get('stoch_divergence')} | Strength: {item.get('divergence_strength')}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception: {e}")
