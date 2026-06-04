import time
import threading
import datetime as dt
import os
import requests
import json
import pytz
from eodhd import APIClient
from collections import deque

from api.stock_ai import supabase, _init_supabase
from api.routers.scan_tech import TechFilter
from api.symbols_local import load_symbols_for_country
from api.stock_ai import is_ticker_synced, get_stock_data_eodhd, add_technical_indicators, get_company_fundamentals

# ─── EGX Market Schedule ──────────────────────────────────────────────────────
# Egyptian Exchange (EGX): Sunday–Thursday, 10:00–14:30 Cairo time
EGX_TZ      = pytz.timezone("Africa/Cairo")
EGX_OPEN    = dt.time(10, 0)    # 10:00 AM Cairo
EGX_CLOSE   = dt.time(14, 30)   # 02:30 PM Cairo
EGX_DAYS    = {6, 0, 1, 2, 3}  # Sunday=6, Monday=0, Tue=1, Wed=2, Thu=3

# ─── Scheduler State (in-memory, readable by admin API) ───────────────────────
_scheduler_state = {
    "enabled":          True,          # master on/off switch
    "respect_schedule": True,          # only run during EGX hours
    "interval_minutes": 30,            # how often to run
    "open_time":        "10:00",       # configurable open time (HH:MM Cairo)
    "close_time":       "14:30",       # configurable close time
    "active_days":      [6, 0, 1, 2, 3],  # Sun-Thu
    "status":           "idle",        # idle | running | sleeping | disabled
    "next_run_at":      None,          # ISO string
    "last_run_at":      None,          # ISO string
    "last_run_status":  None,          # "ok" | "skipped" | "error"
    "total_runs":       0,
    "total_skipped":    0,
}

# ─── Run History (last 100 entries) ───────────────────────────────────────────
_run_history: deque = deque(maxlen=100)

# ─── Live Logs (last 500 lines) ───────────────────────────────────────────────
_live_logs: deque = deque(maxlen=500)

# ─── Scan cycle counter ───────────────────────────────────────────────────────
_scan_cycle_count = 0

def _log(msg: str):
    """Append to both live log buffer and stdout."""
    ts = dt.datetime.now(EGX_TZ).strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    _live_logs.append(line)
    print(line)


def get_scheduler_state() -> dict:
    """Return a JSON-serializable snapshot of scheduler state + history."""
    state = dict(_scheduler_state)
    state["run_history"] = list(_run_history)
    state["live_logs"] = list(_live_logs)[-100:]   # last 100 for API
    return state


def set_scheduler_config(payload: dict):
    """Update scheduler config from admin API."""
    global _scheduler_state
    allowed = ["enabled", "respect_schedule", "interval_minutes",
                "open_time", "close_time", "active_days"]
    for k in allowed:
        if k in payload:
            _scheduler_state[k] = payload[k]
    _log(f"[CONFIG] Scheduler config updated: {payload}")


def _is_market_open() -> bool:
    """Check if EGX market is currently open based on Cairo time."""
    if not _scheduler_state.get("respect_schedule", True):
        return True   # schedule disabled → always run

    now_cairo = dt.datetime.now(EGX_TZ)
    weekday   = now_cairo.weekday()  # Mon=0 ... Sun=6
    cur_time  = now_cairo.time().replace(second=0, microsecond=0)

    active_days = set(_scheduler_state.get("active_days", list(EGX_DAYS)))

    try:
        open_t  = dt.time(*[int(x) for x in _scheduler_state["open_time"].split(":")])
        close_t = dt.time(*[int(x) for x in _scheduler_state["close_time"].split(":")])
    except Exception:
        open_t, close_t = EGX_OPEN, EGX_CLOSE

    return weekday in active_days and open_t <= cur_time <= close_t


def _next_market_open() -> dt.datetime:
    """Return the next datetime when EGX will open."""
    now = dt.datetime.now(EGX_TZ)
    active_days = set(_scheduler_state.get("active_days", list(EGX_DAYS)))
    try:
        open_t = dt.time(*[int(x) for x in _scheduler_state["open_time"].split(":")])
    except Exception:
        open_t = EGX_OPEN

    for offset in range(1, 8):
        candidate = now + dt.timedelta(days=offset)
        if candidate.weekday() in active_days:
            return candidate.replace(
                hour=open_t.hour, minute=open_t.minute,
                second=0, microsecond=0
            )
    return now + dt.timedelta(hours=24)  # fallback


def start_alerts_scheduler():
    thread = threading.Thread(target=_alerts_worker_loop, daemon=True)
    thread.start()
    _log("[SCHEDULER] Alert scanner thread started.")


