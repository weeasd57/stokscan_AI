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
from api.stock_ai import is_ticker_synced
from api.daily_bot_run import calculate_and_save_indicators

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

            candidate_symbols = _collect_scheduler_candidate_symbols()
            refreshed, errors = _refresh_closing_prices_for_alerts(candidate_symbols)
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


def _build_candidate_symbols_for_alert(f: TechFilter) -> list[tuple[str, str]]:
    try:
        symbols_data = load_symbols_for_country(f.country)
    except Exception as e:
        _log(f"[ALERTS SCHEDULER] Failed to load symbols for country {f.country}: {e}")
        return []

    allowed_symbols = {str(s).strip().upper() for s in (f.symbols or []) if str(s).strip()}
    candidate_symbols = []

    for row in symbols_data:
        sym = str(row.get("Code", row.get("Symbol", ""))).strip()
        ex = str(row.get("Exchange", "")).strip()
        sector = str(row.get("Sector", "")).strip()
        industry = str(row.get("Industry", "")).strip()

        if not sym or not ex:
            continue
        if allowed_symbols and sym.upper() not in allowed_symbols:
            continue
        if f.exchange and ex.upper() != str(f.exchange).strip().upper():
            continue
        if f.sector and sector.lower() != str(f.sector).strip().lower():
            continue
        if f.industry and industry.lower() != str(f.industry).strip().lower():
            continue
        if not is_ticker_synced(sym, ex):
            continue

        candidate_symbols.append((sym, ex))

    return candidate_symbols


def _refresh_closing_prices_for_alerts(candidate_symbols: list[tuple[str, str]]) -> tuple:
    """
    Returns (refreshed_count, error_count)
    """
    _init_supabase()

    synced = [(symbol, exchange) for symbol, exchange in candidate_symbols if symbol and exchange]

    if not synced:
        _log("[REFRESH] No candidate tickers found")
        return 0, 0

    today = dt.date.today()
    refreshed = 0
    already_uptodate = 0
    errors = 0
    indicator_updates = 0

    try:
        from api.tradingview_integration import fetch_tradingview_prices
        from api.stock_ai import _get_supabase_info, _last_trading_day
        last_trading = _last_trading_day(today)
    except ImportError as e:
        _log(f"[REFRESH] Import error: {e} — falling back to EODHD")
        r, e2 = _refresh_closing_prices_eodhd_fallback(synced)
        return r, e2

    _log(f"[REFRESH] Refreshing {len(synced)} candidate tickers via TradingView (last trading: {last_trading})")

    for symbol, exchange in synced:
        full_ticker = f"{symbol}.{exchange}"
        try:
            info = _get_supabase_info(full_ticker)
            last_date = info.get("last_date")
            did_refresh = False

            if last_date and last_date >= last_trading:
                already_uptodate += 1
            else:
                ok, msg = fetch_tradingview_prices(
                    symbol=full_ticker, max_days=365, timeframe="1d"
                )
                if ok:
                    refreshed += 1
                    did_refresh = True
                else:
                    errors += 1
                    _log(f"[REFRESH] TV failed for {full_ticker}: {msg}")
                    time.sleep(0.3)
                    continue

            if did_refresh or last_date:
                try:
                    calculate_and_save_indicators(symbol, exchange)
                    indicator_updates += 1
                except Exception as e:
                    errors += 1
                    _log(f"[REFRESH] Indicator update failed for {full_ticker}: {e}")

            time.sleep(0.3)
        except Exception as e:
            errors += 1
            _log(f"[REFRESH] Unexpected error for {full_ticker}: {e}")
            continue

    _log(
        f"[REFRESH] Done: {refreshed} prices updated, {indicator_updates} indicators updated, "
        f"{already_uptodate} up-to-date, {errors} errors / {len(synced)} total"
    )
    return refreshed + indicator_updates, errors


def _refresh_closing_prices_eodhd_fallback(synced: list[tuple[str, str]]) -> tuple:
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
    indicator_updates = 0

    for symbol, exchange in synced:
        full_ticker = f"{symbol}.{exchange}"
        try:
            ok, msg = update_stock_data(api, full_ticker, source="eodhd", max_days=365)
            if ok:
                refreshed += 1
            else:
                errors += 1
                _log(f"[REFRESH] EODHD failed for {full_ticker}: {msg}")
                continue

            try:
                calculate_and_save_indicators(symbol, exchange)
                indicator_updates += 1
            except Exception as e:
                errors += 1
                _log(f"[REFRESH] Indicator update failed for {full_ticker}: {e}")
        except Exception as e:
            errors += 1
            _log(f"[REFRESH] Unexpected EODHD error for {full_ticker}: {e}")

    _log(f"[REFRESH] EODHD fallback: {refreshed} prices updated, {indicator_updates} indicators updated, {errors} errors")
    return refreshed + indicator_updates, errors

