"""
Check ESRS.EGX data in Supabase
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import api.stock_ai as stock_ai
stock_ai._init_supabase()
if not stock_ai.supabase:
    print("❌ Supabase not initialized")
    exit()

# 1. Check in similarity_reports
print("=" * 60)
print("📊 البحث في similarity_reports عن ESRS")
print("=" * 60)
report_res = stock_ai.supabase.table("similarity_reports").select("scans").order("updated_at", desc=True).limit(1).execute()
if report_res.data:
    scans_raw = report_res.data[0].get("scans", "[]")
    if isinstance(scans_raw, str):
        scans = json.loads(scans_raw)
    else:
        scans = scans_raw
    
    found = [s for s in scans if "ESRS" in s.get("symbol", "").upper()]
    if found:
        print("✅ ESRS موجود في التقرير!")
        for s in found:
            print(json.dumps(s, indent=2, ensure_ascii=False))
    else:
        print("❌ ESRS مش موجود في التقرير")
        print("\nعينة من أول 5 رموز في التقرير:")
        for s in scans[:5]:
            print(f"  - {s.get('symbol')}")
else:
    print("❌ مفيش تقارير")

# 2. Check in stock_prices
print()
print("=" * 60)
print("📈 البحث في stock_prices عن ESRS.EGX")
print("=" * 60)
try:
    price_res = stock_ai.supabase.table("stock_prices").select("date,close,volume").eq("symbol", "ESRS.EGX").order("date", desc=True).limit(3).execute()
    if price_res.data:
        print(f"✅ موجود! آخر {len(price_res.data)} أيام:")
        for row in price_res.data:
            print(f"   {row['date']} | Close: {row['close']} | Volume: {row['volume']}")
    else:
        print("❌ مش موجود في stock_prices")
except Exception as e:
    print(f"⚠️  خطأ في الاستعلام: {e}")
    # Try with a simpler query
    try:
        price_res = stock_ai.supabase.table("stock_prices").select("date,close,volume").eq("symbol", "ESRS.EGX").limit(3).execute()
        if price_res.data:
            print(f"✅ موجود (بدون ترتيب)! آخر {len(price_res.data)}:")
            for row in price_res.data:
                print(f"   {row['date']} | Close: {row['close']} | Volume: {row['volume']}")
    except Exception as e2:
        print(f"⚠️  خطأ تاني: {e2}")

# 3. Check in stock_technical_indicators
print()
print("=" * 60)
print("📉 البحث في stock_technical_indicators عن ESRS")
print("=" * 60)
try:
    tech_res = stock_ai.supabase.table("stock_technical_indicators").select("date,close,rsi_14,adx_14").eq("symbol", "ESRS").eq("exchange", "EGX").order("date", desc=True).limit(3).execute()
    if tech_res.data:
        print(f"✅ موجود! آخر {len(tech_res.data)} أيام:")
        for row in tech_res.data:
            print(f"   {row['date']} | Close: {row['close']} | RSI: {row.get('rsi_14', 'N/A')} | ADX: {row.get('adx_14', 'N/A')}")
    else:
        print("❌ مش موجود في stock_technical_indicators")
except Exception as e:
    print(f"⚠️  خطأ: {e}")

# 4. Check active symbols
print()
print("=" * 60)
print("🔍 البحث في get_supabase_symbols عن ESRS")
print("=" * 60)
try:
    active = stock_ai.get_supabase_symbols()
    esrs_found = [s for s in active if "ESRS" in s.get("symbol", "").upper()]
    if esrs_found:
        print("✅ ESRS موجود في الرموز النشطة:")
        for s in esrs_found:
            print(f"   {s}")
    else:
        print("❌ ESRS مش موجود في الرموز النشطة (يعني السهم وقع/مش نشط)")
        print("\nعينة من أول 5 رموز نشطة:")
        for s in active[:5]:
            print(f"   {s.get('symbol')}")
except Exception as e:
    print(f"❌ خطأ: {e}")
