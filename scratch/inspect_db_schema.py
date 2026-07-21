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

def run_query(sql):
    url = f"{SUPABASE_URL}/rest/v1/"
    # We can query RPC/SQL using the API or query the schema.
    # Since direct SQL execution is restricted in basic REST, let's query the PostgREST API docs (OpenAPI spec)
    # which lists all tables and their columns!
    req = urllib.request.Request(
        url,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Accept": "application/openapi+json"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            spec = json.loads(resp.read().decode("utf-8"))
            definitions = spec.get("definitions", {})
            print("Available Tables & Columns:")
            for table, info in definitions.items():
                properties = info.get("properties", {}).keys()
                print(f"- {table}: {list(properties)}")
    except Exception as e:
        print("Error getting OpenAPI schema:", e)

if __name__ == "__main__":
    run_query("")
