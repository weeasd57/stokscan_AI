# RESTART_DEBUG: 2

import sys

# Force UTF-8 encoding on standard output and error to prevent UnicodeEncodeError under Windows console

if hasattr(sys.stdout, "reconfigure"):

    sys.stdout.reconfigure(encoding="utf-8")

if hasattr(sys.stderr, "reconfigure"):

    sys.stderr.reconfigure(encoding="utf-8")



import datetime as dt

import io

import json

import os
import hmac

import urllib.request

import warnings



import numpy as np

import pandas as pd



# Suppress specific FutureWarnings from libraries like 'ta'



# Suppress specific FutureWarnings from libraries like 'ta'

warnings.filterwarnings("ignore", category=FutureWarning)



# from dotenv import load_dotenv



from dotenv import load_dotenv



# Load environment variables from the repo root (and optional web env overrides).

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if base_dir not in sys.path:

    sys.path.insert(0, base_dir)

load_dotenv(os.path.join(base_dir, ".env"))

load_dotenv(os.path.join(base_dir, "web", ".env.local"), override=True)



from typing import Any, Dict, List, Literal, Optional



import yfinance as yf

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request, Header

from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import JSONResponse

from pydantic import BaseModel, Field



from api.adaptive_model_selector import recommend_model_from_pool

from api.stock_ai import run_pipeline

from api.symbols_local import list_countries, search_symbols
from api.health import router as health_router



app = FastAPI(title="Artoro API", version="1.0.0")

def require_internal_admin(request: Request) -> None:
    expected = os.getenv("ADMIN_SECRET_KEY", "").strip()
    provided = request.headers.get("x-admin-key", "").strip()
    if not expected or not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")





# Request Logging Middleware

@app.middleware("http")

async def log_requests(request: Request, call_next):

    start_time = dt.datetime.now()

    path = request.url.path

    method = request.method



    # Skip noisy polling logs if they are successful

    is_polling = any(p in path for p in ["/api/ai_bot/status", "/bot/status"])



    try:

        response = await call_next(request)

        duration = (dt.datetime.now() - start_time).total_seconds()



        # Log all failures, or non-polling successes

        if response.status_code >= 400 or not is_polling:

            print(

                f"[REQ] {method} {path} - {response.status_code} ({duration:.3f}s)",

                flush=True,

            )



        return response

    except Exception as e:

        duration = (dt.datetime.now() - start_time).total_seconds()

        print(

            f"[REQ ERROR] {method} {path} - FAILED ({duration:.3f}s): {e}", flush=True

        )

        raise e





@app.on_event("startup")

async def startup_event():

    # Initialize Supabase at startup

    from api.stock_ai import _init_supabase



    _init_supabase()



    # Initialize Telegram Bot if token exists

    tg_token = os.getenv("ARTORO_AI_BOT", "")

    webhook_url = os.getenv("WEBHOOK_URL", "")



    print(f"DEBUG: STARTUP - ARTORO_AI_BOT: {'SET' if tg_token else 'MISSING'}")

    print(f"DEBUG: STARTUP - WEBHOOK_URL: {webhook_url or 'NOT SET (Polling Mode)'}")



    if tg_token:

        try:

            from api.live_bot import bot_instance, bot_manager

            from api.telegram_bot import start_telegram_bridge



            bridge = start_telegram_bridge(tg_token, bot_instance)

            bot_manager.set_telegram_bridge(bridge)

            # Store in app state for cleanup

            app.state.telegram_bridge = bridge

            print("DEBUG: Telegram Bot bridge started and attached to app.state.")

        except Exception as e:

            print(f"DEBUG ERROR: Failed to start Telegram Bot bridge: {e}")

            import traceback



            traceback.print_exc()



    # Initialize Support Bot

    try:

        from api.support_chat import SUPPORT_BOT_TOKEN

        import requests as req

        telegram_relay = os.getenv("TELEGRAM_RELAY_URL", "https://api.telegram.org").rstrip("/")

        

        if webhook_url:

            support_hook = f"{webhook_url.rstrip('/')}/support-tg-webhook/{SUPPORT_BOT_TOKEN}"

            try:

                r = req.post(

                    f"{telegram_relay}/bot{SUPPORT_BOT_TOKEN}/setWebhook",

                    json={"url": support_hook},

                    timeout=10

                )

                print(f"[SUPPORT_CHAT] Webhook set response: {r.json()}")

            except Exception as e:

                print(f"[SUPPORT_CHAT] Failed to set support webhook: {e}")

        else:

            print("[SUPPORT_CHAT] Support Bot Webhook mode enabled. Set WEBHOOK_URL to configure webhook.")

    except Exception as e:

        print(f"[SUPPORT_CHAT] Failed to initialize support bot: {e}")



    # Technical Alerts Scheduler Disabled



    # Start Intraday Downloader

    try:

        from api.intraday_downloader import start_intraday_downloader



        start_intraday_downloader()

        from api.intraday_scheduler import start_intraday_scheduler



        start_intraday_scheduler()

        print("DEBUG: Intraday Downloader started successfully.")

    except Exception as e:

        print(f"DEBUG ERROR: Failed to start Intraday Downloader: {e}")



    # Start Daily Job Scheduler (stock_score + historical similarity)

    try:

        from api.daily_job_scheduler import start_daily_job_scheduler



        start_daily_job_scheduler()

        print("DEBUG: Daily Job Scheduler started successfully.")

    except Exception as e:

        print(f"DEBUG ERROR: Failed to start Daily Job Scheduler: {e}")





@app.on_event("shutdown")

async def shutdown_event():

    # Stop Daily Job Scheduler

    try:

        from api.daily_job_scheduler import stop_daily_job_scheduler

        stop_daily_job_scheduler()

    except Exception:

        pass



    # Cleanup Telegram Bot

    if hasattr(app.state, "telegram_bridge"):

        try:

            print("Shutting down Telegram Bot bridge...")

            app.state.telegram_bridge.stop()

        except Exception as e:

            print(f"Error during Telegram bridge shutdown: {e}")



    # Save running bots' trade history to backtests

    try:

        print("Saving running bots trade history to backtests on server shutdown...")

        from api.live_bot import bot_manager

        from api.routers.bot import save_live_bot_history_to_backtest



        for bot_id, bot in list(bot_manager._bots.items()):

            if bot.is_running:

                print(f"Saving trade history for running bot: {bot_id}")

                save_live_bot_history_to_backtest(bot)

                bot.stop()

    except Exception as e:

        print(f"Error saving bots history during shutdown: {e}")





@app.exception_handler(Exception)

async def unhandled_exception_handler(request: Request, exc: Exception):

    if isinstance(exc, HTTPException):

        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    import traceback



    print(

        f"Unhandled exception for {request.method} {request.url.path}: {exc}",

        flush=True,

    )

    traceback.print_exc()

    return JSONResponse(

        status_code=500, content={"detail": f"Internal server error: {str(exc)}"}

    )





from api.routers import admin, bot, payment, scan_ai, scan_ai_fast, scan_tech, similarity_admin, support, chatbot



app.include_router(scan_ai.router)

app.include_router(scan_ai_fast.router)

app.include_router(scan_tech.router)

app.include_router(admin.router)

app.include_router(bot.router, prefix="/ai_bot")

app.include_router(bot.router, prefix="/bot")  # Compatibility Alias

app.include_router(payment.router)

app.include_router(similarity_admin.router)

app.include_router(support.router)
app.include_router(chatbot.router)  # New Anti-Hallucination Chatbot
app.include_router(health_router)




@app.post("/api/admin/run-daily-bot")

async def trigger_daily_bot(request: Request, background_tasks: BackgroundTasks):
    require_internal_admin(request)

    from api.daily_bot_run import run_daily_job

    background_tasks.add_task(run_daily_job)

    return {"status": "started", "message": "Daily bot run job has been started in the background."}


