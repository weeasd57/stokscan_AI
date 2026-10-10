# Web Frontend — Agent Guidance

## Module Boundary

Next.js App Router frontend. All source lives under `web/src/`. The repository-root AGENTS.md resource policy also applies here.

| Directory | Responsibility |
|-----------|---------------|
| `src/app/` | Page routes (`page.tsx` shells) and server-side API Route Handlers (`src/app/api/`) |
| `src/app/api/` | Next.js Route Handlers that proxy to the Python backend via rewrites |
| `src/components/` | Shared UI: charts (ApexCharts/Lightweight Charts), tables, dialogs, widgets |
| `src/contexts/` | Zustand-based global state providers (Auth, Theme, Language, Watchlist, Scanner, Chat) |
| `src/lib/` | Business logic: `api.ts` (typed fetch wrappers), `ai/` (planner, pipeline, tools, final) |
| `src/lib/ai/corporate-actions.ts` | Chat-time corporate actions (اكتتاب/توزيعات/تجزئة/منح): DB-first lookup, keyless web-search fallback with results cached back into `corporate_actions` |
| `src/middleware.ts` | Middleware configuration; inspect current matcher and behavior before relying on it for authentication |

## Key Conventions

- **Page pattern:** `page.tsx` is a thin shell; actual client component lives in `<Name>Client.tsx` alongside it.
- **API calls:** Prefer existing typed wrappers and AbortSignal. Do not impose `no-store` on public daily data: reuse existing daily cache helpers and tags. Private/authenticated responses must not enter a shared public cache.
- **State:** Zustand contexts are wrapped in `src/app/providers.tsx`. Each context lives in its own file under `src/contexts/`.
- **Auth:** Preserve server-side route authentication and entitlement checks. Do not assume middleware protects every route; inspect its matcher. Never trade authorization correctness for caching.
- **Styling:** Tailwind CSS with CSS custom properties for theming (dark/light via class strategy). Shared tokens in `tailwind.config.ts`.
- **i18n:** i18next with locale prefix stripping in middleware. Supports English and Arabic.
- **Route handlers:** Mirror the backend URL structure under `src/app/api/<domain>/<resource>/route.ts`.

## Core Files — Do Not Break

These files are high-churn and central to the AI chat pipeline:

- `src/lib/ai/planner.ts` — Deterministic intent/entity planner (legacy NVIDIA vision planner for images)
- `src/lib/ai/pipeline.ts` — End-to-end AI response pipeline
- `src/lib/ai/final-v2.ts` — Final response assembly and formatting
- `src/lib/ai/tools-v2.ts` — Tool definitions for function calling
- `src/lib/ai/config.ts` — Model configuration and selection
- `src/contexts/ChatContext.tsx` — Chat state management
- `src/components/ChatWidget.tsx` — Chat UI component
- `src/app/api/ai-chat/route.ts` — Chat API route handler

## Commands

```bash
cd web
npm run dev          # Start dev server on port 3000
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Jest tests
npm run test:live    # Bounded real production HTTP chat verification (auth + expected SHA required)
npm run test:provider -- src/lib/ai/__tests__/selected.live.test.ts # Explicit provider-only case
npm run format       # Prettier format
```

## Testing

- Tests live in `src/lib/__tests__/`
- Use the repository's Jest configuration and the environment required by the relevant test.
- When changing core AI files, run relevant offline tests first. Do not automatically run `npm run test:live`: live provider calls require a genuine in-scope need, a bounded case and reuse of existing results.
- When changing UI components, update or add companion test/story files
- Never present mocked unit tests or a build as proof of live chat correctness. For reported chat failures, verify the deployed revision, signed-in account, selected model, original session/history and chart context through `/api/ai-chat`; inspect the rendered ARTORO response too. State API and browser results separately, including blockers.
- Use `/admin/chat-verification` for the existing ChatContext/ChatWidget path and `npm run test:production-chat -- --expected-sha <full-sha>` for two bounded real HTTP turns. `test:provider` invokes provider-only tests and cannot establish website parity. Diagnostic traces are private, admin-owned and bounded; an incomplete trace is not a verification pass.

## Request Budget

- Prefer mount, focus/return and payment-completion refresh events to permanent quota polling. Preserve timely entitlement updates and server enforcement; user-scoped deduplication must never leak account data.
- Retries for locked recommendations must be bounded, deduplicated and paused when hidden where appropriate. Avoid indefinite forced refresh loops.
- Retain necessary active-job progress tracking; stop on completion and use backoff/fallback rather than overlapping requests.
- Documentation-only edits do not require Next.js builds, browser smoke tests or live AI calls.
- **NEVER invoke Supabase MCP `query_logs` or cloud log inspection tools** to debug frontend errors. Inspect local browser console errors, Next.js server logs, or local network inspector responses. Cloud log queries scan gigabytes of uncompressed data and exhaust the project's Log Query allowance.

## Cross-Module Dependencies

- **Python backend:** API routes proxy to `api/` via Next.js rewrites in `next.config.js`
- **Supabase:** Auth (SSR cookies), database, and edge functions
- **Vercel:** Frontend hosting; `vercel.json` rewrites `/api/*` to serverless entrypoint
