import os
import sys
sys.path.insert(0, r"c:\Users\MR__CODER__\Desktop\stokscan_AI")
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv(dotenv_path=r"c:\Users\MR__CODER__\Desktop\stokscan_AI\.env")

import api.stock_ai as stock_ai
stock_ai._init_supabase()
supabase = stock_ai.supabase

if supabase:
    # Query all backtests from 2026-06-02 or with profit = 0
    res = supabase.table("backtests").select("id, model_name, exchange, start_date, end_date, total_trades, win_rate, net_profit, avg_return_per_trade, created_at, profit_pct").order("created_at", desc=True).execute()
    if res.data:
        print("Found backtests:")
        for row in res.data[:10]:
            print(f"ID: {row['id']}")
            print(f"  Model: {row['model_name']} on {row['exchange']}")
            print(f"  Dates: {row['start_date']} to {row['end_date']}")
            print(f"  Trades: {row['total_trades']}, Win Rate: {row['win_rate']}")
            print(f"  Net Profit: {row['net_profit']}, Profit %: {row.get('profit_pct')}")
            print(f"  Created At: {row['created_at']}")
            print("-" * 40)
    else:
        print("No backtests found in database.")
else:
    print("Supabase client not available.")
