#!/usr/bin/env python3
"""
Quick script to run news sentiment engine for top EGX stocks
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from api.news_sentiment_engine import process_exchange_news

# Top liquid EGX stocks that usually have news
TOP_STOCKS = [
    "COMI.CA", "ABUK.CA", "FWRY.CA", "SWDY.CA", "TMGH.CA",
    "ESRS.CA", "EMFD.CA", "MFPC.CA", "ATQA.CA", "BTFH.CA",
    "CIB.CA", "ETEL.CA", "ORWE.CA", "PHDC.CA", "HRHO.CA",
    "EAST.CA", "AUTO.CA", "EKHO.CA", "JUFO.CA", "MNHD.CA",
    "AMER.CA", "MILS.CA", "CPCI.CA", "TYCN.CA", "UTOP.CA"
]

print(f"🚀 Starting news sentiment update for {len(TOP_STOCKS)} top EGX stocks...")
print("=" * 60)

ok, count = process_exchange_news("EGX", TOP_STOCKS)

if ok:
    print("=" * 60)
    print(f"✅ Successfully processed news for {count}/{len(TOP_STOCKS)} stocks")
    print("\n💡 Tip: Now try asking the chatbot:")
    print('   "عايز اخبار اخر اسبوع فى جدول"')
else:
    print("❌ Failed to process news")
    sys.exit(1)
