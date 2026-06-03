import os, sys
sys.path.insert(0, r"C:\Users\MR__CODER__\Desktop\stokscan_AI")

from dotenv import load_dotenv
load_dotenv(r"C:\Users\MR__CODER__\Desktop\stokscan_AI\.env")

from supabase import create_client

url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
sb = create_client(url, key)

print("Fetching symbols with volume == 0...")
# Since postgrest doesn't allow raw group by easily without views or RPC, we'll fetch rows with volume = 0 and aggregate in python
res = sb.table("stock_prices").select("symbol, exchange, close, date").eq("volume", 0).limit(5000).execute()
print(f"Total rows with volume == 0: {len(res.data)}")

import pandas as pd
df = pd.DataFrame(res.data)
if not df.empty:
    print("\nTop symbols with volume == 0:")
    print(df.groupby(['symbol', 'exchange']).size().sort_values(ascending=False).head(20))
    
    print("\nSample values for these volume == 0 rows:")
    print(df.head(20))
else:
    print("No rows found with volume == 0")
