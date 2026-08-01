import urllib.request
import json
import sys

url = 'http://localhost:3000/api/ai-chat'
data = json.dumps({
    'messages': [{'role': 'user', 'content': 'حلل ABUK هات أخباره لو كسر الدعم أعمل إيه؟'}]
}).encode('utf-8')

req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req) as response:
        print(f"STATUS: {response.getcode()}")
        while True:
            chunk = response.read(1024)
            if not chunk:
                break
            print(f"CHUNK: {chunk.decode('utf-8', errors='replace')}")
except Exception as e:
    print(f"Error: {e}")
