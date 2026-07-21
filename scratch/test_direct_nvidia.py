import urllib.request
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

def test_abuk_prompt():
    api_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_SECONDARY_API_KEY")
    if not api_key:
        print("NVIDIA_API_KEY or NVIDIA_SECONDARY_API_KEY is required")
        return
    model = "meta/llama-3.1-8b-instruct"
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    
    system_prompt = """أنت المساعد الذكي المالي للبورصة المصرية (EGX AI Assistant).

=== 🔴 REAL-TIME SUPABASE DATABASE DATA FOR STOCK: ABUK (أبو قير للأسمدة والصناعات الكيماوية) ===
CRITICAL INSTRUCTION: You MUST use the exact real-time live numbers and current year 2026 provided below. Do NOT output old dates like 2024 or incorrect stock names.
- Stock Symbol: ABUK
- Official Stock Name: أبو قير للأسمدة والصناعات الكيماوية
- Current Live Date: 2026-07-20 (Year 2026)
- Latest Close Price: EGP 72.89 (Open: EGP 74.61, High: EGP 74.99, Low: EGP 72.73)
- Daily Change %: -2.31%
- RSI (14): 68.10
- Moving Averages: SMA20=EGP 70.10, SMA50=EGP 77.44, SMA200=EGP 64.00
- Bollinger Bands: Upper=EGP 74.46, Middle=EGP 70.10, Lower=EGP 65.74
=== END OF DATABASE DATA ===
"""
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "abuk"}
        ],
        "max_tokens": 300,
        "temperature": 0.5
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    
    try:
        print("Testing ABUK query response with Supabase data injection...")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            reply = data['choices'][0]['message']['content']
            print("\n================== AI RESPONSE FOR ABUK ==================")
            print(reply)
            print("==========================================================\n")
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    test_abuk_prompt()
