import os
import unittest
from unittest import mock

from api import cache_invalidation as ci


def step(name, status):
    return {"step": name, "status": status}


# Any of these being present in the environment would make the module talk to a
# real deployment. Tests must never trigger production cache invalidation.
_ENV_KEYS = ("REVALIDATE_URL", "WEB_ORIGIN", "REVALIDATE_SECRET", "ADMIN_SECRET_KEY")


class SelectCacheTagsTests(unittest.TestCase):
    def test_no_tags_when_price_sync_failed(self):
        steps = [
            step("sync_prices", "failed"),
            step("calculate_indicators", "success"),
            step("news_sentiment", "success"),
        ]
        self.assertEqual(ci.select_cache_tags(steps), [])

    def test_market_tag_requires_prices_and_indicators(self):
        steps = [step("sync_prices", "success"), step("calculate_indicators", "success")]
        self.assertIn(ci.TAG_MARKET, ci.select_cache_tags(steps))

    def test_market_tag_withheld_when_indicators_failed(self):
        steps = [step("sync_prices", "success"), step("calculate_indicators", "failed")]
        self.assertNotIn(ci.TAG_MARKET, ci.select_cache_tags(steps))

    def test_news_tag_only_when_news_step_succeeded(self):
        steps = [step("sync_prices", "success")]
        self.assertNotIn(ci.TAG_NEWS, ci.select_cache_tags(steps))
        steps.append(step("news_sentiment", "success"))
        self.assertIn(ci.TAG_NEWS, ci.select_cache_tags(steps))

    def test_recommendations_tag_uses_any_generator_step(self):
        steps = [step("sync_prices", "success"), step("generate_recommendations", "success")]
        self.assertIn(ci.TAG_RECOMMENDATIONS, ci.select_cache_tags(steps))
        steps = [step("sync_prices", "success"), step("evaluate_recommendations", "success")]
        self.assertIn(ci.TAG_RECOMMENDATIONS, ci.select_cache_tags(steps))

    def test_symbols_tag_requires_inventory_step(self):
        steps = [step("sync_prices", "success"), step("sync_inventory", "skipped")]
        self.assertIn(ci.TAG_SYMBOLS, ci.select_cache_tags(steps))

    def test_latest_status_wins_for_repeated_steps(self):
        steps = [
            step("sync_prices", "started"),
            step("sync_prices", "success"),
            step("calculate_indicators", "success"),
        ]
        self.assertIn(ci.TAG_MARKET, ci.select_cache_tags(steps))

    def test_failed_retry_after_success_blocks_market(self):
        steps = [
            step("sync_prices", "success"),
            step("sync_prices", "failed"),
            step("calculate_indicators", "success"),
        ]
        self.assertEqual(ci.select_cache_tags(steps), [])

    def test_no_steps_yields_no_tags(self):
        self.assertEqual(ci.select_cache_tags([]), [])

    def test_invalidation_skips_without_secret(self):
        steps = [step("sync_prices", "success"), step("calculate_indicators", "success")]
        with mock.patch.dict(os.environ, {key: "" for key in _ENV_KEYS}):
            with mock.patch("urllib.request.urlopen") as urlopen:
                result = ci.invalidate_daily_cache(steps)
        urlopen.assert_not_called()
        self.assertTrue(result["skipped"])
        self.assertEqual(result["invalidated"], [])

    def test_invalidation_posts_selected_tags_with_bearer_secret(self):
        steps = [
            step("sync_prices", "success"),
            step("calculate_indicators", "success"),
            step("news_sentiment", "success"),
        ]
        captured = {}

        class FakeResponse:
            status = 200

            def read(self):
                return b'{"ok":true}'

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def fake_urlopen(request, timeout=None):
            captured["url"] = request.full_url
            captured["auth"] = request.get_header("Authorization")
            captured["body"] = request.data
            return FakeResponse()

        with mock.patch.dict(
            os.environ,
            {"REVALIDATE_URL": "https://example.test/api/revalidate", "REVALIDATE_SECRET": "s3cret"},
        ):
            with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
                result = ci.invalidate_daily_cache(steps)

        self.assertFalse(result["skipped"])
        self.assertEqual(captured["url"], "https://example.test/api/revalidate")
        self.assertEqual(captured["auth"], "Bearer s3cret")
        self.assertIn(ci.TAG_MARKET, result["invalidated"])
        self.assertIn(ci.TAG_NEWS, result["invalidated"])
        self.assertNotIn(ci.TAG_SYMBOLS, result["invalidated"])


if __name__ == "__main__":
    unittest.main()
