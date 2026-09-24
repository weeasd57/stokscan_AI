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

print('=== Cancel test Pro subscriptions (official way: status + updated_at only) ===')
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
        json={'status': 'cancelled', 'updated_at': now_iso},
    )
    print(f"  CANCEL uid={uid[:12]} plan={s.get('plan_id')} -> {rr.status_code} {rr.text[:300]}")

print()
print('=== VERIFY ACTIVE ===')
r2 = requests.get(f'{svc}/subscriptions?select=user_id,plan_id,status&status=eq.active&order=created_at.desc', headers=headers)
active = r2.json() if r2.status_code == 200 else []
print(f'Active subscriptions: {len(active)}')
for a in active:
    print(f"  ACTIVE uid={a.get('user_id')} plan={a.get('plan_id')}")

print()
print('=== VERIFY ALL SUBS ===')
r3 = requests.get(f'{svc}/subscriptions?select=user_id,plan_id,status&order=created_at.desc', headers=headers)
allsubs = r3.json() if r3.status_code == 200 else []
for s in allsubs:
    print(f"  uid={str(s.get('user_id'))[:12]} plan={s.get('plan_id')} status={s.get('status')}")

# Clear pro_telegram_invites rows fully for the two test users (stored links already blanked)
print()
print('=== CLEAR PRO TELEGRAM INVITES for test users ===')
r4 = requests.get(f'{svc}/pro_telegram_invites?select=user_id,invite_link', headers=headers)
invites = r4.json() if r4.status_code == 200 else []
for inv in invites:
    uid = str(inv.get('user_id'))
    if uid.startswith('f3592b1c') or uid.startswith('ba9c27e8'):
        # revoke invite link via official Telegram API (direct, show error)
        link = inv.get('invite_link') or ''
        if link:
            TOKEN = (v.get('SUPPORT_BOT_TOKEN') or '').strip()
            CHAT_ID = (v.get('TELEGRAM_PRO_CHAT_ID') or '').strip()
            try:
                rr = requests.post(f'https://api.telegram.org/bot{TOKEN}/revokeChatInviteLink', json={'chat_id': CHAT_ID, 'invite_link': link}, timeout=10)
                print(f"  revoke link direct for {uid[:12]}: {rr.status_code} {rr.text[:200]}")
            except Exception as e:
                print(f"  revoke link direct failed for {uid[:12]}: {e}")
        # wipe the row so no usable invite remains
        res = requests.delete(f'{svc}/pro_telegram_invites?user_id=eq.{uid}', headers=headers)
        print(f"  DELETE invite row for {uid[:12]}: {res.status_code}")