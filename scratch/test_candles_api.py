import requests

def test_candles():
    url = "http://127.0.0.1:8000/ai_bot/candles"
    params = {
        "symbol": "AUTO",
        "exchange": "EGX",
        "limit": 10
    }
    try:
        response = requests.get(url, params=params)
        print("Status Code:", response.status_code)
        data = response.json()
        if "candles" in data:
            print("Successfully retrieved candles!")
            print(f"Candles count: {len(data['candles'])}")
            if len(data['candles']) > 0:
                print("First candle sample:", data['candles'][0])
        else:
            print("Response JSON:", data)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    test_candles()
