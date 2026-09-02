# Web Frontend — Agent Guidance

## Module Boundary

Next.js 14 App Router frontend. All source lives under `web/src/`.

| Directory | Responsibility |
|-----------|---------------|
| `src/app/` | Page routes (`page.tsx` shells) and server-side API Route Handlers (`src/app/api/`) |
| `src/app/api/` | Next.js Route Handlers that proxy to the Python backend via rewrites |
| `src/components/` | Shared UI: charts (ApexCharts/Lightweight Charts), tables, dialogs, widgets |
| `src/contexts/` | Zustand-based global state providers (Auth, Theme, Language, Watchlist, Scanner, Chat) |
| `src/lib/` | Business logic: `api.ts` (typed fetch wrappers), `ai/` (planner, pipeline, tools, final) |
| `src/lib/ai/corporate-actions.ts` | Chat-time corporate actions (اكتتاب/توزيعات/تجزئة/منح): DB-first lookup, keyless web-search fallback with results cached back into `corporate_actions` |
| `src/middleware.ts` | Auth enforcement (Supabase SSR cookies), locale prefix stripping, admin header injection |

## Key Conventions

- **Page pattern:** `page.tsx` is a thin shell; actual client component lives in `<Name>Client.tsx` alongside it.
- **API calls:** All backend communication goes through typed wrappers in `src/lib/api.ts` using `cache: 'no-store'` and AbortSignal. Never call fetch directly from components.
- **State:** Zustand contexts are wrapped in `src/app/providers.tsx`. Each context lives in its own file under `src/contexts/`.
- **Auth:** Enforced centrally in `src/middleware.ts` using Supabase SSR cookies. Do not add per-route auth checks.
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
npm run test:live    # Live integration tests
npm run format       # Prettier format
```

## Testing

- Tests live in `src/lib/__tests__/`
- Use Jest with jsdom
- When changing core AI files, run `npm run test` and `npm run test:live`
- When changing UI components, update or add companion test/story files

## Cross-Module Dependencies

- **Python backend:** API routes proxy to `api/` via Next.js rewrites in `next.config.js`
- **Supabase:** Auth (SSR cookies), database, and edge functions
- **Vercel:** Frontend hosting; `vercel.json` rewrites `/api/*` to serverless entrypoint
