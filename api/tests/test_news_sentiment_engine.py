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
    is_relevant_news,
    is_unrelated_news,
    parse_pub_date,
    get_symbol_search_terms,
    _normalize_arabic,
    _name_match_tokens,
    GENERIC_NAME_TOKENS,
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


class TestRelevanceMatching:
    """Headline relevance: ticker tokens, Arabic names, and generic-word guards."""

    def test_ticker_matches_as_whole_token(self):
        assert is_relevant_news("COMI reports record profit", "COMI") is True
        assert is_relevant_news("EGX:COMI closes higher", "COMI") is True

    def test_ticker_does_not_match_inside_words(self):
        # Regression: substring matching made "COMI" match "COMING"
        assert is_relevant_news("COMING soon: new listing", "COMI") is False

    def test_arabic_company_name_without_ticker(self):
        # The day-14 production case: Arabic-only headline for AMER
        title = "عامر جروب توافق على إعادة هيكلة إيه إن سي للتنمية السياحية بغرض تداولها في البورصة"
        assert is_relevant_news(title, "AMER", "Amer Group Holding عامر, عامر جروب") is True

    def test_arabic_short_distinctive_token(self):
        # KORA's Arabic name token "قرة" is only 3 chars but is the only marker
        title = "أخبار سهم قرة لمشروعات الطاقة والاستثمار - معلومات مباشر"
        assert is_relevant_news(title, "KORA", "KORRA ENERGIE قرة للطاقة") is True

    def test_arabic_alef_variants(self):
        # "أبو ظبي" in the DB vs "أبوظبي" in the headline
        assert is_relevant_news("«أبوظبي الإسلامي» يحصد جائزة أفضل مصرف إسلامي", "ADIB", "Abu Dhabi Islamic Bank-Egypt ابو ظبي") is True

    def test_generic_token_alone_does_not_match(self):
        # "جروب" must not match every company ending in "جروب"
        assert is_relevant_news("طلعت مصطفى جروب تعلن نتائج أعمالها", "AMER", "Amer Group Holding عامر, عامر جروب") is False
        # "المصرية" alone must not match every Egyptian company
        assert is_relevant_news("المصرية للمنتجعات السياحية تعلن نتائجها", "ETEL", "Telecom Egypt المصرية للاتصالات") is False

    def test_distinctive_token_still_matches(self):
        assert is_relevant_news("المصرية للاتصالات تعلن توزيعات", "ETEL", "Telecom Egypt المصرية للاتصالات") is True

    def test_ambiguous_sector_word_alone_does_not_match(self):
        # "قطر للطاقة" must not match TAQA Arabia ("طاقة عربية") by the bare
        # sector word, while the company's own name phrase still matches.
        assert is_relevant_news(
            "مؤسس القلعة المصرية: 420 مليون دولار صفقة الاستحواذ على حصة قطر للطاقة",
            "TAQA",
            "Taqa Arabia طاقة عربية",
        ) is False
        assert is_relevant_news("طاقة عربية تعلن نتائج أعمالها", "TAQA", "Taqa Arabia طاقة عربية") is True

    def test_latin_phrase_does_not_match_inside_domains(self):
        # "TAQA Arabia" must not match "cnbcarabia.com" in the headline source
        title = "مؤسس ورئيس القلعة المصرية لـ CNBC عربية: صفقة الاستحواذ على حصة قطر للطاقة - cnbcarabia.com"
        assert is_relevant_news(title, "TAQA", "TAQA Arabia") is False
        assert is_relevant_news("TAQA Arabia reports higher profit", "TAQA", "TAQA Arabia") is True

    def test_unrelated_market_news_is_not_relevant(self):
        assert is_relevant_news("البورصة المصرية تغلق مرتفعة 1%", "AMER", "Amer Group Holding عامر جروب") is False

    def test_unrelated_news_filter(self):
        assert is_unrelated_news("الأهلي يفوز على الزمالك في مباراة كرة القدم") is True
        assert is_unrelated_news("شركة تعلن أرباحاً قياسية") is False

    def test_normalize_arabic_variants(self):
        assert _normalize_arabic("أودن") == _normalize_arabic("اودن")
        assert _normalize_arabic("قرة") == _normalize_arabic("قره")
        assert _normalize_arabic("  شركة   كذا  ") == "شركه كذا"

    def test_name_match_tokens_filters_generic_words(self):
        tokens = _name_match_tokens("Amer Group Holding عامر, عامر جروب")
        assert "عامر" in tokens
        assert "amer" in tokens
        assert "جروب" not in tokens
        assert "holding" not in tokens
        assert all(t not in GENERIC_NAME_TOKENS for t in tokens)

    def test_symbol_search_terms_keep_trailing_s_variant(self):
        assert get_symbol_search_terms("COMI") == ["COMI"]
        # Funds/companies ending in S also expose the base ticker (SCTS -> SCT)
        assert "SCT" in get_symbol_search_terms("SCTS")


class TestPubDateParsing:
    """RSS pubDate parsing must yield dates (regression: datetime/date TypeError)."""

    def test_returns_date_not_datetime(self):
        import datetime as _dt
        parsed = parse_pub_date("Mon, 14 Sep 2026 08:11:22 GMT")
        assert parsed == _dt.date(2026, 9, 14)
        assert not isinstance(parsed, _dt.datetime)

    def test_date_is_comparable_with_another_date(self):
        import datetime as _dt
        parsed = parse_pub_date("Mon, 14 Sep 2026 08:11:22 GMT")
        cutoff = _dt.date(2026, 9, 8)
        # This comparison raised TypeError before the fix.
        assert (parsed < cutoff) is False
        assert (parse_pub_date("Mon, 01 Sep 2026 08:11:22 GMT") < cutoff) is True

    def test_invalid_input_returns_none(self):
        assert parse_pub_date("") is None
        assert parse_pub_date("not a date") is None
        assert parse_pub_date(None) is None


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
