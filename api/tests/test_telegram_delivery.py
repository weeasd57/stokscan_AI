import unittest
from unittest.mock import patch

from api.telegram_bot import TelegramBot


class TelegramDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.bot = TelegramBot("test-token")
        self.bot._channel_queue.clear()
        self.bot._queue.clear()

    def test_channel_queue_isolated_from_subscriber_queue(self):
        self.assertTrue(self.bot.send_notification("subscriber", chat_id="12345"))
        self.assertTrue(self.bot.send_notification("channel", chat_id="-1002083067817_153"))
        self.assertEqual(len(self.bot._queue), 1)
        self.assertEqual(len(self.bot._channel_queue), 1)

    def test_long_messages_are_split_for_telegram_limit(self):
        with patch.object(self.bot, "_call_api", return_value={"ok": True}) as call_api:
            delivered = self.bot.send_notification(
                "line\n" * 5000,
                chat_id="-1002083067817_153",
                wait_for_delivery=True,
            )
        self.assertTrue(delivered)
        self.assertGreater(call_api.call_count, 1)
        self.assertTrue(all(len(call.args[1]["text"]) <= self.bot.MAX_MESSAGE_LENGTH for call in call_api.call_args_list))

    def test_immediate_delivery_does_not_report_success_on_forbidden(self):
        with patch.object(self.bot, "_call_api", return_value={"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user"}), \
             patch.object(self.bot, "_mark_blocked_target") as mark_blocked:
            delivered = self.bot.send_notification("blocked", chat_id="12345", wait_for_delivery=True)
        self.assertFalse(delivered)
        mark_blocked.assert_called_once_with("12345")

    def test_transient_failure_queues_failed_tail_for_retry(self):
        responses = [
            {"ok": True},
            {"ok": False, "description": "Timeout after 30s"},
        ]
        long_message = "A" * (self.bot.MAX_MESSAGE_LENGTH + 100)
        with patch.object(self.bot, "_call_api", side_effect=responses):
            delivered = self.bot.send_notification(
                long_message,
                chat_id="-1002083067817_153",
                wait_for_delivery=True,
            )
        self.assertFalse(delivered)
        self.assertEqual(len(self.bot._channel_queue), 1)
        self.assertLessEqual(
            len(self.bot._channel_queue[0]["text"]), self.bot.MAX_MESSAGE_LENGTH
        )


if __name__ == "__main__":
    unittest.main()
