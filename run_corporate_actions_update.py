#!/usr/bin/env python3
"""
Quick script to run the corporate actions engine for top EGX stocks
(rights issues, splits, dividends, bonus shares, capital changes...).
Uses keyless Google News RSS and stores results in `corporate_actions`.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from api.corporate_actions_engine import process_exchange_corporate_actions

# Top liquid EGX stocks that usually have corporate action news
TOP_STOCKS = [
    "COMI.CA", "ABUK.CA", "FWRY.CA", "SWDY.CA", "TMGH.CA",
    "ESRS.CA", "EMFD.CA", "MFPC.CA", "ATQA.CA", "BTFH.CA",
    "CIB.CA", "ETEL.CA", "ORWE.CA", "PHDC.CA", "HRHO.CA",
    "EAST.CA", "AUTO.CA", "EKHO.CA", "JUFO.CA", "MNHD.CA",
    "AMER.CA", "MILS.CA", "CPCI.CA", "TYCN.CA", "UTOP.CA"
]

print(f"Starting corporate actions update for {len(TOP_STOCKS)} top EGX stocks...")
print("=" * 60)

ok, count = process_exchange_corporate_actions("EGX", TOP_STOCKS, days_back=30)

if ok:
    print("=" * 60)
    print(f"Successfully processed corporate actions: {count} stored/refreshed")
    print("\nTip: Now try asking the chatbot:")
    print('   "اخبار اكتتاب كومي" / "توزيعات ابو الفتوح" / "تجزئة سهم كومي"')
else:
    print("Failed to process corporate actions")
    sys.exit(1)