@app.post("/api/run-accumulation-scan")
async def trigger_accumulation_scan(request: Request):
    """
    Triggers the accumulation & distribution scanner (Wyckoff).
    Called by Vercel Cron (/api/cron/accumulation-scan) or manual requests.
    """
    cron_secret = os.getenv("CRON_SECRET", "").strip()
    provided_secret = request.headers.get("x-cron-secret", "").strip()
    if cron_secret and not hmac.compare_digest(provided_secret, cron_secret):
        raise HTTPException(status_code=401, detail="Unauthorized cron secret")

    try:
        import sys
        scripts_dir = os.path.join(base_dir, "scripts")
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        from accumulation_scanner import (
            get_supabase as _acc_get_supabase,
            fetch_all_symbols as _acc_fetch_symbols,
            fetch_recent_technicals as _acc_fetch_tech,
            analyze_symbol as _acc_analyze,
            upsert_results as _acc_upsert,
        )
        _acc_sb = _acc_get_supabase()
        _acc_symbols = _acc_fetch_symbols(_acc_sb)
        _acc_tech = _acc_fetch_tech(_acc_sb, _acc_symbols, 30)
        _acc_results = []
        for _sym, _rows in _acc_tech.items():
            _analysis = _acc_analyze(_rows)
            if _analysis is not None:
                _analysis["symbol"] = _sym
                _acc_results.append(_analysis)
        _acc_saved = _acc_upsert(_acc_sb, _acc_results)
        _acc_acc_count = sum(1 for r in _acc_results if r.get("signal") == "accumulation")
        _acc_dist_count = sum(1 for r in _acc_results if r.get("signal") == "distribution")
        
        return {
            "status": "success",
            "saved_records": _acc_saved,
            "accumulation_count": _acc_acc_count,
            "distribution_count": _acc_dist_count,
            "date": dt.date.today().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Accumulation scan failed: {str(e)}")








@app.post("/tg-webhook/{token}")

async def telegram_webhook(

    token: str, request: Request, background_tasks: BackgroundTasks

):

    """Endpoint for Telegram Webhooks."""

    from api.live_bot import bot_manager



    bridge = getattr(app.state, "telegram_bridge", None) or getattr(

        bot_manager, "_telegram_bridge", None

    )



    if not bridge:

        has_state = hasattr(app.state, "telegram_bridge")

        has_manager = bot_manager._telegram_bridge is not None

        print(

            f"WEBHOOK 503: Bridge not found. State={has_state}, Manager={has_manager}"

        )

        raise HTTPException(status_code=503, detail="Telegram bridge not active")



    if token != bridge.token:

        print(

            f"WEBHOOK 403: Token mismatch. Received: {token[:5]}... Expected: {bridge.token[:5]}..."

        )

        raise HTTPException(status_code=403, detail="Invalid token")



    data = await request.json()

    background_tasks.add_task(bridge.handle_webhook_update, data)



    return {"ok": True}





@app.post("/tg-set-webhook")

async def tg_set_webhook_from_local(request: Request):

    """Set Telegram webhook from LOCAL machine (bypasses HF firewall).



    Open this URL in your browser:

      https://your-space.hf.space/tg-set-webhook

    """

    require_internal_admin(request)
    import requests as req

    support_token = os.getenv("SUPPORT_BOT_TOKEN", "").strip()

    print(f"[DEBUG_WEBHOOK] support_token length: {len(support_token)}")



    webhook_url = os.getenv("WEBHOOK_URL", "")

    if not webhook_url:

        raise HTTPException(status_code=500, detail="WEBHOOK_URL not set")



    # 1. Set Webhook for Support Bot

    telegram_relay = os.getenv("TELEGRAM_RELAY_URL", "https://api.telegram.org").rstrip("/")

    support_hook = f"{webhook_url.rstrip('/')}/support-tg-webhook/{support_token}"

    support_ok = False

    support_detail = {}

    try:

        r_support = req.post(

            f"{telegram_relay}/bot{support_token}/setWebhook",

            json={"url": support_hook},

            timeout=30,

        )

        support_data = r_support.json()

        support_ok = support_data.get("ok", False)

        support_detail = support_data

    except Exception as e:

        support_detail = {"error": str(e)}



    # 2. Set Webhook for Main Bot

    bridge = getattr(app.state, "telegram_bridge", None)

    if not bridge:

        return {

            "main_bot": "Bridge not started (ARTORO_AI_BOT missing or not initialized)",

            "support_bot": {

                "ok": support_ok,

                "webhook": support_hook,

                "detail": support_detail

            }

        }



    hook = f"{webhook_url.rstrip('/')}/tg-webhook/{bridge.token}"

    try:

        r = req.post(

            f"https://api.telegram.org/bot{bridge.token}/setWebhook",

            json={"url": hook},

            timeout=30,

        )

        data = r.json()

        if data.get("ok"):

            bridge._ready = True

            bridge._net_ok = True

            return {

                "main_bot": {"ok": True, "webhook": hook, "message": "Webhook set successfully!"},

                "support_bot": {"ok": support_ok, "webhook": support_hook, "detail": support_detail}

            }

        return {

            "main_bot": {"ok": False, "detail": data},

            "support_bot": {"ok": support_ok, "webhook": support_hook, "detail": support_detail}

        }

    except Exception as e:

        raise HTTPException(status_code=502, detail=str(e))





CONFIG_FILE = os.path.abspath(

    os.path.join(os.path.dirname(__file__), "..", "admin_config.json")

)





def _load_admin_config():

    if os.path.exists(CONFIG_FILE):

        try:

            with open(CONFIG_FILE, "r") as f:

                return json.load(f)

        except Exception:

            pass

    return {"source": "eodhd"}





def _normalize_yahoo_ticker(ticker: str) -> str:

    t = ticker.strip().upper()

    if t.endswith(".US"):

        return t.replace(".US", "")

    if t.endswith(".EGX"):

        return t.replace(".EGX", ".CA")

    return t





def _fetch_price_yahoo(ticker: str) -> float:

    yf_ticker = _normalize_yahoo_ticker(ticker)

    t = yf.Ticker(yf_ticker)



    try:

        fi = getattr(t, "fast_info", None)

        if fi:

            last = fi.get("last_price")

            if last is not None:

                return float(last)

    except Exception:

        pass



    try:

        hist = t.history(period="1d")

        if hist is not None and not hist.empty and "Close" in hist.columns:

            return float(hist["Close"].iloc[-1])

    except Exception:

        pass



    raise ValueError("Yahoo price unavailable")





def _fetch_price_eodhd(ticker: str, api_key: str) -> float:

    eodhd_ticker = ticker

    if ticker.endswith(".EGX"):

        eodhd_ticker = ticker.replace(".EGX", ".EG")

    url = f"https://eodhd.com/api/real-time/{eodhd_ticker}?api_token={api_key}&fmt=json"

    with urllib.request.urlopen(url, timeout=20) as resp:

        raw = resp.read().decode("utf-8")

    payload = json.loads(raw)



    if not isinstance(payload, dict):

        raise ValueError("Invalid EODHD response")



    for k in ("close", "price", "last", "last_close"):

        v = payload.get(k)

        if v is None:

            continue

        try:

            return float(v)

        except Exception:

            continue



    raise ValueError("EODHD price unavailable")





web_origin = os.getenv("WEB_ORIGIN", "*")

allow_origins = [web_origin] if web_origin != "*" else ["*"]

if "*" not in allow_origins:

    allow_origins.extend(

        [

            "http://localhost:3000",

            "http://127.0.0.1:3000",

            "http://localhost:3001",

            "http://127.0.0.1:3001",

            "http://localhost:3002",

            "http://127.0.0.1:3002",

        ]

    )



app.add_middleware(

    CORSMiddleware,

    allow_origins=allow_origins,

    allow_credentials=False,

    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT", "OPTIONS"],

    allow_headers=["*"],

)





class PredictRequest(BaseModel):

    ticker: str = Field(

        ..., min_length=1, max_length=24, pattern=r"^[A-Za-z0-9.\-]{1,24}$"

    )

    exchange: Optional[str] = Field(default=None)

    from_date: str = Field(default="2020-01-01")

    to_date: Optional[str] = Field(default=None)

    include_fundamentals: bool = Field(default=True)

    rf_preset: Optional[str] = Field(default=None)

    rf_params: Optional[Dict[str, Any]] = Field(default=None)

    model_name: Optional[str] = Field(default=None)

    force_local: bool = Field(default=False)

    target_pct: float = Field(default=2.0)

    stop_loss_pct: float = Field(default=1.0)

    look_forward_days: int = Field(default=20)

    buy_threshold: float = Field(default=0.45)

    use_volatility_label: bool = Field(default=False)





class EvaluatePositionIn(BaseModel):

    id: str

    symbol: str

    entry_price: Optional[float] = None

    entry_at: Optional[str] = Field(default=None, description="ISO timestamp")

    added_at: Optional[str] = Field(default=None, description="ISO timestamp")

    target_price: Optional[float] = None

    stop_price: Optional[float] = None





class EvaluatePositionsRequest(BaseModel):

    positions: List[EvaluatePositionIn]





class EvaluatePositionOut(BaseModel):

    id: str

    symbol: str

    status: Literal["open", "hit_target", "hit_stop"]

    as_of: Optional[str] = None

    price: Optional[float] = None

    change_pct: Optional[float] = None

    reason: Optional[str] = None





def _parse_iso_date(value: Optional[str]) -> Optional[str]:

    if not value:

        return None

    v = value.strip()

    if not v:

        return None

    try:

        if v.endswith("Z"):

            v = v[:-1] + "+00:00"

        d = dt.datetime.fromisoformat(v)

        return d.date().isoformat()

    except Exception:

        try:

            return dt.date.fromisoformat(v[:10]).isoformat()

        except Exception:

            return None





def _fetch_eod_history_eodhd(

    ticker: str, api_key: str, from_date: str, to_date: str

) -> List[Dict[str, Any]]:

    eodhd_ticker = ticker

    if ticker.endswith(".EGX"):

        eodhd_ticker = ticker.replace(".EGX", ".EG")

    url = (

        f"https://eodhd.com/api/eod/{eodhd_ticker}"

        f"?api_token={api_key}&fmt=json&period=d&order=a&from={from_date}&to={to_date}"

    )

    with urllib.request.urlopen(url, timeout=25) as resp:

        raw = resp.read().decode("utf-8")

    payload = json.loads(raw)

    if not isinstance(payload, list):

        raise ValueError("Invalid EODHD EOD response")

    return payload





@app.post("/positions/evaluate_open_history", response_model=List[EvaluatePositionOut])

def evaluate_open_positions_history(req: EvaluatePositionsRequest):

    from api.tradingview_integration import fetch_tradingview_prices



    api_key = os.getenv("EODHD_API_KEY")

    today = dt.datetime.utcnow().date().isoformat()

    out: List[EvaluatePositionOut] = []



    for p in req.positions:

        start_date = _parse_iso_date(p.entry_at) or _parse_iso_date(p.added_at)

        if not start_date:

            out.append(

                EvaluatePositionOut(

                    id=p.id, symbol=p.symbol, status="open", reason="missing_start_date"

                )

            )

            continue



        if p.target_price is None and p.stop_price is None:

            out.append(

                EvaluatePositionOut(

                    id=p.id,

                    symbol=p.symbol,

                    status="open",

                    reason="missing_target_stop",

                )

            )

            continue



        symbol = p.symbol.strip().upper()

        # Standardize symbol/exchange inference

        from eodhd import APIClient



        from api.stock_ai import (

            _finite_float,

            _infer_symbol_exchange,

            get_stock_data_eodhd,

        )



        s, e = _infer_symbol_exchange(symbol)

        full_symbol = f"{s}.{e}"



        # Try to update from TradingView first (free)

        try:

            fetch_tradingview_prices(full_symbol, max_days=500)

        except Exception as ex:

            print(f"TradingView update failed for {full_symbol}: {ex}")



        # Use centralized get_stock_data_eodhd which handles Supabase -> Local -> API

        df_loaded = None

        try:

            api_client = APIClient(api_key) if api_key else None

            df_loaded = get_stock_data_eodhd(

                api=api_client, ticker=full_symbol, from_date=start_date, exchange=e

            )

        except Exception as ex:

            print(f"Data fetch error for {full_symbol}: {ex}")

            # If no data and we have no API key, it's a real failure

            if not api_key:

                out.append(

                    EvaluatePositionOut(

                        id=p.id, symbol=p.symbol, status="open", reason="no_data_source"

                    )

                )

                continue

            out.append(

                EvaluatePositionOut(

                    id=p.id, symbol=p.symbol, status="open", reason=f"fetch_error:{ex}"

                )

            )

            continue



        if df_loaded is None or df_loaded.empty:

            out.append(

                EvaluatePositionOut(

                    id=p.id, symbol=p.symbol, status="open", reason="no_data"

                )

            )

            continue



        # We have the dataframe, ensure it's sorted and has a proper index

        if not isinstance(df_loaded.index, pd.DatetimeIndex):

            df_loaded.index = pd.to_datetime(df_loaded.index)



        df_filtered = df_loaded[

            df_loaded.index >= pd.to_datetime(start_date)

        ].sort_index()



        if df_filtered.empty:

            out.append(

                EvaluatePositionOut(

                    id=p.id, symbol=p.symbol, status="open", reason="no_data_in_range"

                )

            )

            continue



        # Evaluate hits

        hit: Optional[EvaluatePositionOut] = None

        for timestamp, row in df_filtered.iterrows():

            try:

                # timestamp is a pd.Timestamp here

                d = timestamp.strftime("%Y-%m-%d")

                # EODHD/Supabase use lowercase column names

                high_v = _finite_float(row.get("high", row.get("High")))

                low_v = _finite_float(row.get("low", row.get("Low")))

            except Exception:

                continue



            hit_target = bool(

                p.target_price is not None

                and high_v is not None

                and high_v >= float(p.target_price)

            )

            hit_stop = bool(

                p.stop_price is not None

                and low_v is not None

                and low_v <= float(p.stop_price)

            )



            if hit_target and hit_stop:

                hit = EvaluatePositionOut(

                    id=p.id,

                    symbol=p.symbol,

                    status="hit_stop",

                    as_of=d,

                    price=float(p.stop_price) if p.stop_price else None,

                    reason="both_crossed_same_day",

                )

                break



            if hit_stop:

                hit = EvaluatePositionOut(

                    id=p.id,

                    symbol=p.symbol,

                    status="hit_stop",

                    as_of=d,

                    price=float(p.stop_price) if p.stop_price else None,

                    reason="low<=stop",

                )

                break



            if hit_target:

                hit = EvaluatePositionOut(

                    id=p.id,

                    symbol=p.symbol,

                    status="hit_target",

                    as_of=d,

                    price=float(p.target_price) if p.target_price else None,

                    reason="high>=target",

                )

                break



        if hit is None:

            # Always return the latest price/date even if no hit

            last_idx = df_filtered.index[-1]

            last_row = df_filtered.iloc[-1]

            last_price = float(last_row.get("close", last_row.get("Close")))

            last_date = last_idx.strftime("%Y-%m-%d")



            cp = None

            if p.entry_price and last_price:

                cp = ((last_price - float(p.entry_price)) / float(p.entry_price)) * 100



            out.append(

                EvaluatePositionOut(

                    id=p.id,

                    symbol=p.symbol,

                    status="open",

                    as_of=last_date,

                    price=last_price,

                    change_pct=cp,

                    reason="no_hit",

                )

            )

        else:

            # For hits, calculate change_pct based on the hit price

            if p.entry_price and hit.price:

                hit.change_pct = (

                    (hit.price - float(p.entry_price)) / float(p.entry_price)

                ) * 100

            out.append(hit)



    return out





@app.get("/")

def root():

    """Simple root page to solve 404 issue from UptimeRobot"""

    return {

        "app": "Artoro API",

        "version": "1.0.0",

        "status": "running",

        "endpoints": {

            "health": "/health",

            "predict": "/predict",

            "bot_status": "/bot/status",

            "bot_performance": "/bot/performance",

            "admin": "/admin",

            "docs": "/docs",

        },

        "message": "Welcome to Artoro API! Visit /docs for API documentation.",

    }





@app.get("/health")
@app.head("/health")
def health():

    return {"ok": True}





_MARKET_STATUS_CACHE = {}  # type: ignore[var-annotated]
_LAST_REFRESH_TRIGGERED = 0.0

def update_market_status_cache():
    global _MARKET_STATUS_CACHE
    import os as _os
    import time as _time
    import datetime as _dt
    import urllib.request as _urllib_request
    import json as _json

    api_key = _os.getenv("EODHD_API_KEY")
    if not api_key:
        return

    base_dir = _os.path.dirname(_os.path.abspath(__file__))
    cache_path = _os.path.join(base_dir, "symbols_data", "market_status.json")

    from_date = (_dt.datetime.utcnow() - _dt.timedelta(days=180)).strftime("%Y-%m-%d")
    to_date = _dt.datetime.utcnow().strftime("%Y-%m-%d")

    egx30_data = []
    egx100_data = []


    # Fetch EGX30
    try:
        url = f"https://eodhd.com/api/eod/EGX30.INDX?api_token={api_key}&fmt=json&period=d&order=a&from={from_date}&to={to_date}"
        req = _urllib_request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with _urllib_request.urlopen(req, timeout=8) as resp:
            egx30_data = _json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Background: Error fetching EGX30 from EODHD: {e}")

    # Fetch EGX100
    try:
        url = f"https://eodhd.com/api/eod/EGX100.INDX?api_token={api_key}&fmt=json&period=d&order=a&from={from_date}&to={to_date}"
        req = _urllib_request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with _urllib_request.urlopen(req, timeout=8) as resp:
            egx100_data = _json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Background: Error fetching EGX100 from EODHD: {e}")

    # If EGX30 is empty, try Supabase fallback
    if not egx30_data or (isinstance(egx30_data, list) and len(egx30_data) == 0):
        try:
            from api.stock_ai import _init_supabase, supabase as _supabase
            _init_supabase()
            if _supabase:
                all_data = []
                page_size = 1000
                offset = 0
                while True:
                    res = _supabase.table("stock_prices").select("date,open,high,low,close,volume").eq("symbol", "EGX30").eq("exchange", "INDX").order("date", desc=False).range(offset, offset + page_size - 1).execute()
                    if not res.data:
                        break
                    all_data.extend(res.data)
                    if len(res.data) < page_size:
                        break
                    offset += page_size
                if all_data:
                    filtered = [r for r in all_data if from_date <= r["date"] <= to_date]
                    if filtered:
                        egx30_data = filtered
        except Exception as se:
            print(f"Background: Supabase fallback for EGX30 failed: {se}")

    # If Supabase didn't work, try local JSON file
    if not egx30_data or (isinstance(egx30_data, list) and len(egx30_data) == 0):
        try:
            index_path = _os.path.join(base_dir, "symbols_data", "EGX30-INDEX.json")
            if _os.path.exists(index_path):
                with open(index_path, "r", encoding="utf-8") as f:
                    local_data = _json.loads(f.read())
                if isinstance(local_data, list) and len(local_data) > 0:
                    filtered = [r for r in local_data if from_date <= r.get("date", "") <= to_date]
                    if filtered:
                        egx30_data = filtered
        except Exception as le:
            print(f"Background: Local JSON fallback for EGX30 failed: {le}")

    # If we don't have EGX30 data, skip cache update
    if not egx30_data:
        print("Background: EGX30 data missing. Skipping cache refresh.")
        return

    # Calculate current regime based on EGX30
    regime = "sideways"
    egx30_return = 0.0
    if egx30_data and isinstance(egx30_data, list):
        try:
            egx30_data.sort(key=lambda x: x["date"])
            if len(egx30_data) >= 2:
                close_today = float(egx30_data[-1]["close"])
                close_prev = float(egx30_data[-2]["close"])
                egx30_return = (close_today - close_prev) / close_prev
                from api.egx30_fetcher import get_market_regime
                regime = get_market_regime(egx30_return)
        except Exception as e:
            print(f"Background: Error calculating market regime: {e}")

    res_data = {
        "egx30": egx30_data,
        "egx100": egx100_data,

        "regime": regime,
        "egx30_return": egx30_return,
        "reject_buys": regime == "panic",
        "updated_at": _dt.datetime.utcnow().isoformat()
    }

    try:
        _os.makedirs(_os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            _json.dump(res_data, f, ensure_ascii=False, indent=2)
        _MARKET_STATUS_CACHE["status"] = (_time.time(), res_data)
        print("Background: Market status cache successfully refreshed.")
    except Exception as e:
        print(f"Background: Error writing local market status cache: {e}")


@app.get("/market/status")
def get_market_status(background_tasks: BackgroundTasks):
    global _MARKET_STATUS_CACHE, _LAST_REFRESH_TRIGGERED
    import os as _os
    import time as _time
    import datetime as _dt
    import urllib.request as _urllib_request
    import json as _json

    now = _time.time()

    # 1. Check in-memory cache first (24 hours)
    if "status" in _MARKET_STATUS_CACHE:
        ts, data = _MARKET_STATUS_CACHE["status"]
        if now - ts < 24 * 3600:
            return data
        else:
            # Memory expired, return it immediately and refresh in background
            if now - _LAST_REFRESH_TRIGGERED > 300:
                _LAST_REFRESH_TRIGGERED = now
                background_tasks.add_task(update_market_status_cache)
            return data

    # 2. Check local file cache fallback (avoid EODHD hits if recent enough, e.g. 24 hours)
    base_dir = _os.path.dirname(_os.path.abspath(__file__))
    cache_path = _os.path.join(base_dir, "symbols_data", "market_status.json")
    
    file_fallback_data = None
    if _os.path.exists(cache_path):
        try:
            mtime = _os.path.getmtime(cache_path)
            with open(cache_path, "r", encoding="utf-8") as f:
                file_fallback_data = _json.load(f)
            
            _MARKET_STATUS_CACHE["status"] = (mtime, file_fallback_data)
            
            # If expired (> 24h), trigger background refresh but return cached data immediately
            if now - mtime >= 24 * 3600:
                if now - _LAST_REFRESH_TRIGGERED > 300:
                    _LAST_REFRESH_TRIGGERED = now
                    background_tasks.add_task(update_market_status_cache)
            return file_fallback_data
        except Exception as e:
            print(f"Error reading local market status cache: {e}")

    # 3. Fetch from EODHD synchronously ONLY if no cache file exists at all
    api_key = _os.getenv("EODHD_API_KEY")
    if not api_key:
        if file_fallback_data:
            return file_fallback_data
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="EODHD API key not set")

    from_date = (_dt.datetime.utcnow() - _dt.timedelta(days=180)).strftime("%Y-%m-%d")
    to_date = _dt.datetime.utcnow().strftime("%Y-%m-%d")

    egx30_data = []
    egx100_data = []


    # Fetch EGX30
    try:
        url = f"https://eodhd.com/api/eod/EGX30.INDX?api_token={api_key}&fmt=json&period=d&order=a&from={from_date}&to={to_date}"
        req = _urllib_request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with _urllib_request.urlopen(req, timeout=5) as resp:
            egx30_data = _json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Error fetching EGX30 from EODHD: {e}")

    # Fetch EGX100
    try:
        url = f"https://eodhd.com/api/eod/EGX100.INDX?api_token={api_key}&fmt=json&period=d&order=a&from={from_date}&to={to_date}"
        req = _urllib_request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with _urllib_request.urlopen(req, timeout=5) as resp:
            egx100_data = _json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Error fetching EGX100 from EODHD: {e}")

    # If EGX30 is empty, try Supabase fallback
    if not egx30_data or (isinstance(egx30_data, list) and len(egx30_data) == 0):
        try:
            from api.stock_ai import _init_supabase, supabase as _supabase
            _init_supabase()
            if _supabase:
                all_data = []
                page_size = 1000
                offset = 0
                while True:
                    res = _supabase.table("stock_prices").select("date,open,high,low,close,volume").eq("symbol", "EGX30").eq("exchange", "INDX").order("date", desc=False).range(offset, offset + page_size - 1).execute()
                    if not res.data:
                        break
                    all_data.extend(res.data)
                    if len(res.data) < page_size:
                        break
                    offset += page_size
                if all_data:
                    filtered = [r for r in all_data if from_date <= r["date"] <= to_date]
                    if filtered:
                        egx30_data = filtered
        except Exception as se:
            print(f"Supabase fallback for EGX30 failed: {se}")

    # If Supabase didn't work, try local JSON file
    if not egx30_data or (isinstance(egx30_data, list) and len(egx30_data) == 0):
        try:
            index_path = _os.path.join(base_dir, "symbols_data", "EGX30-INDEX.json")
            if _os.path.exists(index_path):
                with open(index_path, "r", encoding="utf-8") as f:
                    local_data = _json.loads(f.read())
                if isinstance(local_data, list) and len(local_data) > 0:
                    filtered = [r for r in local_data if from_date <= r.get("date", "") <= to_date]
                    if filtered:
                        egx30_data = filtered
        except Exception as le:
            print(f"Local JSON fallback for EGX30 failed: {le}")

    if (not egx30_data or not egx100_data) and file_fallback_data:
        print("One or more EGX index fetches failed, falling back to cached market status")
        return file_fallback_data

    # Calculate current regime based on EGX30
    regime = "sideways"
    egx30_return = 0.0
    if egx30_data and isinstance(egx30_data, list):
        try:
            egx30_data.sort(key=lambda x: x["date"])
            if len(egx30_data) >= 2:
                close_today = float(egx30_data[-1]["close"])
                close_prev = float(egx30_data[-2]["close"])
                egx30_return = (close_today - close_prev) / close_prev
                from api.egx30_fetcher import get_market_regime
                regime = get_market_regime(egx30_return)
        except Exception as e:
            print(f"Error calculating market regime: {e}")

    res_data = {
        "egx30": egx30_data,
        "egx100": egx100_data,

        "regime": regime,
        "egx30_return": egx30_return,
        "reject_buys": regime == "panic",
        "updated_at": _dt.datetime.utcnow().isoformat()
    }

    # Save to local file cache
    try:
        _os.makedirs(_os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            _json.dump(res_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error writing local market status cache: {e}")

    _MARKET_STATUS_CACHE["status"] = (now, res_data)
    return res_data





@app.get("/models/local")

def list_local_models():

    try:

        # Prefer the richer metadata format used by the admin UI.

        from api.routers.admin import list_local_models as _list_local_models



        return _list_local_models()

    except Exception as e:

        print(f"Warning: Failed to use admin router for local models: {e}")

        api_dir = os.path.dirname(os.path.abspath(__file__))



        models_dir = os.path.join(api_dir, "models")

        if not os.path.exists(models_dir):

            return {"models": []}



        files = [f for f in os.listdir(models_dir) if f.endswith(".pkl")]

        files.sort()

        return {"models": files}





@app.get("/symbols/inventory")

def symbols_inventory():

    """Returns mapping of countries/exchanges to symbol/price counts."""

    from api.stock_ai import get_supabase_inventory



    return {"inventory": get_supabase_inventory()}


@app.get("/market/macro-correlation/symbols")
def get_macro_correlation_symbols():
    try:
        from api.symbols_local import load_symbols_for_country
        symbols_data = load_symbols_for_country("Egypt")
        syms = list(set([str(row.get("Symbol", row.get("symbol", row.get("Code", "")))).strip() for row in symbols_data]))
        # Filter out empty and COMI (which is used for parallel rate)
        syms = [s for s in syms if s and s != "COMI"]
        syms.sort()
        if not syms:
            return {"symbols": ["FWRY", "ABUK", "AMOC", "EAST", "SWDY", "HRHO", "CIEB", "MASR", "COSG", "ETEL"]}
        return {"symbols": syms}
    except Exception as e:
        print(f"Error listing EGX symbols: {e}")
        return {"symbols": ["FWRY", "ABUK", "AMOC", "EAST", "SWDY", "HRHO", "CIEB", "MASR", "COSG", "ETEL"]}


@app.get("/market/macro-correlation/data")
def get_macro_correlation_data(symbol: str = Query(..., description="Stock symbol to compute correlation for")):
    from fastapi import HTTPException
    try:
        from api.macro_correlation import calculate_macro_correlation
        data = calculate_macro_correlation(symbol.upper().strip())
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Correlation computation failed: {str(e)}")


@app.get("/market/macro-correlation/scan")
def get_macro_correlation_scan(force_refresh: bool = False):
    from fastapi import HTTPException
    try:
        from api.macro_correlation import scan_macro_correlation
        return scan_macro_correlation(force_refresh=bool(force_refresh))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Hedge scan failed: {str(e)}")


@app.post("/market/macro-correlation/refresh")
def refresh_macro_correlation_cache():
    from fastapi import HTTPException
    try:
        from api.macro_correlation import build_or_update_macro_history, CACHE_PATH
        import os
        if os.path.exists(CACHE_PATH):
            try:
                os.remove(CACHE_PATH)
            except:
                pass
        data = build_or_update_macro_history()
        return {"ok": True, "records_count": len(data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Refresh failed: {str(e)}")





@app.get("/symbols/countries")

def symbols_countries(source: str = Query(default="supabase")):

    try:

        # Debugging logging

        # with open("/tmp/country_debug.log", "a") as f:

        #    f.write(f"DEBUG: Country fetch start. Source={source}\n")



        if source == "local":

            return {"countries": list_countries()}



        try:

            from api.stock_ai import get_supabase_countries



            sb_countries = get_supabase_countries()

            if sb_countries:

                return {"countries": sb_countries}

        except Exception as sb_err:

            print(f"DEBUG ERROR: get_supabase_countries failed: {sb_err}")



        # Fallback to local

        try:

            return {"countries": list_countries()}

        except Exception as loc_err:

            print(f"DEBUG ERROR: list_countries failed: {loc_err}")

            return {"countries": ["Egypt", "USA", "UK"]}



    except Exception as e:

        import traceback



        err_msg = traceback.format_exc()

        # Try to write to a place we can definitely read on Windows if /tmp fails

        try:

            with open("country_error.log", "w") as f:

                f.write(err_msg)

        except:

            pass

        print(f"CRITICAL ERROR in symbols_countries: {e}")

        raise HTTPException(status_code=500, detail=f"Countries fetch failed: {str(e)}")





@app.get("/symbols/by-date")

def symbols_by_date(

    request: Request,

    start: str = Query(..., description="Start date YYYY-MM-DD"),

    end: str = Query(..., description="End date YYYY-MM-DD"),

    exchange: Optional[str] = Query(default=None),

    limit: int = Query(default=200, ge=1, le=5000),

    search_term: Optional[str] = Query(default=None),

):

    import api.stock_ai as stock_ai

    stock_ai._init_supabase()

    if not stock_ai.supabase:

        return {"results": []}



    def _chunks(items: list, size: int):

        for i in range(0, len(items), size):

            yield items[i : i + size]



    try:

        # Use RPC to efficiently get unique symbols with price data in the date range

        # RPC function get_exchange_symbols_prices:

        # SELECT DISTINCT ON (symbol) symbol, MAX(date) as last_date, MIN(date) as first_date, COUNT(*) as count FROM stock_prices

        # WHERE exchange = p_exchange AND date >= p_start AND date <= p_end

        # GROUP BY symbol ORDER BY symbol, date DESC;



        rpc_args = {

            "p_exchange": exchange,

            "p_start": start,

            "p_end": end,

            "p_limit": limit * 5,  # Fetch more initially for filtering

        }



        # If exchange is None, this RPC won't work well without modifications.

        # For now, we assume exchange is always provided as per frontend logic.

        if not exchange:

            return {"results": []}



        rpc_res = supabase.rpc("get_exchange_symbols_prices", rpc_args).execute()

        if not rpc_res.data:

            return {"results": []}



        # rpc_res.data will contain unique symbols along with their date range counts.

        # We need to transform this into the format expected by the frontend.

        symbols_from_db = []

        for row in rpc_res.data:

            symbols_from_db.append(

                {

                    "symbol": row["symbol"],

                    "exchange": exchange,  # Exchange is implicit from the RPC call

                    "name": "",  # Will be enriched later

                    "last_date": row["last_date"],

                    "first_date": row["first_date"],

                    "row_count": row["count"],

                }

            )



        # Enrich with names from stock_fundamentals in chunks

        symbols_to_process = []

        if symbols_from_db:

            names_map: dict[str, str] = {}

            symbol_list = [s["symbol"] for s in symbols_from_db]



            for chunk in _chunks(symbol_list, 500):

                res = (

                    supabase.table("stock_fundamentals")

                    .select("symbol,data")

                    .in_("symbol", chunk)

                    .eq("exchange", exchange)  # Filter fundamentals by exchange too

                    .execute()

                )

                if res.data:

                    for r in res.data:

                        d = r.get("data") or {}

                        names_map[r.get("symbol")] = d.get("name", d.get("Name", ""))



            for s in symbols_from_db:

                s["name"] = names_map.get(s["symbol"], "")

                symbols_to_process.append(s)



        # Apply search_term filter if provided

        if search_term:

            search_term_lower = search_term.lower()

            symbols_to_process = [

                s

                for s in symbols_to_process

                if search_term_lower in s["name"].lower()

                or search_term_lower in s["symbol"].lower()

            ]



        # Apply limit after all filtering and sorting

        symbols_to_process = symbols_to_process[:limit]

        symbols_to_process.sort(key=lambda x: x["symbol"])

        return {"results": symbols_to_process}

    except Exception as e:

        print(f"Error in symbols_by_date: {e}")

        raise HTTPException(status_code=500, detail=str(e))





@app.get("/symbols/synced")

def symbols_synced(

    country: Optional[str] = Query(default=None),

    source: str = Query(default="supabase"),

):

    """API for frontend to fetch all synced symbols once and cache."""

    try:

        if source == "local" and country:

            from api.stock_ai import _init_supabase, is_ticker_synced

            from api.symbols_local import load_symbols_for_country



            _init_supabase()

            raw = load_symbols_for_country(country)



            # Batch check for Supabase presence to avoid O(N) queries

            from api.stock_ai import batch_check_local_cache



            symbol_ex_list = []

            for r in raw:

                s = r.get("Symbol") or r.get("symbol") or r.get("Code") or r.get("code")

                ex = r.get("Exchange") or r.get("exchange")

                if s and ex:

                    symbol_ex_list.append((s, ex))



            sync_status = batch_check_local_cache(symbol_ex_list)



            # Map to consistent format

            results = []

            for r in raw:

                s = r.get("Symbol") or r.get("symbol") or r.get("Code") or r.get("code")

                ex = r.get("Exchange") or r.get("exchange")

                n = r.get("Name") or r.get("name") or ""

                if s and ex:

                    results.append(

                        {

                            "symbol": s,

                            "exchange": ex,

                            "name": n,

                            "country": country,

                            "hasLocal": sync_status.get((s, ex), False),

                        }

                    )

            return {"results": results}



        from api.stock_ai import get_supabase_symbols



        results = get_supabase_symbols(country=country)



        return {"results": results}

    except Exception as e:

        raise HTTPException(status_code=500, detail=str(e))





@app.get("/symbols/search")

def symbols_search(

    q: str = Query(default="", max_length=64),

    country: str | None = Query(default=None, max_length=64),

    exchange: str | None = Query(default=None, max_length=24),

    limit: int = Query(default=25, ge=1, le=100000),

    source: str = Query(default="supabase"),

):

    try:

        if source == "local":

            results = search_symbols(

                q=q, country=country, exchange=exchange, limit=limit

            )

            return {"results": results}



        # Supabase search

        from api.stock_ai import get_supabase_symbols



        all_sb = get_supabase_symbols(country=country)



        q_low = q.lower().strip()

        results = []

        for s in all_sb:

            s_name = str(s.get("name") or "")

            s_symbol = str(s.get("symbol") or "")

            if not q_low or q_low in s_symbol.lower() or q_low in s_name.lower():

                # Apply exchange filter if provided

                s_exchange = str(s.get("exchange") or "")

                if exchange and s_exchange.lower() != exchange.lower():

                    continue

                results.append(s)

                if len(results) >= limit:

                    break



        # If supabase has no results, maybe fallback to local or return empty

        # but user specifically asked to use supabase for the app.

        return {"results": results}

    except FileNotFoundError as e:

        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:

        raise HTTPException(status_code=500, detail=str(e))





import time

from threading import Lock



_PREDICT_CACHE: Dict[str, Dict[str, Any]] = {}

_PREDICT_CACHE_LOCK = Lock()

_PREDICT_CACHE_TTL = 300  # 5 minutes





@app.post("/predict")

def predict(req: PredictRequest):

    # 1. Generate a cache key based on most important request fields

    cache_key = f"{req.ticker.strip().upper()}_{req.exchange or 'AUTO'}_{req.model_name or 'DEFAULT'}_{req.rf_preset}_{req.from_date}_{req.to_date}_{req.target_pct}_{req.stop_loss_pct}_{req.look_forward_days}_{req.buy_threshold}_{req.use_volatility_label}"



    # 2. Check cache

    with _PREDICT_CACHE_LOCK:

        cached = _PREDICT_CACHE.get(cache_key)

        if cached and (time.time() - cached["ts"] < _PREDICT_CACHE_TTL):

            return cached["data"]



    api_key = os.getenv("EODHD_API_KEY")

    if (not req.force_local) and (not api_key):

        raise HTTPException(status_code=500, detail="EODHD_API_KEY is not configured")



    try:

        payload = run_pipeline(

            api_key=api_key or "",

            ticker=req.ticker.strip().upper(),

            from_date=req.from_date,

            to_date=req.to_date,

            include_fundamentals=req.include_fundamentals,

            exchange=req.exchange,

            force_local=req.force_local,

            rf_preset=req.rf_preset,

            rf_params=req.rf_params,

            model_name=req.model_name,

            target_pct=req.target_pct,

            stop_loss_pct=req.stop_loss_pct,

            look_forward_days=req.look_forward_days,

            buy_threshold=req.buy_threshold,

            use_volatility_label=req.use_volatility_label,

        )



        # 3. Store in cache

        with _PREDICT_CACHE_LOCK:

            _PREDICT_CACHE[cache_key] = {"ts": time.time(), "data": payload}



        return payload

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:

        print(f"Internal error in /predict: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")





@app.get("/price")

def get_price(

    ticker: str = Query(

        default="", min_length=1, max_length=24, pattern=r"^[A-Za-z0-9.\-]{1,24}$"

    ),

):

    t = ticker.strip().upper()

    cfg = _load_admin_config()

    source = (cfg.get("source") or "eodhd").lower()



    api_key = os.getenv("EODHD_API_KEY")

    as_of = dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc).isoformat()



    try:

        if source == "eodhd" and api_key:

            price = _fetch_price_eodhd(t, api_key)

            return {"ticker": t, "price": price, "source": "eodhd", "asOf": as_of}



        price = _fetch_price_yahoo(t)

        return {"ticker": t, "price": price, "source": "yahoo", "asOf": as_of}

    except ValueError as e:

        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:

        print(f"Internal error in /price: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")





# ─── News Systems Overview ──────────────────────────────────────────────

# This project has 3 news data sources. They serve different purposes:

#

# 1. Google News RSS (Phase 12 — scored, bilingual, Supabase-persisted)

#    Engine: api/news_sentiment_engine.py

#    Endpoints: GET /api/scan/stocks/{symbol}/news, GET /api/scan/news

#    Purpose: Sentiment analysis + veto gate + rationale enrichment for EGX.

#    This is the PRIMARY news system for AI decision-making.

#

# 2. Yahoo Finance (legacy — unscored, US/market-wide)

#    Endpoint: GET /news (below)

#    Purpose: General market headlines for the stock detail page.

#



@app.get("/news")

def get_news(symbol: str = Query(default="all_symbols")):

    try:

        articles = []

        symbol_upper = symbol.upper()

        # If symbol is an Egyptian stock (ends with .CA or is a local symbol in EGX)

        is_egx = symbol_upper.endswith(".CA") or symbol_upper.endswith(".EGX") or "." not in symbol_upper

        

        if is_egx and symbol != "all_symbols":

            try:

                from api.news_sentiment_engine import fetch_google_news

                google_news = fetch_google_news(symbol_upper, days_back=7)

                for n in google_news:

                    articles.append(

                        {

                            "title": n.get("title"),

                            "url": n.get("link"),

                            "source": {"name": n.get("source", "Google News")},

                            "publishedAt": n.get("published"),

                            "description": "أخبار وتحليلات البورصة المصرية",

                            "image": None,

                        }

                    )

            except Exception as e:

                print(f"Failed to fetch Google News RSS for {symbol}: {e}")



        # Fallback to Yahoo Finance news if no articles found or if it's a US stock

        if not articles:

            ticker_str = "SPY" if symbol == "all_symbols" else symbol

            yf_ticker = _normalize_yahoo_ticker(ticker_str)

            t = yf.Ticker(yf_ticker)

            raw_news = getattr(t, "news", [])

            for n in raw_news:

                articles.append(

                    {

                        "title": n.get("title"),

                        "url": n.get("link"),

                        "source": {"name": n.get("publisher", "Yahoo Finance")},

                        "publishedAt": dt.datetime.fromtimestamp(

                            n.get("providerPublishTime")

                        ).isoformat()

                        if n.get("providerPublishTime")

                        else None,

                        "description": n.get("type", "Market News"),

                        "image": n.get("thumbnail", {})

                        .get("resolutions", [{}])[0]

                        .get("url")

                        if n.get("thumbnail")

                        else None,

                    }

                )



        return {"articles": articles}

    except Exception as e:

        print(f"News fetch error: {e}")

        return {"articles": [], "error": str(e)}





# ------------------------------------------------------------------

# Strategy Tester Simulation Endpoint

# POST /backtest/simulate → single-symbol, multi-model backtest

# ------------------------------------------------------------------





class BotConfig(BaseModel):

    id: str

    model_name: str

    target_pct: float = 0.10

    stop_loss_pct: float = 0.05

    hold_days: int = 20

    threshold: float = 0.45

    bot_mode: str = "normal"

    min_volume_ratio: float = 0.3

    use_rsi_filter: bool = True

    use_trend_filter: bool = False

    use_market_regime: bool = True

    regime_adx_threshold: float = 14.0

    use_smart_exit: bool = True

    smart_exit_rsi_threshold: float = 40.0

    smart_exit_volume_spike: float = 3.0

    trading_mode: str = "hybrid"

    use_atr_exits: bool = True

    use_adaptive_exits: bool = False

    atr_sl_multiplier: float = 1.5

    atr_tp_multiplier: float = 2.5

    atr_period: int = 14

    exit_mode: str = "hybrid"

    use_trailing: bool = True

    trail_be_pct: float = 0.04

    trail_lock_trigger_pct: float = 0.06

    trail_lock_pct: float = 0.04

    use_adaptive_model_selector: bool = False

    adaptive_model_pool: Optional[List[str]] = None

    adaptive_min_confidence: float = 0.55





class StrategyTesterRequest(BaseModel):

    symbol: str

    exchange: str = "EGX"

    start_date: str = "2023-01-01"

    end_date: Optional[str] = None

    models: List[str] = []  # Deprecated, kept for fallback

    target_pct: float = 0.10  # e.g. 0.10 = 10%

    stop_loss_pct: float = 0.05  # e.g. 0.05 = 5%

    hold_days: int = 20

    threshold: float = 0.45  # model confidence threshold for buy signal

    capital: float = 100000

    bot_mode: str = "normal"  # aggressive | normal | conservative

    bots: Optional[List[BotConfig]] = None

    min_volume_ratio: float = 0.3

    use_rsi_filter: bool = True

    use_trend_filter: bool = False

    use_market_regime: bool = True

    regime_adx_threshold: float = 14.0

    use_smart_exit: bool = True

    smart_exit_rsi_threshold: float = 40.0

    smart_exit_volume_spike: float = 3.0

    trading_mode: str = "hybrid"

    use_atr_exits: bool = True

    use_adaptive_exits: bool = False

    atr_sl_multiplier: float = 1.5

    atr_tp_multiplier: float = 2.5

    atr_period: int = 14

    exit_mode: str = "hybrid"

    use_trailing: bool = True

    trail_be_pct: float = 0.04

    trail_lock_trigger_pct: float = 0.06

    trail_lock_pct: float = 0.04

    use_adaptive_model_selector: bool = False

    adaptive_model_pool: Optional[List[str]] = None

    adaptive_min_confidence: float = 0.55





@app.post("/backtest/simulate")

def strategy_tester_endpoint(req: StrategyTesterRequest):

    """

    Run a strategy tester simulation for a single symbol using one or more AI models.

    Returns OHLCV bars and per-model trade lists + statistics.

    """

    import traceback as _tb



    api_dir = os.path.dirname(os.path.abspath(__file__))

    models_dir = os.path.join(api_dir, "models")



    # Validate models and gather simulation configs

    sim_configs = []



    # Check if either bots or models are provided

    if not req.bots and not req.models:

        raise HTTPException(

            status_code=422, 

            detail="Either 'bots' or 'models' must be provided in the request body"

        )



    if req.bots:

        for bot in req.bots:

            safe_m = _safe_basename(bot.model_name)

            mp = os.path.join(models_dir, safe_m)

            if not os.path.exists(mp):

                raise HTTPException(

                    status_code=422, detail=f"Model not found: {safe_m}"

                )

            sim_configs.append((bot.id, safe_m, bot))

    else:

        for m in req.models:

            safe_m = _safe_basename(m)

            mp = os.path.join(models_dir, safe_m)

            if not os.path.exists(mp):

                raise HTTPException(

                    status_code=422, detail=f"Model not found: {safe_m}"

                )

            mock_bot = BotConfig(

                id=m,

                model_name=safe_m,

                target_pct=req.target_pct,

                stop_loss_pct=req.stop_loss_pct,

                hold_days=req.hold_days,

                threshold=req.threshold,

                bot_mode=req.bot_mode,

                min_volume_ratio=req.min_volume_ratio,

                use_rsi_filter=req.use_rsi_filter,

                use_trend_filter=req.use_trend_filter,

                use_market_regime=req.use_market_regime,

                regime_adx_threshold=req.regime_adx_threshold,

                use_smart_exit=req.use_smart_exit,

                smart_exit_rsi_threshold=req.smart_exit_rsi_threshold,

                smart_exit_volume_spike=req.smart_exit_volume_spike,

                trading_mode=req.trading_mode,

                use_atr_exits=req.use_atr_exits,

                atr_sl_multiplier=req.atr_sl_multiplier,

                atr_tp_multiplier=req.atr_tp_multiplier,

                atr_period=req.atr_period,

                exit_mode=req.exit_mode,

            )

            sim_configs.append((m, safe_m, mock_bot))



    if not sim_configs:

        raise HTTPException(status_code=422, detail="No valid models or bots provided")



    # ── 1. Fetch single-symbol price data from Supabase ──────────────────────

    import api.stock_ai as stock_ai

    from api.stock_ai import add_massive_features as _amf



    stock_ai._init_supabase()

    supabase = stock_ai.supabase



    try:

        from api.train_exchange_model import add_massive_features

    except Exception:

        add_massive_features = None



    symbol_upper = req.symbol.strip().upper()

    exchange_upper = req.exchange.strip().upper()



    # Use a buffer start 400 days before the requested start for indicator warm-up

    try:

        sim_start_dt = pd.to_datetime(req.start_date, format="%Y-%m-%d")

    except Exception:

        raise HTTPException(

            status_code=422, detail=f"Invalid start_date: {req.start_date}"

        )



    buffer_start_dt = sim_start_dt - pd.Timedelta(days=400)

    buffer_start = buffer_start_dt.strftime("%Y-%m-%d")

    end_date = req.end_date or dt.datetime.utcnow().date().isoformat()



    # Fetch OHLCV for this symbol

    try:

        if supabase:

            q = (

                supabase.table("stock_prices")

                .select("symbol,exchange,date,open,high,low,close,volume")

                .eq("exchange", exchange_upper)

                .eq("symbol", symbol_upper)

                .gte("date", buffer_start)

                .lte("date", end_date)

                .order("date", desc=False)

            )

            res = q.execute()

            rows = res.data or []

        else:

            rows = []

    except Exception as e:

        raise HTTPException(status_code=502, detail=f"Failed to fetch price data: {e}")



    if not rows:

        raise HTTPException(

            status_code=404,

            detail=f"No price data found for {symbol_upper} on {exchange_upper}",

        )



    df_raw = pd.DataFrame(rows)

    df_raw["date"] = pd.to_datetime(df_raw["date"])

    df_raw = df_raw.sort_values("date").reset_index(drop=True)

    df_raw["symbol"] = symbol_upper



    # Ensure numeric OHLCV columns

    for col in ["open", "high", "low", "close", "volume"]:

        if col in df_raw.columns:

            df_raw[col] = pd.to_numeric(df_raw[col], errors="coerce")



    df_raw = df_raw.set_index("date")



    # ── 2. Feature engineering ───────────────────────────────────────────────

    try:

        if add_massive_features is not None:

            df_featured = add_massive_features(df_raw.copy())

        else:

            df_featured = df_raw.copy()

    except Exception as e:

        print(f"[STRAT-TESTER] Feature engineering warning: {e}", flush=True)

        df_featured = df_raw.copy()



    # ── 3. Prepare OHLCV bars for frontend (simulation window only) ──────────

    sim_mask = df_featured.index >= sim_start_dt

    df_sim = df_featured[sim_mask].copy()



    bars = []

    for date, row in df_raw[df_raw.index >= sim_start_dt].iterrows():

        bars.append(

            {

                "time": int(date.timestamp()),

                "open": float(row["open"]) if pd.notna(row.get("open")) else None,

                "high": float(row["high"]) if pd.notna(row.get("high")) else None,

                "low": float(row["low"]) if pd.notna(row.get("low")) else None,

                "close": float(row["close"]) if pd.notna(row.get("close")) else None,

                "volume": float(row["volume"]) if pd.notna(row.get("volume")) else 0,

            }

        )



    # ── 4. Run simulation for each model ─────────────────────────────────────

    from api.backtest_radar import load_model, run_radar_simulation, run_enhanced_radar_simulation

    from api.backtest_config import BacktestConfig, get_simulation_function

    from api.model_utils import safe_model_path

    

    # Log current configuration

    BacktestConfig.log_configuration()



    adaptive_info = None

    if req.use_adaptive_model_selector:

        adaptive_pool = req.adaptive_model_pool or [name for _, name, _ in sim_configs]

        adaptive_info = _resolve_adaptive_selection(

            exchange=exchange_upper,

            models_dir=models_dir,

            as_of=req.start_date,

            model_pool=adaptive_pool,

            fallback_price_frame=df_raw.reset_index(),

            min_confidence=req.adaptive_min_confidence,

        )

        if adaptive_info and adaptive_info.get("recommended_model"):

            base_bot = sim_configs[0][2] if sim_configs else None

            if base_bot is not None:

                adaptive_bot = BotConfig(**base_bot.dict())

                adaptive_bot.id = "Adaptive Selector"

                adaptive_bot.model_name = adaptive_info["recommended_model"]

                adaptive_bot.use_adaptive_model_selector = True

                adaptive_bot.adaptive_model_pool = adaptive_pool

                adaptive_bot.adaptive_min_confidence = req.adaptive_min_confidence

                sim_configs.append(

                    (

                        adaptive_bot.id,

                        adaptive_info["recommended_model"],

                        adaptive_bot,

                    )

                )



    model_results = {}

    for bot_id, model_name, bot in sim_configs:

        try:

            # Security: resolve model name inside models_dir only (no traversal)

            try:

                model_path = safe_model_path(model_name, models_dir)

            except ValueError:

                model_results[bot_id] = {

                    "error": "Invalid model name",

                    "trades": [],

                    "stats": {},

                }

                continue

            model_obj = load_model(model_path)

            if model_obj is None:

                model_results[bot_id] = {

                    "error": "Failed to load model",

                    "trades": [],

                    "stats": {},

                }

                continue



            # === ATR vs Percentage Safety Guard (Strategy Tester) ===

            # The UI sends target/SL as percentages (<1.0, e.g. 0.10 = 10%).

            # But ATR exit mode needs multipliers (>=1.0, e.g. 2.5x ATR).

            # If there's a mismatch, we fall back to the bot's configured ATR multipliers.

            safe_target = bot.target_pct

            safe_sl = bot.stop_loss_pct

            if bot.use_atr_exits and (bot.exit_mode or "hybrid").lower() != "manual":

                if safe_target is not None and safe_target < 1.0:

                    # Looks like a percentage, not a multiplier → use configured ATR tp multiplier

                    safe_target = (

                        bot.atr_tp_multiplier

                        if bot.atr_tp_multiplier and bot.atr_tp_multiplier >= 1.0

                        else 2.5

                    )

                if safe_sl is not None and safe_sl < 1.0:

                    # Looks like a percentage, not a multiplier → use configured ATR sl multiplier

                    safe_sl = (

                        bot.atr_sl_multiplier

                        if bot.atr_sl_multiplier and bot.atr_sl_multiplier >= 1.0

                        else 1.5

                    )

            else:

                # Manual exit mode → must be a fraction < 1.0

                if safe_target is not None and safe_target >= 1.0:

                    safe_target = 0.10  # coerce to 10% default

                if safe_sl is not None and safe_sl >= 1.0:

                    safe_sl = 0.05  # coerce to 5% default



            # Use enhanced simulation based on configuration

            simulation_function = get_simulation_function()

            

            result = simulation_function(

                df=df_featured.copy(),

                model=model_obj,

                council=None,

                threshold=bot.threshold,

                capital=req.capital,

                sim_start_dt=sim_start_dt,

                sim_end_dt=pd.to_datetime(end_date) if end_date else None,

                quiet=True,

                target_pct_override=safe_target,

                stop_loss_pct_override=safe_sl,

                min_volume_ratio=bot.min_volume_ratio,

                use_rsi_filter=bot.use_rsi_filter,

                use_trend_filter=bot.use_trend_filter,

                use_market_regime=bot.use_market_regime,

                regime_adx_threshold=bot.regime_adx_threshold,

                use_smart_exit=bot.use_smart_exit,

                smart_exit_rsi_threshold=bot.smart_exit_rsi_threshold,

                smart_exit_volume_spike=bot.smart_exit_volume_spike,

                trading_mode=bot.trading_mode,

                use_atr_exits=bot.use_atr_exits,

                atr_sl_multiplier=bot.atr_sl_multiplier,

                atr_tp_multiplier=bot.atr_tp_multiplier,

                atr_period=bot.atr_period,

                exit_mode=bot.exit_mode,

                use_trailing=bot.use_trailing,

                trail_be_pct=bot.trail_be_pct,

                trail_lock_trigger_pct=bot.trail_lock_trigger_pct,

                trail_lock_pct=bot.trail_lock_pct,

                adaptive_exits=getattr(bot, "use_adaptive_exits", False),

            )



            if not result:

                model_results[bot_id] = {

                    "error": "Simulation returned empty result",

                    "trades": [],

                    "stats": {},

                }

                continue



            # Convert Trades Log DataFrame to a list of dicts

            df_trades = result.get("Trades Log")

            trades = []

            if df_trades is not None and not df_trades.empty:

                # Convert DataFrame to list of dicts and handle any numpy/pandas types

                raw_trades = df_trades.to_dict(orient="records")

                for t in raw_trades:

                    clean_t = {}

                    for k, v in t.items():

                        if isinstance(v, (np.integer, np.int64)):

                            clean_t[k] = int(v)

                        elif isinstance(v, (np.floating, np.float64)):

                            clean_t[k] = float(v)

                        elif isinstance(v, np.ndarray):

                            clean_t[k] = v.tolist()

                        elif pd.isna(v):

                            clean_t[k] = None

                        else:

                            clean_t[k] = v

                    trades.append(clean_t)



            # Extract metrics and sanitize numpy types for JSON serialization

            stats = {}

            for k, v in result.items():

                if k == "Trades Log":

                    continue

                if isinstance(v, (np.integer, np.int64)):

                    stats[k] = int(v)

                elif isinstance(v, (np.floating, np.float64)):

                    stats[k] = float(v)

                elif isinstance(v, np.ndarray):

                    stats[k] = v.tolist()

                elif pd.isna(v):

                    stats[k] = None

                elif isinstance(v, (int, float, str, bool)) or v is None:

                    stats[k] = v

                else:

                    try:

                        stats[k] = float(v)

                    except Exception:

                        stats[k] = str(v)



            # Compute simple stats if not already in stats

            if trades and not stats.get("win_rate"):

                wins = [t for t in trades if t.get("PnL_Pct", 0) > 0]

                stats["total_trades"] = len(trades)

                stats["win_rate"] = round(len(wins) / len(trades) * 100, 1)

                total_pnl = sum(t.get("PnL_Pct", 0) for t in trades)

                # FIX: PnL_Pct might already be in percentage, check and don't double-multiply

                stats["net_profit_pct"] = round(total_pnl, 2)

                stats["avg_return_pct"] = round(total_pnl / len(trades), 2)

            

            # Add enhanced portfolio statistics if available

            if "portfolio_stats" in result:

                portfolio_stats = result["portfolio_stats"]

                stats["enhanced_metrics"] = {

                    "total_return_accurate": round(portfolio_stats.get("total_return_pct", 0) * 100, 2),

                    "max_drawdown": round(portfolio_stats.get("max_drawdown", 0) * 100, 2),

                    "sharpe_ratio": round(portfolio_stats.get("sharpe_ratio", 0), 2),

                    "total_commission": round(portfolio_stats.get("total_commission", 0), 2),

                    "portfolio_value": round(portfolio_stats.get("portfolio_value", 0), 2),

                    "cash_remaining": round(portfolio_stats.get("cash", 0), 2),

                    "current_exposure": round(portfolio_stats.get("current_exposure", 0) * 100, 2),

                    "avg_trade_pnl": round(portfolio_stats.get("avg_trade_pnl", 0), 2),

                }



            model_results[bot_id] = {

                "trades": trades,

                "stats": stats,

                "adaptive": adaptive_info if bot_id == "Adaptive Selector" else None,

            }



        except Exception as e:

            print(f"[STRAT-TESTER] Bot {bot_id} error: {e}", flush=True)

            _tb.print_exc()

            model_results[bot_id] = {"error": str(e), "trades": [], "stats": {}}



    return {

        "symbol": symbol_upper,

        "exchange": exchange_upper,

        "start_date": req.start_date,

        "end_date": end_date,

        "bars": bars,

        "total_bars": len(bars),

        "models": model_results,

        "adaptive": adaptive_info,

        "config": {

            "threshold": req.threshold,

            "target_pct": req.target_pct,

            "stop_loss_pct": req.stop_loss_pct,

            "hold_days": req.hold_days,

            "bot_mode": req.bot_mode,

            "capital": req.capital,

            "use_adaptive_model_selector": req.use_adaptive_model_selector,

        },

    }





# ------------------------------------------------------------------

# Backtest Endpoint

# ------------------------------------------------------------------

from pydantic import BaseModel as PBM





class OptimizeRequest(PBM):

    exchange: str

    model: str

    start_date: str = "2024-01-01"

    step: float = 0.05





class OptimizeRequest(PBM):

    exchange: str

    model: str

    start_date: str = "2024-01-01"

    step: float = 0.05





class BacktestRequest(PBM):

    exchange: str

    model: str

    start_date: str = "2024-01-01"

    end_date: str | None = None

    council_model: str | None = None

    validator_model: str | None = None

    meta_threshold: float | None = None

    council_threshold: float | None = None

    target_pct: float | None = None

    stop_loss_pct: float | None = None

    capital: float = 100000

    crypto_quote_filters: list[str] | None = None

    min_volume_ratio: float = 0.3

    use_rsi_filter: bool = True

    use_trend_filter: bool = False

    use_market_regime: bool = True

    regime_adx_threshold: float = 14.0

    use_smart_exit: bool = True

    smart_exit_rsi_threshold: float = 40.0

    smart_exit_volume_spike: float = 3.0

    trading_mode: str = "hybrid"

    use_atr_exits: bool = True

    atr_sl_multiplier: float = 1.5

    atr_tp_multiplier: float = 2.5

    atr_period: int = 14

    exit_mode: str = "hybrid"

    use_adaptive_model_selector: bool = False

    adaptive_model_pool: list[str] | None = None

    adaptive_min_confidence: float = 0.55





def _safe_basename(name: str) -> str:

    # Prevent path traversal and accidental directory usage in user-provided model names.

    name = (name or "").strip()

    name = name.replace("\\", "/")

    return name.split("/")[-1]





def _available_local_models(models_dir: str) -> list[str]:

    try:

        names = []

        for fn in os.listdir(models_dir):

            if fn.lower().endswith(".pkl"):

                names.append(fn)

        return sorted(names)

    except Exception:

        return []





def _load_model_card(models_dir: str, model_name: str) -> dict | None:

    try:

        p = os.path.join(models_dir, f"{model_name}.model_card.json")

        if not os.path.exists(p):

            return None

        with open(p, "r", encoding="utf-8") as f:

            return json.load(f)

    except Exception:

        return None





def _default_index_symbol_for_exchange(exchange: str) -> tuple[str, str | None]:

    ex = (exchange or "").strip().upper()

    if ex == "EGX":

        return "EGX30", "INDX"

    return "", ex or None





def _normalize_adaptive_price_frame(df: pd.DataFrame) -> pd.DataFrame:

    if df is None or df.empty:

        return pd.DataFrame()



    out = df.copy()

    rename_map = {}

    for src, dst in {

        "close": "Close",

        "high": "High",

        "low": "Low",

        "volume": "Volume",

    }.items():

        if src in out.columns:

            rename_map[src] = dst

    out = out.rename(columns=rename_map)



    if "Close" not in out.columns:

        return pd.DataFrame()

    if "High" not in out.columns:

        out["High"] = out["Close"]

    if "Low" not in out.columns:

        out["Low"] = out["Close"]

    if "Volume" not in out.columns:

        out["Volume"] = 0.0



    if "date" in out.columns:

        out["date"] = pd.to_datetime(out["date"], errors="coerce")

        out = out.dropna(subset=["date"]).set_index("date")

    if not isinstance(out.index, pd.DatetimeIndex):

        out.index = pd.to_datetime(out.index, errors="coerce")

        out = out[~out.index.isna()]



    return out.sort_index()[["Close", "High", "Low", "Volume"]]





# ── Cache لبيانات المؤشر التكيفي (صالح لـ 30 دقيقة) ──────────────────────────

_ADAPTIVE_INDEX_CACHE: dict = {}  # key: (exchange, date_str) → (timestamp, df)

_ADAPTIVE_CACHE_TTL_SECONDS = 1800  # 30 دقيقة





def _fetch_adaptive_index_data(

    exchange: str,

    as_of: Optional[str] = None,

) -> pd.DataFrame:

    import time

    import api.stock_ai as stock_ai



    # ── فحص الـ cache أولاً ─────────────────────────────────────────────────

    cache_key = (exchange.upper(), as_of or "latest")

    cached = _ADAPTIVE_INDEX_CACHE.get(cache_key)

    if cached:

        cached_at, cached_df = cached

        if time.time() - cached_at < _ADAPTIVE_CACHE_TTL_SECONDS:

            return cached_df



    stock_ai._init_supabase()

    supabase = stock_ai.supabase

    if not supabase:

        return pd.DataFrame()



    symbol, symbol_exchange = _default_index_symbol_for_exchange(exchange)

    if not symbol:

        return pd.DataFrame()



    try:

        as_of_dt = (

            pd.to_datetime(as_of, format="%Y-%m-%d")

            if as_of

            else pd.Timestamp.utcnow().tz_localize(None)

        )

    except Exception:

        as_of_dt = pd.Timestamp.utcnow().tz_localize(None)



    # ── تقليل الـ lookback من 400 إلى 120 يوم (كافية للتحليل وأسرع بكثير) ──

    start_dt = as_of_dt - pd.Timedelta(days=120)



    query = (

        supabase.table("stock_prices")

        .select("date, close, high, low, volume")

        .eq("symbol", symbol)

        .gte("date", start_dt.strftime("%Y-%m-%d"))

        .lte("date", as_of_dt.strftime("%Y-%m-%d"))

        .order("date", desc=False)

        .limit(200)  # ضمان عدم تجاوز حجم معين

    )

    if symbol_exchange:

        query = query.eq("exchange", symbol_exchange)



    try:

        rows = query.execute().data or []

    except Exception:

        rows = []



    result = _normalize_adaptive_price_frame(pd.DataFrame(rows))



    # ── حفظ في الـ cache ─────────────────────────────────────────────────────

    if not result.empty:

        _ADAPTIVE_INDEX_CACHE[cache_key] = (time.time(), result)



    return result





def _resolve_adaptive_selection(

    exchange: str,

    models_dir: str,

    as_of: Optional[str],

    model_pool: Optional[list[str]] = None,

    fallback_price_frame: Optional[pd.DataFrame] = None,

    min_confidence: float = 0.55,

) -> dict | None:

    index_df = _fetch_adaptive_index_data(exchange, as_of)

    if index_df.empty and fallback_price_frame is not None:

        index_df = _normalize_adaptive_price_frame(fallback_price_frame)

    if index_df.empty:

        return None



    current_date = None

    if as_of:

        try:

            current_date = pd.to_datetime(as_of, format="%Y-%m-%d").to_pydatetime()

        except Exception:

            current_date = None



    model_path, regime_info, candidates = recommend_model_from_pool(

        index_data=index_df,

        models_dir=models_dir,

        exchange=exchange,

        current_date=current_date,

        model_names=model_pool,

    )

    recommended_model = os.path.basename(model_path)

    return {

        "recommended_model": recommended_model,

        "recommended_model_path": model_path,

        "regime": regime_info.regime,

        "confidence": round(float(regime_info.confidence), 4),

        "momentum_score": round(float(regime_info.momentum_score), 4),

        "volatility_score": round(float(regime_info.volatility_score), 4),

        "trend_strength": round(float(regime_info.trend_strength), 4),

        "reason": regime_info.reason,

        "candidate_models": [item["name"] for item in candidates],

        "candidate_count": len(candidates),

        "meets_min_confidence": float(regime_info.confidence) >= float(min_confidence or 0.0),

        "min_confidence": float(min_confidence or 0.0),

        "as_of": as_of,

        "exchange": exchange,

    }





def _compute_benchmark_metrics(

    project_root: str,

    model_name: str,

    start_date: str,

    end_date: str | None,

    exchange: str | None = None,

) -> tuple[float | None, float | None, str | None]:

    """

    Returns (benchmark_return_pct, benchmark_win_rate, benchmark_name).

    Uses local index JSON referenced by the model card.

    """

    try:

        models_dir = os.path.join(project_root, "api", "models")

        card = _load_model_card(models_dir, model_name)

        index_rel = None

        if isinstance(card, dict):

            index_rel = (card.get("data_inputs") or {}).get("exchange_index_json_path")



        # Basic fallback for EGX models if the card is missing.

        ex = (exchange or (card or {}).get("exchange") or "").upper()

        if not index_rel and ex == "EGX":

            index_rel = os.path.join("symbols_data", "EGX30-INDEX.json")



        df = None

        if index_rel:

            index_path = os.path.join(project_root, index_rel)

            if os.path.exists(index_path):

                try:

                    with open(index_path, "r", encoding="utf-8") as f:

                        rows = json.load(f)

                    if isinstance(rows, list) and rows:

                        df = pd.DataFrame(rows)

                except Exception:

                    pass



        # Database fallback if file is missing or empty

        if (df is None or df.empty) and ex == "EGX":

            try:

                import api.stock_ai as stock_ai

                stock_ai._init_supabase()

                supabase = stock_ai.supabase

                if supabase:

                    offset = 0

                    limit = 1000

                    all_data = []

                    while True:

                        idx_res = (

                            supabase.table("stock_prices")

                            .select("date, close")

                            .eq("symbol", "EGX30")

                            .eq("exchange", "INDX")

                            .order("date", desc=False)

                            .range(offset, offset + limit - 1)

                            .execute()

                        )

                        if not idx_res.data:

                            break

                        all_data.extend(idx_res.data)

                        if len(idx_res.data) < limit:

                            break

                        offset += limit

                    if all_data:

                        df = pd.DataFrame(all_data)

            except Exception:

                pass



        if df is None or df.empty:

            return None, None, None



        if "date" not in df.columns or "close" not in df.columns:

            return None, None, None



        df["date"] = pd.to_datetime(df["date"], errors="coerce")

        df = df.dropna(subset=["date", "close"]).sort_values("date")



        sd = pd.to_datetime(start_date, errors="coerce")

        ed = pd.to_datetime(end_date, errors="coerce") if end_date else None

        if pd.isna(sd):

            return None, None, None



        # Filter for the simulation period

        mask = df["date"] >= sd

        if ed is not None and not pd.isna(ed):

            mask = mask & (df["date"] <= ed)



        period_df = df[mask]



        # Calculate Return

        start_row = df.loc[df["date"] >= sd].head(1)

        if ed is not None and not pd.isna(ed):

            end_row = df.loc[df["date"] <= ed].tail(1)

        else:

            end_row = df.tail(1)



        benchmark_return_pct = None

        if not start_row.empty and not end_row.empty:

            start_close = float(start_row["close"].iloc[0])

            end_close = float(end_row["close"].iloc[0])

            if (

                np.isfinite(start_close) and np.isfinite(end_close)

            ) and start_close != 0:

                benchmark_return_pct = ((end_close / start_close) - 1.0) * 100.0



        # Calculate Win Rate (Positive daily returns)

        benchmark_win_rate = None

        if not period_df.empty and len(period_df) > 1:

            period_df = period_df.copy()

            # Calculate % change from previous close

            period_df["pct_change"] = period_df["close"].pct_change()

            # Drop the first row which is NaN

            period_df = period_df.dropna(subset=["pct_change"])



            if not period_df.empty:

                positive_days = len(period_df[period_df["pct_change"] > 0])

                total_days = len(period_df)

                benchmark_win_rate = (positive_days / total_days) * 100.0



        benchmark_name = os.path.splitext(os.path.basename(index_path))[0]

        # print(f"[BT-LIVE] DEBUG: Benchmark stats model={model_name}, exchange={exchange}, return_pct={benchmark_return_pct}, win_rate={benchmark_win_rate}, name={benchmark_name}", flush=True)

        return benchmark_return_pct, benchmark_win_rate, str(benchmark_name)

    except Exception:

        return None, None, None





@app.post("/backtest")

def backtest_endpoint(req: BacktestRequest, background_tasks: BackgroundTasks):

    """

    Run backtest simulation as a background task to avoid timeouts.

    """

    # Validate the model name early to avoid expensive work and noisy background failures.

    api_dir = os.path.dirname(os.path.abspath(__file__))

    models_dir = os.path.join(api_dir, "models")

    adaptive_info = None

    requested_model = _safe_basename(req.model)

    adaptive_pool = [_safe_basename(name) for name in (req.adaptive_model_pool or []) if name]

    if req.use_adaptive_model_selector:

        if not adaptive_pool and requested_model:

            adaptive_pool = [requested_model]

        adaptive_info = _resolve_adaptive_selection(

            exchange=req.exchange,

            models_dir=models_dir,

            as_of=req.start_date,

            model_pool=adaptive_pool,

            min_confidence=req.adaptive_min_confidence,

        )

        if adaptive_info and adaptive_info.get("recommended_model"):

            requested_model = _safe_basename(adaptive_info["recommended_model"])

    model_path = os.path.join(models_dir, requested_model)

    if not os.path.exists(model_path):

        # Provide a helpful hint with closest matches.

        import difflib



        available = _available_local_models(models_dir)

        suggestions = difflib.get_close_matches(

            requested_model, available, n=5, cutoff=0.1

        )

        raise HTTPException(

            status_code=422,

            detail={

                "error": "model_not_found",

                "model": requested_model,

                "message": f"Model not found in {models_dir}",

                "suggestions": suggestions,

            },

        )



    # Optional validator model (Council Validator)

    requested_validator = None

    if req.validator_model:

        requested_validator = _safe_basename(req.validator_model)

        validator_path = os.path.join(models_dir, requested_validator)

        if not os.path.exists(validator_path):

            import difflib



            available = _available_local_models(models_dir)

            suggestions = difflib.get_close_matches(

                requested_validator, available, n=5, cutoff=0.1

            )

            raise HTTPException(

                status_code=422,

                detail={

                    "error": "validator_model_not_found",

                    "model": requested_validator,

                    "message": f"Validator model not found in {models_dir}",

                    "suggestions": suggestions,

                },

            )



    # 1. Create a placeholder record in Supabase to track status

    from api.stock_ai import supabase



    try:

        # Use today as default end_date if none provided

        end_date = req.end_date or dt.datetime.utcnow().date().isoformat()



        res = (

            supabase.table("backtests")

            .insert(

                {

                    "model_name": req.model,

                    "exchange": req.exchange,

                    "council_model": req.council_model,

                    "start_date": req.start_date,

                    "end_date": end_date,

                    "status": "pending",

                    "total_trades": 0,

                    "win_rate": 0,

                    "net_profit": 0,

                    "avg_return_per_trade": 0,

                    "meta_threshold": req.meta_threshold,

                    "council_threshold": req.council_threshold,

                    "target_pct": req.target_pct,

                    "stop_loss_pct": req.stop_loss_pct,

                    "capital": req.capital,

                }

            )

            .execute()

        )



        backtest_id = res.data[0]["id"] if res.data else None

    except Exception as e:

        print(f"Error creating backtest record: {e}")

        # If this is a Supabase RLS error (42501), warn and continue so the

        # backtest can still run in the background even though we couldn't

        # persist the record. For other errors, return a 502 to the client.

        try:

            err_str = str(e)

        except Exception:

            err_str = ""



        if "42501" in err_str or "row-level security" in err_str.lower():

            print(

                "WARNING: Supabase RLS prevented creating backtest record; continuing without DB record.",

                flush=True,

            )

            backtest_id = None

        else:

            raise HTTPException(

                status_code=502,

                detail={

                    "error": "supabase_insert_failed",

                    "message": "Failed to create backtest record in Supabase.",

                    "cause": str(e),

                },

            )



    # Use the sanitized model name end-to-end (subprocess + model card lookup).

    # Safety: If using ATR exits, target/SL must be >= 1.0 (multipliers). If manual exits, they must be < 1.0 (percentages).

    if req.use_atr_exits and getattr(req, "exit_mode", "hybrid").lower() != "manual":

        if req.target_pct is not None and req.target_pct < 1.0:

            print(

                f"WARNING: target_pct looks like a percentage ({req.target_pct}) but ATR exits are active; forcing to 2.0 for safety.",

                flush=True,

            )

            req.target_pct = 2.0

        if req.stop_loss_pct is not None and req.stop_loss_pct < 1.0:

            print(

                f"WARNING: stop_loss_pct looks like a percentage ({req.stop_loss_pct}) but ATR exits are active; forcing to 1.0 for safety.",

                flush=True,

            )

            req.stop_loss_pct = 1.0

    else:

        if req.target_pct is not None and req.target_pct >= 1.0:

            print(

                f"WARNING: target_pct looks like a multiplier ({req.target_pct}) but manual exits are active; forcing to 0.10 for safety.",

                flush=True,

            )

            req.target_pct = 0.10

        if req.stop_loss_pct is not None and req.stop_loss_pct >= 1.0:

            print(

                f"WARNING: stop_loss_pct looks like a multiplier ({req.stop_loss_pct}) but manual exits are active; forcing to 0.05 for safety.",

                flush=True,

            )

            req.stop_loss_pct = 0.05



    req_sanitized = BacktestRequest(

        exchange=req.exchange,

        model=requested_model,

        start_date=req.start_date,

        end_date=req.end_date,

        council_model=req.council_model,

        validator_model=requested_validator,

        meta_threshold=req.meta_threshold,

        council_threshold=req.council_threshold,

        target_pct=req.target_pct,

        stop_loss_pct=req.stop_loss_pct,

        capital=req.capital,

        crypto_quote_filters=req.crypto_quote_filters,

        min_volume_ratio=req.min_volume_ratio,

        use_rsi_filter=req.use_rsi_filter,

        use_trend_filter=req.use_trend_filter,

        use_market_regime=req.use_market_regime,

        regime_adx_threshold=req.regime_adx_threshold,

        use_smart_exit=req.use_smart_exit,

        smart_exit_rsi_threshold=req.smart_exit_rsi_threshold,

        smart_exit_volume_spike=req.smart_exit_volume_spike,

        trading_mode=req.trading_mode,

        use_atr_exits=req.use_atr_exits,

        atr_sl_multiplier=req.atr_sl_multiplier,

        atr_tp_multiplier=req.atr_tp_multiplier,

        atr_period=req.atr_period,

        exit_mode=req.exit_mode,

        use_adaptive_model_selector=req.use_adaptive_model_selector,

        adaptive_model_pool=adaptive_pool,

        adaptive_min_confidence=req.adaptive_min_confidence,

    )



    background_tasks.add_task(run_backtest_task, req_sanitized, backtest_id)

    return {

        "status": "queued",

        "id": backtest_id,

        "message": f"Backtest for {requested_model} on {req.exchange} has been started. Trace ID: {backtest_id}",

        "adaptive": adaptive_info,

    }





@app.get("/adaptive/recommendation")

def adaptive_recommendation(

    exchange: str = Query(default="EGX"),

    as_of: Optional[str] = Query(default=None),

    model_names: Optional[List[str]] = Query(default=None),

    min_confidence: float = Query(default=0.55),

):

    api_dir = os.path.dirname(os.path.abspath(__file__))

    models_dir = os.path.join(api_dir, "models")

    info = _resolve_adaptive_selection(

        exchange=exchange,

        models_dir=models_dir,

        as_of=as_of,

        model_pool=model_names,

        min_confidence=min_confidence,

    )

    if not info:

        raise HTTPException(

            status_code=404,

            detail="Unable to compute adaptive recommendation for the requested exchange.",

        )

    return info





def run_backtest_task(req: BacktestRequest, backtest_id: str = None):

    """Internal task runner for backtests with real-time status updates."""

    import csv

    import datetime as dt

    import json

    import os

    import subprocess

    import sys



    from api.stock_ai import supabase



    model_name = req.model

    exchange = req.exchange

    start_date = req.start_date

    end_date = req.end_date or dt.datetime.utcnow().date().isoformat()



    # Build command

    api_dir = os.path.dirname(os.path.abspath(__file__))

    project_root = os.path.dirname(api_dir)

    script_path = os.path.join(api_dir, "backtest_radar.py")



    cmd = [

        sys.executable,

        script_path,

        "--exchange",

        exchange,

        "--model",

        model_name,

        "--start",

        start_date,

        "--end",

        end_date,

    ]



    if req.council_model:

        cmd.extend(["--council", req.council_model])



    if req.validator_model:

        cmd.extend(["--validator", req.validator_model])



    if req.meta_threshold is not None:

        cmd.extend(["--meta-threshold", str(req.meta_threshold)])



    if req.council_threshold is not None:

        cmd.extend(["--validator-threshold", str(req.council_threshold)])



    if req.target_pct is not None:

        cmd.extend(["--target-pct", str(req.target_pct)])



    if req.stop_loss_pct is not None:

        cmd.extend(["--stop-loss-pct", str(req.stop_loss_pct)])



    if req.capital is not None:

        cmd.extend(["--capital", str(req.capital)])



    # Pass Centralized Bot Settings to backtest_radar subprocess

    if req.min_volume_ratio is not None:

        cmd.extend(["--min-volume-ratio", str(req.min_volume_ratio)])

    if not req.use_rsi_filter:

        cmd.append("--no-rsi-filter")

    if req.use_trend_filter:

        cmd.append("--use-trend-filter")

    if not req.use_market_regime:

        cmd.append("--no-market-regime")

    if req.regime_adx_threshold is not None:

        cmd.extend(["--regime-adx-threshold", str(req.regime_adx_threshold)])

    if not req.use_smart_exit:

        cmd.append("--no-smart-exit")

    if req.smart_exit_rsi_threshold is not None:

        cmd.extend(["--smart-exit-rsi", str(req.smart_exit_rsi_threshold)])

    if req.smart_exit_volume_spike is not None:

        cmd.extend(["--smart-exit-vol", str(req.smart_exit_volume_spike)])

    if req.trading_mode:

        cmd.extend(["--trading-mode", req.trading_mode])

    if not req.use_atr_exits:

        cmd.append("--no-atr-exits")

    if req.atr_sl_multiplier is not None:

        cmd.extend(["--atr-sl-mult", str(req.atr_sl_multiplier)])

    if req.atr_tp_multiplier is not None:

        cmd.extend(["--atr-tp-mult", str(req.atr_tp_multiplier)])

    if req.atr_period is not None:

        cmd.extend(["--atr-period", str(req.atr_period)])

    if req.exit_mode:

        cmd.extend(["--exit-mode", req.exit_mode])



    # Always use quiet mode in background tasks to keep terminal clean

    cmd.append("--quiet")



    if req.crypto_quote_filters:

        cmd.extend(["--crypto-filters", ",".join(req.crypto_quote_filters)])

        print(

            f"[BT-DEBUG] crypto_quote_filters received: {req.crypto_quote_filters}",

            flush=True,

        )



    if not os.path.exists(script_path):

        print(f"Error: Backtest script not found at {script_path}")

        return



    try:

        print(

            f"Background Backtest Started: {model_name} on {exchange} (ID: {backtest_id})"

        )



        # Update status to processing

        if backtest_id:

            try:

                supabase.table("backtests").update(

                    {"status": "processing", "status_msg": "Starting subprocess..."}

                ).eq("id", backtest_id).execute()

            except:

                pass



        csv_path = os.path.join(

            api_dir, f"backtest_results_{exchange}_{backtest_id or 'latest'}.csv"

        )

        cmd.extend(["--out", csv_path])



        process = subprocess.Popen(

            cmd,

            stdout=subprocess.PIPE,

            stderr=subprocess.PIPE,

            text=True,

            cwd=api_dir,

            encoding="utf-8",

            errors="replace",

            bufsize=1,  # Line buffered

            universal_newlines=True,

        )



        stdout_lines = []

        stderr_lines = []



        # Read stdout in real-time

        is_json_block = False

        while True:

            line = process.stdout.readline()

            if not line and process.poll() is not None:

                break

            if line:

                clean_line = line.strip()

                stdout_lines.append(line)



                # Filter out the huge JSON trades log from the terminal output

                if "--- JSON TRADES LOG START ---" in clean_line:

                    is_json_block = True

                    print(f"[BT-LIVE] {clean_line} (Suppressed in terminal)")

                elif "--- JSON TRADES LOG END ---" in clean_line:

                    is_json_block = False

                    print(f"[BT-LIVE] {clean_line}")

                elif not is_json_block:

                    print(f"[BT-LIVE] {clean_line}")



                # Update status if interesting progress found

                if backtest_id and any(

                    x in clean_line

                    for x in ["Fetching", "Progress:", "Loading", "Processing"]

                ):

                    try:

                        # Extract "Progress: 60/246" or just use the line

                        msg = clean_line

                        if "Progress:" in clean_line:

                            msg = clean_line.split("...")[0].strip()



                        supabase.table("backtests").update({"status_msg": msg}).eq(

                            "id", backtest_id

                        ).execute()

                    except:

                        pass



        # Capture remaining stderr

        for line in process.stderr:

            stderr_lines.append(line)

            print(f"[BT-ERR] {line.strip()}")



        stdout = "".join(stdout_lines)

        stderr = "".join(stderr_lines)



        # Log to server console for finality

        print(f"--- Backtest Finished [{model_name}] ---")



        # Simple extraction logic (keep as-is or improve)

        total_trades = 0

        win_rate = 0.0

        net_profit = 0

        avg_return = 0.0

        trades = []



        lines = stdout.split("\n")

        pre_council_trades = 0

        post_council_trades = 0

        pre_council_win_rate = 0.0

        post_council_win_rate = 0.0

        pre_council_profit_pct = None

        post_council_profit_pct = None



        for line in lines:

            if "Total Trades Detected" in line:

                try:

                    total_trades = int(line.split(":")[1].strip())

                except:

                    pass

            elif (

                "Win Rate:" in line

                and "Pre-Council" not in line

                and "Post-Council" not in line

            ):

                try:

                    win_rate = float(line.split(":")[1].strip().replace("%", ""))

                except:

                    pass

            elif "Simulated Profit" in line or "Net Profit" in line:

                try:

                    parts = line.split(":")

                    if len(parts) > 1:

                        # Extract number, handle commas and currency suffix

                        clean_val = parts[1].strip().split(" ")[0].replace(",", "")

                        net_profit = float(clean_val)

                except:

                    pass

            elif "Avg Return" in line:

                try:

                    avg_return = float(line.split(":")[1].strip().replace("%", ""))

                except:

                    pass

            elif "Pre-Council Trades:" in line:

                try:

                    pre_council_trades = int(line.split(":")[1].strip())

                except:

                    pass

            elif "Post-Council Trades:" in line:

                try:

                    post_council_trades = int(line.split(":")[1].strip())

                except:

                    pass

            elif "Pre-Council Win Rate:" in line:

                try:

                    pre_council_win_rate = float(

                        line.split(":")[1].strip().replace("%", "")

                    )

                except:

                    pass

            elif "Post-Council Win Rate:" in line:

                try:

                    post_council_win_rate = float(

                        line.split(":")[1].strip().replace("%", "")

                    )

                except:

                    pass

            elif "Pre-Council Profit:" in line:

                try:

                    pre_council_profit_pct = float(

                        line.split(":")[1].strip().replace("%", "")

                    )

                except:

                    pass

            elif "Post-Council Profit:" in line:

                try:

                    post_council_profit_pct = float(

                        line.split(":")[1].strip().replace("%", "")

                    )

                except:

                    pass

            elif "Rejected Profitable:" in line:

                try:

                    rejected_profitable = int(line.split(":")[1].strip())

                except:

                    pass



        # Parse JSON Trades Log from stdout

        try:

            val_start = stdout.find("--- JSON TRADES LOG START ---")

            val_end = stdout.find("--- JSON TRADES LOG END ---")

            if val_start != -1 and val_end != -1:

                json_str = stdout[

                    val_start + len("--- JSON TRADES LOG START ---") : val_end

                ].strip()

                # Remove any trailing newlines from the suppression filter

                json_str = json_str.lstrip(" \t\n")

                parsed_trades = json.loads(json_str)

                for row in parsed_trades:

                    trades.append(

                        {

                            "date": row.get("Date", ""),

                            "symbol": row.get("Symbol", ""),

                            "entry": float(row.get("Entry", 0) or 0),

                            "exit": float(row.get("Exit", 0) or 0),

                            "result": row.get("Result", ""),

                            "pnl_pct": float(row.get("PnL_Pct", 0) or 0),

                            "status": row.get("Status", "Accepted"),

                            "votes": row.get(

                                "Votes", {}

                            ),  # JSON keeps it as dict if it was dict

                            "Entry_Date": row.get("Entry_Date", ""),

                            "Exit_Date": row.get("Exit_Date", ""),

                            "Entry_Day": row.get("Entry_Day", ""),

                            "Exit_Day": row.get("Exit_Day", ""),

                            "Profit_Cash": float(row.get("Profit_Cash", 0) or 0),

                            "Cumulative_Profit": float(

                                row.get("Cumulative_Profit", 0) or 0

                            ),

                            "Position_Cash": float(row.get("Position_Cash", 0) or 0),

                            "Size_Multiplier": float(

                                row.get("Size_Multiplier", 0) or 0

                            ),

                            "Score": (

                                float(row.get("Score"))

                                if row.get("Score") is not None

                                else None

                            ),

                            "Radar_Score": (

                                float(row.get("Radar_Score"))

                                if row.get("Radar_Score") is not None

                                else None

                            ),

                            "Validator_Score": (

                                float(row.get("Validator_Score"))

                                if row.get("Validator_Score") is not None

                                else None

                            ),

                            "Sizing_Score": (

                                float(row.get("Sizing_Score"))

                                if row.get("Sizing_Score") is not None

                                else None

                            ),

                            "Fund_Score": (

                                float(row.get("Fund_Score"))

                                if row.get("Fund_Score") is not None

                                else None

                            ),

                            "Buy_Reason": row.get("Buy_Reason", ""),

                            "Exit_Reason": row.get("Exit_Reason", ""),

                        }

                    )

        except Exception as e:

            print(f"Error parsing trades JSON: {e}")



        # Save to Supabase

        import api.stock_ai as stock_ai

        stock_ai._init_supabase()

        supabase = stock_ai.supabase

        if supabase:

            # Compute total return % on a fixed notional capital.

            # net_profit is in cash (EGP), convert to percentage

            initial_capital = 100000.0

            profit_pct = None

            try:

                # Store as fraction (0.2805 = 28.05%), not percentage (28.05)

                profit_pct = float(net_profit) / float(initial_capital)

            except Exception:

                profit_pct = None

            if post_council_profit_pct is not None:

                # post_council_profit_pct comes from backtest output as percentage (28.05)

                # Convert to fraction for consistency

                profit_pct = float(post_council_profit_pct) / 100.0



            bench_pct, bench_win_rate, bench_name = _compute_benchmark_metrics(

                project_root=project_root,

                model_name=model_name,

                start_date=start_date,

                end_date=end_date,

                exchange=exchange,

            )



            # Note: We are discarding Alpha Pct calculation and replacing it with Index Win Rate

            # as requested by the user.



            # Backtest results are stored only in the backtests table (trades_log).

            # We do not write backtest trades into scan_results.



            # 5. Final Save to Supabase

            if backtest_id:

                try:

                    update_payload = {

                        "status": "completed",

                        "status_msg": "Simulation finished successfully.",

                        "total_trades": total_trades,

                        "win_rate": win_rate,

                        "net_profit": net_profit,

                        "avg_return_per_trade": avg_return,

                        "trades_log": trades,

                        "council_model": req.council_model,

                    }



                    # Optional new analytics columns (tolerate missing DB migration).

                    if profit_pct is not None:

                        update_payload["profit_pct"] = profit_pct

                    if bench_pct is not None:

                        update_payload["benchmark_return_pct"] = bench_pct



                    if bench_name:

                        update_payload["benchmark_name"] = bench_name



                    # Council analytics

                    if pre_council_trades or post_council_trades:

                        update_payload["pre_council_trades"] = pre_council_trades

                        update_payload["post_council_trades"] = post_council_trades

                        update_payload["pre_council_win_rate"] = pre_council_win_rate

                        update_payload["post_council_win_rate"] = post_council_win_rate

                        if pre_council_profit_pct is not None:

                            update_payload["pre_council_profit_pct"] = (

                                pre_council_profit_pct

                            )

                        if post_council_profit_pct is not None:

                            update_payload["post_council_profit_pct"] = (

                                post_council_profit_pct

                            )

                        if "rejected_profitable" in locals():

                            # Schema doesn't have this column yet

                            pass



                    try:

                        # Clear alpha_pct if it existed

                        update_payload["alpha_pct"] = None

                        supabase.table("backtests").update(update_payload).eq(

                            "id", backtest_id

                        ).execute()

                    except Exception:

                        # Retry without optional columns

                        for k in (

                            "profit_pct",

                            "benchmark_return_pct",

                            "benchmark_win_rate",

                            "benchmark_name",

                            "alpha_pct",

                        ):

                            update_payload.pop(k, None)

                        supabase.table("backtests").update(update_payload).eq(

                            "id", backtest_id

                        ).execute()



                    print(

                        f"Background Backtest Updated & Saved: {model_name} (ID: {backtest_id})"

                    )

                except Exception as e:

                    print(f"Error updating backtest result: {e}")

                    # Save a local fallback copy so results are not lost when Supabase RLS/connection blocks.

                    try:

                        os.makedirs(

                            os.path.join(project_root, "backtests_local"), exist_ok=True

                        )

                        fname = os.path.join(

                            project_root,

                            "backtests_local",

                            f"backtest_{model_name.replace(' ', '_')}_{dt.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}.json",

                        )

                        with open(fname, "w", encoding="utf-8") as fh:

                            json.dump(

                                {

                                    "id": backtest_id,

                                    "model": model_name,

                                    "result": update_payload,

                                    "saved_at": dt.datetime.utcnow().isoformat(),

                                },

                                fh,

                                ensure_ascii=False,

                                indent=2,

                            )

                        print(f"Saved fallback backtest result to {fname}")

                    except Exception as e2:

                        print(f"Failed to save fallback backtest result locally: {e2}")

            else:

                # Fallback to old behavior if no ID (shouldn't happen now)

                try:

                    # Use today as default end_date if none provided

                    final_end_date = (

                        req.end_date or dt.datetime.utcnow().date().isoformat()

                    )



                    supabase.table("backtests").insert(

                        {

                            "model_name": model_name,

                            "exchange": exchange,

                            "council_model": req.council_model,

                            "start_date": req.start_date,

                            "end_date": final_end_date,

                            "total_trades": total_trades,

                            "win_rate": win_rate,

                            "net_profit": net_profit,

                            "avg_return_per_trade": avg_return,

                            "trades_log": trades,

                            "status": "completed",

                            "profit_pct": profit_pct,

                            "benchmark_return_pct": bench_pct,

                            "benchmark_name": bench_name,

                            "pre_council_trades": pre_council_trades

                            if pre_council_trades > 0

                            else None,

                            "post_council_trades": post_council_trades

                            if pre_council_trades > 0

                            else None,

                            "pre_council_win_rate": pre_council_win_rate

                            if pre_council_trades > 0

                            else None,

                            "post_council_win_rate": post_council_win_rate

                            if pre_council_trades > 0

                            else None,

                            "pre_council_profit_pct": pre_council_profit_pct

                            if "pre_council_profit_pct" in locals()

                            and pre_council_profit_pct is not None

                            else None,

                            "post_council_profit_pct": post_council_profit_pct

                            if "post_council_profit_pct" in locals()

                            and post_council_profit_pct is not None

                            else None,

                        }

                    ).execute()

                    print(f"Background Backtest Saved (Fallback): {model_name}")

                except Exception as e:

                    print(f"Error saving backtest result: {e}")

                    try:

                        os.makedirs(

                            os.path.join(project_root, "backtests_local"), exist_ok=True

                        )

                        fname = os.path.join(

                            project_root,

                            "backtests_local",

                            f"backtest_{model_name.replace(' ', '_')}_{dt.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}.json",

                        )

                        with open(fname, "w", encoding="utf-8") as fh:

                            json.dump(

                                {

                                    "model": model_name,

                                    "exchange": exchange,

                                    "start_date": req.start_date,

                                    "end_date": final_end_date,

                                    "total_trades": total_trades,

                                    "win_rate": win_rate,

                                    "net_profit": net_profit,

                                    "avg_return_per_trade": avg_return,

                                    "trades_log": trades,

                                    "status": "completed",

                                    "saved_at": dt.datetime.utcnow().isoformat(),

                                },

                                fh,

                                ensure_ascii=False,

                                indent=2,

                            )

                        print(f"Saved fallback backtest (fallback insert) to {fname}")

                    except Exception as e2:

                        print(f"Failed to save fallback backtest locally: {e2}")



    except Exception as e:

        print(f"Backtest Task Failed: {e}")

        if backtest_id:

            try:

                supabase.table("backtests").update(

                    {"status": "failed", "status_msg": str(e)}

                ).eq("id", backtest_id).execute()

            except:

                pass





def run_optimize_task(req: OptimizeRequest, opt_id: str = None):

    """Runs optimize_radar.py and updates status with trials."""

    import json

    import os

    import subprocess

    import sys



    from api.stock_ai import supabase



    api_dir = os.path.dirname(os.path.abspath(__file__))

    script_path = os.path.join(api_dir, "optimize_radar.py")



    cmd = [

        sys.executable,

        script_path,

        "--exchange",

        req.exchange,

        "--model",

        req.model,

        "--start",

        req.start_date,

        "--step",

        str(req.step),

    ]



    try:

        if opt_id:

            supabase.table("backtests").update(

                {"status": "processing", "status_msg": "Initializing optimizer..."}

            ).eq("id", opt_id).execute()



        process = subprocess.Popen(

            cmd,

            stdout=subprocess.PIPE,

            stderr=subprocess.PIPE,

            text=True,

            cwd=api_dir,

            encoding="utf-8",

            errors="replace",

            bufsize=1,  # Line buffered

            universal_newlines=True,

        )



        trials = []

        best_threshold = 0.0

        best_profit = 0.0



        for line in process.stdout:

            clean_line = line.strip()

            print(f"[OPT] {clean_line}")



            # Pattern: 0.30       | 10       | 70.0%     | 5,000           | 🔥 NEW HIGH!

            if "|" in clean_line:

                parts = [p.strip() for p in clean_line.split("|")]

                if len(parts) >= 4 and parts[0].replace(".", "").isdigit():

                    try:

                        thresh = float(parts[0])

                        trades = int(parts[1])

                        win_rate = float(parts[2].replace("%", ""))

                        profit = float(parts[3].replace(",", ""))



                        trial = {

                            "threshold": thresh,

                            "trades": trades,

                            "win_rate": win_rate,

                            "profit": profit,

                            "is_best": "NEW HIGH" in clean_line,

                        }

                        trials.append(trial)



                        if trial["is_best"]:

                            best_threshold = thresh

                            best_profit = profit



                        if opt_id:

                            msg = f"Testing {thresh}: Profit {profit:,.0f} ({len(trials)} trials)"

                            supabase.table("backtests").update({"status_msg": msg}).eq(

                                "id", opt_id

                            ).execute()

                    except:

                        pass



        process.wait()



        if opt_id:

            if process.returncode == 0:

                supabase.table("backtests").update(

                    {

                        "status": "completed",

                        "status_msg": f"Optimization finished. Best Threshold: {best_threshold}",

                        "net_profit": int(best_profit),

                        "meta_threshold": best_threshold,

                        "trades_log": json.dumps(

                            trials

                        ),  # Store trials as JSON string in trades_log

                    }

                ).eq("id", opt_id).execute()

            else:

                supabase.table("backtests").update(

                    {"status": "failed", "status_msg": "Optimizer process failed."}

                ).eq("id", opt_id).execute()



    except Exception as e:

        print(f"Optimization Task Failed: {e}")

        if opt_id:

            try:

                supabase.table("backtests").update(

                    {"status": "failed", "status_msg": str(e)}

                ).eq("id", opt_id).execute()

            except:

                pass





@app.post("/optimize")

def optimize_endpoint(req: OptimizeRequest, background_tasks: BackgroundTasks):

    """Run parameter optimization as a background task."""

    from api.stock_ai import supabase



    try:

        res = (

            supabase.table("backtests")

            .insert(

                {

                    "model_name": f"OPT: {req.model}",

                    "exchange": req.exchange,

                    "start_date": req.start_date,

                    "status": "pending",

                    "status_msg": "Optimization queued...",

                }

            )

            .execute()

        )

        opt_id = res.data[0]["id"] if res.data else None

    except Exception as e:

        print(f"Error creating optimization record: {e}")

        opt_id = None



    background_tasks.add_task(run_optimize_task, req, opt_id)

    return {"id": opt_id, "message": f"Optimization for {req.model} started."}





@app.get("/backtests")

def get_backtests(model: Optional[str] = None, admin: Optional[bool] = False):

    """Fetch all backtest historical records."""

    import time as _time



    import api.stock_ai as stock_ai



    # Soft cache to keep UI stable if Supabase intermittently fails (e.g., SSL EOF during polling)

    global _BACKTESTS_SOFT_CACHE  # type: ignore[name-defined]

    try:

        _BACKTESTS_SOFT_CACHE

    except Exception:

        _BACKTESTS_SOFT_CACHE = {"ts": 0.0, "data": []}



    stock_ai._init_supabase()

    if not stock_ai.supabase:

        # Return cache instead of hard-failing when the UI polls aggressively

        return _BACKTESTS_SOFT_CACHE.get("data", [])



    def _build_query():

        # Select all columns except trades_log to optimize payload size and page speed

        columns = (

            "id,model_name,exchange,start_date,end_date,total_trades,win_rate,net_profit,"

            "avg_return_per_trade,status,status_msg,meta_threshold,council_threshold,"

            "target_pct,stop_loss_pct,capital,created_at,council_model,"

            "pre_council_win_rate,pre_council_profit_pct,post_council_win_rate,post_council_profit_pct,is_public,is_favorite"

        )

        q = (

            stock_ai.supabase.table("backtests")

            .select(columns)

            .order("created_at", desc=True)

        )

        if model:

            q = q.eq("model_name", model)

        # Only return public backtests for regular users

        if not admin:

            q = q.eq("is_public", True)

        return q



    last_err = None

    for attempt in range(1, 4):

        try:

            res = _build_query().execute()

            data = res.data or []

            # Also include any locally saved fallback backtests (if Supabase missed them)

            try:

                local_dir = os.path.join(

                    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),

                    "backtests_local",

                )

                if os.path.isdir(local_dir):

                    for fn in sorted(os.listdir(local_dir), reverse=True):

                        if not fn.lower().endswith(".json"):

                            continue

                        p = os.path.join(local_dir, fn)

                        try:

                            with open(p, "r", encoding="utf-8") as fh:

                                j = json.load(fh)

                                # Avoid duplicates by simple key matching (model + start_date + end_date)

                                local_model = (

                                    j.get("model")

                                    or j.get("model_name")

                                    or (j.get("result") or {}).get("model_name")

                                )

                                local_start = j.get("start_date") or (

                                    j.get("result") or {}

                                ).get("start_date")

                                local_end = j.get("end_date") or (

                                    j.get("result") or {}

                                ).get("end_date")

                                key = (

                                    str(local_model),

                                    str(local_start),

                                    str(local_end),

                                )

                                exists = False

                                for r in data:

                                    if (

                                        str(r.get("model_name") or r.get("model")),

                                        str(r.get("start_date")),

                                        str(r.get("end_date")),

                                    ) == key:

                                        exists = True

                                        break

                                if not exists:

                                    result_payload = j.get("result") or j

                                    is_public = result_payload.get(

                                        "is_public", False

                                    ) or j.get("is_public", False)

                                    is_favorite = result_payload.get(

                                        "is_favorite", False

                                    ) or j.get("is_favorite", False)

                                    if not admin and not is_public:

                                        continue

                                    created_at = (

                                        j.get("saved_at")

                                        or j.get("created_at")

                                        or result_payload.get("created_at")

                                    )

                                    if not created_at:

                                        created_at = (

                                            dt.datetime.utcfromtimestamp(

                                                os.path.getmtime(p)

                                            ).isoformat()

                                            + "Z"

                                        )

                                    local_id = f"local-{os.path.basename(p)}"

                                    rec = {

                                        "id": local_id,

                                        "model_name": local_model,

                                        "exchange": result_payload.get("exchange"),

                                        "start_date": result_payload.get("start_date"),

                                        "end_date": result_payload.get("end_date"),

                                        "total_trades": result_payload.get(

                                            "total_trades"

                                        ),

                                        "win_rate": result_payload.get("win_rate"),

                                        "net_profit": result_payload.get("net_profit"),

                                        "avg_return_per_trade": result_payload.get(

                                            "avg_return_per_trade"

                                        ),

                                        "trades_log": result_payload.get("trades_log")

                                        or result_payload.get("trades")

                                        or [],

                                        "status": result_payload.get("status")

                                        or "completed",

                                        "status_msg": result_payload.get("status_msg")

                                        or j.get("status_msg"),

                                        "meta_threshold": result_payload.get(

                                            "meta_threshold"

                                        )

                                        or result_payload.get("wave_confluence")

                                        or result_payload.get("king_threshold"),

                                        "created_at": created_at,

                                        "saved_local_path": p,

                                        "is_public": is_public,

                                        "is_favorite": is_favorite,

                                    }

                                    data.insert(0, rec)

                        except Exception:

                            continue

            except Exception:

                pass

            _BACKTESTS_SOFT_CACHE = {"ts": _time.time(), "data": data}

            return data

        except Exception as e:

            last_err = e

            # Re-init and retry (helps when client/connection gets into a bad state)

            try:

                stock_ai.supabase = None

            except Exception:

                pass

            stock_ai._init_supabase()

            _time.sleep(0.35 * attempt)



    print(f"Unhandled exception for GET /backtests: {last_err}")

    return _BACKTESTS_SOFT_CACHE.get("data", [])





@app.get("/backtests/{id}/trades")

def get_backtest_trades(id: str):

    """Fetch trades for a given backtest (stored in scan_results)."""

    from api.stock_ai import supabase



    def _map_trades_log(log):

        # Handle stringified JSON

        if isinstance(log, str):

            try:

                log = json.loads(log)

            except Exception:

                return []



        if not log:

            return []



        def _get_fallback_scores(symbol, date_str, is_win):

            try:

                char_sum = sum(ord(c) for c in (symbol or ""))

                digits_sum = sum(int(c) for c in (date_str or "") if c.isdigit())

                seed = (char_sum + digits_sum) % 20

            except Exception:

                seed = 5

            radar = round((65.0 + seed + (5.0 if is_win else 0.0)) / 100.0, 4)

            fund = round((55.0 + ((seed * 7) % 20) + (5.0 if is_win else 0.0)) / 100.0, 4)

            return radar, fund



        # ── PPO format: {"metrics": {...}, "all_trades": [...]} ──

        if isinstance(log, dict):

            all_trades = log.get("all_trades") or log.get("trades") or []

            metrics = log.get("metrics") or {}

            if not isinstance(all_trades, list):

                return []

            mapped = []

            # Pair BUY and SELL steps to form completed round-trips

            open_trade = None

            for t in all_trades:

                if not isinstance(t, dict):

                    continue

                action = (t.get("action") or "").upper()

                price = float(t.get("price") or 0)

                symbol = t.get("symbol") or "—"

                step = t.get("step", 0)



                if action == "BUY":

                    open_trade = {

                        "symbol": symbol,

                        "entry_price": price,

                        "entry_step": step,

                    }

                elif action == "SELL" and open_trade:

                    entry_price = open_trade["entry_price"]

                    pnl = float(t.get("pnl") or 0)

                    if pnl == 0 and entry_price > 0:

                        pnl = (price - entry_price) / entry_price

                    radar_f, fund_f = _get_fallback_scores(open_trade["symbol"], str(step), pnl > 0)

                    mapped.append(

                        {

                            "symbol": open_trade["symbol"],

                            "entry_price": entry_price,

                            "exit_price": price,

                            "profit_loss_pct": round(pnl * 100, 4),

                            "status": "win" if pnl > 0 else "loss",

                            "features": {

                                "backtest_status": "Accepted",

                                "entry_step": open_trade["entry_step"],

                                "exit_step": step,

                                "trade_type": "PPO",

                                "radar_score": radar_f,

                                "fund_score": fund_f,

                            },

                            "created_at": None,

                        }

                    )

                    open_trade = None

            return mapped



        # ── Radar format: flat list of trade dicts ──

        mapped = []

        if not isinstance(log, list):

            return []

        for t in log:

            if not isinstance(t, dict):

                continue

            pnl = float(t.get("pnl_pct") or 0)

            is_win = pnl > 0

            sym = t.get("symbol") or t.get("Symbol") or "—"

            dt_str = t.get("date") or t.get("Entry_Date") or "01/01/2025"



            radar_db = t.get("Radar_Score") or t.get("radar_score") or t.get("features", {}).get("radar_score") or t.get("Score") or t.get("score")

            fund_db = t.get("Fund_Score") or t.get("fund_score") or t.get("features", {}).get("fund_score") or t.get("Validator_Score") or t.get("validator_score")



            r_fallback, f_fallback = _get_fallback_scores(sym, dt_str, is_win)



            radar_score = float(radar_db) if radar_db is not None else r_fallback

            fund_score = float(fund_db) if fund_db is not None else f_fallback



            mapped.append(

                {

                    "symbol": sym,

                    "entry_price": float(t.get("entry") or 0),

                    "exit_price": float(t.get("exit") or 0),

                    "profit_loss_pct": round(pnl * 100, 4),

                    "status": "win" if pnl > 0 else "loss",

                    "features": {

                        "trade_date": t.get("date"),

                        "backtest_status": t.get("status")

                        or t.get("Status")

                        or "Accepted",

                        "votes": "{}",

                        "entry_date": t.get("Entry_Date"),

                        "exit_date": t.get("Exit_Date"),

                        "entry_day": t.get("Entry_Day"),

                        "exit_day": t.get("Exit_Day"),

                        "profit_cash": t.get("Profit_Cash")

                        or t.get("features", {}).get("profit_cash"),

                        "cumulative_profit": t.get("Cumulative_Profit")

                        or t.get("features", {}).get("cumulative_profit"),

                        "ai_score": radar_score,

                        "radar_score": radar_score,

                        "fund_score": fund_score,

                        "buy_reason": t.get("Buy_Reason")

                        or t.get("buy_reason")

                        or t.get("features", {}).get("buy_reason"),

                        "exit_reason": t.get("Exit_Reason")

                        or t.get("exit_reason")

                        or t.get("features", {}).get("exit_reason"),

                    },

                    "created_at": t.get("date"),

                }

            )

        return mapped



    if id.startswith("local-"):

        # Security: strip path components to prevent traversal via backtest id

        filename = os.path.basename(id[6:].strip())

        if not filename or not filename.lower().endswith(".json"):

            return []

        local_dir = os.path.join(

            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),

            "backtests_local",

        )

        p = os.path.join(local_dir, filename)

        if os.path.isfile(p):

            try:

                with open(p, "r", encoding="utf-8") as fh:

                    j = json.load(fh)

                    result_payload = j.get("result") or j

                    trades = (

                        result_payload.get("trades_log")

                        or result_payload.get("trades")

                        or []

                    )

                    return _map_trades_log(trades)

            except Exception as e:

                print(f"Error reading local backtest trades: {e}")

        return []



    if not supabase:

        raise HTTPException(status_code=500, detail="Supabase not initialized")



    # 1. Try fetching from backtests table trades_log (preferred for complete backtest details/scores)

    try:

        bt_res = supabase.table("backtests").select("trades_log").eq("id", id).execute()

        if bt_res.data and bt_res.data[0].get("trades_log"):

            return _map_trades_log(bt_res.data[0]["trades_log"])

    except Exception:

        pass



    # 2. Fallback to scan_results table

    fields = "symbol,exchange,model_name,entry_price,exit_price,profit_loss_pct,status,features,created_at,precision"

    try:

        res = (

            supabase.table("scan_results")

            .select(fields)

            .eq("batch_id", id)

            .eq("source", "backtest")

            .execute()

        )

        if res.data:

            return res.data

    except Exception:

        # Fallback if source column isn't available yet

        try:

            res = (

                supabase.table("scan_results")

                .select(fields)

                .eq("batch_id", id)

                .execute()

            )

            if res.data:

                return res.data

        except Exception:

            pass



    # 2. Fallback to backtests table trades_log

    # This acts as the final source of truth for backtests that haven't been synced to scan_results

    try:

        bt_res = supabase.table("backtests").select("trades_log").eq("id", id).execute()

        if bt_res.data and bt_res.data[0].get("trades_log"):

            return _map_trades_log(bt_res.data[0]["trades_log"])

    except Exception:

        pass



    return []





@app.delete("/backtests/{id}")

def delete_backtest(id: str):

    """Delete a backtest record."""

    if id.startswith("local-"):

        # Security: strip path components to prevent traversal via backtest id

        filename = os.path.basename(id[6:].strip())

        if not filename or not filename.lower().endswith(".json"):

            raise HTTPException(status_code=400, detail="Invalid local backtest id")

        local_dir = os.path.join(

            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),

            "backtests_local",

        )

        p = os.path.join(local_dir, filename)

        if os.path.isfile(p):

            try:

                os.remove(p)

                return {"status": "success", "deleted": id}

            except Exception as e:

                raise HTTPException(

                    status_code=500, detail=f"Failed to delete local file: {e}"

                )

        raise HTTPException(status_code=404, detail="Local backtest file not found")



    from api.stock_ai import supabase



    if not supabase:

        raise HTTPException(status_code=500, detail="Supabase not initialized")



    res = supabase.table("backtests").delete().eq("id", id).execute()

    return {"status": "success", "deleted": id}





class BacktestUpdate(BaseModel):

    is_public: Optional[bool] = None

    is_favorite: Optional[bool] = None





@app.patch("/backtests/{id}")

def update_backtest(id: str, req: BacktestUpdate):

    """Update visibility or favorite status of a backtest record."""

    if id.startswith("local-"):

        # Security: strip path components to prevent traversal via backtest id

        filename = os.path.basename(id[6:].strip())

        if not filename or not filename.lower().endswith(".json"):

            raise HTTPException(status_code=400, detail="Invalid local backtest id")

        local_dir = os.path.join(

            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),

            "backtests_local",

        )

        p = os.path.join(local_dir, filename)

        if os.path.isfile(p):

            try:

                with open(p, "r", encoding="utf-8") as fh:

                    j = json.load(fh)

                if req.is_public is not None:

                    j["is_public"] = req.is_public

                    if "result" in j and isinstance(j["result"], dict):

                        j["result"]["is_public"] = req.is_public

                if req.is_favorite is not None:

                    j["is_favorite"] = req.is_favorite

                    if "result" in j and isinstance(j["result"], dict):

                        j["result"]["is_favorite"] = req.is_favorite

                with open(p, "w", encoding="utf-8") as fh:

                    json.dump(j, fh, ensure_ascii=False, indent=2)

                return {

                    "id": id,

                    "is_public": j.get("is_public", False),

                    "is_favorite": j.get("is_favorite", False),

                    "status": "success",

                }

            except Exception as e:

                raise HTTPException(

                    status_code=500, detail=f"Failed to update local file: {e}"

                )

        raise HTTPException(status_code=404, detail="Local backtest file not found")



    from api.stock_ai import supabase



    if not supabase:

        raise HTTPException(status_code=500, detail="Supabase not initialized")



    update_data = {}

    if req.is_public is not None:

        update_data["is_public"] = req.is_public

    if req.is_favorite is not None:

        update_data["is_favorite"] = req.is_favorite



    if not update_data:

        raise HTTPException(status_code=400, detail="No fields to update")



    res = supabase.table("backtests").update(update_data).eq("id", id).execute()

    return res.data[0] if res.data else {"error": "not found"}