def _collect_scheduler_candidate_symbols() -> list[tuple[str, str]]:
    _init_supabase()
    if not supabase:
        return []

    res = supabase.table("technical_alerts").select("filters").eq("is_active", True).execute()
    if not res.data:
        return []

    candidate_set: set[tuple[str, str]] = set()

    for row in res.data:
        filters_dict = row.get("filters") or {}
        try:
            if "country" not in filters_dict:
                filters_dict["country"] = "Egypt"
            f = TechFilter(**filters_dict)
        except Exception:
            continue

        for symbol_pair in _build_candidate_symbols_for_alert(f):
            candidate_set.add(symbol_pair)

    return sorted(candidate_set)


def _check_and_trigger_alerts() -> list:
    """
    Scan all active technical_alerts using the same Supabase stock_technical_indicators
    table and shared filter_tech_row() function as the /scan/technical API endpoint.
    """
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
    tg_token = os.getenv("ARTORO_AI_BOT")
    if not tg_token:
        _log("[ALERTS SCHEDULER] ARTORO_AI_BOT token not configured, cannot send Telegram alerts.")
        return []

    from api.routers.scan_tech import filter_tech_row, _fetch_latest_technical_indicators, _fetch_company_fundamentals

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
            continue

        chat_id = prof_res.data[0]["telegram_chat_id"]

        # Build TechFilter
        try:
            if "country" not in filters_dict:
                filters_dict["country"] = "Egypt"
            f = TechFilter(**filters_dict)
        except Exception as e:
            _log(f"[ALERTS SCHEDULER] Invalid filters for alert {alert_id}: {e}")
            continue

        candidate_symbols = _build_candidate_symbols_for_alert(f)
        if not candidate_symbols:
            continue

        candidate_limit = min(len(candidate_symbols), max(f.limit * 3, 100))
        candidate_slice = candidate_symbols[:candidate_limit]

        # Fetch from Supabase stock_technical_indicators (same as scan API)
        tech_rows = _fetch_latest_technical_indicators(candidate_slice)
        if not tech_rows:
            _log(f"[ALERTS SCHEDULER] No technical indicators in Supabase for alert {alert_id}")
            continue

        fundamentals_map = _fetch_company_fundamentals(
            [tuple(key.split("|", 1)) for key in tech_rows.keys()]
        )

        matched_symbols = []

        for symbol, exchange in candidate_slice:
            key = f"{symbol}|{exchange}"
            tech = tech_rows.get(key)
            if not tech:
                continue
            if tech.get("rsi_14") is None or tech.get("close") is None:
                continue

            funds = fundamentals_map.get(key) or {}

            if not filter_tech_row(tech, f, funds):
                continue

            # AI Filter
            if f.use_ai_filter:
                if not api_key:
                    continue
                try:
                    from api.stock_ai import run_pipeline
                    prediction = run_pipeline(
                        api_key=api_key,
                        ticker=symbol,
                        from_date="2020-01-01",
                        include_fundamentals=False,
                        tolerance_days=5,
                        exchange=exchange,
                        force_local=True,
                    )
                    if prediction.get("tomorrowPrediction") != 1:
                        continue
                    if prediction.get("precision", 0) < f.min_ai_precision:
                        continue
                except Exception:
                    continue

            matched_symbols.append(symbol)

        # Compare with last triggered matches
        new_matches = [s for s in matched_symbols if s not in last_triggered_matches]
        if new_matches:
            all_new_matches.extend(new_matches)
            msg = (
                f"🔔 *تنبيه الفاحص الفني: {alert_name}* 🔔\n\n"
                f"تم رصد أسهم جديدة تطابق شروط الفلتر الخاصة بك:\n"
            )
            for sym in new_matches:
                msg += f"• *{sym}*\n"
            msg += f"\nإجمالي الأسهم المطابقة حالياً: {len(matched_symbols)}"

            # Send Telegram
            from api.live_bot import bot_manager
            bridge = getattr(bot_manager, "_telegram_bridge", None)
            if bridge:
                bridge._queue.append({"chat_id": int(chat_id), "text": msg, "parse_mode": "Markdown"})
                _log(f"[ALERTS SCHEDULER] Queued telegram alert to bridge for {chat_id}")
            else:
                url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
                try:
                    requests.post(url, json={"chat_id": int(chat_id), "text": msg, "parse_mode": "Markdown"}, timeout=15)
                    _log(f"[ALERTS SCHEDULER] Sent direct telegram alert to {chat_id}")
                except Exception as ex:
                    _log(f"[ALERTS SCHEDULER] Direct Telegram post failed: {ex}")

            # Broadcast to service subscribers
            try:
                from api.daily_bot_run import _notify_service_subscribers
                _notify_service_subscribers("technical_scanner", msg)
            except Exception as e:
                _log(f"[ALERTS SCHEDULER] Service subscriber notify failed: {e}")

            supabase.table("technical_alerts").update({
                "last_triggered_at": dt.datetime.now().isoformat(),
                "last_triggered_matches": matched_symbols,
            }).eq("id", alert_id).execute()
        elif set(matched_symbols) != set(last_triggered_matches):
            supabase.table("technical_alerts").update({
                "last_triggered_matches": matched_symbols,
            }).eq("id", alert_id).execute()

    return list(set(all_new_matches))
