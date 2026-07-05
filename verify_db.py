from api.stock_ai import _init_supabase, supabase
_init_supabase()
res = supabase.table('market_cache').select('payload').eq('cache_key', 'market_status_Egypt').maybe_single().execute()
payload = res.data.get('payload', {}) if res.data else {}
print(f'USDEGP payload size: {len(payload.get("usdegp", []))}')
print(f'EGX30 payload size: {len(payload.get("egx30", []))}')
