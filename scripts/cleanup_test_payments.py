import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests, json, time
from dotenv import dotenv_values

v = dotenv_values('.env')
SB_URL = v.get('SUPABASE_URL', 'https://gfcmaxbtscmizsakarvc.supabase.co')
SB_KEY = v.get('SUPABASE_SERVICE_ROLE_KEY', '')
headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Content-Type': 'application/json'}
svc = f'{SB_URL}/rest/v1'

TOKEN = (v.get('SUPPORT_BOT_TOKEN') or '').strip()
CHAT_ID = (v.get('TELEGRAM_PRO_CHAT_ID') or '').strip()
RELAY = (v.get('TELEGRAM_RELAY_URL') or 'https://api.telegram.org').rstrip('/')

def tg_call(method, payload):
    if not TOKEN or not CHAT_ID:
        print('  !! no bot env, skipping telegram call')
        return False
    for base in [RELAY, 'https://api.telegram.org']:
        try:
            r = requests.post(f'{base}/bot{TOKEN}/{method}', json=payload, timeout=10)
            data = r.json()
            if r.ok and data.get('ok'):
                return True
        except Exception:
            pass
    return False

def delete_rows(table, **filters):
    params = []
    for k, val in filters.items():
        params.append(f'{k}=eq.{val}')
    q = '&'.join(params)
    r = requests.delete(f'{svc}/{table}?{q}', headers=headers)
    if r.status_code < 300:
        return r.headers.get('content-range', 'ok')
    return f'ERR {r.status_code}: {r.text[:250]}'

KEEP_USER = '2974d0db-7'  # the real 200 EGP subscriber

print('=== STEP 1: Delete test local_payment_orders, keep real 200 EGP order ===')
# Fetch all orders to identify test ones
r = requests.get(f'{svc}/local_payment_orders?select=*&order=created_at.desc', headers=headers)
orders = r.json() if r.status_code == 200 else []
print(f'Found {len(orders)} orders total')

for o in orders:
    uid = str(o.get('user_id'))
    is_real = (o.get('amount_egp') == 200 and o.get('status') == 'approved' and str(o.get('user_id'))[:10] == KEEP_USER)
    if is_real:
        print(f"  KEEP: id={o['id'][:8]} uid={str(o['user_id'])[:10]} amount={o.get('amount_egp')} status={o.get('status')} (real subscriber)")
        continue
    res = delete_rows('local_payment_orders', id=o['id'])
    print(f"  DEL: id={o['id'][:8]} uid={str(o['user_id'])[:10]} amount={o.get('amount_egp')} status={o.get('status')} -> {res}")

print()
print('=== STEP 2: Delete kashier test payments ===')
r = requests.get(f'{svc}/kashier_payments?select=*', headers=headers)
kpay = r.json() if r.status_code == 200 else []
print(f'Found {len(kpay)} kashier payments')
for k in kpay:
    res = delete_rows('kashier_payments', id=k['id'])
    print(f"  DEL: id={k['id'][:8]} uid={str(k.get('user_id'))[:10]} amount={k.get('amount_paid')} status={k.get('status')} -> {res}")

print()
print('=== STEP 3: Cancel subscriptions for test Pro users (f3592b1c, ba9c27e8) ===')
TEST_USERS = ['f3592b1c-e', 'ba9c27e8-f']
for prefix in TEST_USERS:
    r = requests.get(f'{svc}/subscriptions?select=user_id,plan_id,status&user_id=ilike.{prefix}%', headers=headers)
    subs = r.json() if r.status_code == 200 else []
    for s in subs:
        payload = {'status': 'cancelled', 'current_period_end': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()), 'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())}
        rr = requests.patch(f'{svc}/subscriptions?user_id=eq.{s["user_id"]}&plan_id=eq.{s["plan_id"]}&status=eq.active', headers=headers, json=payload)
        print(f"  uid={str(s['user_id'])[:10]} plan={s['plan_id']} status={s['status']} -> patch {rr.status_code}")

print()
print('=== STEP 4: Revoke telegram invite links for test Pro users ===')
invites = requests.get(f'{svc}/pro_telegram_invites?select=*', headers=headers).json()
for inv in invites:
    uid = str(inv.get('user_id'))
    is_test = uid.startswith('f3592b1c') or uid.startswith('ba9c27e8')
    if not is_test:
        continue
    invite_link = inv.get('invite_link') or ''
    tg_uid = inv.get('vip_telegram_user_id')
    print(f"  uid={uid[:10]} link={'set' if invite_link else 'none'} tg_user={tg_uid}")
    if invite_link:
        ok1 = tg_call('revokeChatInviteLink', {'chat_id': CHAT_ID, 'invite_link': invite_link})
        print(f"    revokeChatInviteLink: {ok1}")
    if tg_uid:
        until = int(time.time()) + 60
        ok2 = tg_call('banChatMember', {'chat_id': CHAT_ID, 'user_id': int(tg_uid), 'until_date': until})
        print(f"    banChatMember: {ok2}")
    # clear stored invite in DB
    patch = {'invite_link': '', 'invite_expires_at': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()), 'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())}
    rr = requests.patch(f'{svc}/pro_telegram_invites?user_id=eq.{uid}', headers=headers, json=patch)
    print(f"    clear DB invite: {rr.status_code}")

# Also clear telegram_invite_link on any local_payment_orders we kept
print()
print('=== STEP 5: Also disable bot subscriptions for test users? NO - keep user data ===')
# Clear telegram_chat_id only if the user wants telegram access fully stopped.
# The admin cancel path (route.ts) does NOT clear profile.telegram_chat_id; it revokes invite + bans member.
# We match that behavior: revocation of invites above is sufficient for access.
print('Done. Telegram access revocation matches admin cancel_subscription behavior (revoke invite + ban member).')