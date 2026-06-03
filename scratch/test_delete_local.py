import urllib.request
import json
import os

local_id = "local-backtest_NANO.pkl_20260525T204001Z.json"
base_url = "http://127.0.0.1:8000"

local_dir = r"c:\Users\MR__CODER__\Desktop\stokscan_AI\backtests_local"
filename = "backtest_NANO.pkl_20260525T204001Z.json"
filepath = os.path.join(local_dir, filename)

print("Before delete - file exists?", os.path.isfile(filepath))

url_delete = f"{base_url}/backtests/{local_id}"
req = urllib.request.Request(url_delete, method="DELETE")

try:
    with urllib.request.urlopen(req) as response:
        res = json.loads(response.read().decode('utf-8'))
        print("DELETE response:", res)
except Exception as e:
    print("DELETE failed:", e)

print("After delete - file exists?", os.path.isfile(filepath))
