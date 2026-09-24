import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests, json
from dotenv import dotenv_values
from datetime import datetime, timezone

v = dotenv_values('.env')
SB_URL = v.get('SUPABASE_URL','https://gfcmaxbtscmizsakarvc.supabase.co')
SB_KEY = v.get('SUPABASE_SERVICE_ROLE_KEY','')
headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Prefer': 'count=exact'}

# 1. Fetch sample profile to see schema
r = requests.get(f'{SB_URL}/rest/v1/profiles?limit=5', headers=headers)
print("Profiles schema / sample:", json.dumps(r.json()[:2], ensure_ascii=False, indent=2) if r.status_code==200 and r.json() else r.status_code)

# 2. Fetch all profiles
r_all_profiles = requests.get(f'{SB_URL}/rest/v1/profiles?select=*', headers=headers)
profiles = r_all_profiles.json() if r_all_profiles.status_code == 200 else []
print(f"Total profiles: {len(profiles)}")

# 3. Check auth users
r_auth = requests.get(f'{SB_URL}/auth/v1/admin/users?per_page=1000', headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'})
auth_data = r_auth.json() if r_auth.status_code == 200 else {}
auth_users = auth_data.get('users', []) if isinstance(auth_data, dict) else []
print(f"Total auth users: {len(auth_users)}")

# 4. Check ai_chat_sessions
r_sess = requests.get(f'{SB_URL}/rest/v1/ai_chat_sessions?select=*', headers=headers)
sessions = r_sess.json() if r_sess.status_code == 200 else []
print(f"Total AI chat sessions: {len(sessions)}")

# 5. Check ai_chat_messages count
r_msg = requests.get(f'{SB_URL}/rest/v1/ai_chat_messages?select=id', headers=headers)
print(f"Total AI chat messages count-range: {r_msg.headers.get('content-range')}")

# 6. Check other tables in Supabase (e.g. portfolio, watchlist, user_activity, telegram)
# Let's inspect OpenAPI definition or list known tables
r_openapi = requests.get(f'{SB_URL}/rest/v1/?apikey={SB_KEY}')
if r_openapi.status_code == 200:
    definitions = r_openapi.json().get('definitions', {})
    print("All Supabase tables found:", list(definitions.keys()))
