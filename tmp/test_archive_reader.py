import os, sys
sys.path.append('C:/Users/MR__CODER__/Desktop/stokscan_AI')
from api.stock_ai import _init_supabase, supabase
from api.archive_reader import fetch_archived_stock_prices

# Initialize Supabase client
_init_supabase()
if not supabase:
    print('Supabase not initialized')
    sys.exit(1)

symbol = 'EGX30'  # example symbol archived
df = fetch_archived_stock_prices(supabase, symbol)
if df is None:
    print(f'No archived data for {symbol}')
else:
    print(f'Archived rows for {symbol}: {len(df)}')
    print(df.head())