def _alerts_worker_loop():
    global _scan_cycle_count
    _log("[SCHEDULER] Worker thread initializing — waiting 30s for app startup...")
    time.sleep(30)

    while True:
        try:
            if not _scheduler_state.get("enabled", True):
                _scheduler_state["status"] = "disabled"
                _log("[SCHEDULER] Scheduler is disabled. Sleeping 5 minutes...")
                time.sleep(300)
                continue

            if not _is_market_open():
                next_open = _next_market_open()
                next_iso  = next_open.isoformat()
                _scheduler_state["status"]      = "sleeping"
                _scheduler_state["next_run_at"] = next_iso
                _scheduler_state["total_skipped"] = _scheduler_state.get("total_skipped", 0) + 1
                sleep_secs = max(60, (next_open - dt.datetime.now(EGX_TZ)).total_seconds())
                _log(f"[SCHEDULER] Market closed — sleeping until {next_iso} ({int(sleep_secs/60)} min)")
                # Record a skipped entry in history
                _run_history.appendleft({
                    "run_at":    dt.datetime.now(EGX_TZ).isoformat(),
                    "status":    "skipped",
                    "reason":    "market_closed",
                    "cycle":     _scan_cycle_count,
                    "matches":   [],
                    "refreshed": 0,
                    "errors":    0,
                    "duration_s": 0,
                })
                time.sleep(min(sleep_secs, 3600))   # max 1 hr sleep at a time
                continue

            # ── Run the scan ──────────────────────────────────────────────────
            _scan_cycle_count += 1
            _scheduler_state["status"]      = "running"
            _scheduler_state["last_run_at"] = dt.datetime.now(EGX_TZ).isoformat()
            interval = _scheduler_state.get("interval_minutes", 30)
            next_run = dt.datetime.now(EGX_TZ) + dt.timedelta(minutes=interval)
            _scheduler_state["next_run_at"] = next_run.isoformat()
            _scheduler_state["total_runs"]  = _scheduler_state.get("total_runs", 0) + 1

            _log(f"[SCHEDULER] === Cycle #{_scan_cycle_count} started ===")
            run_start = time.monotonic()

            refreshed, errors = _refresh_closing_prices_for_alerts()
            new_matches = _check_and_trigger_alerts()

            duration = round(time.monotonic() - run_start, 1)
            _scheduler_state["last_run_status"] = "ok"
            _scheduler_state["status"]           = "idle"

            _log(f"[SCHEDULER] Cycle #{_scan_cycle_count} done in {duration}s — "
                 f"refreshed={refreshed}, errors={errors}, new_matches={len(new_matches)}")

            # Record in history
            _run_history.appendleft({
                "run_at":     _scheduler_state["last_run_at"],
                "status":     "ok",
                "cycle":      _scan_cycle_count,
                "matches":    new_matches,
                "refreshed":  refreshed,
                "errors":     errors,
                "duration_s": duration,
            })

        except Exception as e:
            _scheduler_state["status"]          = "error"
            _scheduler_state["last_run_status"] = "error"
            _log(f"[SCHEDULER] ERROR in cycle #{_scan_cycle_count}: {e}")
            _run_history.appendleft({
                "run_at":    dt.datetime.now(EGX_TZ).isoformat(),
                "status":    "error",
                "reason":    str(e),
                "cycle":     _scan_cycle_count,
                "matches":   [],
                "refreshed": 0,
                "errors":    1,
                "duration_s": 0,
            })

        interval = _scheduler_state.get("interval_minutes", 30)
        _log(f"[SCHEDULER] Next run in {interval} minutes.")
        time.sleep(interval * 60)


def _refresh_closing_prices_for_alerts() -> tuple:
    """
    Returns (refreshed_count, error_count)
    """
    _init_supabase()

    try:
        from api.symbols_local import load_symbols_for_country
        symbols_data = load_symbols_for_country("Egypt")
    except Exception as e:
        _log(f"[REFRESH] Failed to load Egyptian symbols: {e}")
        return 0, 1

    synced = [
        (str(r.get("Code", r.get("Symbol", ""))), str(r.get("Exchange", "")))
        for r in symbols_data
        if is_ticker_synced(str(r.get("Code", r.get("Symbol", ""))), str(r.get("Exchange", "")))
    ]

    if not synced:
        _log("[REFRESH] No synced tickers found")
        return 0, 0

    today = dt.date.today()
    refreshed = 0
    already_uptodate = 0
    errors = 0

    try:
        from api.tradingview_integration import fetch_tradingview_prices
        from api.stock_ai import _get_supabase_info, _last_trading_day
        last_trading = _last_trading_day(today)
    except ImportError as e:
        _log(f"[REFRESH] Import error: {e} — falling back to EODHD")
        r, e2 = _refresh_closing_prices_eodhd_fallback(synced)
        return r, e2

    _log(f"[REFRESH] Refreshing {len(synced)} tickers via TradingView (last trading: {last_trading})")

    for symbol, exchange in synced:
        if not symbol:
            continue
        full_ticker = f"{symbol}.{exchange}"
        try:
            info = _get_supabase_info(full_ticker)
            last_date = info.get("last_date")
            if last_date and last_date >= last_trading:
                already_uptodate += 1
                continue
            ok, msg = fetch_tradingview_prices(
                symbol=full_ticker, max_days=365, timeframe="1d"
            )
            if ok:
                refreshed += 1
            else:
                errors += 1
                _log(f"[REFRESH] TV failed for {full_ticker}: {msg}")
            time.sleep(0.3)
        except Exception as e:
            errors += 1
            continue

    _log(f"[REFRESH] Done: {refreshed} updated, {already_uptodate} up-to-date, {errors} errors / {len(synced)} total")
    return refreshed, errors


