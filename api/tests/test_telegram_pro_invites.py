import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from api import telegram_pro_invites as invites


class TelegramProInviteTests(unittest.TestCase):
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
