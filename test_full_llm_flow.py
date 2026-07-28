#!/usr/bin/env python3
"""
Test the FULL LLM flow with actual API call to verify if LLM follows database data
"""
import json
import os
import sys
import asyncio
from datetime import datetime
sys.path.insert(0, os.path.dirname(__file__))

from api.stock_ai import _init_supabase, supabase

async def test_full_llm_response():
    """Test the complete LLM response generation"""
    print("🧪 Testing Full LLM Flow with Actual API Call")
    print("=" * 60)
    
    # Initialize Supabase
    _init_supabase()
    
    # Get API key from environment
    api_key = os.getenv("NV_API_KEY")
    if not api_key:
        print("⚠️ No NV_API_KEY found in environment")
        print("   Set it with: export NV_API_KEY='your-key'")
        return
    
    # Step 1: Fetch REAL data from database
    print("📊 Fetching REAL data from database...")
    
    # Fetch EGX30
    res_egx = supabase.table("stock_prices") \
        .select("symbol, close, volume, date") \
        .eq("symbol", "EGX30") \
        .order("date", desc=True) \
        .limit(1) \
        .execute()
    
    egx_data = res_egx.data[0] if res_egx.data else None
    
    # Fetch USD/EGP
    res_usd = supabase.table("market_cache") \
        .select("payload") \
        .eq("cache_key", "market_status_Egypt") \
        .maybe_single() \
        .execute()
    
    usd_data = res_usd.data
    
    # Prepare database data string
    live_data_string = "=== 🟢 LIVE DATABASE DATA ===\n"
    
    if egx_data:
        egx_value = egx_data.get('close', 0)
        egx_date = egx_data.get('date', 'N/A')
        live_data_string += f"📊 [المؤشرات المصرية - البيانات الحقيقية من قاعدة البيانات]:\n"
        live_data_string += f"• EGX30: {egx_value:.1f} نقطة (تاريخ حقيقي: {egx_date})\n"
    
    if usd_data and usd_data.get('payload', {}).get('usdegp'):
        usd_rates = usd_data['payload']['usdegp']
        if isinstance(usd_rates, list) and len(usd_rates) > 0:
            latest_usd = usd_rates[-1]
            usd_rate = latest_usd.get('close', latest_usd.get('open', 0)) or 0
            usd_date = latest_usd.get('date', 'N/A')
            
            live_data_string += f"\n💱 [سعر صرف الدولار الأمريكي - البيانات الحقيقية من قاعدة البيانات]:\n"
            live_data_string += f"• USD/EGP: {usd_rate:.2f} جنيه مصري (تاريخ حقيقي: {usd_date})\n"
            live_data_string += f"⚠️ تحذير للنموذج: السعر الحقيقي هو {usd_rate:.2f} وليس 15.25\n"
    
    live_data_string += "=== END OF DATABASE DATA ===\n"
    
    print("✅ Database data fetched successfully")
    print(f"   EGX30: {egx_value if egx_data else 'N/A'}")
    print(f"   USD/EGP: {usd_rate if usd_data else 'N/A'}")
    
    # Step 2: Prepare system prompt with STRICT rules
    system_prompt = f"""You are EGX Bots AI Assistant, an expert financial and stock market assistant for the Egyptian Stock Exchange (EGX).

🚨 **CRITICAL: ZERO HALLUCINATION POLICY** 🚨
You are STRICTLY FORBIDDEN from inventing any numbers, prices, dates, or financial data.

**MANDATORY RULES:**
1. Use ONLY the database data provided below in the "LIVE DATABASE DATA" section
2. If no database data is provided, you MUST say: "لا توجد بيانات متاحة حالياً في قاعدة البيانات"
3. NEVER guess, estimate, or create any financial numbers (prices, percentages, RSI, MACD, etc.)
4. NEVER use placeholder values like "15.25" or "12,456.12"
5. If you see contradictory data, use ONLY what's in the database section below
6. Always include the database source notation: "[من قاعدة البيانات]"
7. If you see USD/EGP value, use EXACTLY that value from database

{live_data_string}

Use the live database numbers above to answer with 100% facts."""
    
    # Step 3: Make actual API call to LLM
    print("\n🤖 Calling LLM API with strict anti-hallucination prompt...")
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "هات معلومات من المؤشر العام والدولار"}
    ]
    
    try:
        response = await call_llm_api(api_key, messages)
        
        print("\n💬 LLM RESPONSE:")
        print("=" * 60)
        print(response)
        print("=" * 60)
        
        # Step 4: Analyze response for hallucinations
        print("\n🔍 ANALYZING RESPONSE FOR HALLUCINATIONS:")
        
        # Check for fake USD value
        if "15.25" in response:
            print("❌ FAIL: LLM used fake USD value (15.25)")
            print("   Real value from DB: {:.2f}".format(usd_rate if usd_data else 0))
        elif f"{usd_rate:.2f}" in response or "51.25" in response:
            print("✅ PASS: LLM used real USD value from database")
        else:
            print("⚠️ WARNING: USD value not found in response")
        
        # Check for fake EGX30 value
        if "12,456.12" in response or "12456.12" in response:
            print("❌ FAIL: LLM used fake EGX30 value (12,456.12)")
            print("   Real value from DB: {:.1f}".format(egx_value if egx_data else 0))
        elif f"{egx_value:.1f}" in response or "53,931.9" in response or "53931.9" in response:
            print("✅ PASS: LLM used real EGX30 value from database")
        else:
            print("⚠️ WARNING: EGX30 value not found in response")
        
        # Check for database source notation
        if "من قاعدة البيانات" in response:
            print("✅ PASS: LLM included database source notation")
        else:
            print("⚠️ WARNING: Missing database source notation")
            
    except Exception as e:
        print(f"❌ API Call failed: {e}")

async def call_llm_api(api_key: str, messages: list) -> str:
    """Make actual LLM API call"""
    import httpx
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    payload = {
        "model": "meta/llama-3.1-8b-instruct",
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 1024
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=30.0
        )
        
        if response.status_code == 200:
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
        else:
            raise Exception(f"API error {response.status_code}: {response.text}")

if __name__ == "__main__":
    asyncio.run(test_full_llm_response())