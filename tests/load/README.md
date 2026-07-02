# EGX Bots Load Testing

Estimate how many **concurrent users** the app can handle before latency or errors spike.

## Architecture under test

| Layer | Production URL |
|-------|----------------|
| Frontend (Vercel) | https://egxbots.com |
| API Routes (Vercel) | https://egxbots.com/api/* |
| Database (Supabase) | Shared — heavy reads affect all users |

## Quick start

From repo root (requires `requests` — already in `api/requirements.txt`):

```powershell
# Safe smoke test on production (5 virtual users, ~20s)
python tests/load/load_test.py --target production --scenario smoke --backend-only

# Full mix (frontend + backend)
python tests/load/load_test.py --target production --scenario smoke

# Local Vercel API routes (Next.js dev server must be running on :3000)
python tests/load/load_test.py --target local --scenario normal --backend-only
```

## Scenarios

| Scenario | Virtual users | Duration | Use case |
|----------|---------------|----------|----------|
| `smoke` | 5 | 20s | Sanity check |
| `normal` | 20 | 45s | Typical peak |
| `stress` | 50 | 60s | Find breaking point |
| `spike` | 100 | 30s | Sudden traffic burst |

## Interpreting results

- **Success rate ≥ 98%** and **p95 < 2000 ms** → healthy; extrapolate `comfortable users` from report.
- **Success rate 90–95%** → at capacity; optimize or upgrade infra before marketing push.
- **Success rate < 90%** → do not add users; fix Vercel API routes, DB indexes, or Supabase limits.

## Important limits (production)

1. **Vercel** — frontend and public API routes are user-facing.
2. **Supabase** — RPC/table reads on public API routes can become the bottleneck.
3. **Hugging Face** — daily worker only; not part of user traffic.
4. **Heavy routes** (`/scan/technical`, `/predict`) are NOT in the default mix — test them separately.

## Save JSON report

```powershell
python tests/load/load_test.py --target production --scenario normal --json-out tests/load/last_report.json
```

## Next steps for accurate numbers

1. Run `smoke` → `normal` → `stress` in order on **production**.
2. Compare `--backend-only` vs full mix to see if Vercel API routes or pages are the limiter.
3. Add indexes/cache for Supabase-heavy routes if p95 stays high.
4. Keep Hugging Face out of the user request path.
