import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests
from dotenv import dotenv_values

v = dotenv_values('.env')
SB_URL = v.get('SUPABASE_URL', 'https://gfcmaxbtscmizsakarvc.supabase.co')
SB_KEY = v.get('SUPABASE_SERVICE_ROLE_KEY', '')
headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}',
           'Content-Type': 'application/json',
           'Prefer': 'return=representation'}
svc = f'{SB_URL}/rest/v1'

# Force the failing write with a full payload to expose the exact CHECK constraint name
uid = 'f3592b1c-ebe1-4fed-ba36-b92a58568df8'
rr = requests.patch(
    f'{svc}/subscriptions?user_id=eq.{uid}&plan_id=eq.pro',
    headers=headers,
    json={'status': 'cancelled'},
)
print('PATCH full response:')
print(rr.status_code)
print(rr.text)
print()

# Try inserting a cancelled row into a NEW plan to see constraints
# Actually we can't create new plans. Instead, let's query the table's
# column schema via PostgREST OpenAPI if exposed
try:
    openapi = requests.get(f'{SB_URL}/rest/v1/', headers={'apikey': SB_KEY}).json()
    subs_schema = None
    for path, meta in openapi.get('paths', {}).items():
        if 'subscriptions' in path and not any(x in path for x in ['bot', 'plan', 'pricing']):
            subs_schema = meta.get('get', {}).get('responses', {}).get('200', {}).get('content', {}).get('application/json', {}).get('schema', {})
            break
    if subs_schema:
        print('SUBSCRIPTIONS OPENAPI SCHEMA:')
        import json
        print(json.dumps(subs_schema, indent=2)[:3000])
    else:
        print('No subscriptions schema found in OpenAPI')
except Exception as e:
    print('OpenAPI error:', e)