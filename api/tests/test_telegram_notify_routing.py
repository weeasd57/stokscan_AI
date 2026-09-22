import unittest
from unittest.mock import Mock, patch

from api.daily_bot_run import (
    TelegramNotificationOutcome,
    _build_daily_digest_message,
    _notify_central_telegram,
    _notify_vip_telegram,
    _resolve_vip_chat_target,
)


class TelegramNotifyRoutingTests(unittest.TestCase):
    def test_resolve_vip_chat_target_prefers_pro_channel(self):
        with patch("api.plan_limits.telegram_pro_channel_target", return_value="-100999"), \
             patch("api.plan_limits.telegram_recommendations_target", return_value="-100111"):
            self.assertEqual(_resolve_vip_chat_target(), "-100999")

    def test_resolve_vip_chat_target_never_falls_back_when_pro_missing(self):
        with patch("api.plan_limits.telegram_pro_channel_target", return_value=""), \
             patch("api.plan_limits.telegram_recommendations_target", return_value="-100111"):
            self.assertEqual(_resolve_vip_chat_target(), "")

    def test_configured_legacy_vip_id_is_still_a_valid_vip_target(self):
        with patch("api.plan_limits.telegram_pro_channel_target", return_value="-1003699330518"):
            self.assertEqual(_resolve_vip_chat_target(), "-1003699330518")

    def test_vip_delivery_uses_configured_pro_channel_end_to_end(self):
        bot = Mock()
        bot.send_notification.return_value = True
        bot.get_last_delivery_receipts.return_value = [
            {"chat_id": -1003699330518, "message_id": 404}
        ]
        with patch("api.plan_limits.telegram_pro_channel_target", return_value="-1003699330518"), \
             patch("api.telegram_bot.get_telegram_bot", return_value=bot):
            result = _notify_vip_telegram("vip only", "daily_digest")

        self.assertTrue(result)
        bot.send_notification.assert_called_once_with(
            "vip only", chat_id="-1003699330518", wait_for_delivery=True
        )

    def test_central_notify_routes_exits_to_free_channel(self):
        with patch("api.daily_bot_run._notify_free_telegram", return_value=True) as free_send, \
             patch("api.daily_bot_run._notify_vip_telegram") as vip_send, \
             patch("api.daily_bot_run._telegram_recommendation_writes_enabled", return_value=True):
            result = _notify_central_telegram("exit", "recommendation_exit")
        self.assertTrue(result)
        free_send.assert_called_once()
        vip_send.assert_not_called()

    def test_central_notify_routes_recommendations_to_vip_without_scoping_error(self):
        with patch("api.daily_bot_run._notify_vip_telegram", return_value=TelegramNotificationOutcome(True)) as vip_send, \
             patch("api.daily_bot_run._telegram_recommendation_writes_enabled", return_value=True):
            result = _notify_central_telegram("buy list", "daily_recommendations")
        self.assertTrue(result)
        vip_send.assert_called_once()

    def test_build_daily_digest_message_includes_failed_steps(self):
        message = _build_daily_digest_message(
            [
                {"step": "sync_prices", "status": "success", "details": "Synced 200 symbols", "count": 200},
                {"step": "generate_recommendations", "status": "success", "details": "Generated 3", "count": 3},
                {"step": "news_sentiment", "status": "failed", "details": "timeout", "count": 0},
                {"step": "weekly_adaptive_retraining", "status": "failed", "details": "Model not found", "count": 0},
            ],
            job_start_time="2026-09-21T14:00:00+00:00",
            total_symbols=200,
            trigger="scheduled",
        )
        self.assertIn("ملخص التشغيل اليومي", message)
        self.assertIn("news_sentiment", message)
        self.assertIn("توصيات جديدة", message)
        self.assertNotIn("weekly_adaptive_retraining", message)
        self.assertNotIn("Model not found", message)


if __name__ == "__main__":
    unittest.main()
