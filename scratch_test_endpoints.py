import urllib.request
import json

def test_endpoint(url):
    print(f"Testing URL: {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"Success! Response keys: {list(data.keys()) if isinstance(data, dict) else len(data)}")
            if isinstance(data, dict) and "egx30" in data:
                print(f"EGX30 index rows: {len(data['egx30'])}")
                print(f"EGX100 index rows: {len(data['egx100'])}")
                print(f"Regime: {data['regime']}")
            if isinstance(data, dict) and "chart_data" in data:
                print(f"Chart data points: {len(data['chart_data'])}")
                print(f"Rating: {data['rating']}")
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")

if __name__ == "__main__":
    import time
    time.sleep(2) # Give Next.js compilation a moment
    test_endpoint("http://localhost:3000/api/market/status")
    test_endpoint("http://localhost:3000/api/market/macro-correlation/data?symbol=FWRY")
