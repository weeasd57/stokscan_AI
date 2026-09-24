import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests, time, json
from dotenv import dotenv_values

v = dotenv_values('.env')
SB_URL = v.get('SUPABASE_URL', 'https://gfcmaxbtscmizsakarvc.supabase.co')
SB_KEY = v.get('SUPABASE_SERVICE_ROLE_KEY', '')
headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Content-Type': 'application/json'}
svc = f'{SB_URL}/rest/v1'

TOKEN = (v.get('SUPPORT_BOT_TOKEN') or '').strip()
CHAT_ID = (v.get('TELEGRAM_PRO_CHAT_ID') or '').strip()
RELAY = (v.get('TELEGRAM_RELAY_URL') or 'https://api.telegram.org').rstrip('/')

print('=== FULL SUBSCRIPTION ROWS ===')
r = requests.get(f'{svc}/subscriptions?select=user_id,plan_id,status,provider,current_period_end,created_at,updated_at&order=created_at.desc', headers=headers)
rows = r.json() if r.status_code == 200 else []
for s in rows:
    print(f"  uid={s.get('user_id')} plan={s.get('plan_id')} status={s.get('status')} provider={s.get('provider')} end={str(s.get('current_period_end'))[:10]}")

TEST_PREFIXES = ('f3592b1c', 'ba9c27e8')
now_iso = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())

for s in rows:
    uid = str(s.get('user_id'))
    if s.get('status') != 'active':
        continue
    if not uid.startswith(TEST_PREFIXES):
        print(f"  (keep active) uid={uid[:10]}")
        continue
    payload = {
        'status': 'cancelled',
        'current_period_end': s.get('current_period_start') or now_iso,
        'updated_at': now_iso,
    }
    rr = requests.patch(
        f'{svc}/subscriptions?user_id=eq.{uid}&plan_id=eq.{s.get("plan_id")}',
        headers=headers, json=payload
    )
    print(f"  CANCEL uid={uid[:10]} plan={s.get('plan_id')} -> patch {rr.status_code} {rr.text[:200]}")

# Verify
print()
print('=== VERIFY: remaining active subscriptions ===')
r2 = requests.get(f'{svc}/subscriptions?select=user_id,plan_id,status&status=eq.active&order=created_at.desc', headers=headers)
active = r2.json() if r2.status_code == 200 else []
print(f'Active count: {len(active)}')
for a in active:
    print(f"  ACTIVE uid={a.get('user_id')} plan={a.get('plan_id')}")

# Verify remaining orders
print()
print('=== VERIFY: remaining local_payment_orders ===')
r3 = requests.get(f'{svc}/local_payment_orders?select=id,user_id,amount_egp,status', headers=headers)
orders = r3.json() if r3.status_code == 200 else []
print(f'Remaining orders: {len(orders)}')
for o in orders:
    print(f"  KEPT uid={str(o.get('user_id'))[:12]} amount={o.get('amount_egp')} status={o.get('status')} id={o.get('id')}")