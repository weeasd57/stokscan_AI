import os
import sys
import time

sys.path.append(os.path.abspath('.'))

from dotenv import load_dotenv
load_dotenv()

from api.stock_ai import _init_supabase, supabase
from api.telegram_bot import get_telegram_bot, start_telegram_bridge
from api.daily_bot_run import _dispatch_similarity_notifications

# Mock similarity results
mock_results = [
    {
        "symbol": "AJWA.EGX",
        "stats": {
            "win_rate": 0.8,
            "average_return": 0.12,
            "total_cases": 10
        },
        "matches": [
            {"similarity": 0.95},
            {"similarity": 0.92},
            {"similarity": 0.90}
        ]
    },
    {
        "symbol": "ACGC.EGX",
        "stats": {
            "win_rate": 0.75,
            "average_return": 0.08,
            "total_cases": 8
        },
        "matches": [
            {"similarity": 0.88},
            {"similarity": 0.85}
        ]
    },
    {
        "symbol": "AMIA.EGX",
        "stats": {
            "win_rate": 0.65,
            "average_return": 0.05,
            "total_cases": 5
        },
        "matches": [
            {"similarity": 0.82}
        ]
    }
]

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
        
    print(f"Telegram bot initialized successfully. Bot username: {bot.bot_username}")
    
    print("\nCalling _dispatch_similarity_notifications with mock data...")
    _dispatch_similarity_notifications(mock_results)
    
    # Wait a bit for the outbound queue to process
    print("Waiting 5 seconds for messages to send...")
    time.sleep(5)
    print("Done.")
    
except Exception as e:
    import traceback
    traceback.print_exc()
