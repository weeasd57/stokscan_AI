import os
import json
import asyncio
from supabase import create_client

def load_env():
    with open('web/.env.local') as f:
        for line in f:
            if '=' in line:
                k, v = line.strip().split('=', 1)
                os.environ[k] = v

load_env()
s = create_client(os.environ['NEXT_PUBLIC_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
res = s.table('stock_prices').select('date,close').eq('symbol', 'ABUK').order('date', desc=True).limit(5).execute()
print("ABUK", res.data)
res2 = s.table('stock_prices').select('date,close').eq('symbol', 'COMI').order('date', desc=True).limit(5).execute()
print("COMI", res2.data)
