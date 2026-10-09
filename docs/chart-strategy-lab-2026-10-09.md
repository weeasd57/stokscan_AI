# Chart strategy lab — 9 October 2026 (Cairo)

## Scope

The existing `/chart` page hosts 1/2/3/4/6/8 independent chart panels with a bottom toolbar. Mobile displays the selected panel with navigation. The existing Lightweight Charts renderer remains responsible for candles, indicators and manual drawings. A shared deterministic TypeScript engine produces strategy overlays and simulated trades; the LLM selects tools and explains measured evidence.

## Implementation map

- `web/src/components/strategy-lab/StrategyWorkspace.tsx`: panel selection, workspace persistence, daily history deduplication, AI result targeting.
- `web/src/components/strategy-lab/LabTools.tsx`: strategy catalog, comparison, scenarios, trade sizing, false breakout research, relative performance, manual valuation and sourced event notes.
- `web/src/components/strategy-lab/LabDialogShell.tsx`: one accessible Radix shell for all eight tool dialogs using the site's `app-panel-strong`, control, chip and gold action tokens; keyboard focus, Escape, RTL and both themes are retained. Indicator and drawing-properties surfaces in the chart use the same site tokens.
- `web/src/lib/strategy-lab/index.ts`: ten analytical techniques, causal signals, next-open backtesting, Sunday-based EGX weekly/monthly aggregation and deterministic utilities.
- `web/src/components/TradingViewChart.tsx`: structured overlays, scoped manual drawings, visible-time synchronization and draggable trade levels.
- `web/src/lib/ai/chart-strategy-tools.ts`: `list_chart_strategies`, `apply_chart_strategy`, `compare_strategies_history`, bounded direct projected Supabase reads, compact model evidence and structured UI actions.
- `web/src/contexts/ChatContext.tsx`: request context/owner/generation guard; applies successful canonical JSON/SSE actions only to the still-current workspace.
- `web/src/app/api/chart-workspace/route.ts`: authenticated private GET/PUT; owner comes from `getUser`, never request input; bounded schema-checked JSON.
- `web/src/app/api/chart-events/route.ts`: cached public projection of existing dated, linked corporate-action announcements; symbol/date bounds and 30 rows maximum, no generation or ingestion writes.
- `supabase/migrations/20261008222339_chart_strategy_workspace.sql`: one workspace per user, explicit grants and ownership RLS policies.

## Calculation boundaries

Four named rule-based approximations are tradable: prior-range price action, high-volume range breakout (Wyckoff approximation), prior-low liquidity sweep/reclaim with bullish close (SMC approximation, exiting on a bearish upper sweep or loss of the prior low), and MACD signal crossovers. The other six are drawing studies. Users can select any of the ten for visual comparison; performance ranking excludes the six studies and returns their IDs with explanatory warnings, never simulated zero performance as a substitute. Returned analyses preserve the exact window and parameters when drawn, including a custom lookback or AI request.

Harmonic candidates use confirmed pivots and ratio constraints. Elliott candidates use explicit five-wave constraints. Both need human review and do not execute trades. Gann uses a stated price/time scale. Volume Profile allocates daily bar volume to its typical price and is explicitly approximate. Time cycles are bar-count research; no astronomical feed or calibrated forecast probabilities are supplied.

Signals use only information available at bar close, and trades execute at the next bar open. The simulator is long-only with integer shares, configurable commission/slippage and no leverage. It does not simulate intrabar stop/target fills. Ending positions are valued at liquidation costs and are not counted as closed trades. Profit factor is null when its denominator is unavailable. Few closed trades trigger a sample-size notice.

Buy-and-hold uses the same capital and costs. A chronological holdout is offered; there is no optimizer. Changing settings after observing holdout results invalidates its independence. Daily price adjustment for splits/distributions must be established before results can be relied on; this work does not change the market ingestion pipeline.

