import os
from supabase import create_client
import dotenv

dotenv.load_dotenv('.env')

supabase = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

sql = """
ALTER TABLE public.ai_chatbot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chatbot_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chatbot_limits ENABLE ROW LEVEL SECURITY;
"""

try:
    res = supabase.rpc('execute_sql', {'query': sql}).execute()
    print("RLS Enabled:", res.data)
except Exception as e:
    print("Error:", e)
