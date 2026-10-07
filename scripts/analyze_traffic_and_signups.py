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

def fetch_all(endpoint, max_records=5000):
    results = []
    page_size = 1000
    offset = 0
    while offset < max_records:
        h = dict(headers)
        h['Range'] = f"{offset}-{offset + page_size - 1}"
        r = requests.get(f"{SB_URL}/rest/v1/{endpoint}", headers=h)
        if r.status_code not in [200, 206]:
            break
        data = r.json()
        if not data:
            break
        results.extend(data)
        if len(data) < page_size:
            break
        offset += page_size
    return results

print("Fetching data from Supabase...")

# 1. Auth Users
r_auth = requests.get(f'{SB_URL}/auth/v1/admin/users?per_page=1000', headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'})
auth_users = r_auth.json().get('users', []) if r_auth.status_code == 200 else []

# 2. Activity Events
activity_events = fetch_all("user_activity_events?select=*&order=created_at.desc", max_records=10000)

# 3. Chat Messages & Sessions
chat_sessions = fetch_all("ai_chat_sessions?select=*&order=created_at.desc", max_records=2000)
chat_messages = fetch_all("ai_chat_messages?select=id,session_id,user_id,role,created_at&order=created_at.desc", max_records=5000)

# 4. Portfolios & Positions
positions = fetch_all("positions?select=*")

# 5. Orders & Subscriptions
orders = fetch_all("local_payment_orders?select=*&order=created_at.desc")
subscriptions = fetch_all("subscriptions?select=*&order=created_at.desc")

print(f"\n==========================================")
print(f"📊 EGX BOTS: TRAFFIC & SIGNUPS DEEP DIVE")
print(f"Snapshot Time: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}")
print(f"==========================================\n")

# --- 1. SIGNUPS ANALYSIS ---
signup_by_day = Counter()
signin_by_day = Counter()
signup_dates = []
signin_dates = []

for u in auth_users:
    created = u.get('created_at')
    if created:
        dt = datetime.fromisoformat(created.replace('Z', '+00:00'))
        signup_dates.append(dt)
        signup_by_day[dt.strftime('%Y-%m-%d')] += 1
    
    last_in = u.get('last_sign_in_at')
    if last_in:
        dt_in = datetime.fromisoformat(last_in.replace('Z', '+00:00'))
        signin_dates.append(dt_in)
        signin_by_day[dt_in.strftime('%Y-%m-%d')] += 1

total_users = len(auth_users)
confirmed_users = sum(1 for u in auth_users if u.get('email_confirmed_at'))

# Signups timeline breakdown
d1 = now - timedelta(days=1)
d3 = now - timedelta(days=3)
d7 = now - timedelta(days=7)
d14 = now - timedelta(days=14)
d30 = now - timedelta(days=30)

signups_24h = sum(1 for d in signup_dates if d >= d1)
signups_3d = sum(1 for d in signup_dates if d >= d3)
signups_7d = sum(1 for d in signup_dates if d >= d7)
signups_14d = sum(1 for d in signup_dates if d >= d14)
signups_30d = sum(1 for d in signup_dates if d >= d30)

dau = sum(1 for d in signin_dates if d >= d1)
wau = sum(1 for d in signin_dates if d >= d7)
mau = sum(1 for d in signin_dates if d >= d30)

print(f"--- 1. التسجيل والنمو (SIGNUPS & GROWTH) ---")
print(f"• إجمالي المستخدمين المسجلين: {total_users} مستخدم")
print(f"• الحسابات المؤكدة: {confirmed_users} ({confirmed_users/max(1,total_users)*100:.1f}%)")
print(f"• التسجيلات خلال آخر 24 ساعة: {signups_24h} مستخدم جديد")
print(f"• التسجيلات خلال آخر 3 أيام: {signups_3d} مستخدم جديد ({signups_3d/3:.1f}/يوم)")
print(f"• التسجيلات خلال آخر 7 أيام: {signups_7d} مستخدم جديد ({signups_7d/7:.1f}/يوم)")
print(f"• التسجيلات خلال آخر 14 يوماً: {signups_14d} مستخدم جديد ({signups_14d/14:.1f}/يوم)")
print(f"• التسجيلات خلال آخر 30 يوماً: {signups_30d} مستخدم جديد ({signups_30d/30:.1f}/يوم)")

print(f"\n--- النشاط والتفاعل (RETENTION) ---")
print(f"• النشطون يومياً DAU (آخر 24 ساعة): {dau}")
print(f"• النشطون أسبوعياً WAU (آخر 7 أيام): {wau}")
print(f"• النشطون شهرياً MAU (آخر 30 يوماً): {mau}")
print(f"• نسبة الالتصاق والارتباط Stickiness (DAU/MAU): {dau/max(1,mau)*100:.1f}%")

print(f"\n--- آخر 14 يوماً من التسجيلات اليومية ---")
sorted_days = sorted(list(set(list(signup_by_day.keys()) + [ (now-timedelta(days=i)).strftime('%Y-%m-%d') for i in range(14)])))[-14:]
for day in sorted_days:
    cnt = signup_by_day.get(day, 0)
    bar = "█" * cnt
    print(f"  {day}: {cnt:2d} مسجل {bar}")

# --- 2. TRAFFIC ANALYSIS FROM ACTIVITY EVENTS ---
print(f"\n--- 2. تحليل الترافيك وحركة المرور (TRAFFIC & PAGEVIEWS) ---")
print(f"• إجمالي الأحداث المسجلة (Events Logged): {len(activity_events)}")

event_dates = []
events_by_day = Counter()
events_by_path = Counter()
events_by_name = Counter()
users_active_on_site = Counter()
sessions_by_day = defaultdict(set)

for ev in activity_events:
    c_at = ev.get('created_at')
    if c_at:
        dt = datetime.fromisoformat(c_at.replace('Z', '+00:00'))
        day_str = dt.strftime('%Y-%m-%d')
        event_dates.append(dt)
        events_by_day[day_str] += 1
        
        sess_id = ev.get('session_id')
        if sess_id:
            sessions_by_day[day_str].add(sess_id)
            
    p = ev.get('path') or '/'
    events_by_path[p] += 1
    
    en = ev.get('event_name') or 'unknown'
    events_by_name[en] += 1
    
    u_id = ev.get('user_id')
    if u_id:
        users_active_on_site[u_id] += 1

print(f"\n• توزيع الأحداث حسب النوع:")
for en, count in events_by_name.most_common(5):
    print(f"  - {en}: {count} حدث ({count/max(1,len(activity_events))*100:.1f}%)")

print(f"\n• أكثر الصفحات زيارة (Top Visited Pages):")
for path, count in events_by_path.most_common(10):
    pct = count / max(1, len(activity_events)) * 100
    print(f"  - {path:25s}: {count:4d} زيارة ({pct:5.1f}%)")

print(f"\n• الترافيك اليومي لآخر 14 يوماً (أحداث + جلسات فريدة):")
for day in sorted_days:
    ev_cnt = events_by_day.get(day, 0)
    sess_cnt = len(sessions_by_day.get(day, set()))
    bar = "▒" * (ev_cnt // 5)
    print(f"  {day}: {ev_cnt:3d} حدث | {sess_cnt:2d} جلسات فريدة {bar}")

# --- 3. PRICING & CONVERSION FUNNEL ---
print(f"\n--- 3. مسار التحويل والاشتراكات (CONVERSION FUNNEL) ---")
pricing_views = events_by_path.get('/pricing', 0)
pricing_users = len(set(ev.get('user_id') for ev in activity_events if ev.get('path') == '/pricing' and ev.get('user_id')))

total_orders = len(orders)
order_users = len(set(o.get('user_id') for o in orders if o.get('user_id')))
approved_orders = [o for o in orders if o.get('status') in ['approved', 'completed', 'paid', 'success']]
pending_orders = [o for o in orders if o.get('status') == 'pending']
active_subs = [s for s in subscriptions if s.get('status') == 'active']

print(f"• إجمالي من زاروا صفحة التسعير (/pricing): {pricing_views} زيارة (منهم {pricing_users} مستخدم مسجل)")
print(f"• إجمالي طلبات الدفع المنشأة (Checkout Started): {total_orders} طلب (من {order_users} مستخدم)")
print(f"• الطلبات الناجحة / المعتمدة (Approved Orders): {len(approved_orders)}")
print(f"• الطلبات قيد الانتظار (Pending / Uncompleted): {len(pending_orders)}")
print(f"• الاشتراكات النشطة حالياً (Active Subscriptions): {len(active_subs)}")

# Breakdown of subscriptions by plan
subs_by_plan = Counter(s.get('plan_id') for s in subscriptions)
print(f"• تفاصيل الاشتراكات حسب الخطة:")
for pl, count in subs_by_plan.items():
    print(f"  - {pl}: {count} مشترك")

# --- 4. CHATBOT ACTIVITY & ENGAGEMENT ---
print(f"\n--- 4. ترافيك الشات بوت الذكي (AI CHATBOT) ---")
print(f"• إجمالي جلسات الشات (Chat Sessions): {len(chat_sessions)}")
print(f"• إجمالي الرسائل المتبادلة (Chat Messages): {len(chat_messages)}")
user_messages = [m for m in chat_messages if m.get('role') == 'user']
print(f"• أسئلة واستفسارات المستخدمين (User Queries): {len(user_messages)}")

chat_users_set = set(s.get('user_id') for s in chat_sessions if s.get('user_id'))
print(f"• عدد المستخدمين الذين استخدموا الشات: {len(chat_users_set)} مستخدم ({len(chat_users_set)/max(1,total_users)*100:.1f}% من المسجلين)")

# Chat usage over time
chat_by_day = Counter()
for m in user_messages:
    c_at = m.get('created_at')
    if c_at:
        day_str = datetime.fromisoformat(c_at.replace('Z', '+00:00')).strftime('%Y-%m-%d')
        chat_by_day[day_str] += 1

print(f"\n• أسئلة الشات بوت في آخر 14 يوماً:")
for day in sorted_days:
    cnt = chat_by_day.get(day, 0)
    print(f"  {day}: {cnt:2d} سؤال")

# --- 5. PORTFOLIO ENGAGEMENT ---
print(f"\n--- 5. تفاعل المحافظ الاستثمارية (PORTFOLIO TRACKING) ---")
portfolio_users = len(set(p.get('user_id') for p in positions if p.get('user_id')))
print(f"• عدد المستخدمين الذين سجلوا محفظتهم: {portfolio_users} مستخدم ({portfolio_users/max(1,total_users)*100:.1f}%)")
print(f"• إجمالي الأسهم المضافة بالمحافظ: {len(positions)} مركز استثماري")

print(f"\n==========================================")
print(f"✅ انتهى استخراج وتحليل البيانات")
print(f"==========================================")
