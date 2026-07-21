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
    "deepseek-ai/deepseek-r1",
    "meta/llama-3.1-8b-instruct",
    "meta/llama-3.3-70b-instruct",
    "nvidia/nemotron-4-340b-instruct",
    "mistralai/mistral-7b-instruct-v0.3"
]

for m in models:
    payload = {
        "model": m,
        "messages": [{"role": "user", "content": "Hi! Say hello."}],
        "max_tokens": 50
    }
    res = requests.post(url, headers=headers, json=payload)
    print(f"Model {m} -> Status: {res.status_code}, Body: {res.text[:150]}")
