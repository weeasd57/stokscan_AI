import urllib.request
import urllib.parse
import json
import os

local_id = "local-backtest_NANO.pkl_20260525T203834Z.json"
base_url = "http://127.0.0.1:8000"

def run_test():
    print("--- 1. Testing GET /backtests/{id}/trades for local backtest ---")
    url_trades = f"{base_url}/backtests/{local_id}/trades"
    try:
        with urllib.request.urlopen(url_trades) as response:
            trades = json.loads(response.read().decode('utf-8'))
            print(f"Success: retrieved {len(trades)} trades.")
            if trades:
                print("Sample trade:", trades[0])
    except Exception as e:
        print("Failed to get trades:", e)

    print("\n--- 2. Testing PATCH /backtests/{id} (toggle public status) ---")
    url_patch = f"{base_url}/backtests/{local_id}"
    
    # Toggle to True
    req = urllib.request.Request(
        url_patch,
        data=json.dumps({"is_public": True}).encode('utf-8'),
        headers={"Content-Type": "application/json"},
        method="PATCH"
    )
    try:
        with urllib.request.urlopen(req) as response:
            res = json.loads(response.read().decode('utf-8'))
            print("PATCH response (is_public=True):", res)
    except Exception as e:
        print("PATCH is_public=True failed:", e)

    # Verify visibility via GET /backtests?admin=false
    url_all_public = f"{base_url}/backtests?admin=false"
    try:
        with urllib.request.urlopen(url_all_public) as response:
            data = json.loads(response.read().decode('utf-8'))
            ids = [r['id'] for r in data]
            print(f"Found {len(data)} public backtests. Is local_id present? {local_id in ids}")
    except Exception as e:
        print("GET public backtests failed:", e)

    # Toggle to False
    req = urllib.request.Request(
        url_patch,
        data=json.dumps({"is_public": False}).encode('utf-8'),
        headers={"Content-Type": "application/json"},
        method="PATCH"
    )
    try:
        with urllib.request.urlopen(req) as response:
            res = json.loads(response.read().decode('utf-8'))
            print("PATCH response (is_public=False):", res)
    except Exception as e:
        print("PATCH is_public=False failed:", e)

    # Verify visibility via GET /backtests?admin=false (should be hidden)
    try:
        with urllib.request.urlopen(url_all_public) as response:
            data = json.loads(response.read().decode('utf-8'))
            ids = [r['id'] for r in data]
            print(f"Found {len(data)} public backtests. Is local_id present? {local_id in ids}")
    except Exception as e:
        print("GET public backtests failed:", e)

    # Verify visibility via GET /backtests?admin=true (should be visible)
    url_all_admin = f"{base_url}/backtests?admin=true"
    try:
        with urllib.request.urlopen(url_all_admin) as response:
            data = json.loads(response.read().decode('utf-8'))
            ids = [r['id'] for r in data]
            print(f"Found {len(data)} admin backtests. Is local_id present? {local_id in ids}")
    except Exception as e:
        print("GET admin backtests failed:", e)

run_test()
