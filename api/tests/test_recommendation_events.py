"""Regression tests for recommendation_events delivery claiming.

The duplicate-Telegram bug: the inline evaluator and the background retry loop
both read ``telegram_status == 'pending'`` and each sent the same message.
``claim_event_delivery`` must let exactly one caller win the send.
"""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.recommendation_events import claim_event_delivery, update_telegram_delivery


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, rows):
        self.rows = rows
        self._op = None
        self._payload = None
        self._filters = []
        self._limit = None

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def select(self, _cols):
        self._op = "select"
        return self

    def eq(self, col, val):
        self._filters.append((col, "eq", val))
        return self

    def gte(self, col, val):
        self._filters.append((col, "gte", val))
        return self

    def is_(self, col, val):
        self._filters.append((col, "is", val))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _matches(self, row):
        for col, op, val in self._filters:
            if op == "eq" and row.get(col) != val:
                return False
            if op == "gte" and not (row.get(col) is not None and row.get(col) >= val):
                return False
            if op == "is":
                if val == "null" and row.get(col) is not None:
                    return False
                if val != "null" and row.get(col) != val:
                    return False
        return True

    def execute(self):
        matched = [r for r in self.rows if self._matches(r)]
        if self._op == "update":
            for row in matched:
                row.update(self._payload)
            return _FakeResponse(matched)
        return _FakeResponse(matched[: self._limit] if self._limit else matched)


class _FakeSupabase:
    def __init__(self, rows):
        self.rows = rows

    def table(self, _name):
        return _FakeTable(self.rows)


def _pending_event():
    return [{
        "id": "evt-1",
        "telegram_status": "pending",
        "retry_claimed_at": None,
        "retry_claim_token": None,
        "telegram_attempts": 0,
        "updated_at": None,
    }]


class TestClaimEventDelivery:
    def test_first_claimer_wins_and_locks_the_event(self):
        db = _FakeSupabase(_pending_event())
        token = claim_event_delivery(db, "evt-1")
        assert token
        assert db.rows[0]["retry_claim_token"] == token
        assert db.rows[0]["retry_claimed_at"] is not None

    def test_second_claimer_cannot_send_the_same_event(self):
        db = _FakeSupabase(_pending_event())
        assert claim_event_delivery(db, "evt-1")
        assert claim_event_delivery(db, "evt-1") is None

    def test_non_pending_event_is_not_claimable(self):
        rows = _pending_event()
        rows[0]["telegram_status"] = "sent"
        db = _FakeSupabase(rows)
        assert claim_event_delivery(db, "evt-1") is None

    def test_read_only_mode_never_claims(self):
        db = _FakeSupabase(_pending_event())
        with patch.dict(os.environ, {"TELEGRAM_RECOMMENDATIONS_READ_ONLY": "true"}):
            assert claim_event_delivery(db, "evt-1") is None


class TestDeliveryBookkeepingClearsClaim:
    def test_success_marks_sent_and_releases_claim(self):
        db = _FakeSupabase(_pending_event())
        token = claim_event_delivery(db, "evt-1")
        assert update_telegram_delivery(db, "evt-1", success=True, claim_token=token)
        assert db.rows[0]["telegram_status"] == "sent"
        assert db.rows[0]["retry_claimed_at"] is None
