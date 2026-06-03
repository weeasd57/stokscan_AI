import os, sys
sys.path.insert(0, r"C:\Users\MR__CODER__\Desktop\stokscan_AI")

from dotenv import load_dotenv
load_dotenv(r"C:\Users\MR__CODER__\Desktop\stokscan_AI\.env")

from tvDatafeed import TvDatafeed, Interval

print("=== TradingView (tvDatafeed) Check for 3.8 ===")
try:
    tv = TvDatafeed()
    df_tv = tv.get_hist(
        symbol="WATP",
        exchange="EGX",
        interval=Interval.in_daily,
        n_bars=2000
    )
    if df_tv is not None and not df_tv.empty:
        print(f"TradingView returned {len(df_tv)} rows")
        df_tv = df_tv.reset_index()
        print("TradingView rows with close == 3.8:")
        rows_38 = df_tv[df_tv['close'] == 3.8]
        print(f"Found {len(rows_38)} rows with close == 3.8")
        if not rows_38.empty:
            print(rows_38.head(10))
            print("...")
            print(rows_38.tail(10))
        
        print("\nTradingView rows with close == 1.0:")
        rows_1 = df_tv[df_tv['close'] == 1.0]
        print(f"Found {len(rows_1)} rows with close == 1.0")
        
        print("\nCheck a sample of rows around 2025-02-04:")
        df_tv['datetime_str'] = df_tv['datetime'].dt.strftime('%Y-%m-%d')
        print(df_tv[(df_tv['datetime_str'] >= '2025-02-01') & (df_tv['datetime_str'] <= '2025-02-15')])
    else:
        print("TradingView returned empty or None")
except Exception as e:
    print("TradingView error:", e)
