import sys
import os
import pandas as pd
import datetime as dt

# Reconfigure stdout to use UTF-8 to handle Arabic text print
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Add the project root to python path
sys.path.append(r"C:\Users\MR__CODER__\Desktop\stokscan_AI")

from api.daily_bot_run import (
    _send_telegram_adjustment,
    _send_telegram_exit,
    generate_weekly_performance_report,
)

def test_telegram_enhancements():
    print("Testing Telegram adjustment notification format...")
    # Mock adjustment
    mock_adj = {
        "type": "acceleration_breakout",
        "reason_ar": "تسارع سعري قوي — ADX عالي + سيولة مرتفعة — رفع الهدف 40%",
        "reason_en": "Acceleration breakout — High ADX + Volume surge — target raised 40%",
        "old_target": 12.5,
        "new_target": 17.5,
        "old_stop": 9.5,
        "new_stop": 10.2,
        "rsi": 78.4,
        "adx": 52.1,
        "pl_pct": 15.2,
        "current_price": 11.5,
    }
    
    # We will trigger the formatting but since get_telegram_bot() will return None (since the bot is not started),
    # it won't send it to the queue. Let's make sure it doesn't throw any Exceptions.
    try:
        _send_telegram_adjustment("TYCN", "EGX", mock_adj)
        print("✓ Adjustment formatting ran without exceptions.")
    except Exception as e:
        print(f"✗ Adjustment formatting failed: {e}")
        raise e

    print("Testing Telegram exit notification format...")
    try:
        _send_telegram_exit("TYCN", "EGX", 10.0, 13.5, 35.0, "win")
        _send_telegram_exit("EASB", "EGX", 10.0, 9.0, -10.0, "loss")
        print("✓ Exit alerts formatted successfully.")
    except Exception as e:
        print(f"✗ Exit alerts failed: {e}")
        raise e

    print("Testing Weekly Report generation logic...")
    try:
        # This will query Supabase and print stats. Let's see if it executes correctly.
        # Since it runs on Sunday trigger naturally, let's run it with manual trigger and no chat_id.
        # It shouldn't crash if database is empty or has data.
        generate_weekly_performance_report(trigger="manual")
        print("✓ Weekly Report generation ran successfully.")
    except Exception as e:
        print(f"✗ Weekly Report failed: {e}")
        raise e

    print("\nAll Telegram enhancements tests completed successfully!")

if __name__ == "__main__":
    test_telegram_enhancements()
