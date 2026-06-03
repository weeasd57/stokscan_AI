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
    res = supabase.table("backtests").select("*").limit(1).execute()
    if res.data:
        print("Keys in backtests row:", list(res.data[0].keys()))
        print("Sample row:", res.data[0])
    else:
        print("No rows found")
else:
    print("Supabase client not available.")
