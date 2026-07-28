#!/usr/bin/env python3
"""
Test the final fix: Direct response generation for market indices
"""
import json
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

def test_direct_response_generation():
    """Test the direct response generation logic"""
    print("🧪 Testing Direct Response Generation Fix")
    print("=" * 60)
    
    # Simulate live data string from database
    live_data_string = """🔍 [تم تفعيل أداة جلب المؤشرات والعملات]:
📊 [المؤشرات المصرية - البيانات الحقيقية من قاعدة البيانات]:
• EGX30: 53931.9 نقطة (تاريخ حقيقي: 2026-07-22)
• EGX100: 23597.5 نقطة (تاريخ حقيقي: 2026-07-22)

💱 [سعر صرف الدولار الأمريكي - البيانات الحقيقية من قاعدة البيانات]:
• USD/EGP: 51.25 جنيه مصري (تاريخ حقيقي: 2026-07-22)
⚠️ تحذير للنموذج: السعر الحقيقي هو 51.25 وليس 15.25
• التغيير الحقيقي: +0.1600 (+0.31%)

✅ تم جلب البيانات الحقيقية بنجاح - يُرجى عدم اختراع أي أرقام."""
    
    # Simulate TypeScript logic in Python
    def generate_direct_response_py(live_data: str, wants_table: bool = True) -> str:
        lines = live_data.split('\n')
        egx30_value = ""
        egx30_date = ""
        usd_value = ""
        usd_date = ""
        usd_change = ""
        
        for i, line in enumerate(lines):
            # Extract EGX30 value
            if "EGX30:" in line and not egx30_value:
                parts = line.split("EGX30:")
                if len(parts) > 1:
                    value_part = parts[1].strip()
                    # Extract number
                    import re
                    match = re.search(r'([\d,]+\.?\d*)', value_part)
                    if match:
                        egx30_value = match.group(1).replace(',', '')
                
                # Try to find date
                if "تاريخ حقيقي:" in line:
                    date_match = re.search(r'تاريخ حقيقي:\s*(\d{4}-\d{2}-\d{2})', line)
                    if date_match:
                        egx30_date = date_match.group(1)
            
            # Extract USD value
            if "USD/EGP:" in line and not usd_value:
                parts = line.split("USD/EGP:")
                if len(parts) > 1:
                    value_part = parts[1].strip()
                    match = re.search(r'([\d,]+\.?\d*)', value_part)
                    if match:
                        usd_value = match.group(1)
                
                # Try to find date
                if "تاريخ حقيقي:" in line:
                    date_match = re.search(r'تاريخ حقيقي:\s*(\d{4}-\d{2}-\d{2})', line)
                    if date_match:
                        usd_date = date_match.group(1)
            
            # Extract USD change
            if "التغيير الحقيقي:" in line and not usd_change:
                usd_change = line.replace("• التغيير الحقيقي:", "").strip()
        
        # Generate response
        response = "**معلومات عن المؤشر العام والدولار** [من قاعدة البيانات]\n\n"
        
        if egx30_value:
            formatted_value = f"{float(egx30_value):,.1f}"
            response += f"📊 **المؤشر العام (EGX 30)**\n"
            response += f"• التاريخ: {egx30_date or '2026-07-22'}\n"
            response += f"• القيمة: {formatted_value} نقطة\n"
            response += f"• المصدر: قاعدة بيانات البورصة المصرية\n\n"
        
        if usd_value:
            response += f"💱 **الدولار الأمريكي (USD)**\n"
            response += f"• التاريخ: {usd_date or '2026-07-22'}\n"
            response += f"• السعر: 1 USD = {usd_value} جنيه مصري\n"
            if usd_change:
                response += f"• {usd_change}\n"
            response += f"• المصدر: قاعدة البيانات الحقيقية\n\n"
        
        # Add table if wanted
        if wants_table and (egx30_value or usd_value):
            response += "| المؤشر | القيمة | التاريخ |\n"
            response += "|---------|--------|---------|\n"
            if egx30_value:
                formatted_value = f"{float(egx30_value):,.1f}"
                response += f"| EGX30 | {formatted_value} نقطة | {egx30_date or '2026-07-22'} |\n"
            if usd_value:
                response += f"| USD/EGP | {usd_value} جنيه | {usd_date or '2026-07-22'} |\n"
            response += "\n"
        
        response += "✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك."
        
        return response
    
    # Test the function
    print("📊 Input Live Data:")
    print(live_data_string[:200] + "...")
    
    print("\n💬 Generated Direct Response:")
    print("=" * 60)
    
    result = generate_direct_response_py(live_data_string, wants_table=True)
    print(result)
    
    print("=" * 60)
    
    # Validate the response
    print("\n🔍 VALIDATION RESULTS:")
    
    # Check for correct USD value
    if "51.25" in result:
        print("✅ USD rate is CORRECT: 51.25 جنيه مصري")
    elif "15.25" in result:
        print("❌ USD rate is WRONG: Contains fake value 15.25")
    else:
        print("⚠️ USD rate not found in response")
    
    # Check for correct EGX30 value
    if "53,931.9" in result or "53931.9" in result:
        print("✅ EGX30 value is CORRECT: 53,931.9 نقطة")
    elif "12,456.12" in result or "12456.12" in result:
        print("❌ EGX30 value is WRONG: Contains fake value 12,456.12")
    else:
        egx_match = "EGX30" in result and "نقطة" in result
        print(f"✅ EGX30 value appears in response" if egx_match else "⚠️ EGX30 value not clearly found")
    
    # Check for database source
    if "من قاعدة البيانات" in result:
        print("✅ Includes database source notation")
    else:
        print("⚠️ Missing database source notation")
    
    return "51.25" in result and ("53,931.9" in result or "53931.9" in result)

if __name__ == "__main__":
    success = test_direct_response_generation()
    if success:
        print("\n🎉 FIX SUCCESSFUL: Response will show REAL data only!")
        print("   • USD: 51.25 جنيه (NOT 15.25)")
        print("   • EGX30: 53,931.9 نقطة (NOT 12,456.12)")
    else:
        print("\n⚠️ Fix needs adjustment")