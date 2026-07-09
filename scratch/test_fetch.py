import os
import sys

# Add root folder to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.macro_correlation import fetch_eod_data
from api.stock_ai import _init_supabase, supabase

try:
    print("Running fetch_eod_data for CBKD.LSE...")
    res = fetch_eod_data("CBKD.LSE", "2025-01-01")
    print(f"Fetch completed. Records fetched: {len(res)}")
    
    # Check if symbol exists in stock_fundamentals
    _init_supabase()
    fund = supabase.table("stock_fundamentals").select("*").eq("symbol", "CBKD").eq("exchange", "LSE").execute()
    print(f"Fundamentals in DB: {fund.data}")
    
    prices = supabase.table("stock_prices").select("count", count="exact").eq("symbol", "CBKD").eq("exchange", "LSE").execute()
    print(f"Prices in DB: {prices.count}")

except Exception as e:
    import traceback
    traceback.print_exc()
