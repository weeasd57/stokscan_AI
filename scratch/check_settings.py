#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Inspect ai_chatbot_settings and test NVIDIA API keys.
"""

import os
import json
import urllib.request
import os
import json
import urllib.request
import sys
from dotenv import load_dotenv

# Reconfigure stdout for UTF-8
sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
load_dotenv("web/.env.local")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "https://gfcmaxbtscmizsakarvc.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

def get_settings():
    if not SUPABASE_SERVICE_ROLE_KEY:
        print("❌ SUPABASE_SERVICE_ROLE_KEY not found!")
        return None
        
    url = f"{SUPABASE_URL}/rest/v1/ai_chatbot_settings?select=*"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print("Database Settings:")
            print(json.dumps(data, indent=2, ensure_ascii=False))
            return data
    except Exception as e:
        print("❌ Failed to query ai_chatbot_settings:", e)
        if hasattr(e, "read"):
            print("Details:", e.read().decode("utf-8"))
        return None

def test_nvidia_key(key_name, api_key):
    if not api_key:
        print(f"⚠️ {key_name} is empty.")
        return
    print(f"Testing {key_name} ({api_key[:10]}...):")
    
    payload = {
        "model": "meta/llama-3.1-8b-instruct",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 10
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
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            print(f"✅ Success! Response status: {resp.status}")
            print("Output:", res_data["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"❌ Failed: {e}")
        if hasattr(e, "read"):
            print("Details:", e.read().decode("utf-8"))

if __name__ == "__main__":
    settings = get_settings()
    
    keys_to_test = {}
    if settings and len(settings) > 0:
        keys_to_test["DB_SETTINGS_API_KEY"] = settings[0].get("api_key")
        
    keys_to_test["NVIDIA_SECONDARY_API_KEY"] = os.getenv("NVIDIA_SECONDARY_API_KEY")
    keys_to_test["ENV_NVIDIA_API_KEY"] = os.getenv("NVIDIA_API_KEY")

    for name, key in keys_to_test.items():
        if key:
            test_nvidia_key(name, key)
            print("-" * 50)
