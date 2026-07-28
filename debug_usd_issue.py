#!/usr/bin/env python3
"""
Debug why USD data is not showing correctly in chatbot
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from api.stock_ai import _init_supabase, supabase

_init_supabase()

print("🔍 Debugging USD Data Issue...")
print("=" * 50)

# Check exact structure of market_cache for USD data
res = supabase.table('market_cache').select('cache_key, payload').eq('cache_key', 'market_status_Egypt').maybe_single().execute()

if res.data and res.data.get('payload'):
    payload = res.data['payload']
    print("✅ market_status_Egypt payload found")
    
    # Check USD data structure
    if 'usdegp' in payload:
        usd_data = payload['usdegp']
        print(f"✅ usdegp key exists, type: {type(usd_data)}")
        
        if isinstance(usd_data, list) and len(usd_data) > 0:
            print(f"✅ usdegp is list with {len(usd_data)} entries")
            
            # Show last few entries
            for i, entry in enumerate(usd_data[-3:]):
                print(f"   Entry {len(usd_data)-3+i}: date={entry.get('date')}, close={entry.get('close')}, open={entry.get('open')}")
                
            # Get latest rate
            latest = usd_data[-1]
            rate = latest.get('close', latest.get('open', 0))
            print(f"\n💡 Latest USD rate should be: {rate:.2f} EGP")
            print(f"   Date: {latest.get('date')}")
            
        else:
            print(f"❌ usdegp is not a valid list: {usd_data}")
    else:
        print("❌ usdegp key not found in payload")
        print(f"   Available keys: {list(payload.keys())}")
else:
    print("❌ No market_status_Egypt data found")

print("\n" + "=" * 50)
print("🎯 Expected Result:")
print("   USD/EGP should show ~51.25 EGP, NOT 15.25 EGP")
print("   The chatbot is getting wrong data somewhere...")