"""Event-driven CDN cache invalidation for the daily job.

After the daily Python job finishes, the public Next.js routes that serve
daily data must stop serving yesterday's cached payloads. Each route tags its
CDN response with one of the `daily-*` cache tags; this module asks Vercel to
invalidate exactly the tags whose data was refreshed successfully.

Rules:
  * Nothing is invalidated when the essential price sync failed.
  * A tag is invalidated only when every step feeding it succeeded.
  * Network/HTTP failures are logged and never break the daily run.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, List, Optional

TAG_MARKET = "daily-market-data"
TAG_NEWS = "daily-news-data"
TAG_RECOMMENDATIONS = "daily-recommendations"
TAG_SYMBOLS = "daily-symbols"

# Steps that must complete before a tag's data can be considered refreshed.
# `required_all` must every succeed; `required_any` needs at least one, which
# keeps invalidation working when a run performs only part of a pipeline.
TAG_STEP_REQUIREMENTS: Dict[str, Dict[str, tuple]] = {
    TAG_MARKET: {"required_all": ("sync_prices", "calculate_indicators"), "required_any": ()},
    TAG_NEWS: {"required_all": ("news_sentiment",), "required_any": ()},
    TAG_RECOMMENDATIONS: {"required_all": (), "required_any": ("generate_recommendations", "evaluate_recommendations")},
    TAG_SYMBOLS: {"required_all": ("sync_inventory",), "required_any": ()},
}

# Losing the price sync makes every downstream daily payload stale, so the run
# must not advertise fresh data at all.
ESSENTIAL_STEPS = ("sync_prices",)

_SUCCESS_STATUSES = {"success", "completed", "skipped"}


def _latest_step_status(steps: Iterable[Dict[str, Any]]) -> Dict[str, str]:
    latest: Dict[str, str] = {}
    for step in steps or []:
        name = str(step.get("step") or step.get("name") or "").strip()
        if not name:
            continue
        latest[name] = str(step.get("status") or "").strip().lower()
    return latest


def select_cache_tags(steps: List[Dict[str, Any]]) -> List[str]:
    """Return the cache tags that a completed run may safely invalidate."""
    latest = _latest_step_status(steps)

    for step in ESSENTIAL_STEPS:
        if latest.get(step) != "success":
            return []

    tags = []
    for tag, requirements in TAG_STEP_REQUIREMENTS.items():
        required_all = requirements.get("required_all", ())
        required_any = requirements.get("required_any", ())
        all_ok = all(latest.get(step) in _SUCCESS_STATUSES for step in required_all)
        any_ok = (not required_any) or any(latest.get(step) in _SUCCESS_STATUSES for step in required_any)
        if all_ok and any_ok:
            tags.append(tag)
    return tags


def _revalidate_endpoint() -> Optional[str]:
    explicit = (os.getenv("REVALIDATE_URL") or "").strip()
    if explicit:
        return explicit
    origin = (os.getenv("WEB_ORIGIN") or "").strip().rstrip("/")
    if not origin or "localhost" in origin or "127.0.0.1" in origin:
        return None
    return f"{origin}/api/revalidate"


def invalidate_daily_cache(steps: List[Dict[str, Any]], timeout: float = 310.0) -> Dict[str, Any]:
    """Ask Vercel to invalidate the daily cache tags for a completed run."""
    tags = select_cache_tags(steps)
    if not tags:
        print("[CACHE] No cache tags to invalidate (essential step not successful).")
        return {"invalidated": [], "skipped": True}

    endpoint = _revalidate_endpoint()
    secret = (os.getenv("REVALIDATE_SECRET") or os.getenv("ADMIN_SECRET_KEY") or "").strip()
    if not endpoint or not secret:
        print("[CACHE] Revalidation skipped: REVALIDATE_URL/WEB_ORIGIN or REVALIDATE_SECRET not configured.")
        return {"invalidated": [], "skipped": True}

    # Stable across HTTP retries: Vercel stages data before switching generation.
    payload = json.dumps({"tags": tags, "event_id": datetime.now(timezone.utc).isoformat()}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="ignore")
        print(f"[CACHE] Invalidated {tags}: HTTP {response.status} {body[:200]}")
        return {"invalidated": tags, "skipped": False, "status": response.status}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore")[:200]
        print(f"[CACHE] Revalidation HTTP {error.code}: {detail}")
        return {"invalidated": [], "skipped": False, "error": f"HTTP {error.code}"}
    except Exception as error:  # network, DNS, timeout — never break the job
        print(f"[CACHE] Revalidation failed: {error}")
        return {"invalidated": [], "skipped": False, "error": str(error)}
