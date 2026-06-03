import os, sys
sys.path.insert(0, r"C:\Users\MR__CODER__\Desktop\stokscan_AI")

from dotenv import load_dotenv
load_dotenv(r"C:\Users\MR__CODER__\Desktop\stokscan_AI\.env")

from supabase import create_client

url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
sb = create_client(url, key)

# Let's get all prices for WATP
res = sb.table("stock_prices").select("*").eq("symbol", "WATP").eq("exchange", "EGX").order("date", desc=False).execute()
print(f"Total WATP rows in DB: {len(res.data)}")
import pandas as pd
df = pd.DataFrame(res.data)
df['date'] = pd.to_datetime(df['date'])
df = df.set_index('date')

print("\nRows where close == 3.8:")
print(df[df['close'] == 3.8])

print("\nRows where close != 3.8 and close != 1.0 (head & tail):")
df_good = df[(df['close'] != 3.8) & (df['close'] != 1.0)]
print(df_good.head(20))
print("...")
print(df_good.tail(20))
