import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests, time
from dotenv import dotenv_values

v = dotenv_values('.env')
SB_URL = v.get('SUPABASE_URL', 'https://gfcmaxbtscmizsakarvc.supabase.co')
SB_KEY = v.get('SUPABASE_SERVICE_ROLE_KEY', '')
headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Content-Type': 'application/json'}
svc = f'{SB_URL}/rest/v1'

now_iso = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())

print('=== CANCEL TEST PRO SUBS (correct spelling: canceled) ===')
r = requests.get(f'{svc}/subscriptions?select=user_id,plan_id,status&status=eq.active&order=created_at.desc', headers=headers)
subs = r.json() if r.status_code == 200 else []
for s in subs:
    uid = str(s.get('user_id'))
    if not (uid.startswith('f3592b1c') or uid.startswith('ba9c27e8')):
        print(f"  KEEP ACTIVE uid={uid[:12]} plan={s.get('plan_id')}")
        continue
    rr = requests.patch(
        f'{svc}/subscriptions?user_id=eq.{uid}&plan_id=eq.{s.get("plan_id")}',
        headers=headers,
        json={'status': 'canceled', 'updated_at': now_iso},
    )
    print(f"  CANCEL uid={uid[:12]} plan={s.get('plan_id')} -> {rr.status_code}")

print()
print('=== VERIFY ACTIVE SUBS ===')
r2 = requests.get(f'{svc}/subscriptions?select=user_id,plan_id,status&status=eq.active&order=created_at.desc', headers=headers)
active = r2.json() if r2.status_code == 200 else []
print(f'Active subscriptions: {len(active)}')
for a in active:
    print(f"  ACTIVE uid={a.get('user_id')} plan={a.get('plan_id')}")

print()
print('=== VERIFY ALL SUBS ===')
r3 = requests.get(f'{svc}/subscriptions?select=user_id,plan_id,status&order=created_at.desc', headers=headers)
for s in r3.json():
    print(f"  uid={str(s.get('user_id'))[:12]} plan={s.get('plan_id')} status={s.get('status')}")