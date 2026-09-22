import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import requests

from api import telegram_pro_invites as invites


class TelegramProInviteTests(unittest.TestCase):
    def test_telegram_api_retries_after_transient_timeouts(self):
        failed = requests.Timeout("timed out")
        successful = Mock()
        successful.json.return_value = {"ok": True, "result": {"invite_link": "https://t.me/+new"}}
        with patch.dict("os.environ", {"SUPPORT_BOT_TOKEN": "test-token", "TELEGRAM_RELAY_URL": "https://relay.example.test"}, clear=False), \
             patch.object(invites.requests, "post", side_effect=[failed, failed, successful]) as post:
            response = invites.telegram_api("createChatInviteLink", {"chat_id": "-1001"})
        self.assertTrue(response["ok"])
        self.assertEqual(post.call_count, 3)
        self.assertEqual(post.call_args.kwargs["timeout"], (3.0, 12.0))

    def test_missing_invite_row_accepts_postgrest_204(self):
        class NoContentQuery:
            def select(self, *args, **kwargs): return self
            def eq(self, *args, **kwargs): return self
            def maybe_single(self): return self
            def execute(self):
                raise RuntimeError("{'message': 'Missing response', 'code': '204'}")

        class FakeSupabase:
            def table(self, name): return NoContentQuery()

        with patch.object(invites, "_init_supabase"), patch.object(invites, "supabase", FakeSupabase()):
            self.assertIsNone(invites._load_invite_row("user-1"))

    def test_save_invite_accepts_empty_204_write_response(self):
        class Query:
            def __init__(self, table): self.table = table
            def upsert(self, *args, **kwargs): return self
            def select(self, *args, **kwargs): return self
            def update(self, *args, **kwargs): return self
            def eq(self, *args, **kwargs): return self
            def order(self, *args, **kwargs): return self
            def limit(self, *args, **kwargs): return self
            def execute(self):
                if self.table == "pro_telegram_invites":
                    raise RuntimeError("{'message': 'Missing response', 'code': '204'}")
                return type("Response", (), {"data": []})()

        class FakeSupabase:
            def table(self, name): return Query(name)

        future = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        with patch.object(invites, "_init_supabase"), patch.object(invites, "supabase", FakeSupabase()):
            row = invites.save_invite("user-1", "https://t.me/+new", future)
        self.assertEqual(row["invite_link"], "https://t.me/+new")

    def test_save_invite_uses_payment_order_when_invites_table_is_pending(self):
        class Query:
            def upsert(self, *args, **kwargs): return self
            def execute(self):
                error = RuntimeError("Could not find the table 'public.pro_telegram_invites' in the schema cache")
                error.code = "PGRST205"
                raise error

        class FakeSupabase:
            def table(self, name): return Query()

        future = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        with patch.object(invites, "_init_supabase"), \
             patch.object(invites, "supabase", FakeSupabase()), \
             patch.object(invites, "_sync_order_invite") as sync_order:
            row = invites.save_invite("user-1", "https://t.me/+new", future)
        self.assertEqual(row["invite_link"], "https://t.me/+new")
        sync_order.assert_called_once_with("user-1", "https://t.me/+new", future)

    def test_ensure_pro_invite_reuses_valid_saved_link(self):
        future = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        with patch.object(invites, "_load_invite_row", return_value={"invite_link": "https://t.me/+abc", "invite_expires_at": future}), \
             patch.object(invites, "create_invite_link") as create_link:
            row = invites.ensure_pro_invite("user-1", future)
        self.assertEqual(row["invite_link"], "https://t.me/+abc")
        create_link.assert_not_called()

    def test_repeated_profile_loads_keep_the_same_valid_invite(self):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        saved = {"invite_link": "https://t.me/+vip-month", "invite_expires_at": future}
        with patch.object(invites, "_load_invite_row", return_value=saved), \
             patch.object(invites, "create_invite_link") as create_link:
            first = invites.ensure_pro_invite("user-1", future)
            second = invites.ensure_pro_invite("user-1", future)

        self.assertEqual(first["invite_link"], second["invite_link"])
        self.assertEqual(first["invite_expires_at"], second["invite_expires_at"])
        create_link.assert_not_called()

    def test_ensure_pro_invite_creates_when_missing(self):
        future = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        with patch.object(invites, "_load_invite_row", return_value=None), \
             patch.object(invites, "create_invite_link", return_value="https://t.me/+new"), \
             patch.object(invites, "save_invite", return_value={"invite_link": "https://t.me/+new", "invite_expires_at": future}) as save_invite:
            row = invites.ensure_pro_invite("user-1", future)
        self.assertEqual(row["invite_link"], "https://t.me/+new")
        save_invite.assert_called_once()

    def test_handle_chat_member_update_records_join(self):
        payload = {
            "chat_member": {
                "chat": {"id": -100123},
                "from": {"id": 555},
                "new_chat_member": {"status": "member"},
                "invite_link": {"invite_link": "https://t.me/+vip"},
            }
        }
        with patch.dict("os.environ", {"TELEGRAM_PRO_CHAT_ID": "-100123"}), \
             patch.object(invites, "record_vip_channel_join") as record_join:
            invites.handle_chat_member_update(payload)
        record_join.assert_called_once_with(555, "https://t.me/+vip")


if __name__ == "__main__":
    unittest.main()
