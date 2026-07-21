import urllib.request
import json
import os
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

models_to_test = [
    ("meta/llama-3.1-8b-instruct", "Llama 3.1 8B"),
    ("nvidia/llama-3.1-nemotron-70b-instruct", "Nemotron 70B"),
    ("deepseek-ai/deepseek-r1", "DeepSeek R1"),
    ("deepseek-ai/deepseek-v3", "DeepSeek V3"),
    ("meta/llama-3.2-11b-vision-instruct", "Llama 3.2 Vision"),
    ("deepseek-ai/deepseek-v4-pro", "DeepSeek V4 Pro")
]

api_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_SECONDARY_API_KEY")
if not api_key:
    print("NVIDIA_API_KEY or NVIDIA_SECONDARY_API_KEY is required")
    sys.exit(1)
url = "https://integrate.api.nvidia.com/v1/chat/completions"

for model_id, model_name in models_to_test:
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": "مرحباً، ما هو سهم COMI؟"}],
        "max_tokens": 40,
        "temperature": 0.5
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            reply = data['choices'][0]['message']['content'].strip()
            elapsed = round(time.time() - t0, 2)
            print(f"✅ [{model_name}] ({model_id}) -> {elapsed}s | Reply: {reply[:40]}")
    except Exception as e:
        elapsed = round(time.time() - t0, 2)
        print(f"❌ [{model_name}] ({model_id}) -> FAILED/TIMEOUT after {elapsed}s | Error: {str(e)[:60]}")
