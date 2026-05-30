import requests

def inspect():
    url = "http://127.0.0.1:8000/ai_bot/candles"
    params = {
        "symbol": "ABUK",
        "exchange": "EGX",
        "limit": 800
    }
    try:
        response = requests.get(url, params=params)
        print("Status:", response.status_code)
        data = response.json()
        candles = data.get("candles", [])
        print("Total candles:", len(candles))
        if candles:
            print("Last 20 candles:")
            for c in candles[-20:]:
                print(c)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    inspect()
