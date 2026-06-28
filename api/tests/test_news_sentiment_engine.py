"""
Unit Tests for the News Sentiment Engine (api/news_sentiment_engine.py)

These tests cover the previously-untested Phase 12 sentiment engine:
- Word-boundary regex matching (no substring false positives like "rise" in "surprise")
- Negation handling (bilingual): "no profit" -> negative, "no losses" -> positive
- Arabic prefix/suffix stemming: "الربح", "أرباحاً", "ارباح" (no-hamza variant)
- Extreme sentiment flags (negative_flag / positive_flag thresholds)
- Aggregation over multiple headlines, neutral/empty cases
- The persisted payload shape produced by analyze_sentiment

Note: fetch_google_news / process_exchange_news require network + Supabase and are
intentionally NOT covered here; only the pure analysis + regex helpers are unit-tested.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from api.news_sentiment_engine import (
    analyze_sentiment,
    _build_keyword_pattern,
    _detect_negation_tokens,
    tokenize_with_positions,
    NEGATION_TOKENS,
    NEGATION_WINDOW,
    FINANCIAL_LEXICON,
)


def _one(title):
    """Helper: build a single-item news list and analyze it."""
    return analyze_sentiment([{
        "title": title,
        "link": "https://example.com/x",
        "published": "2026-06-28",
        "source": "Test Source",
    }])


class TestWordBoundaryMatching:
    """English keywords must use \\b word boundaries (no substring false positives)."""

    def test_rise_not_in_surprise(self):
        """'rise' must NOT match inside 'surprise' (regression: old substring bug)."""
        result = _one("surprise announcement from the board")
        assert result["sentiment_score"] == 0.0
        assert result["positive_flag"] == 0
        assert result["negative_flag"] == 0

    def test_loss_not_in_lossless(self):
        """'loss' must NOT match inside 'lossless' (regression: old substring bug)."""
        result = _one("lossless compression technology deployed")
        assert result["sentiment_score"] == 0.0
        assert result["positive_flag"] == 0
        assert result["negative_flag"] == 0

    def test_buy_not_in_buyback_distinct(self):
        """'buy' should still match the standalone word 'buy'."""
        result = _one("analysts recommend strong buy on the stock")
        assert result["sentiment_score"] > 0.0
        assert result["positive_flag"] == 1

    def test_fine_word_boundary(self):
        """'fine' (negative penalty) must match standalone but not inside 'define'."""
        # 'define' should not trigger the 'fine' negative keyword
        result = _one("company defines new strategy")
        assert result["sentiment_score"] == 0.0
        # standalone 'fine' (penalty) is negative
        result_fine = _one("regulator issues heavy fine against company")
        assert result_fine["sentiment_score"] < 0.0
        assert result_fine["negative_flag"] == 1


class TestEnglishNegation:
    """Negation tokens must flip sentiment within the configured window."""

    def test_no_profit_is_negative(self):
        """'no profit' -> negated positive counts as negative."""
        result = _one("company reports no profit this quarter")
        assert result["sentiment_score"] < 0.0
        assert result["negative_flag"] == 1

    def test_no_losses_is_positive(self):
        """'no losses' -> negated negative counts as positive."""
        result = _one("company reports no losses this quarter")
        assert result["sentiment_score"] > 0.0
        assert result["positive_flag"] == 1

    def test_negation_window_boundary(self):
        """A positive keyword beyond NEGATION_WINDOW words after 'no' should NOT be flipped."""
        # Build a sentence where 'profit' is just outside the negation window.
        # 'no <word> <word> <word> <word> profit' -> profit at index 5, window covers up to index 4.
        filler = " ".join(["data"] * NEGATION_WINDOW)
        title = f"no {filler} profit reported"
        result = _one(title)
        # 'profit' is outside the window -> stays positive
        assert result["sentiment_score"] > 0.0
        assert result["positive_flag"] == 1

    def test_negated_within_window(self):
        """A positive keyword within the negation window IS flipped."""
        # 'no profit' -> profit at index 1, inside window
        result = _one("no profit at all")
        assert result["sentiment_score"] < 0.0


class TestArabicMatching:
    """Arabic keywords with prefix/suffix stemming and hamza variants."""

    def test_arabic_profits_strong_positive(self):
        """'أرباح قياسية' (record profits) -> strong positive."""
        result = _one("شركة تحقق أرباح قياسية هذا الربع")
        assert result["sentiment_score"] > 0.0
        assert result["positive_flag"] == 1

    def test_arabic_suffix_stemming(self):
        """'أرباحاً' (with tanwin suffix) should still match the 'أرباح' root."""
        result = _one("أرباحاً كبيرة تحققها الشركة")
        assert result["sentiment_score"] > 0.0
        assert result["positive_flag"] == 1

    def test_arabic_prefix_al(self):
        """'الربح' (with 'ال' prefix) should match the 'ربح' root."""
        result = _one("الربح يتضاعف للشركة")
        assert result["sentiment_score"] > 0.0
        assert result["positive_flag"] == 1

    def test_arabic_no_hamza_variant(self):
        """'ارباح' (hamza omitted, common in EGX news) should match as positive."""
        result = _one("ارباح قياسية للشركة")
        assert result["sentiment_score"] > 0.0
        assert result["positive_flag"] == 1

    def test_arabic_losses_negative(self):
        """'خسائر' (losses) -> negative."""
        result = _one("خسائر فادحة وأزمة مالية")
        assert result["sentiment_score"] < 0.0
        assert result["negative_flag"] == 1

    def test_arabic_singular_loss(self):
        """'خسارة' (singular loss) -> negative."""
        result = _one("الشركة تعلن خسارة كبيرة")
        assert result["sentiment_score"] < 0.0
        assert result["negative_flag"] == 1

    def test_arabic_distinct_roots_not_confused(self):
        """'ربح' root must not match 'أرباح' and vice versa as the same token index,
        but both should independently register as positive."""
        # Both roots present -> definitely positive
        result = _one("أرباح الشركة وربح المساهمين")
        assert result["sentiment_score"] > 0.0


class TestArabicNegation:
    """Arabic negation tokens (لا / لم / لن) must flip sentiment."""

    def test_la_khasair_positive(self):
        """'لا خسائر' (no losses) -> negated negative becomes positive."""
        result = _one("لا خسائر هذا الربع المالي")
        assert result["sentiment_score"] > 0.0
        assert result["positive_flag"] == 1

    def test_lam_arbah_negative(self):
        """'لم ... أرباح' (did not achieve profits) -> negated positive becomes negative."""
        result = _one("لم تحقق الشركة أرباح هذا الربع")
        assert result["sentiment_score"] < 0.0
        assert result["negative_flag"] == 1

    def test_lan_negative_future(self):
        """'لن تنمو' (will not grow) -> negated positive (نمو) becomes negative."""
        result = _one("لن تنمو أرباح الشركة")
        assert result["sentiment_score"] < 0.0


class TestAggregationAndFlags:
    """Multi-headline aggregation and extreme-sentiment flag thresholds."""

    def test_mixed_headlines_net_score(self):
        """One strong positive + one strong negative headline averages toward neutral-ish."""
        result = analyze_sentiment([
            {"title": "company profits surge to record high", "link": "a", "published": "2026-06-28", "source": "S1"},
            {"title": "huge losses and bankruptcy filing", "link": "b", "published": "2026-06-28", "source": "S2"},
        ])
        # One fully positive (+1) and one fully negative (-1) -> average ~0
        assert -0.2 < result["sentiment_score"] < 0.2
        assert result["news_count"] == 2

    def test_all_positive_sets_positive_flag(self):
        """Multiple positive headlines raise positive_flag (>0.15 threshold)."""
        result = analyze_sentiment([
            {"title": "profits surge", "link": "a", "published": "2026-06-28", "source": "S1"},
            {"title": "strong earnings growth", "link": "b", "published": "2026-06-28", "source": "S2"},
        ])
        assert result["positive_flag"] == 1
        assert result["negative_flag"] == 0

    def test_all_negative_sets_negative_flag(self):
        """Multiple negative headlines raise negative_flag (<-0.15 threshold)."""
        result = analyze_sentiment([
            {"title": "huge losses reported", "link": "a", "published": "2026-06-28", "source": "S1"},
            {"title": "bankruptcy warning issued", "link": "b", "published": "2026-06-28", "source": "S2"},
        ])
        assert result["negative_flag"] == 1
        assert result["positive_flag"] == 0

    def test_neutral_headline_zero_score(self):
        """A headline with no financial keywords scores 0 and sets no flags."""
        result = _one("the weather is sunny today")
        assert result["sentiment_score"] == 0.0
        assert result["positive_flag"] == 0
        assert result["negative_flag"] == 0

    def test_headlines_truncated_to_five(self):
        """Only the first 5 headlines are kept in the output payload."""
        news = [
            {"title": f"headline {i} profits", "link": f"l{i}", "published": "2026-06-28", "source": f"S{i}"}
            for i in range(10)
        ]
        result = analyze_sentiment(news)
        assert len(result["headlines"]) == 5

    def test_sources_deduplicated(self):
        """Sources list is deduplicated."""
        news = [
            {"title": "profits rise", "link": "a", "published": "2026-06-28", "source": "SourceA"},
            {"title": "growth reported", "link": "b", "published": "2026-06-28", "source": "SourceA"},
            {"title": "earnings up", "link": "c", "published": "2026-06-28", "source": "SourceB"},
        ]
        result = analyze_sentiment(news)
        assert sorted(result["sources"]) == ["SourceA", "SourceB"]


class TestEdgeCases:
    """Empty inputs and malformed data must not crash."""

    def test_empty_news_list(self):
        """An empty news list returns a safe zero-score payload."""
        result = analyze_sentiment([])
        assert result["sentiment_score"] == 0.0
        assert result["news_count"] == 0
        assert result["negative_flag"] == 0
        assert result["positive_flag"] == 0
        assert result["headlines"] == []
        assert result["sources"] == []

    def test_headline_missing_title(self):
        """A news item without a 'title' key is treated as neutral, not crashed."""
        result = analyze_sentiment([{"link": "a", "published": "2026-06-28", "source": "S"}])
        assert result["sentiment_score"] == 0.0
        assert result["news_count"] == 1

    def test_empty_string_title(self):
        """An empty string title scores 0."""
        result = _one("")
        assert result["sentiment_score"] == 0.0

    def test_score_range_bounded(self):
        """Sentiment score must always be within [-1.0, 1.0]."""
        titles = [
            "profits surge growth dividend buy",
            "losses bankruptcy crisis debt deficit",
            "neutral announcement about schedule",
        ]
        for t in titles:
            score = _one(t)["sentiment_score"]
            assert -1.0 <= score <= 1.0


class TestRegexHelpers:
    """Direct unit tests for the low-level regex/token helpers."""

    def test_build_english_pattern_word_boundary(self):
        p = _build_keyword_pattern("rise")
        assert p.search("the rise of stocks") is not None
        assert p.search("surprise event") is None

    def test_build_arabic_pattern_prefix(self):
        p = _build_keyword_pattern("ربح")
        assert p.search("الربح") is not None
        assert p.search("ربح") is not None
        # 'أرباح' is a different root (أ + رباح) and should NOT match the 'ربح' token
        assert p.search("أرباح") is None

    def test_build_arabic_pattern_suffix(self):
        p = _build_keyword_pattern("أرباح")
        assert p.search("أرباحاً") is not None
        assert p.search("أرباح") is not None

    def test_negation_token_detection(self):
        tokens = tokenize_with_positions("no profit at all")
        negated = _detect_negation_tokens(tokens)
        # 'no' is at index 0, window covers indices 1..4
        assert 1 in negated  # 'profit'
        # the 'no' token itself is not in the negated set
        assert 0 not in negated

    def test_tokenize_positions_monotonic(self):
        tokens = tokenize_with_positions("profits surge today")
        starts = [t["start"] for t in tokens]
        assert starts == sorted(starts)
        assert all(t["text"].islower() for t in tokens)

    def test_negation_tokens_present(self):
        """Sanity: core negation tokens are defined bilingually."""
        for tok in ["no", "not", "never"]:
            assert tok in NEGATION_TOKENS
        for tok in ["لا", "لم", "لن"]:
            assert tok in NEGATION_TOKENS

    def test_lexicon_has_both_polarities(self):
        assert len(FINANCIAL_LEXICON["positive"]) > 0
        assert len(FINANCIAL_LEXICON["negative"]) > 0
        # Ensure the added Arabic variants are present
        assert "ربح" in FINANCIAL_LEXICON["positive"]
        assert "ارباح" in FINANCIAL_LEXICON["positive"]
        assert "خسائر" in FINANCIAL_LEXICON["negative"]
        assert "خسارة" in FINANCIAL_LEXICON["negative"]


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
