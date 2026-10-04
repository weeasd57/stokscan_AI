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
`blogId`, future `date`, `info` (serialized JSON), `mediaFiles` (local absolute
file paths in the Codex desktop connector, NOT public URLs).

Download the existing verified public PNG once into a unique temporary folder.
Validate the response MIME, PNG signature and size before attaching. This is a
copy of the saved report image, not regeneration. Pass its absolute local path
in `mediaFiles`. Do not also put the same image in `info.media`: the connector
appends attachments, and doing both creates duplicate images. The local-file
workflow was verified with real Facebook and TikTok scheduled posts on 2026-10-04.

Prepare it with `python scripts/prepare_social_attachment.py --date YYYY-MM-DD
--url PUBLIC_IMAGE_URL`. The script restricts downloads to this project's report
bucket and session path, validates MIME/signature/dimensions and returns JSON
containing the absolute attachment `path`. Reuse that same file for both platforms.

Use one request per platform so retries cannot duplicate a successful platform:

```json
{
  "publicationDate": {"dateTime": "FUTURE_LOCAL_DATETIME", "timezone": "Africa/Cairo"},
  "text": "VERIFIED_SAVED_SOCIAL_CAPTION_WITH_TRACKED_SITE_LINK",
  "providers": [{"network": "facebook"}],
  "autoPublish": true,
  "draft": false,
  "saveExternalMediaFiles": true
}
```

For TikTok use `network: tiktok`; `tiktokData.title` may use saved `social_title`.
Do not invent privacy values; if account settings require explicit choices the
connector cannot supply safely, report the error for the user. No music or video
conversion is required for a photo post. Pass the downloaded PNG's absolute local
path in `mediaFiles`, once. A successful response has exactly one media URL.
Verify the returned post has media and the correct provider, then reconcile using
`getscheduledposts`. Scheduling acceptance is not proof of successful publication.

If editing an existing post, keep its full returned content and original UUID,
but omit automatically returned `twitterData` / `instagramData` (or other
network-specific defaults) for networks absent from `providers`: the connector's
validator rejects them. Updating assigns a new post ID; persist that new ID.

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
one desktop heartbeat run at 18:30, Sunday–Thursday Cairo, scheduling one post
per platform for 18:40 after checking HF completion. There are no hourly repeats.
If the report isn't ready, don't publish an old report or a text-only fallback;
notify the user of the delay. It is not an HF completion webhook, and requires
this desktop host to be available. If the run starts after 18:40, use one nearby
future time for that same session, never a past date or a second post.
No historical test report (2026-10-01) may be published.

Run `python -m pytest tests/test_daily_social_reports.py tests/test_social_report_images.py -q`
and `python scripts/social_image_preview.py`. Uploading historical sample images
is permitted for verification, but it does not publish a Facebook/TikTok post.
