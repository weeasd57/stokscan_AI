import json
import urllib.request

url = 'http://127.0.0.1:8000/planner/v2/plan'
data = json.dumps({
    "message": "حلل ABUK هات أخباره لو كسر الدعم أعمل إيه؟",
    "history": []
}).encode('utf-8')

req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req) as response:
        print(response.read().decode('utf-8'))
except Exception as e:
    print(f"Error: {e}")
