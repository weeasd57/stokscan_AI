import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

res = supabase.table("stocks").select("*").limit(1).execute()
if res.data:
    print("Columns in stocks table:")
    for k in res.data[0].keys():
        print(f"  {k}")
else:
    print("No data in stocks table")