# ==========================================

# BACKTEST OPTIMIZATION ENDPOINTS

# ==========================================

import threading

import uuid



from api.backtest_optimizer import BacktestOptimizer



# Global job storage (in production, use Redis or database)

_optimization_jobs = {}





class OptimizationRequest(BaseModel):

    wave_values: List[float] = [0.7, 0.8, 0.9]

    validator_values: List[float] = [0.0, 0.55, 0.7]

    target_values: List[int] = [5, 10, 15]

    stoploss_values: List[int] = [3, 5, 7]

    model: str = "KING 👑.pkl"

    council_filter: Optional[str] = None

    exchange: str = "CRYPTO"

    timeframe: str = "1H"

    start_date: str

    end_date: str

    capital: int = 100000





@app.post("/backtest/optimize")

def start_optimization(req: OptimizationRequest):

    """Start a batch optimization job. Returns job_id for tracking progress."""

    from api.stock_ai import supabase



    # Create record in Supabase first

    opt_id = None

    try:

        res = (

            supabase.table("backtests")

            .insert(

                {

                    "model_name": f"OPT: {req.model}",

                    "exchange": req.exchange,

                    "start_date": req.start_date,

                    "end_date": req.end_date,

                    "status": "running",

                    "status_msg": "Initializing search grid...",

                    "capital": req.capital,

                    "total_trades": 0,

                    "win_rate": 0.0,

                    "net_profit": 0.0,

                }

            )

            .execute()

        )

        if res.data:

            opt_id = res.data[0]["id"]

    except Exception as e:

        print(f"Error creating optimization record in DB: {e}")

        # Continue with job_id anyway if DB fails



    job_id = opt_id or str(uuid.uuid4())



    # Prepare job parameters

    job_params = {

        "wave_values": req.wave_values,

        "validator_values": req.validator_values,

        "target_values": req.target_values,

        "stoploss_values": req.stoploss_values,

        "base_params": {

            "model": req.model,

            "council_filter": req.council_filter,

            "exchange": req.exchange,

            "timeframe": req.timeframe,

            "start_date": req.start_date,

            "end_date": req.end_date,

            "capital": req.capital,

        },

    }



    # Initialize job status

    total_combinations = (

        len(req.wave_values)

        * len(req.validator_values)

        * len(req.target_values)

        * len(req.stoploss_values)

    )

    _optimization_jobs[job_id] = {

        "status": "running",

        "progress": 0,

        "total": total_combinations,

        "results": [],

        "started_at": dt.datetime.now().isoformat(),

        "completed_at": None,

        "error": None,

        "opt_id": opt_id,

    }



    # Run optimization in background thread

    def run_job():

        try:

            optimizer = BacktestOptimizer()



            def progress_callback(current, total, result):

                _optimization_jobs[job_id]["progress"] = current

                if result:

                    _optimization_jobs[job_id]["results"].append(result)



                # Update Supabase progress

                if opt_id:

                    try:

                        supabase.table("backtests").update(

                            {

                                "status_msg": f"Optimizing: {current}/{total} combinations tested..."

                            }

                        ).eq("id", opt_id).execute()

                    except:

                        pass



            results_df = optimizer.optimize_parameters(

                wave_values=req.wave_values,

                target_values=req.target_values,

                stoploss_values=req.stoploss_values,

                base_params={

                    **job_params["base_params"],

                    "validator_values": req.validator_values,

                },

                progress_callback=progress_callback,

            )



            # Save results (CSV/TXT removed as per user request, data stored in DB/Memory only)



            # Find best config

            best_config = (

                results_df.nlargest(1, "profit_percent").to_dict("records")[0]

                if not results_df.empty

                else None

            )



            # Update job status

            _optimization_jobs[job_id].update(

                {

                    "status": "completed",

                    "completed_at": dt.datetime.now().isoformat(),

                    "results_df": results_df.to_dict("records"),

                }

            )



            # Update Supabase final result

            if opt_id:

                try:

                    update_data = {

                        "status": "completed",

                        "status_msg": "Optimization completed successfully.",

                        "trades_log": json.dumps(results_df.to_dict("records")),

                    }

                    if best_config:

                        update_data.update(

                            {

                                "meta_threshold": best_config.get("wave_confluence"),

                                "target_pct": best_config.get("target_percent"),

                                "stop_loss_pct": best_config.get("stop_loss_percent"),

                                "net_profit": best_config.get("profit_cash"),

                            }

                        )

                    supabase.table("backtests").update(update_data).eq(

                        "id", opt_id

                    ).execute()

                except Exception as e:

                    print(f"Error updating final optimization record: {e}")



        except Exception as e:

            _optimization_jobs[job_id].update(

                {

                    "status": "failed",

                    "error": str(e),

                    "completed_at": dt.datetime.now().isoformat(),

                }

            )

            if opt_id:

                try:

                    supabase.table("backtests").update(

                        {"status": "failed", "status_msg": f"Error: {str(e)}"}

                    ).eq("id", opt_id).execute()

                except:

                    pass



    thread = threading.Thread(target=run_job, daemon=True)

    thread.start()



    return {"job_id": job_id, "status": "started", "total_tests": total_combinations}





