import os
import requests

url = "https://integrate.api.nvidia.com/v1/chat/completions"
api_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_SECONDARY_API_KEY")
if not api_key:
    raise SystemExit("NVIDIA_API_KEY or NVIDIA_SECONDARY_API_KEY is required")

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

models = [
    "meta/llama-3.1-8b-instruct",
    "meta/llama-3.1-70b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct"
]

for m in models:
    payload = {
        "model": m,
        "messages": [{"role": "user", "content": "Say hello in Arabic!"}],
        "max_tokens": 100
    }
    res = requests.post(url, headers=headers, json=payload)
    print(f"Model {m} -> Status: {res.status_code}")
    if res.status_code == 200:
        print("Reply:", res.json()["choices"][0]["message"]["content"])
    else:
        print("Body:", res.text[:150])
