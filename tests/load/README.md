# EGX Bots Load Testing

Estimate how many **concurrent users** the app can handle before latency or errors spike.

## Architecture under test

| Layer | Production URL |
|-------|----------------|
| Frontend (Vercel) | https://egxbots.com |
| Backend (HuggingFace) | https://weeasdwee-ai-bot.hf.space |
| Database (Supabase) | Shared — heavy reads affect all users |

## Quick start

From repo root (requires `requests` — already in `api/requirements.txt`):

```powershell
# Safe smoke test on production (5 virtual users, ~20s)
python tests/load/load_test.py --target production --scenario smoke --backend-only

# Full mix (frontend + backend)
python tests/load/load_test.py --target production --scenario smoke

# Local backend (must be running on :8000)
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
- **Success rate < 90%** → do not add users; fix backend cold starts, DB indexes, or HF tier.

## Important limits (production)

1. **HuggingFace Spaces (free)** — single container, cold start after idle, CPU throttling.
2. **Vercel** — frontend scales well; API-heavy pages still hit HF backend.
3. **Supabase** — RPC/table reads on `/symbols/inventory` can become the bottleneck.
4. **Heavy routes** (`/scan/technical`, `/predict`) are NOT in the default mix — test them separately.

## Save JSON report

```powershell
python tests/load/load_test.py --target production --scenario normal --json-out tests/load/last_report.json
```

## Next steps for accurate numbers

1. Run `smoke` → `normal` → `stress` in order on **production**.
2. Compare `--backend-only` vs full mix to see if HF or Vercel is the limiter.
3. Upgrade HF to **CPU upgrade** or dedicated host if p95 stays high at 20 users.
4. Add Redis/cache for `/symbols/inventory` and static scanner configs.
