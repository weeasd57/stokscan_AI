import os, sys
sys.path.insert(0, r"C:\Users\MR__CODER__\Desktop\stokscan_AI")

from dotenv import load_dotenv
load_dotenv(r"C:\Users\MR__CODER__\Desktop\stokscan_AI\.env")

from supabase import create_client

url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
sb = create_client(url, key)

# Let's find rows with volume = 0 for WATP
res = sb.table("stock_prices").select("*").eq("symbol", "WATP").eq("exchange", "EGX").eq("volume", 0).order("date", desc=True).limit(20).execute()
print(f"WATP rows with volume = 0 count: {len(res.data)}")
for row in res.data[:10]:
    print(row['date'], "open:", row['open'], "high:", row['high'], "low:", row['low'], "close:", row['close'], "vol:", row['volume'], "updated_at:", row.get('updated_at'))

print("\nAre there other symbols with close == 3.8 and volume == 0?")
res2 = sb.table("stock_prices").select("symbol, exchange, count").eq("close", 3.8).eq("volume", 0).limit(10).execute()
# Wait, let's group or see
print("Sample symbols with close == 3.8 and volume == 0:", res2.data)