def _refresh_closing_prices_eodhd_fallback(synced: list) -> tuple:
    """
    Fallback EODHD refresh. Returns (refreshed, errors).
    """
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        _log("[REFRESH] EODHD API Key not set — skipping fallback")
        return 0, 0

    from api.stock_ai import update_stock_data
    api = APIClient(api_key)
    refreshed = 0
    errors = 0

    for symbol, exchange in synced:
        if not symbol:
            continue
        full_ticker = f"{symbol}.{exchange}"
        try:
            ok, msg = update_stock_data(api, full_ticker, source="eodhd", max_days=365)
            if ok:
                refreshed += 1
            else:
                errors += 1
        except Exception:
            errors += 1

    _log(f"[REFRESH] EODHD fallback: {refreshed} updated, {errors} errors")
    return refreshed, errors

def _check_and_trigger_alerts() -> list:
    _init_supabase()
    if not supabase:
        _log("[ALERTS SCHEDULER] Supabase client not initialized")
        return []
        
    # Get active alerts
    res = supabase.table("technical_alerts").select("*").eq("is_active", True).execute()
    if not res.data:
        return []
        
    alerts = res.data
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        _log("[ALERTS SCHEDULER] EODHD API Key not set")
        return []
        
    tg_token = os.getenv("ARTORO_AI_BOT")
    if not tg_token:
        _log("[ALERTS SCHEDULER] ARTORO_AI_BOT token not configured, cannot send Telegram alerts.")
        return []
        
    api = APIClient(api_key)
    all_new_matches = []
    
    for alert in alerts:
        alert_id = alert["id"]
        user_id = alert["user_id"]
        alert_name = alert["name"]
        filters_dict = alert["filters"]
        last_triggered_matches = alert.get("last_triggered_matches") or []
        
        # Get user's telegram_chat_id from profiles
        prof_res = supabase.table("profiles").select("telegram_chat_id").eq("id", user_id).execute()
        if not prof_res.data or not prof_res.data[0].get("telegram_chat_id"):
            # User hasn't set up Telegram chat id
            continue
            
        chat_id = prof_res.data[0]["telegram_chat_id"]
        
        # Build TechFilter
        try:
            # Backend expects country, limit, etc. Default country is Egypt.
            if "country" not in filters_dict:
                filters_dict["country"] = "Egypt"
            f = TechFilter(**filters_dict)
        except Exception as e:
            _log(f"[ALERTS SCHEDULER] Invalid filters for alert {alert_id}: {e}")
            continue
            
        try:
            symbols_data = load_symbols_for_country(f.country)
        except Exception as e:
            _log(f"[ALERTS SCHEDULER] Failed to load symbols for country {f.country}: {e}")
            continue
            
        cached_candidates = []
        others = []
        for row in symbols_data:
            sym = str(row.get("Code", row.get("Symbol", "")))
            ex = str(row.get("Exchange", ""))
            if is_ticker_synced(sym, ex):
                cached_candidates.append(row)
            else:
                others.append(row)
                
        sorted_candidates = cached_candidates + others
        candidates = sorted_candidates[:f.limit]
        
        matched_symbols = []
        
        for row in candidates:
            symbol = str(row.get("Code", row.get("Symbol", "")))
            exchange = str(row.get("Exchange", ""))
            if not symbol or not is_ticker_synced(symbol, exchange):
                continue
                
            try:
                # Use local data (already refreshed above by _refresh_closing_prices_for_alerts)
                # force_local=True here is safe — fresh data was pulled in the refresh step
                df = get_stock_data_eodhd(api, symbol, from_date="2023-01-01", tolerance_days=5, exchange=exchange, force_local=True)
                if df is None or df.empty:
                    continue
                df = add_technical_indicators(df)
                if df is None or df.empty:
                    continue
                last = df.iloc[-1]
                
                close = float(last.get("Close", 0))
                rsi = float(last.get("RSI", 0))
                ema50 = float(last.get("EMA_50", 0))
                ema200 = float(last.get("EMA_200", 0))
                volume = float(last.get("Volume", 0))
                momentum = float(last.get("Momentum", 0))
                atr14 = float(last.get("ATR_14", 0))
                adx14 = float(last.get("ADX_14", 0))
                stoch_k = float(last.get("STOCH_K", 0))
                roc12 = float(last.get("ROC_12", 0))
                vol_sma20 = float(last.get("VOL_SMA20", 0))
                vwap20 = float(last.get("VWAP_20", 0))
                
                # Apply filters
                if f.min_price and close < f.min_price: continue
                if f.rsi_min and rsi < f.rsi_min: continue
                if f.rsi_max and rsi > f.rsi_max: continue
                if f.above_ema50 and close <= ema50: continue
                if f.below_ema50 and close >= ema50: continue
                if f.above_ema200 and close <= ema200: continue
                if f.adx_min and adx14 < f.adx_min: continue
                if f.adx_max and adx14 > f.adx_max: continue
                if f.atr_min and atr14 < f.atr_min: continue
                if f.atr_max and atr14 > f.atr_max: continue
                if f.stoch_k_min and stoch_k < f.stoch_k_min: continue
                if f.stoch_k_max and stoch_k > f.stoch_k_max: continue
                if f.roc_min and roc12 < f.roc_min: continue
                if f.roc_max and roc12 > f.roc_max: continue
                if f.above_vwap20 and close <= vwap20: continue
                if f.volume_above_sma20 and volume <= vol_sma20: continue
                if f.golden_cross and ema50 <= ema200: continue
                
                # Fundamentals if needed
                if f.market_cap_min or f.market_cap_max or f.sector or f.industry:
                    funds = get_company_fundamentals(symbol) or {}
                    m_cap = funds.get("marketCap")
                    sec = funds.get("sector")
                    ind = funds.get("industry")
                    
                    if f.market_cap_min and (m_cap or 0) < f.market_cap_min: continue
                    if f.market_cap_max and (m_cap or 0) > f.market_cap_max: continue
                    if f.sector and f.sector.lower() not in (sec or "").lower(): continue
                    if f.industry and f.industry.lower() not in (ind or "").lower(): continue

                # AI Filter
                if f.use_ai_filter:
                    from api.stock_ai import run_pipeline
                    prediction = run_pipeline(
                        api_key=api_key,
                        ticker=symbol,
                        from_date="2020-01-01",
                        include_fundamentals=False,
                        tolerance_days=5,
                        exchange=exchange,
                        force_local=True
                    )
                    if prediction["tomorrowPrediction"] != 1: continue
                    if prediction["precision"] < f.min_ai_precision: continue

                # If passed all filters, it's a match!
                matched_symbols.append(symbol)
            except Exception as e:
                # _log(f"[ALERTS SCHEDULER] Error processing symbol {symbol}: {e}")
                continue
                
        # Compare with last triggered matches
        new_matches = [s for s in matched_symbols if s not in last_triggered_matches]
        if new_matches:
            all_new_matches.extend(new_matches)
            # We have new matches! Send Telegram notification
            msg = (
                f"🔔 *تنبيه الفاحص الفني: {alert_name}* 🔔\n\n"
                f"تم رصد أسهم جديدة تطابق شروط الفلتر الخاصة بك في سوق مصر:\n"
            )
            for sym in new_matches:
                msg += f"• *{sym}*\n"
                
            msg += f"\nإجمالي الأسهم المطابقة حالياً: {len(matched_symbols)}"
            
            # Send using bot_manager's bridge queue if available to preserve ordering/retries
            from api.live_bot import bot_manager
            bridge = getattr(bot_manager, "_telegram_bridge", None)
            if bridge:
                bridge._queue.append({"chat_id": int(chat_id), "text": msg, "parse_mode": "Markdown"})
                _log(f"[ALERTS SCHEDULER] Queued telegram alert to bridge for {chat_id}")
            else:
                # Fallback to direct requests call
                url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
                try:
                    requests.post(url, json={"chat_id": int(chat_id), "text": msg, "parse_mode": "Markdown"}, timeout=15)
                    _log(f"[ALERTS SCHEDULER] Sent direct telegram alert to {chat_id}")
                except Exception as ex:
                    _log(f"[ALERTS SCHEDULER] Direct Telegram post failed: {ex}")
                    
            # Update database with matches and trigger timestamp
            supabase.table("technical_alerts").update({
                "last_triggered_at": dt.datetime.now().isoformat(),
                "last_triggered_matches": matched_symbols
            }).eq("id", alert_id).execute()
        elif set(matched_symbols) != set(last_triggered_matches):
            # If the matched list decreased or changed but has no NEW matches, we still update the DB
            # but don't notify to avoid spamming the user
            supabase.table("technical_alerts").update({
                "last_triggered_matches": matched_symbols
            }).eq("id", alert_id).execute()

    return list(set(all_new_matches))
