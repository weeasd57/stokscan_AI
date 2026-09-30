# Signal explanations and portfolio performance — 2026-09-30

## Delivered

- Signal explanation in recommendation details and active market signal cards. Reuses saved rationale (arrays, rich JSON, serialized JSON), without AI calls or synthetic feature attribution.
- Entry risk, entry reward, reward/risk and distance from latest price to target. Direction-aware BUY/SELL arithmetic; unavailable levels stay unavailable, and profit-protection stops do not acquire a made-up positive risk.
- Brief indicator glossary, signal issuance date and market-card price session. Model metric explicitly distinguished from a guaranteed trade success probability. Saved rationale distinguished from independently verified news.
- Removed inferred ATR (entry minus stop), artificial 8% risk and clipped reward/risk in recommendation details. Preserved surrounding styles; corrected rationale text contrast in both themes.
- Expandable performance dashboard under the profile's existing portfolio summary. Reuses existing borders, yellow accent, shadows, Arabic/English direction and dark/light classes. Chart code loads lazily.
- Daily-close unrealized P/L, recorded realized P/L and holdings allocation/ranking. New sales preserve the average entry price at sale time in the existing event payload; no schema migration or backfill.
- Fixed-current-quantity historical comparison against EGX30 for 30/90/365 calendar days, equal starting points, common sessions and maximum drawdown. Changing period or reopening a loaded dashboard does not fetch again. Holdings edits invalidate the displayed report; quote-only snapshot changes do not.

## Data and privacy

- `/api/portfolio/performance` resolves identity through the existing viewer-context helper. User-supplied owner parameters are ignored. Private holdings and sale events use the cookie-backed client, explicit owner filters and existing RLS.
- The assembled report is `private, no-store`; Vercel/CDN caching is explicitly disabled for success and errors. Private portfolio information never enters the shared market cache.
- Public price histories use the anonymous, cookie-free market client and canonical per-symbol queries (latest 300 sessions). Existing Vercel Runtime Cache and HF-triggered daily refresh apply. No extra AI runs, polling, realtime subscriptions or HF jobs were added.
- Price-history cold misses are bounded to six concurrent reads. Sale events are paginated, capped at 10,000 with an explicit truncation flag. Failures are not rendered as successful zero-profit reports.
- Private frontend reports are tied to both account identity and holdings version; pending requests are aborted on change/close. No localStorage/sessionStorage of reports.

## Important limits

- The historical chart is a **simulation of current stock quantities**, not actual historical account equity or money/time-weighted performance. The existing account data lacks a complete, trustworthy equity/cash-flow history. Cash, actual trades, fees and separate cash distributions are excluded. The dashboard explicitly labels this distinction.
- Old sale events without sale-time cost cannot establish reliable realized P/L. Their proceeds are never treated as profit; the dashboard flags unknown sales and labels any known sum as partial. No legacy values were invented or rewritten.
- Exact common sessions are used, with no future prices or stale forward-fill. Missing symbols and actual comparison dates/coverage are shown. Adjusted closes are used consistently per stock; incomplete adjusted series fall back to raw closes with a corporate-action warning.
- Existing main portfolio summary behavior and chatbot live valuations were not changed; the new dashboard's figures are separately labelled daily-close values.
- No production deployment, schema migration or production data backfill was performed.

## Verification

- Six focused Jest suites: **73 tests passed** (math, UI interactions, API authorization/cache policy, existing portfolio tools, shared market cache).
- `npx tsc --noEmit`: passed.
- `npm run build`: passed, exit 0. Existing unrelated dynamic-route/static-generation and local Runtime Cache fallback messages remain in output.
- Anonymous public read checked: COMI and EGX30 each returned 300 historical rows, latest session 2026-09-30.
- Real unauthenticated HTTP request, including an arbitrary `user_id` parameter: 401; private/no-store headers preserved.
- Existing `positions`/`position_events` RLS and owner predicates inspected read-only.
- Broad `npm test` was interrupted after discovering older, unguarded live AI tests (including a failure); it must not be reported as passing. No additional live-chat test run was requested.
- Standalone ESLint could not run because the repository lacks an ESLint configuration. No dependency/config changes were made for this.
- Browser visual inspection was attempted, but the browser tool repeatedly timed out establishing CDP access, including after one reset. UI behavior tests passed; a real desktop/mobile visual pass remains outstanding.
