#!/usr/bin/env python3
"""
Check the actual structure of stock_news_sentiment table
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from api.stock_ai import _init_supabase, supabase

_init_supabase()

# Get sample record to see actual columns
res = supabase.table('stock_news_sentiment').select('*').limit(1).execute()

if res.data and len(res.data) > 0:
    print("✅ Table columns found:")
    sample = res.data[0]
    for key, value in sample.items():
        print(f"   {key}: {type(value).__name__} = {value}")
else:
    print("❌ No data in table")