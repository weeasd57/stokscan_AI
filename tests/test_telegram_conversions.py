import sys
import os

project_root = r"c:\Users\MR__CODER__\Desktop\stokscan_AI"
sys.path.insert(0, project_root)

from api.telegram_bot import TelegramBot

class DummyConfig:
    telegram_chat_id = None

class DummyBotInstance:
    config = DummyConfig()

def test_conversions():
    # Initialize mock TelegramBot
    bot = TelegramBot(token="12345:dummy_token", bot_instance=DummyBotInstance())
    bot._queue.clear()
    
    # Test send_notification with various ID formats
    bot.send_notification("Test 1", chat_id=123)
    bot.send_notification("Test 2", chat_id=123.0)
    bot.send_notification("Test 3", chat_id="123.0")
    bot.send_notification("Test 4", chat_id="@my_channel")
    bot.send_notification("Test 5", chat_id="-1002083067817_153")
    
    print(f"Queue size after notifications: {len(bot._queue)}")
    assert len(bot._queue) == 5
    
    assert bot._queue[0]["chat_id"] == 123
    assert "message_thread_id" not in bot._queue[0]
    
    assert bot._queue[1]["chat_id"] == 123
    assert "message_thread_id" not in bot._queue[1]
    
    assert bot._queue[2]["chat_id"] == 123
    assert "message_thread_id" not in bot._queue[2]
    
    assert bot._queue[3]["chat_id"] == "@my_channel"
    assert "message_thread_id" not in bot._queue[3]
    
    assert bot._queue[4]["chat_id"] == -1002083067817
    assert bot._queue[4]["message_thread_id"] == 153
    
    print("[SUCCESS] send_notification correctly parsed all ID formats, including threads!")
    
    # Test send_message_with_keyboard with various ID formats
    bot._queue.clear()
    buttons = [[{"text": "Btn", "url": "https://example.com"}]]
    
    bot.send_message_with_keyboard("KB 1", chat_id=456, buttons=buttons)
    bot.send_message_with_keyboard("KB 2", chat_id=456.0, buttons=buttons)
    bot.send_message_with_keyboard("KB 3", chat_id="456.0", buttons=buttons)
    bot.send_message_with_keyboard("KB 4", chat_id="@my_channel", buttons=buttons)
    bot.send_message_with_keyboard("KB 5", chat_id="-1002083067817_153", buttons=buttons)
    
    print(f"Queue size after keyboards: {len(bot._queue)}")
    assert len(bot._queue) == 5
    
    assert bot._queue[0]["chat_id"] == 456
    assert "message_thread_id" not in bot._queue[0]
    
    assert bot._queue[1]["chat_id"] == 456
    assert "message_thread_id" not in bot._queue[1]
    
    assert bot._queue[2]["chat_id"] == 456
    assert "message_thread_id" not in bot._queue[2]
    
    assert bot._queue[3]["chat_id"] == "@my_channel"
    assert "message_thread_id" not in bot._queue[3]
    
    assert bot._queue[4]["chat_id"] == -1002083067817
    assert bot._queue[4]["message_thread_id"] == 153
    
    print("[SUCCESS] send_message_with_keyboard correctly parsed all ID formats, including threads!")
    
    # Test _is_admin with various formats
    print("\n--- Test _is_admin functionality ---")
    
    # Test Case 1: Default fallback chat_id
    bot.chat_id = 999999
    assert bot._is_admin(999999) is True
    assert bot._is_admin(111111) is False
    
    # Test Case 2: Config overrides
    bot.bot_instance.config.telegram_chat_id = 888888
    assert bot._is_admin(888888) is True
    assert bot._is_admin(999999) is False  # Fallback should be overridden by config
    
    # Test Case 3: Composite config chat ID with thread suffix
    bot.bot_instance.config.telegram_chat_id = "-1002083067817_153"
    assert bot._is_admin(-1002083067817) is True
    assert bot._is_admin("-1002083067817") is True
    assert bot._is_admin(153) is False
    
    # Test Case 4: TELEGRAM_ADMIN_CHAT_ID environment variable
    os.environ["TELEGRAM_ADMIN_CHAT_ID"] = "777777"
    assert bot._is_admin(777777) is True
    assert bot._is_admin("777777") is True
    
    # Clean up environment variable
    del os.environ["TELEGRAM_ADMIN_CHAT_ID"]
    
    # Test Case 5: support_chat.load_admin_chat_id()
    # Let's mock support_chat's CHAT_ID_FILE or just verify load_admin_chat_id fallback (5149631436)
    assert bot._is_admin(5149631436) is True
    
    print("[SUCCESS] _is_admin correctly handles all formats and thread stripping!")

if __name__ == "__main__":
    try:
        test_conversions()
        print("All tests passed successfully!")
    except Exception as e:
        print(f"[FAIL] Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

