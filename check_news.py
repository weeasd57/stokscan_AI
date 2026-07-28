#!/usr/bin/env python3
"""
Script to check if stock_news_sentiment table has recent data
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from api.stock_ai import _init_supabase, supabase

_init_supabase()

if not supabase:
    print("❌ Supabase not initialized")
    sys.exit(1)

# Check latest news
res = supabase.table('stock_news_sentiment').select('symbol, date, news_count, sentiment_score').order('date', desc=True).limit(20).execute()

if not res.data:
    print("❌ No news data found in stock_news_sentiment table!")
    print("\n💡 Solution: Run the news sentiment engine:")
    print("   python -m api.news_sentiment_engine")
else:
    print(f"✅ Found {len(res.data)} recent news records:")
    print("\n| Date       | Symbol | News Count | Sentiment |")
    print("|------------|--------|------------|-----------|")
    for r in res.data[:10]:
        sentiment = f"{r['sentiment_score']:+.2f}" if r['sentiment_score'] else "N/A"
        print(f"| {r['date']} | {r['symbol']:6s} | {r['news_count']:10d} | {sentiment:9s} |")
