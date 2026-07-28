#!/usr/bin/env python3
"""
Check for market index and currency data
"""
import sys
import os

# Force UTF-8 encoding on standard output and error to prevent UnicodeEncodeError under Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(__file__))

from api.stock_ai import _init_supabase, supabase

_init_supabase()

print("🔍 Checking for Market Index & Currency data...")
print("=" * 50)

# Check market_cache for index data
print("📊 Checking market_cache table:")
res = supabase.table('market_cache').select('cache_key, payload').execute()
for item in res.data:
    key = item['cache_key']
    payload = item.get('payload', {})
    if 'egx' in key.lower() or 'index' in key.lower() or 'usd' in key.lower():
        print(f"  ✅ {key}")
        if isinstance(payload, dict):
            for k, v in list(payload.items())[:3]:  # First 3 keys
                print(f"     {k}: {type(v).__name__}")

print("\n💱 Checking for USD/EGP exchange rate:")
# Check market_status_Egypt for USD data
res = supabase.table('market_cache').select('payload').eq('cache_key', 'market_status_Egypt').maybe_single().execute()
if res.data and res.data.get('payload'):
    payload = res.data['payload']
    usd_keys = [k for k in payload.keys() if 'usd' in k.lower() or 'egp' in k.lower() or 'exchange' in k.lower()]
    if usd_keys:
        print(f"  ✅ Found USD-related keys: {usd_keys}")
        for key in usd_keys[:3]:
            print(f"     {key}: {payload.get(key)}")
    else:
        print("  ❌ No USD/EGP data found in market_status_Egypt")
else:
    print("  ❌ No market_status_Egypt payload found")

print("\n📈 Checking for EGX index symbols:")
# Check stock_prices for index symbols
index_symbols = ['EGX30', 'EGX70', 'EGX100', '^EGX30', 'EGID']
res = supabase.table('stock_prices').select('symbol, close, date').in_('symbol', index_symbols).order('date', desc=True).limit(10).execute()
if res.data:
    print("  ✅ Found index data:")
    for item in res.data:
        print(f"     {item['symbol']}: {item['close']} ({item['date']})")
else:
    print("  ❌ No EGX index symbols found in stock_prices")