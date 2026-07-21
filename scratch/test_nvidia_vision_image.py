import urllib.request
import json
import base64
import sys

sys.stdout.reconfigure(encoding='utf-8')

# A small 1x1 red PNG base64 for testing payload structure
TEST_BASE64_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

def test_vision():
    api_key = "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"
    model = "meta/llama-3.2-11b-vision-instruct"
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "أنت خبير محترف في تحليل صور الشاشات والمحافظ المالية."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "صف محتوى هذه الصورة باختصار في سطر واحد."},
                    {"type": "image_url", "image_url": {"url": TEST_BASE64_IMAGE}}
                ]
            }
        ],
        "max_tokens": 100,
        "temperature": 0.1
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    
    try:
        print(f"Testing Vision API ({model})...")
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            reply = data['choices'][0]['message']['content']
            print("✅ Vision Test PASSED!")
            print("AI Reply:", reply)
    except Exception as e:
        print("❌ Vision Test FAILED:", e)
        if hasattr(e, "read"):
            print("Details:", e.read().decode("utf-8"))

if __name__ == "__main__":
    test_vision()
