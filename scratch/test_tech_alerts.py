import os
import sys
import time

sys.path.append(os.path.abspath('.'))

from dotenv import load_dotenv
load_dotenv()

from api.stock_ai import _init_supabase, supabase
from api.telegram_bot import get_telegram_bot, start_telegram_bridge
from api.daily_bot_run import _dispatch_technical_alerts

try:
    _init_supabase()
    token = os.getenv("ARTORO_AI_BOT", "").strip()
    if not token:
        print("ARTORO_AI_BOT token not found in .env")
        sys.exit(1)
        
    print("Starting Telegram bridge...")
    start_telegram_bridge(token, None)
    
    # Wait for bot to be ready
    bot = None
    for _ in range(10):
        bot = get_telegram_bot()
        if bot and bot._ready:
            break
        time.sleep(1)
        
    if not bot:
        print("Failed to initialize Telegram bot bridge")
        sys.exit(1)
        
    # Insert temporary technical alert
    temp_alert_payload = {
        "user_id": "ba9c27e8-f62d-452f-8a29-dc77fd092207",
        "name": "TEST MACD BEARISH DIV ALERT",
        "filters": {
            "country": "Egypt",
            "divergence_type": "BEARISH",
            "divergence_indicator": "MACD",
            "divergence_min_strength": 0.3
        },
        "is_active": True,
        "last_triggered_at": None,
        "last_triggered_matches": []
    }
    
    print("\nInserting temporary technical alert into database...")
    res = supabase.table("technical_alerts").insert(temp_alert_payload).execute()
    if not res.data:
        print("Failed to insert technical alert")
        sys.exit(1)
        
    alert_id = res.data[0]["id"]
    print(f"Inserted technical alert ID: {alert_id}")
    
    try:
        print("\nCalling _dispatch_technical_alerts()...")
        stats = _dispatch_technical_alerts()
        print(f"Stats: {stats}")
        
        # Wait a bit for the outbound queue to process
        print("Waiting 5 seconds for messages to send...")
        time.sleep(5)
        
    finally:
        print("\nDeleting temporary technical alert from database...")
        supabase.table("technical_alerts").delete().eq("id", alert_id).execute()
        print("Deleted.")
        
except Exception as e:
    import traceback
    traceback.print_exc()
