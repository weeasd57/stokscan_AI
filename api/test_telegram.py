#!/usr/bin/env python3
"""
Simple test script to verify Telegram bot functionality.
Run this to test if daily recommendations and weekly reports are working.
"""

import os
import sys
import asyncio
from datetime import datetime

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

def test_telegram_bot():
    """Test basic Telegram bot functionality."""
    try:
        from api.telegram_bot import get_telegram_bot
        bot = get_telegram_bot()
        
        if not bot:
            print("❌ Telegram bot not initialized")
            return False
            
        print(f"✅ Telegram bot found: chat_id = {bot.chat_id}")
        
        # Test basic message sending
        test_message = (
            "🧪 *اختبار البوت / Bot Test* 🧪\n"
            f"⏰ الوقت: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            "📝 هذه رسالة اختبار للتأكد من عمل البوت\n\n"
            "✅ This is a test message to verify bot functionality"
        )
        
        bot.send_notification(test_message)
        print("✅ Test message sent successfully")
        return True
        
    except Exception as e:
        print(f"❌ Telegram bot test failed: {e}")
        return False

def test_daily_recommendations():
    """Test daily recommendations generation and sending."""
    try:
        from api.daily_bot_run import generate_daily_recommendations
        print("🔄 Testing daily recommendations...")
        
        count = asyncio.run(generate_daily_recommendations())
        if count and count > 0:
            print(f"✅ Daily recommendations test successful: {count} recommendations sent")
        else:
            print("ℹ️ No recommendations generated (might be normal)")
        return True
        
    except Exception as e:
        print(f"❌ Daily recommendations test failed: {e}")
        return False

def test_weekly_report():
    """Test weekly performance report generation and sending."""
    try:
        from api.daily_bot_run import generate_weekly_performance_report
        print("🔄 Testing weekly report...")
        
        # Test with specific chat ID from Telegram URL
        generate_weekly_performance_report(trigger="manual", chat_id="-1002083067817")
        print("✅ Weekly report test completed")
        return True
        
    except Exception as e:
        print(f"❌ Weekly report test failed: {e}")
        return False

def main():
    print("=" * 60)
    print("🚀 TELEGRAM BOT FUNCTIONALITY TEST")
    print("=" * 60)
    
    # Test 1: Basic bot functionality
    print("\n1️⃣ Testing basic Telegram bot...")
    bot_ok = test_telegram_bot()
    
    if not bot_ok:
        print("❌ Basic bot test failed. Stopping further tests.")
        return
    
    # Test 2: Daily recommendations
    print("\n2️⃣ Testing daily recommendations...")
    daily_ok = test_daily_recommendations()
    
    # Test 3: Weekly report
    print("\n3️⃣ Testing weekly report...")
    weekly_ok = test_weekly_report()
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    print(f"Basic Bot: {'✅ PASS' if bot_ok else '❌ FAIL'}")
    print(f"Daily Recommendations: {'✅ PASS' if daily_ok else '❌ FAIL'}")
    print(f"Weekly Report: {'✅ PASS' if weekly_ok else '❌ FAIL'}")
    
    if all([bot_ok, daily_ok, weekly_ok]):
        print("\n🎉 All tests passed! Telegram bot is working correctly.")
    else:
        print("\n⚠️ Some tests failed. Please check the error messages above.")

if __name__ == "__main__":
    main()