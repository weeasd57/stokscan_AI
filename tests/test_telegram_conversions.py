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
    bot._channel_queue.clear()
    
    # Test send_notification with various ID formats
    bot.send_notification("Test 1", chat_id=123)
    bot.send_notification("Test 2", chat_id=123.0)
    bot.send_notification("Test 3", chat_id="123.0")
    bot.send_notification("Test 4", chat_id="@my_channel")
    bot.send_notification("Test 5", chat_id="-1002083067817_153")
    
    # Public-channel targets are isolated in _channel_queue by design.
    queued = list(bot._queue) + list(bot._channel_queue)
    print(f"Queue size after notifications: {len(queued)}")
    assert len(queued) == 5
    
    assert queued[0]["chat_id"] == 123
    assert "message_thread_id" not in queued[0]
    
    assert queued[1]["chat_id"] == 123
    assert "message_thread_id" not in queued[1]
    
    assert queued[2]["chat_id"] == 123
    assert "message_thread_id" not in queued[2]
    
    assert queued[3]["chat_id"] == "@my_channel"
    assert "message_thread_id" not in queued[3]
    
    assert queued[4]["chat_id"] == -1002083067817
    assert queued[4]["message_thread_id"] == 153
    
    print("[SUCCESS] send_notification correctly parsed all ID formats, including threads!")
    
    # Test send_message_with_keyboard with various ID formats
    bot._queue.clear()
    bot._channel_queue.clear()
    buttons = [[{"text": "Btn", "url": "https://example.com"}]]
    
    bot.send_message_with_keyboard("KB 1", chat_id=456, buttons=buttons)
    bot.send_message_with_keyboard("KB 2", chat_id=456.0, buttons=buttons)
    bot.send_message_with_keyboard("KB 3", chat_id="456.0", buttons=buttons)
    bot.send_message_with_keyboard("KB 4", chat_id="@my_channel", buttons=buttons)
    bot.send_message_with_keyboard("KB 5", chat_id="-1002083067817_153", buttons=buttons)
    
    kb_queued = list(bot._queue) + list(bot._channel_queue)
    print(f"Queue size after keyboards: {len(kb_queued)}")
    # Free-channel keyboard messages are never mirrored into the paid VIP channel.
    assert len(kb_queued) == 5
    
    assert kb_queued[0]["chat_id"] == 456
    assert "message_thread_id" not in kb_queued[0]
    
    assert kb_queued[1]["chat_id"] == 456
    assert "message_thread_id" not in kb_queued[1]
    
    assert kb_queued[2]["chat_id"] == 456
    assert "message_thread_id" not in kb_queued[2]
    
    assert kb_queued[3]["chat_id"] == "@my_channel"
    assert "message_thread_id" not in kb_queued[3]
    
    assert kb_queued[4]["chat_id"] == -1002083067817
    assert kb_queued[4]["message_thread_id"] == 153
    
    vip_targets = [m for m in kb_queued if str(m["chat_id"]) == bot.VIP_CHANNEL_ID]
    assert vip_targets == []
    
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

