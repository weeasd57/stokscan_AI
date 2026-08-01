import urllib.request
import json
import os
import sys
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
load_dotenv("web/.env.local")

# Get API key from env or DB settings
api_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_SECONDARY_API_KEY")

if not api_key:
    # Try fetching from DB settings
    sys.path.append(os.path.abspath("scratch"))
    try:
        from check_settings import get_settings
        settings = get_settings()
        if settings:
            api_key = settings[0].get("api_key")
    except Exception as e:
        print("Error getting DB key:", e)

if not api_key:
    print("❌ No NVIDIA API key found.")
    exit(1)

print("NVIDIA API key found:", bool(api_key))

import base64

REAL_IMAGE_PATH = r"C:\Users\MR__CODER__\.gemini\antigravity\brain\d86860c0-464a-43c2-b9a7-81fa66370ce2\media__1784634516280.png"

with open(REAL_IMAGE_PATH, "rb") as f:
    img_data = f.read()
    b64_str = base64.b64encode(img_data).decode("utf-8")
    TEST_BASE64_IMAGE = f"data:image/png;base64,{b64_str}"

models_to_test = [
    "meta/llama-3.2-11b-vision-instruct",
    "meta/llama-3.2-90b-vision-instruct",
    "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
    "nvidia/nemotron-nano-12b-v2-vl",
]

def test_model(model_name):
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    
    # Use the real planner prompts
    plannerSystemPrompt = """You are EGX Bots Master Planner for the Egyptian Stock Exchange.

YOUR TASK:
Analyze user request and return JSON with this exact structure:
{
  "intent": "portfolio",
  "confidence": 0.95,
  "entities": {
    "symbols": ["ALL_STOCK_SYMBOLS_FROM_IMAGE"],
    "sector": null,
    "wants_table": true,
    "timeframe": null
  },
  "tools": ["get_stock"],
  "image_summary": "وصف تفصيلي بالعربية لكل محتوى الصورة المالية بما في ذلك جميع رموز الأسهم المرئية",
  "session_update": {
    "current_symbol": "FIRST_SYMBOL",
    "last_symbols": ["ALL_SYMBOLS_IN_ORDER"],
    "summary": "portfolio analysis with all visible stocks"
  }
}

RULES:
- Return ONLY the JSON, no extra text."""

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": plannerSystemPrompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Analyze the uploaded image and extract symbols."},
                    {"type": "image_url", "image_url": {"url": TEST_BASE64_IMAGE}}
                ]
            }
        ],
        "max_tokens": 1500,
        "temperature": 0.05
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    
    import time
    start = time.time()
    try:
        print(f"Testing model: {model_name} ...", end="", flush=True)
        with urllib.request.urlopen(req, timeout=25) as resp:
            elapsed = time.time() - start
            data = json.loads(resp.read().decode('utf-8'))
            reply = data['choices'][0]['message']['content'].strip()
            print(f" SUCCESS in {elapsed:.2f}s")
            print(f"   Reply: {reply}")
            return True
    except Exception as e:
        elapsed = time.time() - start
        print(f" FAILED in {elapsed:.2f}s")
        print(f"   Error: {e}")
        if hasattr(e, "read"):
            try:
                print("   Details:", e.read().decode("utf-8")[:300])
            except:
                pass
        return False

for m in models_to_test:
    test_model(m)
    print("-" * 60)
