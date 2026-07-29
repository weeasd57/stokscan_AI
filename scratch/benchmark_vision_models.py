import sys, os, time, base64, requests, json

sys.stdout.reconfigure(encoding='utf-8')

# 1. Base64 encode the test portfolio image
img_path = r"C:\Users\MR__CODER__\.gemini\antigravity\brain\d9374818-9613-45ee-888b-8469feaa873d\.user_uploaded\media__1785274816394.png"
if not os.path.exists(img_path):
    # Fallback to any user uploaded image
    up_dir = r"C:\Users\MR__CODER__\.gemini\antigravity\brain\d9374818-9613-45ee-888b-8469feaa873d\.user_uploaded"
    for f in os.listdir(up_dir):
        if f.endswith(('.png', '.jpg')):
            img_path = os.path.join(up_dir, f)
            break

print(f"📷 Using test image: {os.path.basename(img_path)}")

with open(img_path, "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode("utf-8")

image_url_data = f"data:image/png;base64,{img_b64}"

nv_key = "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"
nv_url = "https://integrate.api.nvidia.com/v1/chat/completions"
headers = {
    "Authorization": f"Bearer {nv_key}",
    "Content-Type": "application/json"
}

prompt_text = """Analyze this stock portfolio image from the Egyptian Stock Exchange (EGX).
Extract ONLY uppercase stock TICKERS visible in the image (e.g. FWRY, TMGH, ORHD, MASR, EFIH, GTWL, RAYA).
Respond with a JSON object:
{
  "intent": "portfolio",
  "confidence": 0.95,
  "entities": {
    "symbols": ["SYMBOL_1", "SYMBOL_2"]
  },
  "tools": ["get_stock"]
}"""

models_to_test = [
    "moonshotai/kimi-k2.6",
    "meta/llama-3.2-90b-vision-instruct",
    "meta/llama-3.2-11b-vision-instruct"
]

results = []

for model in models_to_test:
    print(f"\n=========================================")
    print(f"🚀 Testing Model: {model}")
    print(f"=========================================")

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": image_url_data}}
                ]
            }
        ],
        "temperature": 0.1,
        "max_tokens": 1000
    }

    start_time = time.time()
    try:
        r = requests.post(nv_url, json=payload, headers=headers, timeout=60)
        elapsed_ms = int((time.time() - start_time) * 1000)

        if r.ok:
            data = r.json()
            raw_content = data['choices'][0]['message']['content'].strip()
            print(f"⏱️ Response Latency: {elapsed_ms} ms ({elapsed_ms/1000:.2f}s)")
            print(f"📝 Raw Content:\n{raw_content}")

            # Try JSON parse
            try:
                parsed = json.loads(raw_content)
                symbols = parsed.get("entities", {}).get("symbols", [])
                print(f"✅ Extracted Symbols ({len(symbols)}): {symbols}")
                results.append({
                    "model": model,
                    "status": "SUCCESS",
                    "latency_ms": elapsed_ms,
                    "symbols_count": len(symbols),
                    "symbols": symbols,
                    "raw": raw_content
                })
            except Exception as pe:
                print(f"⚠️ JSON Parse Error: {pe}")
                results.append({
                    "model": model,
                    "status": "JSON_PARSE_ERROR",
                    "latency_ms": elapsed_ms,
                    "raw": raw_content
                })
        else:
            print(f"❌ API Error ({r.status_code}): {r.text}")
            results.append({
                "model": model,
                "status": f"HTTP_{r.status_code}",
                "latency_ms": elapsed_ms,
                "error": r.text
            })

    except Exception as err:
        elapsed_ms = int((time.time() - start_time) * 1000)
        print(f"💥 Exception: {err}")
        results.append({
            "model": model,
            "status": "EXCEPTION",
            "latency_ms": elapsed_ms,
            "error": str(err)
        })

print("\n\n=========================================")
print("📊 BENCHMARK SUMMARY REPORT")
print("=========================================")
for res in results:
    status = res['status']
    lat = f"{res['latency_ms']} ms ({res['latency_ms']/1000:.2f}s)"
    syms = res.get('symbols', [])
    print(f"• Model: {res['model']}")
    print(f"  - Status: {status}")
    print(f"  - Latency: {lat}")
    print(f"  - Extracted Symbols: {syms}")
    print("-----------------------------------------")
