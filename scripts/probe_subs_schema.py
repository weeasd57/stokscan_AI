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

# Read-only table info via PostgREST options isn't available, so query the
# exact failing error instead. We'll hit the constraint by checking available
# columns first.
r = requests.options(f'{svc}/subscriptions', headers=headers)
print('OPTIONS status:', r.status_code)
print(r.text[:1500])