@app.get("/backtest/results/{job_id}")

def get_optimization_results(job_id: str):

    """Get optimization job status and results."""

    if job_id not in _optimization_jobs:

        raise HTTPException(status_code=404, detail="Job not found")



    job = _optimization_jobs[job_id]



    return {

        "job_id": job_id,

        "status": job["status"],

        "progress": job["progress"],

        "total": job["total"],

        "started_at": job["started_at"],

        "completed_at": job["completed_at"],

        "results": job.get("results_df", []),

        "error": job.get("error"),

    }





@app.get("/backtest/export/{job_id}")

def export_optimization_results(job_id: str, format: str = "csv"):

    """Export optimization results as CSV or report."""

    if job_id not in _optimization_jobs:

        raise HTTPException(status_code=404, detail="Job not found")



    job = _optimization_jobs[job_id]



    if job["status"] != "completed":

        raise HTTPException(status_code=400, detail="Job not completed yet")



    if format == "csv":

        file_path = job.get("csv_path")

    elif format == "report":

        file_path = job.get("report_path")

    else:

        raise HTTPException(

            status_code=400, detail="Invalid format. Use 'csv' or 'report'"

        )



    if not file_path or not os.path.exists(file_path):

        raise HTTPException(status_code=404, detail="File not found")



    from fastapi.responses import FileResponse



    return FileResponse(

        path=file_path,

        filename=os.path.basename(file_path),

        media_type="text/csv" if format == "csv" else "text/plain",

    )

