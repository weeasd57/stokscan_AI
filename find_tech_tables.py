#!/usr/bin/env python3
"""Find tables with technical data."""

import os
from pathlib import Path
import sys
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent / "api"))

load_dotenv("web/.env.local")

from api.stock_ai import _init_supabase, supabase

_init_supabase()

if supabase:
    tables_to_try = [
        "stock_technical_analysis",
        "technical_indicators",
        "daily_analysis",
        "stock_screening_results",
        "stock_scores",
        "market_data",
        "ohlc_daily",
        "daily_prices",
        "price_data",
        "stock_metrics",
        "screening_cache",
        "latest_screening",
    ]
    
    print("Searching for technical data tables...\n")
    
    for table_name in tables_to_try:
        try:
            response = supabase.table(table_name).select("*").limit(1)
            data = response.execute()
            
            if data.data:
                print(f"✅ {table_name}")
                row = data.data[0]
                cols = list(row.keys())
                print(f"   Columns ({len(cols)}): {cols[:5]}..." if len(cols) > 5 else f"   Columns: {cols}")
                print()
        except Exception as e:
            pass  # Skip
    
    print("\n" + "="*60)
    print("All available tables (checking 'information_schema'):")
    print("="*60 + "\n")
    
    try:
        # Query information schema
        info_query = """
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
        """
        # Note: Supabase might not allow direct SQL queries through client
        # Let's just try the most common patterns
        common_tables = [
            "public.stock_screening_results",
            "stock_analysis_cache",
            "scanner_results",
            "ai_recommendations",
        ]
        
        for table_name in common_tables:
            try:
                clean_name = table_name.replace("public.", "")
                response = supabase.table(clean_name).select("count").limit(1).execute()
                print(f"   - {clean_name}")
            except:
                pass
    except:
        pass

else:
    print("❌ Supabase not initialized")
