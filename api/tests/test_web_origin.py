import os
import unittest
from unittest.mock import patch

from api.web_origin import DEFAULT_WEB_ORIGIN, get_web_origin


class WebOriginTests(unittest.TestCase):
    def test_localhost_origin_falls_back_to_public_domain(self):
        with patch.dict(os.environ, {"WEB_ORIGIN": "http://localhost:3000"}):
            self.assertEqual(get_web_origin(), DEFAULT_WEB_ORIGIN)

    def test_loopback_origin_falls_back_to_public_domain(self):
        for origin in ("http://127.0.0.1:3000", "http://0.0.0.0:3000"):
            with patch.dict(os.environ, {"WEB_ORIGIN": origin}):
                self.assertEqual(get_web_origin(), DEFAULT_WEB_ORIGIN)

    def test_missing_or_invalid_origin_falls_back_to_public_domain(self):
        for origin in ("", "   ", "egxbots.com"):
            with patch.dict(os.environ, {"WEB_ORIGIN": origin}):
                self.assertEqual(get_web_origin(), DEFAULT_WEB_ORIGIN)

    def test_public_origin_is_preserved_without_trailing_slash(self):
        with patch.dict(os.environ, {"WEB_ORIGIN": "https://egxbots.com/"}):
            self.assertEqual(get_web_origin(), "https://egxbots.com")


if __name__ == "__main__":
    unittest.main()
