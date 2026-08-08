#!/usr/bin/env python3
"""List all tables in Supabase."""

import os
from pathlib import Path
import sys
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent / "api"))

load_dotenv("web/.env.local")

from api.stock_ai import _init_supabase, supabase

_init_supabase()

if supabase:
    try:
        # Get schema information using Postgres query
        # Try different approaches
        
        # Approach 1: Try to list tables
        tables_to_try = [
            "stock_bars_intraday",
            "stock_daily_data",
            "stocks",
            "stock_analysis",
            "market_data",
            "daily_stocks",
            "intraday",
        ]
        
        print("Trying to find stock data tables...\n")
        
        for table_name in tables_to_try:
            try:
                response = supabase.table(table_name).select("*").limit(1).execute()
                if response.data:
                    print(f"✅ Found: {table_name}")
                    row = response.data[0]
                    print(f"   Columns: {list(row.keys())}")
                    print()
                elif not response.error:
                    print(f"⚠️ Found (empty): {table_name}")
                    print()
            except Exception as e:
                error_msg = str(e)
                if "could not find" in error_msg.lower() or "not found" in error_msg.lower():
                    pass  # Table doesn't exist, skip
                else:
                    print(f"❌ {table_name}: {e}\n")
    
    except Exception as e:
        print(f"❌ Error: {e}")
else:
    print("❌ Supabase not initialized")
