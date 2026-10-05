# Daily branded social reports

HF generates four verified LLM report types after the daily data job. It renders
immutable 1200x1200 PNGs using bundled Cairo font and the real site logo, uploads
each once to the public `social-reports` bucket, and saves the caption, title,
hashtags and image URL with the report. No paid image API or extra LLM is used.
The daily pipeline still produces four reports. Only Monday/Wednesday sessions
produce social posts: one selected report on each platform. All publication
inputs must match the completed job and session.

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
workflow was verified with real scheduled posts on 2026-10-04. TikTok subsequently
rejected PNG at publication: scheduling acceptance alone does not validate format.

Prepare it with `python scripts/prepare_social_attachment.py --date YYYY-MM-DD
--url PUBLIC_IMAGE_URL`. The script restricts downloads to this project's report
bucket and session path, validates MIME/signature/dimensions and returns JSON
containing the absolute attachment `path`. Use `--platform facebook` for the
original 1200x1200 PNG and `--platform tiktok` for a real RGB JPEG resized to
1080x1080 with the same design, no crop, below 5 MiB. One image is attached per post.
TikTok accepts image/jpeg or image/webp, not image/png. Never just rename PNG.

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

For TikTok use `network: tiktok`; `tiktokData.title` uses saved `social_title`,
at most 90 UTF-16 units. Reject oversized titles instead of silently cutting them.
Do not invent privacy values; if account settings require explicit choices the
connector cannot supply safely, report the error for the user. No music or video
conversion is required for a photo post. Pass the platform-specific image's absolute local
path in `mediaFiles`, once. A successful response has exactly one media URL.
Verify the returned post has media and the correct provider, then reconcile using
`getscheduledposts`. Scheduling acceptance is not proof of successful publication.
For TikTok verify the hosted attachment responds with image/jpeg, not image/png.
TikTok auto-publish captions must be at most 2000 characters including the title,
tracked link, hashtags and disclaimer. Prefer a concise summary under 1800;
preserve session date, key facts, risks and educational disclaimer. Do not cut
text mid-sentence or remove risk warnings to fit. Facebook retains the full report.
Before sending, pipe the final caption into
`python scripts/social_caption_guard.py --platform tiktok --title SAVED_TITLE`.
This checks UTF-16 length conservatively (emoji count twice), the separate title
limit, and fails closed above 2000 combined units. The Metricool path's stricter
2000 limit is used even though TikTok's native photo description allows 4000.
TikTok text is a single line because the Metricool photo API does not support
line breaks. Facebook keeps the full saved report and its paragraph formatting.
When repairing the rejected post, replace its media (clear old media before passing
the new local attachment), reschedule that same UUID, and never resend Facebook.

If editing an existing post, keep its full returned content and original UUID,
but omit automatically returned `twitterData` / `instagramData` (or other
network-specific defaults) for networks absent from `providers`: the connector's
validator rejects them. Updating assigns a new post ID; persist that new ID.

## Durable deduplication

Check `daily_social_publications` and Metricool first. Build and validate both
payloads and attachments, then call the service-only RPC
`reserve_daily_social_publications(p_session_date, p_kind, p_tiktok_at)` once.
It returns both new claims atomically or fails. Never use raw INSERT/ON CONFLICT
as a sending claim: the old protocol has been replaced. Only the invocation that
received BOTH newly inserted rows may send. A pre-existing claim is not permission
to send. Store post ID/planner URL and `scheduled` after each platform succeeds.
An ambiguous result stays `ambiguous` until read-only reconciliation; never retry
it blindly. Do not reset claims on timeouts. One platform's success must never be
resent after the other's failure. Record errors and updated_at on failed/ambiguous
results. Do not delete ledger rows or alter reservation dates to obtain more slots.

`social_publication_monthly_quota` limits reservations to 20 per Cairo calendar
publication month. Each network costs one slot. Claimed, scheduled, published,
failed and ambiguous rows all count conservatively; uncertain sends never free
a slot automatically. Row updates serialize concurrent claims, and both claims
roll back if either month has insufficient capacity. Across a month boundary,
Monday TikTok counts in its publication month and Tuesday Facebook in the next.
Existing October publications are included. At most 8–10 eligible sessions per
month give 16–20 posts; extra/manual posts reduce available capacity and a full
pair is skipped when fewer than two applicable slots remain. Metricool may enforce
its own limit; do not bypass it or retry the provider error repeatedly.
The ledger and quota tables are private/service-only; the images alone are public.

## Deterministic planner

Run `python -m scripts.social_publish_plan --input INPUT.json` from the repository
root. Input is `{ "session_date": "YYYY-MM-DD", "reports": [...], "jobs": [...] }`:
select only today's four `daily_social_reports` rows and today's relevant
`daily_job_runs` (`id,job_type,status,completed_at`). Include report status,
validation, job_run_id, image fields, saved title/caption/hashtags and kind.
Require completed daily_bot with the same Cairo session date, ready report,
validation.ok, ready immutable v4 image and saved caption/title.

Monday prefers market, Wednesday stock; fallback is the other kind, accumulation,
then follow_up, only if fully verified. The same report feeds both networks.
The planner retains the full saved Facebook text. For TikTok it selects whole
paragraphs: opening facts, all explicit scenarios, risks, warning paragraphs and
conclusion, then optional paragraphs within the preferred 1800-unit budget.
It appends the disclaimer and tracked site link, preserves the source session
date and numbers, and rejects a required summary over 2000 instead of truncating.
No new LLM generation or provider request is made. Review the output if it fails;
do not substitute a stale report or delete its warnings to force a send.

Output includes reservation arguments, dates, info payloads, attachment URLs and
caption counts. Prepare both platform attachments before claiming. Pass only the
selected platform's local attachment path as mediaFiles; do not duplicate it in info.
Before claiming, ensure the current time is still before BOTH planned dates;
rebuild the plan if preparation crossed the TikTok target. After claiming, send
once per platform, verify exactly one returned media/provider and reconcile IDs
with getscheduledposts. Preserve ambiguous claims on connector timeouts.

## Timing and tests

Image preparation runs immediately after report generation on HF. A scheduled
automation at 18:30 Monday/Wednesday Cairo replaces the old Sun–Thu desktop
heartbeat publishing protocol. It schedules TikTok at 18:45 the same session and
Facebook at 10:00 the following Tuesday/Thursday, explicitly dated to the source
session. Both posts are queued during that one run. There are no hourly repeats.
The database rejects the old claim protocol (missing publication_at), other session
days, stale dates and wrong publication times. An old heartbeat cannot acquire a
new sending claim. Its external host configuration is not stored in this repo.
If the report isn't ready, don't publish an old report or a text-only fallback;
notify the user of the delay. This is a scheduled run, not an HF completion webhook.
If the run starts after 18:45, use now + 10 minutes for TikTok in that same Cairo
session day; Facebook remains next day 10:00. If too late, skip instead of posting
on a different session day. Tool/host failures require notification, not blind retry.
No historical test report (2026-10-01) may be published.

Run `python -m pytest tests/test_social_publish_plan.py tests/test_social_caption_guard.py tests/test_social_attachment.py tests/test_daily_social_reports.py tests/test_social_report_images.py -q`.
Use offline image fixtures. Do not publish live test posts or rerun the daily job.

Official limits: https://metricool.com/what-is-metricool/ (Free: 20 publications,
one brand; cross-posting counts per network), https://help.metricool.com/schedule-and-post-on-tiktok-bkepi
and https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post
(TikTok native photo title: 90 UTF-16 units). Verify the current connector limits
before changing this conservative policy.
