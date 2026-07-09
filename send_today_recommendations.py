#!/usr/bin/env python3
"""
Send today's recommendations to Telegram channel
"""
import os
import sys
import asyncio
from dotenv import load_dotenv

# Add project root to path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

# Load environment variables
load_dotenv()

async def send_recommendations():
    """Send today's AI recommendations to Telegram."""
    try:
        # Initialize Telegram bot
        from api.telegram_bot import get_telegram_bot, start_telegram_bridge
        
        token = os.getenv("ARTORO_AI_BOT", "").strip()
        if not token:
            print("❌ ARTORO_AI_BOT token not found in environment")
            return False
            
        # Start bot if not already started
        bot = get_telegram_bot()
        if not bot:
            print("🔄 Initializing Telegram bot...")
            bot = start_telegram_bridge(token, None)
            import time
            time.sleep(3)  # Wait for bot to initialize
        
        if not bot:
            print("❌ Failed to initialize Telegram bot")
            return False
            
        print(f"✅ Telegram bot initialized: chat_id = {bot.chat_id}")
        
        # Generate and send daily recommendations
        print("🔄 Generating daily recommendations...")
        from api.daily_bot_run import generate_daily_recommendations
        
        count = await generate_daily_recommendations()
        
        if count and count > 0:
            print(f"✅ Successfully sent {count} daily recommendations to Telegram!")
            print(f"📱 Check the channel: https://web.telegram.org/a/#-1002083067817_153")
            return True
        else:
            print("ℹ️ No new recommendations generated today")
            return False
            
    except Exception as e:
        print(f"❌ Error sending recommendations: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("🚀 SENDING TODAY'S RECOMMENDATIONS TO TELEGRAM")
    print("=" * 60)
    
    success = asyncio.run(send_recommendations())
    
    if success:
        print("\n🎉 Recommendations sent successfully!")
    else:
        print("\n⚠️ Failed to send recommendations")
    
    print("=" * 60)
