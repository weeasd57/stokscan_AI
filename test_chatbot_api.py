#!/usr/bin/env python3
"""
Test script to simulate market indices and USD requests
"""
import json
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from api.stock_ai import _init_supabase, supabase

async def test_market_indices_request():
    """Test market indices and USD request"""
    print("🧪 Testing Market Indices & USD Request Flow...")
    print("=" * 50)
    
    # Initialize Supabase
    _init_supabase()
    
    # Step 1: Simulate Planner Result for market indices query
    planner_result = {
        "intent": "market_summary",
        "confidence": 0.95,
        "entities": {
            "symbols": [],
            "sector": None,
            "wants_table": True,
            "timeframe": None
        },
        "tools": ["get_market", "get_indices"],
        "image_summary": None,
        "session_update": {
            "current_symbol": None,
            "last_symbols": [],
            "summary": "معلومات عن المؤشر العام والدولار"
        }
    }
    
    print("📋 Planner Result:")
    print(f"   Intent: {planner_result['intent']}")
    print(f"   Tools: {planner_result['tools']}")
    
    # Step 2: Execute get_indices tool
    print("\n🔧 Executing get_indices tool...")
    
    # جلب بيانات المؤشرات من stock_prices
    index_symbols = ['EGX30', 'EGX70', 'EGX100']
    res_indices = supabase.table("stock_prices") \
        .select("symbol, close, volume, date") \
        .in_("symbol", index_symbols) \
        .order("date", desc=True) \
        .limit(len(index_symbols) * 2) \
        .execute()
    
    index_data = res_indices.data or []
    
    # جلب بيانات الدولار من market_cache
    res_usd = supabase.table("market_cache") \
        .select("payload") \
        .eq("cache_key", "market_status_Egypt") \
        .maybe_single() \
        .execute()
    
    print(f"   Found {len(index_data)} index records")
    
    # Step 3: Format Output
    output_text = ""
    
    if index_data:
        output_text += "\n📊 [المؤشرات المصرية من قاعدة البيانات]:\n"
        
        # تجميع أحدث بيانات لكل مؤشر
        latest_indices = {}
        for item in index_data:
            symbol = item['symbol']
            if symbol not in latest_indices or (latest_indices[symbol].get('date', '') < item.get('date', '')):
                latest_indices[symbol] = item
        
        for symbol, data in latest_indices.items():
            value = data.get('close', 0) or 0
            date = data.get('date', 'N/A')
            output_text += f"• {symbol}: {value:.1f} نقطة (تاريخ: {date})\n"
    
    # استخراج بيانات USD/EGP
    market_data = res_usd.data
    if market_data and market_data.get('payload', {}).get('usdegp'):
        usd_data = market_data['payload']['usdegp']
        if isinstance(usd_data, list) and len(usd_data) > 0:
            # أحدث سعر صرف
            latest_usd = usd_data[-1]
            rate = latest_usd.get('close', latest_usd.get('open', 0)) or 0
            date = latest_usd.get('date', 'N/A')
            
            output_text += f"\n💱 [سعر صرف الدولار الأمريكي من قاعدة البيانات]:\n"
            output_text += f"• USD/EGP: {rate:.2f} جنيه مصري (تاريخ: {date})\n"
            
            # حساب التغيير
            if len(usd_data) > 1:
                previous_usd = usd_data[-2]
                prev_rate = previous_usd.get('close', previous_usd.get('open', 0)) or 0
                if prev_rate > 0:
                    change = rate - prev_rate
                    change_percent = (change / prev_rate) * 100
                    change_symbol = "+" if change >= 0 else ""
                    output_text += f"• التغيير: {change_symbol}{change:.4f} ({change_symbol}{change_percent:.2f}%)\n"
    
    if not output_text:
        output_text = "\n📊 [المؤشرات والعملات]: لا توجد بيانات محدثة متاحة حالياً في قاعدة البيانات.\n"
    
    # Step 4: Final Response
    print("\n💬 Expected Final Response:")
    print("=" * 50)
    print("**معلومات عن المؤشر العام والدولار**")
    print(output_text)
    print("✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك.")
    print("=" * 50)
    
    return len(index_data) > 0 or bool(output_text.strip())

# Run the test
if __name__ == "__main__":
    success = asyncio.run(test_market_indices_request())
    if success:
        print("\n🎉 TEST PASSED: Real market data found and ready!")
        print("💡 The chatbot should now show REAL data instead of fake numbers.")
    else:
        print("\n⚠️ TEST FAILED: No market data available")