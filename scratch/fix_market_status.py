"""
Quick fix: populate market_status_Egypt in market_cache directly from stock_prices data.
"""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.stock_ai import _init_supabase, supabase
_init_supabase()

from_date = '2026-01-01'

# Fetch EGX30 from Supabase
res = supabase.table('stock_prices').select('date,open,high,low,close,volume').eq('symbol','EGX30').eq('exchange','INDX').gte('date', from_date).order('date', desc=False).execute()
egx30_data = [
    {'date': r['date'], 'open': float(r.get('open', 0) or 0), 'high': float(r.get('high', 0) or 0),
     'low': float(r.get('low', 0) or 0), 'close': float(r.get('close', 0) or 0), 'volume': int(r.get('volume', 0) or 0)}
    for r in (res.data or [])
]

# Fetch EGX100 from Supabase
res2 = supabase.table('stock_prices').select('date,open,high,low,close,volume').eq('symbol','EGX100').eq('exchange','INDX').gte('date', from_date).order('date', desc=False).execute()
egx100_data = [
    {'date': r['date'], 'open': float(r.get('open', 0) or 0), 'high': float(r.get('high', 0) or 0),
     'low': float(r.get('low', 0) or 0), 'close': float(r.get('close', 0) or 0), 'volume': int(r.get('volume', 0) or 0)}
    for r in (res2.data or [])
]

latest_egx30 = egx30_data[-1]['date'] if egx30_data else None
latest_egx100 = egx100_data[-1]['date'] if egx100_data else None
print(f'EGX30: {len(egx30_data)} rows, latest={latest_egx30}')
print(f'EGX100: {len(egx100_data)} rows, latest={latest_egx100}')

# Calculate regime from last 2 EGX30 closes
regime = 'sideways'
egx30_return = 0.0
reject_buys = False
if egx30_data and len(egx30_data) >= 2:
    close_today = float(egx30_data[-1]['close'])
    close_prev  = float(egx30_data[-2]['close'])
    egx30_return = (close_today - close_prev) / close_prev if close_prev else 0.0
    if egx30_return > 0.02:
        regime = 'bull'
    elif egx30_return < -0.05:
        regime = 'panic'
        reject_buys = True
    elif -0.02 <= egx30_return <= 0.02:
        regime = 'sideways'
    else:
        regime = 'bear'
    print(f'Regime: {regime}, EGX30 return: {egx30_return:.4f}')

# Use EGX30 as fallback for EGX100 if empty
if not egx100_data:
    egx100_data = egx30_data

payload = {
    'egx30': egx30_data,
    'egx100': egx100_data,
    'usdegp': [],
    'regime': regime,
    'egx30_return': egx30_return,
    'reject_buys': reject_buys,
    'updated_at': dt.datetime.utcnow().isoformat() + 'Z',
    'source': 'supabase_direct'
}

# Upsert to market_cache
result = supabase.table('market_cache').upsert({
    'cache_key': 'market_status_Egypt',
    'country': 'Egypt',
    'payload': payload,
    'computed_at': dt.datetime.now(dt.timezone.utc).isoformat()
}).execute()

print('SUCCESS: market_status_Egypt upserted to market_cache!')
print(f'Regime={regime}, EGX30={len(egx30_data)} rows, EGX100={len(egx100_data)} rows')
print(f'Result: {result}')
