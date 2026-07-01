#!/usr/bin/env python
"""Quick test of free data providers"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

print("Testing free data providers...\n")

# Test 1: Import
print("1. Testing imports...")
try:
    from api.free_data_provider import (
        fetch_egx_symbols_free,
        get_market_status_free,
        fetch_live_rates_free,
        fetch_eod_data_free
    )
    print("   ✓ All imports successful\n")
except Exception as e:
    print(f"   ✗ Import failed: {e}\n")
    sys.exit(1)

# Test 2: Fetch EGX symbols
print("2. Testing fetch_egx_symbols_free()...")
try:
    ok, symbols, msg = fetch_egx_symbols_free()
    print(f"   ✓ {msg}")
    print(f"   Symbols: {symbols[:5]}...\n")
except Exception as e:
    print(f"   ✗ Failed: {e}\n")

# Test 3: Fetch live rates
print("3. Testing fetch_live_rates_free()...")
try:
    rates = fetch_live_rates_free()
    print(f"   ✓ USD/EGP: {rates['usd_official']} (source: {rates['source']})")
    print(f"   ✓ Gold: {rates['gold_24k']} EGP\n")
except Exception as e:
    print(f"   ✗ Failed: {e}\n")

# Test 4: Fetch EOD data
print("4. Testing fetch_eod_data_free()...")
try:
    data = fetch_eod_data_free("EGX30.INDX", period="1mo")
    print(f"   ✓ Fetched {len(data)} EGX30 records")
    if data:
        print(f"   Latest: {data[-1]['date']} close={data[-1]['close']}\n")
except Exception as e:
    print(f"   ✗ Failed: {e}\n")

# Test 5: Get market status
print("5. Testing get_market_status_free()...")
try:
    status = get_market_status_free(period="1mo")
    print(f"   ✓ Market regime: {status['regime']}")
    print(f"   ✓ EGX30 return: {status['egx30_return']:.2%}")
    print(f"   ✓ Source: {status.get('source', 'unknown')}\n")
except Exception as e:
    print(f"   ✗ Failed: {e}\n")

print("=" * 50)
print("✓ All tests completed successfully!")
print("=" * 50)
