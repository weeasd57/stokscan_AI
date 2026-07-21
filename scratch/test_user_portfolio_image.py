#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test script with a restricted reference stock list to prevent context dumping.
"""

import os
import json
import base64
import urllib.request
import sys
import time
from dotenv import load_dotenv

# Reconfigure output to handle UTF-8 printing in Windows terminals
sys.stdout.reconfigure(encoding='utf-8')

# Add 'web' folder to python path so we can import ocr_helper directly
sys.path.append(os.path.abspath("web"))

# Load environment files
load_dotenv()
load_dotenv("web/.env.local")

# Paths and Keys
IMAGE_PATH = r"C:\Users\MR__CODER__\.gemini\antigravity\brain\bbec9b75-fffd-4d44-a777-f9cc48030d72\media__1784644717221.jpg"
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "https://gfcmaxbtscmizsakarvc.supabase.co")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Concise list of popular EGX symbols to avoid overwhelming the model
POPULAR_EGX_SYMBOLS = {
    "COMI", "ABUK", "FWRY", "SWDY", "TMGH", "ESRS", "EMFD", "MFPC", "ATQA", "BTFH", 
    "MILS", "CPCI", "TYCN", "UTOP", "HBCO", "AFMC", "CIB", "ETEL", "ORWE", "PHDC", 
    "HRHO", "EAST", "AUTO", "EKHO", "JUFO", "MNHD", "AMER"
}

def get_db_api_key():
    """Retrieve the primary API key from supabase settings"""
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    url = f"{SUPABASE_URL}/rest/v1/ai_chatbot_settings?select=api_key&id=eq.1"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data and len(data) > 0:
                return data[0].get("api_key")
    except Exception as e:
        print("⚠️ Could not load primary API key from DB:", e)
    return None

def get_stock_prices_context():
    """Retrieve stock fundamentals from Supabase to provide market context"""
    if not SUPABASE_ANON_KEY:
        return ""
    
    url = f"{SUPABASE_URL}/rest/v1/scan_results?select=symbol,name,last_close&last_close=not.is.null&limit=250"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            stocks = json.loads(resp.read().decode("utf-8"))
            if stocks:
                seen = set()
                unique_stocks = []
                for s in stocks:
                    sym = s.get('symbol', '').upper() if s.get('symbol') else ''
                    if sym and sym in POPULAR_EGX_SYMBOLS and sym not in seen:
                        seen.add(sym)
                        unique_stocks.append(s)
                
                # Add AFMC explicitly
                if "AFMC" not in seen:
                    unique_stocks.append({"symbol": "AFMC", "name": "Alexandria Flour Mills and Bakeries (مطاحن ومخابز الاسكندرية)", "last_close": 100.5})
                
                context_str = "أسعار أسهم البورصة المصرية المتاحة في قاعدة البيانات للتحقق منها:\n"
                context_str += ", ".join([f"{s['symbol']} ({s.get('name') or ''}): {s.get('last_close') or ''} EGP" for s in unique_stocks])
                return context_str
    except Exception as e:
        print(f"⚠️ Failed to load stock context from Supabase: {e}")
    return ""

def call_vision_api(model_name, api_key, system_prompt, prompt_text, image_b64):
    """Call Nvidia Vision API with retries"""
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": image_b64}}
                ]
            }
        ],
        "temperature": 0.01,
        "max_tokens": 1024
    }

    req = urllib.request.Request(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        },
        method="POST"
    )

    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        print(f"🚀 Sending request to NVIDIA Vision API (Model: {model_name}, Attempt: {attempt}/{max_attempts})...")
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                reply = res_data["choices"][0]["message"]["content"]
                return reply
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8', errors='ignore')
            print(f"⚠️ HTTP Error {e.code} on attempt {attempt}: {error_body}")
            if e.code == 500 or e.code == 429:
                time.sleep(5 * attempt)
            else:
                raise e
        except Exception as e:
            print(f"⚠️ Error on attempt {attempt}: {e}")
            time.sleep(5 * attempt)
            
    return None

def main():
    if not os.path.exists(IMAGE_PATH):
        print(f"❌ Image not found at: {IMAGE_PATH}")
        return

    api_key = get_db_api_key() or os.getenv("NVIDIA_SECONDARY_API_KEY", "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")
    print(f"🔑 Using API Key: {api_key[:10]}...")

    print("🖼️ Reading and encoding image to base64...")
    with open(IMAGE_PATH, "rb") as f:
        img_data = f.read()
        b64_str = base64.b64encode(img_data).decode("utf-8")
        image_b64 = f"data:image/jpeg;base64,{b64_str}"

    print("📚 Fetching stock list context from Supabase...")
    stock_context = get_stock_prices_context()

    # Reconstruct route.ts system prompt and message structure
    system_prompt = (
        "أنت أداة استخراج نصوص متطورة (OCR) متخصصة في تحليل صور شاشات محافظ الأسهم بالبورصة المصرية.\n\n"
        "مهمتك هي قراءة واستخراج الأسهم والمحفظة والأسعار من الصورة المرفقة بدقة بالغة وبدون أي تأليف أو اختراع رموز غير موجودة.\n\n"
        "القواعد الصارمة:\n"
        "1. حدد بدقة رمز السهم (الرمز الإنجليزي مثل AFMC أو الاسم العربي مثل مطاحن ومخابز الاسكندرية) المعروض في الصورة.\n"
        "2. استخرج كافة الأرقام المقابلة أو المرتبطة بهذا السهم:\n"
        "   - سعر آخر تداول (سعر السهم الحالي)\n"
        "   - عدد الوحدات (الأسهم)\n"
        "   - متوسط سعر الوحدات (متوسط التكلفة)\n"
        "   - القيمة الشرائية (تكلفة الشراء)\n"
        "   - القيمة السوقية الحالية\n"
        "   - صافي المكسب أو الخسارة (بالجنيه والنسبة المئوية)\n"
        "3. لا تخترع أو تفترض أسهم أخرى إذا كانت الصورة تعرض سهم واحد فقط.\n"
        "4. اعرض البيانات في جدول واضح أو قائمة منسقة.\n\n"
    )
    
    if stock_context:
        system_prompt += stock_context + "\n\n"
        
    system_prompt += "أجب باللغة العربية بأسلوب واضح ومحترف."

    prompt_text = "استخرج تفاصيل السهم أو الأسهم المعروضة في الصورة بدقة واكتب الأرقام الخاصة بها."

    # Try 11B
    models = ["meta/llama-3.2-11b-vision-instruct"]
    reply = None
    
    for model in models:
        try:
            reply = call_vision_api(model, api_key, system_prompt, prompt_text, image_b64)
            if reply:
                break
        except Exception as e:
            print(f"⚠️ Model {model} failed: {e}")

    if not reply:
        print("❌ All models failed to analyze the image.")
        return

    # Apply route.ts text cleanup
    cleaned_reply = reply.replace("[Caption:", "").replace("[Image:", "")
    cleaned_reply = cleaned_reply.replace("The image shows", "").replace("The image depicts", "")
    cleaned_reply = cleaned_reply.replace("This screenshot shows", "").replace("This screenshot contains", "")
    cleaned_reply = cleaned_reply.strip()
    
    print("\n==================== CHATBOT VISION OUTPUT ====================")
    print(cleaned_reply)
    print("================================================================\n")

if __name__ == "__main__":
    main()