Trade sizing is a calculator, not broker execution. Scenario paths are conditional illustrations without probability percentages. Valuation uses manually supplied positive dated EPS and an explicit P/E range. Stored dated announcements come from the existing corporate-actions classifier and show sources; they are not presented as verified event dates. Manual event notes remain separate and require source links. Relative performance requires shared dates and reports price return rather than dividends/total return.

## Resources and privacy

Daily history is shared across panels/tools for each symbol with a bounded client snapshot cache. There is no polling, provider generation, production daily job or background cache rebuild introduced. Per-user workspace and drawings remain private. An unavailable cloud table falls back visibly to user-scoped local storage; it never claims a cloud save succeeded.

AI data tools select explicit OHLCV columns with a maximum of 1,000 daily rows and deduplicate reads inside a request. Existing model call, deadline and repair budgets remain unchanged. Canonical chart actions are emitted only after publication review passes. A stale response is ignored after changing the chart context, account, or workspace generation, including A → B → A transitions.

## UI refinements requested after the first build

The timeframe/history-count selectors were removed from panel headers. Each header now has a visible symbol-change button and accepts Enter. The toolbar uses a solid theme surface with per-panel persisted hide/show controls. Applied strategies, tool overlays and manual drawings appear in a compact visible strip with independent visibility/delete controls, plus a scrollable full additions list. Hiding a manual drawing never removes its canonical saved data. Deleting a trade level removes its entire trade group and sizing settings together.

Panel symbol selection now uses a company-name/symbol autocomplete with 250 ms debounce, a 12-result EGX limit, request cancellation and keyboard navigation. Selecting a confirmed result affects only its panel; submitting while loading, without results or after a search failure cannot replace the stock with an unverified identifier. The popup is portaled outside the grid's clipped panels. A bounded local API check returned COMI with its company name, and 16 focused search/workspace interaction tests passed.

Comparisons update immediately on strategy, cost, capital, lookback and window edits using the existing loaded candles. Edited AI results become explicitly local results; all original indicator periods are preserved unless changed. Valid drafts survive reopening. Invalid/empty drafts clear stale comparison executions. Local callbacks preserve unrelated strategy analyses and tool groups. Up to 100 tool overlays are supported; existing unrelated additions are retained when the limit is reached, and any omitted incoming overlays are reported explicitly. These refinements were checked with targeted offline UI/route/tool tests and TypeScript; the full-suite/build figures below describe the initial integrated build.

## Rollout

The SQL migration is prepared in the repository, not assumed applied to production. Cloud synchronization requires applying it and verifying owner/other-user/anonymous access in the target environment. Client-local persistence works before that. No production deployment or paid LLM smoke run is implied by offline tests or a local browser check.

## Validation record

Offline fixture checks cover causal signals, distinct SMC/price-action rules, costs, benchmark math, EGX weekly aggregation, invalid data, owner-only route behavior, independent panels and canonical chat actions with stale-context rejection. Local browser checks used bounded daily history and did not send a paid AI prompt.

- Full offline suite: 104 suites passed, 1,161 tests passed; 4 suites/22 tests skipped (live tests excluded by the offline configuration).
- `npx tsc --noEmit --incremental false`: passed after final integration.
- Independent QA review: PASS after resolving stale responses, shared drawing scopes, corrupt storage, invalid holdout inputs and exact comparison settings.
- Browser: confirmed four-panel rendering, strategy catalog, applied overlays and actual OHLCV history. Final visual recheck after styling was interrupted by the browser tool's local runtime failure (`failed to write kernel assets`). The latest dialog modes are covered by offline interaction tests, but mobile/theme visual checks are not claimed complete.
- Standalone ESLint command could not run because this repository has no ESLint configuration file. No unrelated lint configuration was introduced.
- `npm run build`: passed (64 pages). Local generation reported unavailable Runtime Cache/market data and existing dynamic-route diagnostics; the command exited successfully. This verifies compilation, not production data availability or cloud synchronization.
