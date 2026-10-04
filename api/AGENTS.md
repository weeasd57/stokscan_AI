# API Backend — Agent Guidance

## Module Boundary

FastAPI application serving the stock analysis, backtesting, ML, chatbot, and trading subsystems. Entry point: `api/main.py` → `api.main:app`. The repository-root AGENTS.md resource policy also applies here.

| Directory / File | Responsibility |
|-----------------|---------------|
| `main.py` | App orchestrator: CORS, logging, startup/shutdown lifecycle, router registration |
| `routers/` | Feature routers — each file defines a FastAPI `router` mounted in `main.py` |
| `routers/scan_ai*.py` | AI-driven, technical, and historical similarity scanning endpoints |
| `routers/bot.py` | Live trading bot lifecycle and subscription management |
| `routers/payment.py` | Paymob payment checkout and webhook endpoints |
| `routers/chatbot.py` | Chatbot intent-to-response pipeline |
| `routers/admin.py` | Admin dashboard endpoints |
| `routers/support.py` | Support chat endpoints |
| `daily_bot_run.py` | Daily automated bot execution |
| `live_bot.py` | Live trading bot engine |
| `telegram_bot.py` | Telegram Bot API bridge |
| `stock_ai.py` | Core stock analysis and AI scanning logic |
| `portfolio_manager.py` | Portfolio and position tracking |
| `trading_config.py` | Environment-driven configuration (loaded at module level) |
| `market_status_gate.py` | Gates trading endpoints by exchange open/close status |
| `model_catalog.py` | Trained model registry (LightGBM/XGBoost) |
| `adaptive_model_selector.py` | Adaptive model selection for inference |
| `structured_logger.py` | JSON structured logging to `logs/structured.json` |
| `cache_utils.py` | File-based caching for symbols and model cards |
| `local_storage.py` | Local data storage utilities |
| `unified_features.py` | Feature engineering pipeline |
| `unified_labeling.py` | Label generation for ML training |
| `train_council_validator_crypto.py` | ML model training pipeline |
| `council.py` / `council_validator.py` | Ensemble model validation |
| `news_sentiment_engine.py` | Keyless Google News RSS fetcher + bilingual sentiment lexicon (`stock_news_sentiment` table); classifies corporate actions during the same news pass |
| `corporate_actions_engine.py` | Corporate actions (حقوق اكتتاب/تجزئة/توزيعات/منح/رأس مال) classifier and storage into `corporate_actions`; run via `process_exchange_news` or `run_corporate_actions_update.py` |

## Key Conventions

- **Router pattern:** Each feature area has a dedicated `routers/<feature>.py` with a FastAPI `router` object, mounted once in `main.py`. Never add routes directly to `main.py`.
- **Config:** Environment variables read via `os.getenv` at module load time, cached in module-level config objects. Never pass config as function arguments.
- **Background tasks:** Long-running work dispatched via FastAPI `BackgroundTasks`. Response returns immediately.
- **Lifecycle:** Background workers (Telegram, intraday sync, daily jobs) start in `@app.on_event('startup')` with try/except — one failure must not prevent server startup.
- **Logging:** All structured logging through `structured_logger` producing JSON lines. Request/response timing captured by global HTTP middleware.
- **Data flow:** Supabase tables + local JSON caches (`local_data/crypto/`, `symbols_data/`, `models/`). No internal message bus — routers call domain modules directly.
- **Cross-module state:** `app.state` and module-level singletons (e.g., `bot_manager`) for coordination.

## Core Files — Do Not Break

These files are high-churn and critical to the trading pipeline:

- `main.py` — App entry point and lifecycle management
- `routers/scan_ai*.py` — AI scanning endpoints (most-used API surface)
- `routers/chatbot.py` — Chatbot pipeline (LLM function calling)
- `routers/bot.py` — Live trading bot control
- `stock_ai.py` — Core analysis engine
- `daily_bot_run.py` — Daily automated execution (41 commits, high churn)
- `portfolio_manager.py` — Position tracking and risk
- `trading_config.py` — Environment configuration (affects everything)
- `market_status_gate.py` — Trading gate (EGX market open/close)
- `model_catalog.py` / `adaptive_model_selector.py` — ML model selection

## Commands

```bash
# Backend
uvicorn api.main:app --port 8000          # Start API server
pip install -r api/requirements.txt       # Install dependencies

# From project root
python run_live_bot.py                    # Run live trading bot
python run_daily_bot_job.py               # Run daily job manually
python run_backtest_test.py               # Run backtest
```

## Testing

- Tests live in `api/tests/` and `tests/`
- Python tests use pytest
- When changing core files, run relevant test suites
- Prefer targeted offline pytest tests. The manual job, live bot and backtest commands above can contact services or perform expensive work; do not run them as routine verification without inspecting their effects and establishing an in-scope need.

## Resource Budget

- Read narrowly filtered daily job status (e.g. from `daily_job_runs` table). **NEVER call Supabase MCP `query_logs` or cloud log queries** during routine diagnosis — a single broad scan consumes 5–10 GB of the monthly Log Query quota. Rely solely on local `logs/structured.json`, stdout, and error responses. Do not rerun the production daily job to diagnose its previous run.
- Generate shared daily reports/calculations once in the daily pipeline. Publishing and UI reads consume saved validated reports, not fresh LLM calls.
- Query only needed columns, symbols and date ranges; reuse fetched results across related calculations where safe. Avoid repeated full historical table downloads.
- Invalidate affected Vercel tags only after the corresponding successful data stage; preserve existing failure and stale-data safeguards.
- Keep error/security audit logging and RLS intact. Avoid verbose repeated payload logging, but do not suppress failures to save usage.
- HF uploads should contain only required runtime changes in one batch. Agent instructions and other docs alone do not justify an HF restart/upload.

## Cross-Module Dependencies

- **Supabase:** Database, auth, edge functions (Telegram relay)
- **Next.js frontend:** Proxies `/api/*` routes to this FastAPI app
- **Deployment:** Docker (`Dockerfile`), Render (`render.yaml`), Hugging Face Spaces (`nixpacks.toml`)
- **External services:** TradingView (market data), EODHD (historical data), Paymob (payments), Telegram Bot API
