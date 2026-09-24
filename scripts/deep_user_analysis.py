import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests, json
from dotenv import dotenv_values
from collections import Counter, defaultdict

v = dotenv_values('.env')
SB_URL = v.get('SUPABASE_URL','https://gfcmaxbtscmizsakarvc.supabase.co')
SB_KEY = v.get('SUPABASE_SERVICE_ROLE_KEY','')
headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'}

# Orders
r = requests.get(f'{SB_URL}/rest/v1/local_payment_orders?select=*&order=created_at.desc', headers=headers)
orders = r.json() if r.status_code == 200 else []

print(f"=== LOCAL PAYMENT ORDERS ({len(orders)}) ===")
statuses = Counter(o.get('status') for o in orders)
print("Statuses:", dict(statuses))

approved_orders = [o for o in orders if o.get('status') in ['approved', 'completed', 'active']]
print(f"Approved / Paid orders count: {len(approved_orders)}")
total_approved_revenue = sum(float(o.get('amount_egp') or 0) for o in approved_orders)
print(f"Total Approved Revenue: {total_approved_revenue} EGP")

print("\nRecent Orders:")
for o in orders[:15]:
    uid = str(o.get('user_id', ''))[:8]
    amt = o.get('amount_egp')
    st = o.get('status')
    dt = str(o.get('created_at', ''))[:16]
    note = o.get('customer_note') or 'None'
    print(f"  [{dt}] User:{uid} | {amt} EGP | Status: {st} | Note: {note}")

# Subscriptions
r_sub = requests.get(f'{SB_URL}/rest/v1/subscriptions?select=*', headers=headers)
subs = r_sub.json() if r_sub.status_code == 200 else []
print(f"\n=== ACTIVE SUBSCRIPTIONS ({len(subs)}) ===")
for s in subs:
    uid = str(s.get('user_id', ''))[:8]
    plan = s.get('plan_id')
    st = s.get('status')
    end = str(s.get('current_period_end', ''))[:10]
    prov = s.get('provider')
    print(f"  User: {uid} | Plan: {plan} | Status: {st} | Expires: {end} | Provider: {prov}")

# AI Chat Messages Stats
r_msg_sample = requests.get(f'{SB_URL}/rest/v1/ai_chat_messages?select=role,created_at&limit=1000', headers=headers)
msgs = r_msg_sample.json() if r_msg_sample.status_code == 200 else []
role_counts = Counter(m.get('role') for m in msgs)
print(f"\n=== CHAT MESSAGES SAMPLE (1000) ===")
print("Roles:", dict(role_counts))

# Positions breakdown by portfolio size
r_pos = requests.get(f'{SB_URL}/rest/v1/positions?select=*', headers=headers)
positions = r_pos.json() if r_pos.status_code == 200 else []
user_pos_count = Counter(p.get('user_id') for p in positions)
print(f"\n=== PORTFOLIO DISTRIBUTION ===")
print(f"Total positions: {len(positions)} across {len(user_pos_count)} users")
print(f"Average positions per portfolio user: {len(positions)/max(1, len(user_pos_count)):.1f}")
print("Positions per user distribution:")
dist = Counter(c for c in user_pos_count.values())
for count_val, users_num in sorted(dist.items()):
    print(f"  {users_num} users hold {count_val} stocks")

# Let's inspect user_settings
r_set = requests.get(f'{SB_URL}/rest/v1/user_settings?select=*&limit=100', headers=headers)
settings = r_set.json() if r_set.status_code == 200 else []
print(f"\n=== USER SETTINGS SAMPLE ({len(settings)}) ===")
if settings:
    print("Sample keys in settings:", list(settings[0].keys()))
    langs = Counter(s.get('language') or s.get('locale') or 'unknown' for s in settings)
    print("Languages:", dict(langs))
