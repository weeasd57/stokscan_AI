import os
import json
import base64
import urllib.request
import urllib.parse
from dotenv import load_dotenv

load_dotenv()
load_dotenv("web/.env.local")

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
if not NVIDIA_API_KEY:
    # Try reading from Supabase route_data
    try:
        from supabase import create_client
        url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if url and key:
            sb = create_client(url, key)
            res = sb.from_("ai_chatbot_settings").select("api_key").single().execute()
            if res.data:
                NVIDIA_API_KEY = res.data.get("api_key", "")
    except Exception as e:
        print("Error reading key:", e)

print("NVIDIA_API_KEY found:", bool(NVIDIA_API_KEY))

# Test image: download user's portfolio image or use a base64 test image
img_path = r"C:\Users\MR__CODER__\.gemini\antigravity\brain\8b55cac5-1522-4f6a-b22a-85aa87c434c2\media__1784590869816.png"

models_to_test = [
    "meta/llama-3.3-70b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "deepseek-ai/deepseek-r1",
    "meta/llama-3.1-8b-instruct"
]

for m in models_to_test:
    payload = {
        "model": m,
        "messages": [{"role": "user", "content": "مرحبا"}],
        "max_tokens": 50
    }
    req = urllib.request.Request(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {NVIDIA_API_KEY}"
        }
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"Model {m}: SUCCESS {resp.status}")
    except Exception as e:
        print(f"Model {m}: FAILED {e}")

req = urllib.request.Request(
    "https://integrate.api.nvidia.com/v1/chat/completions",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {NVIDIA_API_KEY}"
    }
)

try:
    with urllib.request.urlopen(req) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        content = res_data["choices"][0]["message"]["content"]
        with open("scratch/vision_result.txt", "w", encoding="utf-8") as out_f:
            out_f.write(content)
        print("\n--- AI RESPONSE SAVED TO scratch/vision_result.txt ---")
except Exception as err:
    print("Error during test call:", err)
