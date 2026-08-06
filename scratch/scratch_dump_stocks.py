import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

res = supabase.table("stocks").select("symbol, name").eq("is_active", True).execute()
print(f"Total active stocks: {len(res.data)}")
for row in sorted(res.data, key=lambda x: x['symbol']):
    print(f"'{row['symbol']}': '{row['name']}',")
