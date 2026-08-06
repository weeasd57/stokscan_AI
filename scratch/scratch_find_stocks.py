import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

res = supabase.table("stocks").select("symbol, name").execute()
search_terms = ["development", "food", "investment", "development", "agricultural", "mills", "valley", "pharmaceutical", "pharma"]

print("--- SEARCH RESULTS ---")
for row in res.data:
    symbol = row['symbol']
    name = str(row['name'])
    # Search for specific terms
    if any(term in name.lower() for term in search_terms):
        print(f"'{symbol}': '{name}',")

# Also print all stocks to see them all
print("\n--- ALL STOCKS ---")
for row in sorted(res.data, key=lambda x: x['symbol']):
    print(f"'{row['symbol']}': '{row['name']}',")
