# Daily branded social reports

HF generates four verified LLM report types after the daily data job. It renders
immutable 1200x1200 PNGs using bundled Cairo font and the real site logo, uploads
each once to the public `social-reports` bucket, and saves the caption, title,
hashtags and image URL with the report. No paid image API or extra LLM is used.
Five sessions per week produce one selected report on each platform, not four
posts per day. All publication inputs must match the completed job and session.

## Metricool connector payload

Verified official schemas:
https://app.metricool.com/api/swagger.json (`ScheduledPost`, `ProviderStatus`,
`ScheduledPostFacebookData`, `ScheduledPostTikTokData`). The connector accepts
`blogId`, future `date`, `info` (serialized JSON), `mediaFiles` (public URLs).

Use one request per platform so retries cannot duplicate a successful platform:

```json
{
  "publicationDate": {"dateTime": "FUTURE_LOCAL_DATETIME", "timezone": "Africa/Cairo"},
  "text": "VERIFIED_SAVED_SOCIAL_CAPTION_WITH_TRACKED_SITE_LINK",
  "providers": [{"network": "facebook"}],
  "autoPublish": true,
  "draft": false,
  "saveExternalMediaFiles": true,
  "media": ["VERIFIED_PUBLIC_IMAGE_URL"]
}
```

For TikTok use `network: tiktok`; `tiktokData.title` may use saved `social_title`.
Do not invent privacy values; if account settings require explicit choices the
connector cannot supply safely, report the error for the user. No music or video
conversion is required for a photo post. Pass the image URL in `mediaFiles` too.
Verify the returned post has media and the correct provider, then reconcile using
`getscheduledposts`. Scheduling acceptance is not proof of successful publication.

## Durable deduplication

Check `daily_social_publications` and Metricool first. Select the same kind for
both platforms. Claim `(session_date,platform)` using INSERT with ON CONFLICT DO
NOTHING RETURNING, before sending. Only a newly acquired claim may send. Store
post ID/planner URL and `scheduled` after success. An ambiguous result stays
`ambiguous` until read-only reconciliation; never retry it blindly. Do not reset
claims on timeouts. One platform's success must never be resent after the other's
failure. The private table is service-only; the images alone are public.

## Timing and tests

Image preparation runs immediately after report generation on HF. Publishing is
still a desktop heartbeat check at 17:40–21:40 hourly, Sunday–Thursday Cairo; it
is not an HF completion webhook, and requires this desktop host to be available.
No historical test report (2026-10-01) may be published.

Run `python -m pytest tests/test_daily_social_reports.py tests/test_social_report_images.py -q`
and `python scripts/social_image_preview.py`. Uploading historical sample images
is permitted for verification, but it does not publish a Facebook/TikTok post.
