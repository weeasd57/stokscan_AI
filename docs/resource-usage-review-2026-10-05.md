# Resource usage review — 2026-10-05

## What is confirmed

The supplied Supabase screenshots show Log Query 35.85/100 GB and Log Ingestion 0.23/1 GB, with zero overage. These are separate metrics. The screenshots do not identify who scanned the logs. No direct remote log-query implementation was found in the inspected application source; dashboard, connector or agent activity remains a possibility, not a proven cause.

The root and module AGENTS instructions now prohibit routine broad log scans and automatic expensive live verification. These rules affect tools that read project instructions; they cannot enforce behavior in an unrelated dashboard/tool. They do not reduce usage already recorded in the current billing cycle.

## Prioritized application candidates

| Priority | Evidence | Proposed change | Safeguard |
| --- | --- | --- | --- |
| 1 | RecommendationsTable polls `/api/user/quota` every 15 seconds while visible and logged in: up to 240 calls per mounted user-hour | Refresh on mount, return/focus and payment completion; consider short user-scoped deduplication and a slower fallback only if necessary | Preserve Free-to-Pro updates, revocation and route-level authorization; never public-cache quota |
| 2 | RecommendationsTable force-refreshes locked recommendations every 65 seconds while Pro access and locked rows coexist; the effect has no visibility check or retry limit | Inspect underlying request deduplication, then add a retry cap, backoff and hidden-tab pause | Preserve tier redaction and allow explicit retry after failure |
| 3 | BacktestTab uses a 15-second fallback during an active job when no realtime event has been seen | Verify overlap protection and visibility behavior; use adaptive fallback if warranted | Keep completion/progress tracking; this is not a permanent idle poll |
| 4 | Shared market/news/report daily cache helpers and tag invalidation already exist | Check endpoints for accidental bypass, duplicate origin reads and unnecessary cache invalidation | Keep authenticated data isolated and expose the actual session date |

The quota estimate is an arithmetic upper bound from the interval, not observed traffic or a monetary saving. Establish endpoint counts/cache hits before and after runtime changes to measure the result.

## Not targets based on current evidence

- LiveBotTab's one-second interval updates a local uptime label; it does not issue a request.
- The AI chat route's 12-second heartbeat is a keepalive on an active stream, not a Supabase log scan.
- Security/error logs, authorization and data freshness must not be disabled to save resources.

## Implementation order

1. Apply agent resource rules immediately; verify documentation without building or calling providers.
2. Address the permanent quota polling, with tests for payment upgrade and entitlement changes.
3. Bound the recommendation recovery loop, with offline retry/visibility tests.
4. Measure targeted request counts and cache effectiveness; optimize only remaining demonstrated hotspots.

This review changes instructions only. Application polling behavior has not been modified by this documentation change.
