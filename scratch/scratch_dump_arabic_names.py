import os
import sys
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

res = supabase.table("stocks").select("symbol, name, name_ar").eq("is_active", True).execute()

with open("scratch/arabic_stocks.txt", "w", encoding="utf-8") as f:
    f.write(f"Total active stocks: {len(res.data)}\n")
    for row in sorted(res.data, key=lambda x: x['symbol']):
        f.write(f"'{row['symbol']}': {{ 'en': '{row['name']}', 'ar': '{row['name_ar']}' }},\n")

print("Dipped to scratch/arabic_stocks.txt successfully!")
