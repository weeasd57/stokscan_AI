import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests, json
from dotenv import dotenv_values
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict
v = dotenv_values('.env')
SB_URL = v.get('SUPABASE_URL','https://gfcmaxbtscmizsakarvc.supabase.co')
SB_KEY = v.get('SUPABASE_SERVICE_ROLE_KEY','')
headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Prefer': 'count=exact'}

now = datetime.now(timezone.utc)

# 1. Fetch Auth Users (up to 1000)
r_auth = requests.get(f'{SB_URL}/auth/v1/admin/users?per_page=1000', headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'})
auth_users = r_auth.json().get('users', []) if r_auth.status_code == 200 else []

# 2. Fetch Profiles
r_prof = requests.get(f'{SB_URL}/rest/v1/profiles?select=*', headers=headers)
profiles = r_prof.json() if r_prof.status_code == 200 else []

# 3. Fetch Positions (portfolio)
r_pos = requests.get(f'{SB_URL}/rest/v1/positions?select=*', headers=headers)
positions = r_pos.json() if r_pos.status_code in [200, 206] else []

# 4. Fetch Payments / Orders
r_kashier = requests.get(f'{SB_URL}/rest/v1/kashier_payments?select=*', headers=headers)
kashier = r_kashier.json() if r_kashier.status_code in [200, 206] else []
r_local = requests.get(f'{SB_URL}/rest/v1/local_payment_orders?select=*', headers=headers)
local_orders = r_local.json() if r_local.status_code in [200, 206] else []
r_subs = requests.get(f'{SB_URL}/rest/v1/subscriptions?select=*', headers=headers)
subs = r_subs.json() if r_subs.status_code in [200, 206] else []
r_pro_inv = requests.get(f'{SB_URL}/rest/v1/pro_telegram_invites?select=*', headers=headers)
pro_invites = r_pro_inv.json() if r_pro_inv.status_code in [200, 206] else []

# 5. Fetch Chat sessions
r_sess = requests.get(f'{SB_URL}/rest/v1/ai_chat_sessions?select=*', headers=headers)
sessions = r_sess.json() if r_sess.status_code in [200, 206] else []

# 6. Fetch User activity events (limit 1000)
r_act = requests.get(f'{SB_URL}/rest/v1/user_activity_events?select=*&order=created_at.desc&limit=1000', headers=headers)
activity = r_act.json() if r_act.status_code in [200, 206] else []

print("=== USER ANALYSIS RAW METRICS ===")
print(f"Auth Users: {len(auth_users)}")
print(f"Profiles: {len(profiles)}")
print(f"Positions in portfolios: {len(positions)}")
print(f"Kashier Payments: {len(kashier)}")
print(f"Local Orders: {len(local_orders)}")
print(f"Subscriptions: {len(subs)}")
print(f"Pro Telegram Invites: {len(pro_invites)}")
print(f"Chat Sessions: {len(sessions)}")
print(f"Activity Events: {len(activity)}")

# Analysis:
# A. Signup timeline (by day / week / month)
signup_dates = []
last_sign_ins = []
domains = []
confirmed_count = 0

for u in auth_users:
    created = u.get('created_at')
    if created:
        dt = datetime.fromisoformat(created.replace('Z', '+00:00'))
        signup_dates.append(dt)
    last_in = u.get('last_sign_in_at')
    if last_in:
        dt_in = datetime.fromisoformat(last_in.replace('Z', '+00:00'))
        last_sign_ins.append(dt_in)
    email = u.get('email', '')
    if '@' in email:
        domain = email.split('@')[1].lower()
        domains.append(domain)
    if u.get('email_confirmed_at'):
        confirmed_count += 1

print("\n--- REGISTRATION & CONFIRMATION ---")
print(f"Total Users: {len(auth_users)}")
print(f"Email Confirmed: {confirmed_count} ({confirmed_count/max(1,len(auth_users))*100:.1f}%)")

# Signup growth by last 7 days, 14 days, 30 days
d7 = now - timedelta(days=7)
d14 = now - timedelta(days=14)
d30 = now - timedelta(days=30)

signups_7d = sum(1 for d in signup_dates if d >= d7)
signups_14d = sum(1 for d in signup_dates if d >= d14)
signups_30d = sum(1 for d in signup_dates if d >= d30)

print(f"Signups Last 7 Days: {signups_7d} ({signups_7d/7:.1f}/day)")
print(f"Signups Last 14 Days: {signups_14d} ({signups_14d/14:.1f}/day)")
print(f"Signups Last 30 Days: {signups_30d} ({signups_30d/30:.1f}/day)")

# Activity / Retention (DAU, WAU, MAU)
dau = sum(1 for d in last_sign_ins if d >= (now - timedelta(days=1)))
wau = sum(1 for d in last_sign_ins if d >= d7)
mau = sum(1 for d in last_sign_ins if d >= d30)

print("\n--- ACTIVE USERS (RETENTION) ---")
print(f"DAU (Last 24h): {dau}")
print(f"WAU (Last 7d): {wau}")
print(f"MAU (Last 30d): {mau}")
print(f"Stickiness (DAU/MAU): {dau/max(1,mau)*100:.1f}%")

# Domains
print("\n--- TOP EMAIL DOMAINS ---")
domain_counts = Counter(domains).most_common(10)
for dom, cnt in domain_counts:
    print(f"  {dom}: {cnt} ({cnt/len(domains)*100:.1f}%)")

# Portfolios & Positions Analysis
user_positions = defaultdict(list)
for p in positions:
    uid = p.get('user_id')
    user_positions[uid].append(p)

symbols_held = Counter(p.get('symbol') for p in positions if p.get('symbol'))
print(f"\n--- PORTFOLIO USAGE ---")
print(f"Users with registered portfolios: {len(user_positions)} ({len(user_positions)/max(1,len(auth_users))*100:.1f}%)")
print(f"Total stock positions held: {len(positions)}")
print("Top 10 most held stocks in user portfolios:")
for sym, cnt in symbols_held.most_common(10):
    print(f"  {sym}: {cnt} users/positions")

# Chat Sessions Analysis
chat_users = set(s.get('user_id') for s in sessions if s.get('user_id'))
print(f"\n--- AI CHATBOT ENGAGEMENT ---")
print(f"Users who initiated AI chat: {len(chat_users)} ({len(chat_users)/max(1,len(auth_users))*100:.1f}%)")
print(f"Total AI chat sessions: {len(sessions)}")
user_session_counts = Counter(s.get('user_id') for s in sessions if s.get('user_id'))
print("Top chat users (session count):", user_session_counts.most_common(5))

# Subscriptions / Payments
print(f"\n--- MONETIZATION & PAYMENTS ---")
print(f"Total Subscriptions records: {len(subs)}")
if subs:
    print("Sample subs:", json.dumps(subs[:2], default=str))
print(f"Kashier Payments: {len(kashier)}")
if kashier:
    print("Sample kashier:", json.dumps(kashier[:2], default=str))
print(f"Local Orders: {len(local_orders)}")
if local_orders:
    print("Sample local orders:", json.dumps(local_orders[:2], default=str))
print(f"Pro Telegram Invites: {len(pro_invites)}")
if pro_invites:
    print("Sample invites:", json.dumps(pro_invites[:2], default=str))

# User Activity Events Analysis
if activity:
    event_types = Counter(e.get('event_type') or e.get('action') or e.get('name') for e in activity)
    print(f"\n--- ACTIVITY EVENTS (Sample 1000) ---")
    for ev, c in event_types.most_common(10):
        print(f"  {ev}: {c}")
