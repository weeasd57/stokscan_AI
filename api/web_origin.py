"""Resolve the public web origin used in Telegram and other user-facing links.

`WEB_ORIGIN` is a local development value ("http://localhost:3000") in many
environments. Emitting that value inside Telegram messages sends users to an
unreachable address, so every link builder must go through this helper instead
of reading the environment variable directly.
"""

import os

DEFAULT_WEB_ORIGIN = "https://egxbots.com"


def get_web_origin() -> str:
    """Return a public, user-reachable web origin.

    Falls back to the production domain when ``WEB_ORIGIN`` is unset, blank,
    not an HTTP(S) URL, or points at a local development host.
    """
    origin = (os.getenv("WEB_ORIGIN") or "").strip().rstrip("/")
    if not origin or not origin.startswith("http"):
        return DEFAULT_WEB_ORIGIN
    if "localhost" in origin or "127.0.0.1" in origin or "0.0.0.0" in origin:
        return DEFAULT_WEB_ORIGIN
    return origin
