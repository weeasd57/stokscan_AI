import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests
from dotenv import dotenv_values

v = dotenv_values('.env')
SB_URL = v.get('SUPABASE_URL', 'https://gfcmaxbtscmizsakarvc.supabase.co')
SB_KEY = v.get('SUPABASE_SERVICE_ROLE_KEY', '')
headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Content-Type': 'application/json'}
svc = f'{SB_URL}/rest/v1'

uid = 'f3592b1c-ebe1-4fed-ba36-b92a58568df8'
candidates = ['expired', 'trialing', 'inactive', 'canceled', 'paused', 'ended']

for status in candidates:
    rr = requests.patch(
        f'{svc}/subscriptions?user_id=eq.{uid}&plan_id=eq.pro',
        headers=headers,
        json={'status': status},
    )
    if rr.status_code < 300:
        print(f"  OK status='{status}' -> {rr.status_code}")
        # revert this test row back to active so we don't leave junk
        requests.patch(
            f'{svc}/subscriptions?user_id=eq.{uid}&plan_id=eq.pro',
            headers=headers,
            json={'status': 'active'},
        )
        print(f"     reverted to active")
    else:
        msg = rr.json().get('message', '') if rr.headers.get('content-type', '').startswith('application/json') else rr.text
        print(f"  FAIL status='{status}' -> {msg[:120]}")