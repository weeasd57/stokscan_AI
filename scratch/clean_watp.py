import os, sys
sys.path.insert(0, r"C:\Users\MR__CODER__\Desktop\stokscan_AI")

from dotenv import load_dotenv
load_dotenv(r"C:\Users\MR__CODER__\Desktop\stokscan_AI\.env")

from supabase import create_client

url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
sb = create_client(url, key)

print("Deleting WATP rows with volume == 0...")
res = sb.table("stock_prices").delete().eq("symbol", "WATP").eq("exchange", "EGX").eq("volume", 0).execute()
print(f"Deleted {len(res.data)} rows.")

print("Double checking WATP rows remaining...")
res2 = sb.table("stock_prices").select("*").eq("symbol", "WATP").eq("exchange", "EGX").order("date", desc=False).execute()
print(f"Remaining WATP rows: {len(res2.data)}")
