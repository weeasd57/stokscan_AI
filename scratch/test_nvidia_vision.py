import os
import json
import base64
import urllib.request
import urllib.parse
from dotenv import load_dotenv

load_dotenv()
load_dotenv("web/.env.local")

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_SECONDARY_API_KEY", "")

print("NVIDIA_API_KEY found:", bool(NVIDIA_API_KEY))

# Test image supplied explicitly by the caller
img_path = os.getenv("TEST_IMAGE_PATH", "")

models_to_test = [
    "nvidia/nemotron-nano-12b-v2-vl",
    "nvidia/llama-3.1-nemotron-nano-vl-8b-v1"
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
