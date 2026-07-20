import requests

url = "https://integrate.api.nvidia.com/v1/chat/completions"
api_key = "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"

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
