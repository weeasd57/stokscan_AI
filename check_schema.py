#!/usr/bin/env python3
"""Check Supabase schema for stock_bars_intraday table."""

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
        # Try to get one row to see column names
        response = supabase.table("stock_bars_intraday").select("*").limit(1).execute()
        
        if response.data:
            row = response.data[0]
            print("✅ Columns in stock_bars_intraday table:")
            for col in sorted(row.keys()):
                print(f"   - {col}: {type(row[col]).__name__}")
        else:
            print("⚠️ Table is empty")
    
    except Exception as e:
        print(f"❌ Error: {e}")
else:
    print("❌ Supabase not initialized")
