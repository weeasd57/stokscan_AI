import os
import sys
import pandas as pd

sys.path.append(os.getcwd())

import api.stock_ai as stock_ai

try:
    print("=== Running load_symbol_prices_direct (direct query) ===")
    stock_ai._init_supabase()
    client = stock_ai.supabase
    s, e = stock_ai._infer_symbol_exchange("AALR.EGX", None)
    if e in ["CC", "CA"]: e = "EGX"
    
    # Direct select
    res = client.table("stock_prices").select("date,open,high,low,close,volume").eq("symbol", s).eq("exchange", e).order("date", desc=False).execute()
    df = pd.DataFrame(res.data)
    df['date'] = pd.to_datetime(df['date'])
    df = df.set_index('date')
    df = df[~df.index.duplicated(keep='last')]
    df = df.sort_index()
    
    print("df columns:", list(df.columns))
    print("df index type:", type(df.index))
    print("df index sample:", list(df.index[-3:]))
    
    df_ind = stock_ai.add_technical_indicators(df)
    print("df_ind columns:", list(df_ind.columns))
    print("df_ind index type:", type(df_ind.index))
    print("df_ind index sample:", list(df_ind.index[-3:]))
    
    target_ts = df_ind.index[-1]
    print(f"Target timestamp: {target_ts} (type: {type(target_ts)})")
    
    print("Lookup Close on target_ts:")
    val = df_ind.loc[target_ts, "Close"]
    print("Val:", val)
    print("SUCCESS: Direct inspection completed without errors!")
except Exception as e:
    import traceback
    traceback.print_exc()
