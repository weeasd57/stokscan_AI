import os, sys
sys.path.insert(0, r"C:\Users\MR__CODER__\Desktop\stokscan_AI")

from dotenv import load_dotenv
load_dotenv(r"C:\Users\MR__CODER__\Desktop\stokscan_AI\.env")

from supabase import create_client
import pandas as pd

url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
sb = create_client(url, key)

print("Fetching all stock_prices where volume == 0 (paginated)...")
all_rows = []
offset = 0
page_size = 1000

while True:
    res = sb.table("stock_prices").select("symbol, exchange, date, close, volume").eq("volume", 0).range(offset, offset + page_size - 1).execute()
    if not res.data:
        break
    all_rows.extend(res.data)
    if len(res.data) < page_size:
        break
    offset += page_size

print(f"Total rows with volume == 0: {len(all_rows)}")
df = pd.DataFrame(all_rows)

if not df.empty:
    # Filter out index exchange 'INDX'
    df_stocks = df[df['exchange'] != 'INDX']
    print(f"Total stock rows with volume == 0 (excluding INDX): {len(df_stocks)}")
    
    if not df_stocks.empty:
        print("\nSummary of stocks with volume == 0:")
        summary = df_stocks.groupby(['symbol', 'exchange']).size().reset_index(name='count')
        print(summary)
        
        # Let's delete them!
        print("\nDeleting zero volume rows for non-index stocks...")
        for _, row in summary.iterrows():
            sym = row['symbol']
            exch = row['exchange']
            del_res = sb.table("stock_prices").delete().eq("symbol", sym).eq("exchange", exch).eq("volume", 0).execute()
            print(f"Deleted {len(del_res.data)} rows for {sym}.{exch}")
    else:
        print("No zero volume rows for non-index stocks found.")
else:
    print("No zero volume rows found at all.")
