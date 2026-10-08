# Repository Agent Instructions

These instructions apply to the entire repository, including AI assistants, reviewers and delegated agents. Nested AGENTS.md files add module-specific rules. Follow the user's requested scope; do not change production behavior merely because an optimization is suggested.

## Resource-conscious investigation

- Start with local code, `rg`, git diffs, existing test results and available status records. Reuse results within the task instead of repeating remote reads.
- Supabase Log Query measures logs scanned while reading; it is not database query count or visitor bandwidth. Log Ingestion measures generated logs. Do not attribute a usage spike to a particular actor without evidence.
- Do not open or query remote logs during routine reviews, successful builds or healthy monitoring. Query logs only for a specific failure that simpler status checks cannot explain.
- For an incident, start with one project, one relevant service and an explicit 15-minute interval around the failure; widen to at most 60 minutes initially if needed. Convert Cairo incident times to the requested timezone explicitly. Longer windows require a concrete diagnostic reason, not another user approval if investigation is already authorized.
- Filter by request/job ID, severity or endpoint where supported. A row LIMIT does not necessarily limit bytes scanned. Never repeatedly scan the same interval or all projects/services just to check progress.
- Prefer a narrowly filtered `daily_job_runs` read for job status over reading runtime logs. Select only required fields and rows. Stop polling at a terminal state; use bounded retries, backoff and in-flight deduplication.
- Do not dump entire price/history tables to answer a count or status question. Use bounded date/symbol filters, aggregates and targeted projections. Never print secrets or full environment files.

## Daily data and caching

- Reuse the existing HF daily pipeline and Vercel daily cache/tag invalidation for shared public market data. Do not add per-visitor daily calculations, LLM generation or database refresh jobs.
- Invalidate only affected tags after the relevant successful pipeline stage; do not flush or warm every cache on each diagnostic check or deployment.
- Private account, quota, payment and entitlement data must remain authenticated and isolated per user. Never apply shared public caching to them or weaken RLS/auth to reduce requests.
- Prefer explicit refresh events for public daily data. Network polling must have a real freshness requirement, be bounded, pause in hidden tabs where appropriate and stop when work completes.
- Distinguish local UI timers and active-stream keepalives from database/network polling before proposing their removal.
- Preserve error, security and operational audit logging. Do not disable logging, change database log settings or remove useful evidence merely to reduce usage.

## AI tools, verification and deployments

- Use deterministic checks and fixtures before paid/live LLM, image, video, search or inference calls. Reuse an existing approved asset/report; do not regenerate it just to verify publishing.
- Do not run daily production jobs, training, large backtests, cache rebuilds or live provider suites as ordinary smoke tests. If genuinely necessary and in scope, use one bounded case with explicit limits and no uncontrolled retries.
- Run the smallest relevant offline tests first. Perform a full production build only when runtime/build changes justify it, normally once after the final changes. Instructions/docs-only changes need a diff/consistency check, not a build or paid tool call.
- Batch related deployments. Do not manually redeploy/restart HF for documentation-only changes. Do not repeatedly check unchanged deployment state; reuse revision/status results and back off.
- Coordinate delegated work so agents do not independently repeat the same remote query, live test or generation. Share compact findings rather than large logs.
- Before an external call, determine the question it answers, the smallest scope and whether an existing result already answers it. Report measured savings separately from estimates; never promise a percentage without measurements.

## AI Chat Architecture (Agentic Function Calling)

- All user chat queries are routed through the pure LLM-driven Agentic architecture in `web/src/lib/ai/agentic-pipeline.ts` (delegated from `web/src/lib/ai/pipeline.ts`).
- DeepSeek-V3 determines user intent and selects from the 9 available tools in parallel (`get_stock`, `get_stock_levels`, `manage_portfolio`, `get_market`, `get_recommendations`, `get_technical_scan`, `get_accumulation_stocks`, `get_news`, `get_comparison`).
- Do NOT re-introduce brittle regex intent routers, rigid keyword blocklists, or mechanical symbol substitutions (e.g., swapping `ADRI` for `ADCI`) that break Egyptian dialect, Nile market stocks, or multi-turn queries.
- Tool executions must always query Supabase directly with explicit column projections and strict `limit()` clauses.
- Detailed architecture and historical reviews are in `docs/chatbot-current-architecture.md` and `docs/chatbot-agentic-architecture-2026-10-08.md`.

The current resource review and prioritized implementation candidates are in `docs/resource-usage-review-2026-10-05.md`.
