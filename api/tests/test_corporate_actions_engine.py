"""Tests for the corporate-actions relevance gate (api/corporate_actions_engine.py).

Regression: a generic article returned by a symbol's RSS query was stored as a
corporate action for every symbol that happened to receive it — e.g. the Edita
bonus-share article was attached to 21 unrelated symbols.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest

from api.corporate_actions_engine import classify_corporate_action, process_news_list_for_corporate_actions


class _FakeQuery:
    def __init__(self, recorder):
        self._recorder = recorder

    def upsert(self, payload, on_conflict=None):
        self._recorder.append(payload)
        return self

    def execute(self):
        return self


class _FakeSupabase:
    def __init__(self):
        self.written = []

    def table(self, name):
        assert name == "corporate_actions"
        return _FakeQuery(self.written)


EDITA_TITLE = "EGX approves Edita's EGP 138.9M capital increase via bonus shares - آراب فاينانس"
AMER_TITLE = "عامر جروب تقرر توزيع أسهم مجانية على المساهمين"


class TestClassification:
    def test_edita_headline_is_a_bonus_share_action(self):
        result = classify_corporate_action(EDITA_TITLE)
        assert result is not None
        assert result["action_type"] == "bonus_shares"

    def test_generic_market_headline_is_not_an_action(self):
        assert classify_corporate_action("البورصة المصرية تغلق مرتفعة 1%") is None


class TestRelevanceGate:
    def test_generic_article_is_not_stored_for_unrelated_symbol(self):
        supabase = _FakeSupabase()
        saved = process_news_list_for_corporate_actions(
            "AMER",
            "EGX",
            [{"title": EDITA_TITLE, "link": "https://x/edita", "published": "2026-09-14"}],
            supabase=supabase,
            company_name="Amer Group Holding, عامر, عامر جروب",
        )
        assert saved == 0
        assert supabase.written == []

    def test_relevant_arabic_article_is_stored(self):
        supabase = _FakeSupabase()
        saved = process_news_list_for_corporate_actions(
            "AMER",
            "EGX",
            [{"title": AMER_TITLE, "link": "https://x/amer", "published": "2026-09-14"}],
            supabase=supabase,
            company_name="Amer Group Holding, عامر, عامر جروب",
        )
        assert saved == 1
        assert len(supabase.written) == 1
        assert supabase.written[0]["symbol"] == "AMER"
        assert supabase.written[0]["action_type"] == "bonus_shares"

    def test_ticker_in_title_is_enough(self):
        supabase = _FakeSupabase()
        saved = process_news_list_for_corporate_actions(
            "COMI",
            "EGX",
            [{"title": "COMI board proposes a dividend increase", "link": "https://x/comi", "published": "2026-09-14"}],
            supabase=supabase,
            company_name="Commercial International Bank - Egypt (CIB) S.A.E., التجاري, CIB",
        )
        assert saved == 1

    def test_unrelated_sports_headline_is_skipped(self):
        supabase = _FakeSupabase()
        saved = process_news_list_for_corporate_actions(
            "AMER",
            "EGX",
            [{"title": "الأهلي يفوز على الزمالك في مباراة كرة القدم", "link": "https://x/sport"}],
            supabase=supabase,
            company_name="Amer Group Holding, عامر, عامر جروب",
        )
        assert saved == 0


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
