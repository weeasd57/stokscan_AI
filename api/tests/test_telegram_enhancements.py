"""Hermetic tests for recommendation Telegram formatting and send guards.

These tests must never touch Supabase or Telegram. A previous version called
the production send helpers directly and published fixture data to the channel.
"""

from datetime import datetime, timezone
from unittest.mock import patch

from api.daily_bot_run import _send_telegram_adjustment, _send_telegram_exit


class _Response:
    def __init__(self, data):
        self.data = data


class _ClaimQuery:
    def __init__(self, row):
        self.row = row

    def select(self, _columns):
        return self

    def eq(self, column, value):
        if self.row and self.row.get(column) != value:
            self.row = None
        return self

    def gte(self, _column, _value):
        return self

    def limit(self, _value):
        return self

    def execute(self):
        return _Response([self.row] if self.row else [])


class _ClaimedEventClient:
    def __init__(self, event_type):
        self.row = {
            "id": "event-1",
            "event_type": event_type,
            "telegram_status": "pending",
            "retry_claim_token": "claim-1",
            "retry_claimed_at": datetime.now(timezone.utc).isoformat(),
        }

    def table(self, name):
        assert name == "recommendation_events"
        return _ClaimQuery(dict(self.row))


def _adjustment():
    return {
        "type": "acceleration_breakout",
        "reason_ar": "اختبار محلي فقط",
        "old_target": 12.5,
        "new_target": 17.5,
        "old_stop": 9.5,
        "new_stop": 10.2,
        "rsi": 78.4,
        "adx": 52.1,
        "pl_pct": 15.2,
        "current_price": 11.5,
    }


@patch("api.daily_bot_run._telegram_delivery_project_allowed", return_value=True)
@patch("api.daily_bot_run._notify_central_telegram")
def test_direct_fixture_calls_cannot_publish(mock_notify, _mock_project):
    assert not _send_telegram_adjustment("TYCN", "EGX", _adjustment())
    assert not _send_telegram_exit("EASB", "EGX", 10.0, 9.0, -10.0, "loss")
    mock_notify.assert_not_called()


@patch("api.daily_bot_run._telegram_delivery_project_allowed", return_value=True)
@patch("api.daily_bot_run._notify_central_telegram", return_value=True)
def test_claimed_adjustment_is_formatted_without_network(mock_notify, _mock_project):
    delivered = _send_telegram_adjustment(
        "TEST", "EGX", _adjustment(),
        event_id="event-1", claim_token="claim-1",
        event_client=_ClaimedEventClient("target_or_stop_adjusted"),
    )
    assert delivered
    message = mock_notify.call_args.args[0]
    assert "TEST.EGX" in message
    assert "12.50" in message and "17.50" in message


@patch("api.daily_bot_run._telegram_delivery_project_allowed", return_value=True)
@patch("api.daily_bot_run._notify_central_telegram", return_value=True)
def test_claimed_exit_is_formatted_without_network(mock_notify, _mock_project):
    delivered = _send_telegram_exit(
        "TEST", "EGX", 10.0, 13.5, 35.0, "win",
        event_id="event-1", claim_token="claim-1",
        event_client=_ClaimedEventClient("recommendation_closed"),
    )
    assert delivered
    message = mock_notify.call_args.args[0]
    assert "TEST.EGX" in message
    assert "+35.00%" in message
