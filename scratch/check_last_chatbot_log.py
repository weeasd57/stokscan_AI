import os
import json
import urllib.request
import sys
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
load_dotenv("web/.env.local")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "https://gfcmaxbtscmizsakarvc.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

headers = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
}

def get_latest_logs():
    url = f"{SUPABASE_URL}/rest/v1/ai_chatbot_logs?select=*&order=created_at.desc&limit=3"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print("Latest Chatbot Logs:")
            for log in data:
                print(f"Time: {log.get('created_at')}")
                print(f"User Name: {log.get('user_name')}")
                print(f"Message: {log.get('message')}")
                print(f"Reply: {log.get('reply')}")
                print("-" * 80)
    except Exception as e:
        print("Error querying logs:", e)
        if hasattr(e, "read"):
            print("Details:", e.read().decode("utf-8"))

if __name__ == "__main__":
    get_latest_logs()
