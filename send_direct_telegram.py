#!/usr/bin/env python3
"""
Send recommendations directly to Telegram using direct API (no relay)
"""
import os
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def send_telegram_message():
    """Send message directly to Telegram API."""
    try:
        token = os.getenv("ARTORO_AI_BOT", "").strip()
        if not token:
            print("❌ ARTORO_AI_BOT token not found")
            return False
        
        # Chat ID from the URL you provided
        chat_id = "-1002083067817"
        message_thread_id = 153  # Thread ID from the URL
        
        # The message (plain text version)
        message = """🚀 توصيات الذكاء الاصطناعي الجديدة / New AI Recommendations 🚀
📅 التاريخ: 2026-07-09
━━━━━━━━━━━━━━━━━━━━

🔥 #1 ELKA.EGX | El Kahera Housing
▪️ الدخول المقترح: 1.57 EGP
▪️ الهدف الأول: 1.88 | الهدف الثاني: 2.07
▪️ وقف الخسارة: 1.41
▪️ تقييم الزخم (Score): 8/10 ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 #2 GGCC.EGX | Giza General Contracting & Real Estate Investment
▪️ الدخول المقترح: 0.55 EGP
▪️ الهدف الأول: 0.66 | الهدف الثاني: 0.73
▪️ وقف الخسارة: 0.50
▪️ تقييم الزخم (Score): 7/10 ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 #3 NARE.EGX | Naeem Real Estate Holding Group
▪️ الدخول المقترح: 19.33 EGP
▪️ الهدف الأول: 26.00 | الهدف الثاني: 28.60
▪️ وقف الخسارة: 16.43
▪️ تقييم الزخم (Score): 7/10 ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 #4 TYCN.EGX | Tycoon Holding Company For Financial Investments
▪️ الدخول المقترح: 21.40 EGP
▪️ الهدف الأول: 23.97 | الهدف الثاني: 26.37
▪️ وقف الخسارة: 18.19
▪️ تقييم الزخم (Score): 7/10 ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 #5 GMCI.EGX | GMC Group for Industrial Commercial & Financial Investments
▪️ الدخول المقترح: 2.08 EGP
▪️ الهدف الأول: 2.70 | الهدف الثاني: 2.97
▪️ وقف الخسارة: 1.81
▪️ تقييم الزخم (Score): 6/10 ⚡
━━━━━━━━━━━━━━━━━━━━
🔥 #6 SPMD.EGX | Speed Medical SAE
▪️ الدخول المقترح: 0.45 EGP
▪️ الهدف الأول: 0.54 | الهدف الثاني: 0.59
▪️ وقف الخسارة: 0.41
▪️ تقييم الزخم (Score): 6/10 ⚡
━━━━━━━━━━━━━━━━━━━━
📈 إجمالي الإشارات الجديدة: 6 أسهم

🔗 لمتابعة الرسوم البيانية والتفاصيل الكاملة:
👉 https://egxbots.com/scanner/backtests?tab=bots"""
        
        # Direct Telegram API URL
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        
        # Payload
        payload = {
            "chat_id": chat_id,
            "text": message,
            "message_thread_id": message_thread_id  # Send to specific thread
        }
        
        print(f"📤 Sending to chat_id: {chat_id}")
        print(f"🌐 Using Telegram API: {url[:50]}...")
        
        # Send the request
        response = requests.post(url, json=payload, timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            if result.get("ok"):
                print("✅ Message sent successfully!")
                print(f"📱 Message ID: {result['result'].get('message_id')}")
                print(f"🔗 Check: https://web.telegram.org/a/#-1002083067817_153")
                return True
            else:
                print(f"❌ API returned error: {result}")
                return False
        else:
            print(f"❌ HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("📨 SENDING RECOMMENDATIONS VIA DIRECT TELEGRAM API")
    print("=" * 60)
    
    success = send_telegram_message()
    
    if success:
        print("\n🎉 Successfully sent to Telegram!")
    else:
        print("\n⚠️ Failed to send")
    
    print("=" * 60)
