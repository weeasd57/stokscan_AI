import requests

url = "https://agentrouter.org/v1/chat/completions"
key = "sk-RbVb5d1wi3mmBfjqAOZaa3mJVjVtafdcaeX3JSJL85lC6sAI"

headers_base = {
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
}

variants = [
    {"name": "Standard Bearer", "headers": headers_base},
    {"name": "With Browser User-Agent", "headers": {**headers_base, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}},
    {"name": "With Referer & Origin", "headers": {**headers_base, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Referer": "https://agentrouter.org/console", "Origin": "https://agentrouter.org"}},
    {"name": "With X-Requested-With", "headers": {**headers_base, "X-Requested-With": "XMLHttpRequest"}},
    {"name": "Token in Query Param", "headers": {"Content-Type": "application/json"}, "url": f"{url}?key={key}"}
]

payload = {
    "model": "claude-opus-4-6",
    "messages": [{"role": "user", "content": "hi"}]
}

for v in variants:
    target_url = v.get("url", url)
    res = requests.post(target_url, headers=v["headers"], json=payload)
    print(f"Variant '{v['name']}': Status {res.status_code} -> Body: {res.text[:150]}")
