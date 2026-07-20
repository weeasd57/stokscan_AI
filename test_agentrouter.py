import requests

api_key = "sk-RbVb5d1wi3mmBfjqAOZaa3mJVjVtafdcaeX3JSJL85lC6sAI"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

endpoints = [
    "https://agentrouter.org/v1/models",
    "https://agentrouter.org/api/v1/models",
    "https://agentrouter.org/v1/chat/completions",
    "https://agentrouter.org/api/v1/chat/completions"
]

for url in endpoints:
    try:
        if "chat/completions" in url:
            res = requests.post(url, headers=headers, json={"model": "glm-5.2", "messages": [{"role": "user", "content": "hi"}]})
        else:
            res = requests.get(url, headers=headers)
        print(f"URL: {url} -> Status: {res.status_code}, Body: {res.text[:200]}")
    except Exception as e:
        print(f"URL: {url} -> Exception: {e}")
