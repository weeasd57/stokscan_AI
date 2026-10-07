# Daily execution repair — 7 October 2026

The Cairo session's daily_bot run `734d215e-20ac-4b6c-949c-07baa50ba69d`
completed its data flow from 17:00 to 17:28 Cairo. Its short_swings_daily stage
failed with `'<' not supported between instances of 'str' and 'Timestamp'`.
Standard recommendations were withheld independently because candidates did not
meet the existing 55% council threshold. No threshold or selection filter changes
were made by this repair.

## Cause and bounded repair

The live HF revision examined was `0a25982f5bf89d5a794395fe268c41f75eaa0a9b`.
It lacked the archive/REST date normalization already present in GitHub main.
Archive dates can be pandas Timestamps while the REST tail uses ISO strings;
sorting, filtering and JSON serialization require one date representation.
The canonical engine now normalizes each date to its ISO session date at both
source boundaries, preserving valid mixed formats and rejecting missing/invalid
dates instead of inventing numeric epoch dates. A 90-row synthetic archive plus
one REST candle exercises the full engine without provider/model calls.

## Completion and failure reporting

`daily_job_runs.status='completed'` remains the data-flow completion contract used
by the existing report route, social planner and durable scheduler deduplication.
It does not mean every independent stage succeeded. The job now returns an
explicit completed/partial/failed outcome to the scheduler. Both normal and
startup-catchup scheduling propagate it and count partial execution as unhealthy.
This avoids treating a caught stage exception as a completely successful run,
while preventing a restart from replaying an already completed daily flow.

Stage errors are summarized by stage name, using the latest outcome for each
stage. The reporting stage is now persisted too, including rejected reports or
image failures. Updating it preserves the completed data contract and completion
timestamp. Admin history now includes the saved steps, enabling its existing
partial-failure badge to work. Failed Supabase initialization returns a failed
outcome using the actual client rather than the truthy proxy wrapper.

## Verified report safety

Rejected LLM reports remain failed and unpublishable. The canonical report
responder now carries AnswerGate reasons in a typed error; the existing route
stores `validation.ok=false` and those reasons. Fallback/degraded responses are
also rejected with an explicit reason. No extra generation, automatic retry,
warning removal or relaxation of the gate was added. This improves diagnosis;
it is not evidence that today's rejected report content has been corrected.

## Validation and deployment boundary

34 targeted Python tests and 25 targeted web tests passed. TypeScript checking,
Python compilation and `git diff --check` passed. No production accuracy or trade
performance estimate is inferred from these fixture results.

Offline coverage includes date types, the archive/REST merge, partial/recovered
stage outcomes, cached images, report rejection, the real nested persistence
functions, scheduler health counting, Telegram delivery failures and permissions.
Telegram and metadata fixtures are isolated from external providers and local
symbol registries. Route tests prove rejected validation is stored and never
marked ready, with one responder invocation. Admin authorization remains intact.

No production daily replay, cloud-log scan, live LLM request, database mutation,
trade notification or social repost was performed during this repair.
The examined HF connector credential has read-repos/read-mcp/jobs scopes and no
repository write scope; the local CLI has no login. Backend activation therefore
requires authenticated repository write access. Do not report the HF server as
repaired until the runtime files are uploaded together and their revision is
verified. Upload the canonical `api/short_swings_engine.py`,
`api/daily_job_outcome.py`, `api/daily_bot_run.py` and
`api/daily_job_scheduler.py` in one bounded commit. Do not use the broad legacy
deploy script or upload local caches/models as part of this repair.

## Subsequent two-phase extension

The authorized midday refresh, short-stage recovery and website audit are recorded
in `docs/daily-two-phase-runbook-2026-10-07.md`. Its runtime upload list supersedes
the four-file list above. The private checkpoint migration and midday schedule
field were applied separately; backend activation still requires the verified HF
runtime deployment described there.
