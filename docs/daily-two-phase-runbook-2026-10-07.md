# Two-phase daily operation and short-swing recovery — 7 October 2026

This extends the existing HF scheduler and daily pipeline. It does not change
ordinary recommendation strategy, council threshold (55%), chatbot architecture,
or social publishing protocol.

## Cairo schedule and isolation

Sunday–Thursday, using Africa/Cairo including DST:

| Phase | Default time | Work |
| --- | --- | --- |
| Midday (`daily_midday`) | 12:15 | Shared prices, indicators, ML scores, news/corporate actions, heatmap, deterministic market status and short-swing monitoring |
| After close (`daily_bot`) | 17:00 | Existing complete daily pipeline, including ordinary recommendations, positions and reports; short-swing stage uses closed-session rules |

Midday returns before all ordinary recommendation/position/report operations. It
does not generate LLM reports, images or social posts. After 14:30, a missed midday
slot is not replayed. Restart catch-up runs only the currently due phase. Each
phase has a separate daily_job_runs identity. Active heartbeat blocks concurrent
attempts; stale heartbeat recovery retains the failed row for audit. Full job
attempts are bounded to three per process/date/phase with 15-minute backoff.
Completed full runs are not replayed because an independent short stage failed.

Both phases explicitly refresh the latest bars even when today's date already
exists. This avoids treating the midday candle as the final after-close candle.
For an already populated history, this remains an incremental latest-bar fetch.

## Partial-session rules

The short engine labels phase, session_complete and computed_at. Today's partial
candle can fill an already planned opening or trigger an existing defensive stop.
It cannot establish close-based exit/progression, advance a next-session trailing
stop, or create new pending breakouts. Those decisions remain after-close work.
Existing liquidity, momentum, gap, stop and holding filters are unchanged.

Missing current-session prices return null (including return_pct and price_date),
not entry-price-as-current-price or a fabricated 0% return. Such rows cannot
produce a Telegram price update. Archive/REST dates remain normalized and the
same-date live bar replaces the archive's partial bar.

## Durable short-stage completion and Telegram ownership

Migration `20261007173521_short_swing_checkpoints.sql` creates a private, RLS-enabled
checkpoint table. anon/authenticated cannot read it; service_role owns its writes.
This is not public market_cache: it holds frozen PRO messages and delivery receipts.
The migration has been applied to project gfcmaxbtscmizsakarvc and grants verified.
The saved schedule has midday_run_time 12:15 and existing run_time 17:00.

A short phase must claim its unique session/phase checkpoint via insert or version
compare-and-set before proceeding. A successful calculation is frozen once;
delivery retries use that snapshot and do not rerun the full daily job. Current
session and matching phase are required. Cached old dates are ineligible.

Each entry/exit/channel has one independent durable event. Entry and exit keys are
shared across phases; monitoring updates have phase-specific keys. Known legacy
sent entries/exits suppress duplicate sends. New entries are only current-session
pending signals after close. Open positions receive VIP monitoring updates with
current-session stored prices. Existing Free exit filtering is retained.

The managed dispatcher disables the Telegram bot's separate background retry
queue and automatic VIP mirroring. It owns one signal/channel message at a time.
A successful response requires receipts; confirmed rejection (e.g. 429) can retry
only that failed event, after 15 minutes, up to four attempts. Timeout, missing
receipts, partial delivery or an abandoned dispatching claim is ambiguous and is
never automatically resent. The phase stays visibly unhealthy until read-only
receipt reconciliation resolves the ambiguity; do not delete claims to resend.
A failed channel never causes a successful channel to resend.

The scheduler checks unfinished short phases every 15 minutes while that phase is
currently due, and stops checking terminal completion in process. Upgrade recovery
can resume today's older failed/started short stage only when price sync was
recorded successful and the full job is no longer running. Successful recovery
appends a short-stage success event to the original job without deleting its
failure history or changing the completed daily-flow contract.

## Website audit and display corrections

Public API and actual rendered page were reviewed on 7 October. The API snapshot
was still as_of 2026-09-24, with three old open rows and 271 displayed 2026 closed
rows. This was not evidence that the current session completed. Latest separately
stored stock_prices rows were read only for CCAP, MFPC and ETEL on 6–7 October.

| Symbol | Site snapshot price | Stored 7 October close |
| --- | ---: | ---: |
| CCAP | 7.09 | 6.62 |
| MFPC | 40.921 | 46.50 |
| ETEL | 118.377 | 148.00 |

The site showed MFPC/ETEL returns of 0% because the old engine substituted entry
price when its last-session candle was missing. This is a missing-data defect,
not a verified flat result. Current prices cannot simply be patched into old
positions: intervening stop/exit/entry history must be computed by the repaired
shared engine first.

The UI now shows the saved session date and provisional midday label, preserves
missing returns as unavailable, derives KPI sample size from kpis.total_trades
(the examined API sample was 1,080 rather than the hardcoded 1,796), and describes
stored-price monitoring without a false realtime claim. Fixed +81.5% marketing
examples were removed. The displayed performance remains simulation, not realized
trades or a guarantee. Telegram links now target the verified page
`/scanner/backtests?tab=short_swings`; the old root query opened the landing page.
Backend and frontend proxies preserve the new phase/freshness metadata without
changing entitlements or masking.

## Verification and deployment boundary

79 targeted offline Python tests passed, including actual midday early-return
isolation, date merge, CAS races, same-date incremental sync, frozen snapshots,
confirmed rejection, ambiguous outcomes, managed Telegram queue ownership and
upgrade recovery. Four targeted web tests passed for admin schedule independence,
missing return formatting, saved-session visibility and API-derived KPI sample.
TypeScript checking and production compilation/lint passed. Full local build
collection stopped because the scratch environment has no Supabase URL configured
for the existing admin-access-log route; no credentials were invented to bypass
that check. No full daily production replay, live LLM/image call, cloud-log query, old-date
notification or historical database download was performed as a test.

GitHub changes do not activate HF by themselves. Backend deployment must upload
these canonical runtime files together in one commit: daily_bot_run.py,
daily_job_scheduler.py, daily_job_outcome.py, daily_recovery_state.py,
short_swings_daily.py, short_swings_engine.py, smart_sync.py,
tradingview_integration.py, telegram_bot.py, routers/short_swings.py and root
daily_job_config.json. Never upload models, cache snapshots or local credentials.
The examined HF revision was 0a25982f5bf89d5a794395fe268c41f75eaa0a9b; its available
connector is read-only and the local CLI is not authenticated. Verify a new HF
revision/runtime before claiming either slot or the recovery worker is active.

## Website presentation update (HF upload explicitly deferred)

The short tab now uses a compact header and responsive trade cards, with a
collapsed strategy guide and lighter navigation/KPI tiles. Ordinary recommendation
warning banners no longer appear in the short tab. Cards and details display the
saved session, quote, entry and stop rather than implying a realtime update.

Frontend presentation checks recognize the older HF entry-price placeholder only
when it conflicts with the recorded raised stop/protection and has no EMA quote.
That quote/return is displayed as unverified; no replacement price is invented or
saved. A legitimate measured zero with valid data remains 0%. Pending entry has
no claimed return, locked cards reveal no supplied ticker/prices, and fetch failure
has its own error state rather than an empty portfolio. Refresh reloads the saved
snapshot without `refresh=true`, so it cannot request HF recomputation.

Ten targeted offline web tests passed for these states and Cairo date boundaries.
TypeScript and a production compile-mode build passed; this mode avoids generating
pages against absent local production credentials. Actual Vercel deployment status
must be checked separately. No backend, scheduling, strategy, entitlement or HF
files changed in this presentation update.
