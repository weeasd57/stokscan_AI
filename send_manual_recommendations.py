#!/usr/bin/env python3
"""
Send pre-formatted recommendations to Telegram channel
"""
import os
import sys
import time
from dotenv import load_dotenv

# Add project root to path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

# Load environment variables
load_dotenv()

def send_message():
    """Send the recommendations message to Telegram."""
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
            time.sleep(3)  # Wait for bot to initialize
        
        if not bot:
            print("❌ Failed to initialize Telegram bot")
            return False
            
        print(f"✅ Telegram bot initialized: chat_id = {bot.chat_id}")
        
        # The pre-formatted message from the admin panel
        message = """🚀 *توصيات الذكاء الاصطناعي الجديدة / New AI Recommendations* 🚀
📅 *التاريخ:* `2026-07-09`
━━━━━━━━━━━━━━━━━━━━

🔥 *#1 ELKA.EGX* | El Kahera Housing
▪️ *الدخول المقترح:* `1.57` EGP
▪️ *الهدف الأول:* `1.88` | *الهدف الثاني:* `2.07`
▪️ *وقف الخسارة:* `1.41`
▪️ *تقييم الزخم (Score):* `8/10` ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 *#2 GGCC.EGX* | Giza General Contracting & Real Estate Investment
▪️ *الدخول المقترح:* `0.55` EGP
▪️ *الهدف الأول:* `0.66` | *الهدف الثاني:* `0.73`
▪️ *وقف الخسارة:* `0.50`
▪️ *تقييم الزخم (Score):* `7/10` ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 *#3 NARE.EGX* | Naeem Real Estate Holding Group
▪️ *الدخول المقترح:* `19.33` EGP
▪️ *الهدف الأول:* `26.00` | *الهدف الثاني:* `28.60`
▪️ *وقف الخسارة:* `16.43`
▪️ *تقييم الزخم (Score):* `7/10` ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 *#4 TYCN.EGX* | Tycoon Holding Company For Financial Investments
▪️ *الدخول المقترح:* `21.40` EGP
▪️ *الهدف الأول:* `23.97` | *الهدف الثاني:* `26.37`
▪️ *وقف الخسارة:* `18.19`
▪️ *تقييم الزخم (Score):* `7/10` ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 *#5 GMCI.EGX* | GMC Group for Industrial Commercial & Financial Investments
▪️ *الدخول المقترح:* `2.08` EGP
▪️ *الهدف الأول:* `2.70` | *الهدف الثاني:* `2.97`
▪️ *وقف الخسارة:* `1.81`
▪️ *تقييم الزخم (Score):* `6/10` ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 *#6 SPMD.EGX* | Speed Medical SAE
▪️ *الدخول المقترح:* `0.45` EGP
▪️ *الهدف الأول:* `0.54` | *الهدف الثاني:* `0.59`
▪️ *وقف الخسارة:* `0.41`
▪️ *تقييم الزخم (Score):* `6/10` ⚡
━━━━━━━━━━━━━━━━━━━━
📈 *إجمالي الإشارات الجديدة:* `6` أسهم

🔗 *لمتابعة الرسوم البيانية والتفاصيل الكاملة:*
👉 [اضغط هنا لفتح المنصة](https://egxbots.com/scanner/backtests?tab=bots)"""
        
        # Send to the channel
        chat_id = "-1002083067817_153"  # Channel + Thread ID for public channel
        print(f"📤 Sending message to chat_id: {chat_id}")
        
        bot.send_notification(message, chat_id=chat_id)
        
        print("✅ Message queued successfully!")
        print("⏳ Waiting for message to be sent...")
        
        # Wait for the message to be sent
        time.sleep(10)
        
        print("📱 Check your Telegram channel: https://web.telegram.org/a/#-1002083067817_153")
        return True
            
    except Exception as e:
        print(f"❌ Error sending message: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("📨 SENDING RECOMMENDATIONS TO TELEGRAM")
    print("=" * 60)
    
    success = send_message()
    
    if success:
        print("\n🎉 Message sent successfully!")
    else:
        print("\n⚠️ Failed to send message")
    
    print("=" * 60)
