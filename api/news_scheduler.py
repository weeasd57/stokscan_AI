"""
News Sentiment Scheduler — runs news_sentiment_engine independently every day at 19:00 Cairo time.
Starts as a daemon thread on server startup alongside daily_job_scheduler.
"""
import os
import json
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Any

_NEWS_RUN_HOUR = 19   # 7 PM Cairo time (UTC+2 = 17:00 UTC)
_NEWS_RUN_MINUTE = 0
_ACTIVE_DAYS = [6, 0, 1, 2, 3]  # Sun–Thu (EGX trading days)

_state: Dict[str, Any] = {
    "enabled": True,
    "run_time": "19:00",       # Cairo time
    "timezone": "Africa/Cairo",
    "active_days": _ACTIVE_DAYS,
    "status": "idle",
    "next_run_at": None,
    "last_run_at": None,
    "last_run_status": None,
    "last_count": 0,
}
_state_lock = threading.RLock()
_thread = None
_stop_event = threading.Event()

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "news_scheduler_config.json")


def _load_config():
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r") as f:
                _state.update(json.load(f))
    except Exception:
        pass


def _save_config():
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump({
                "enabled": _state["enabled"],
                "run_time": _state["run_time"],
                "active_days": _state["active_days"],
            }, f, indent=2)
    except Exception:
        pass


_load_config()


def get_news_scheduler_state() -> Dict[str, Any]:
    with _state_lock:
        return dict(_state)


def update_news_scheduler_config(patch: Dict[str, Any]) -> Dict[str, Any]:
    with _state_lock:
        _state.update(patch)
        _save_config()
        return dict(_state)


def _compute_next_run() -> str:
    run_time_str = _state.get("run_time", "19:00")
    try:
        hour, minute = map(int, run_time_str.split(":"))
    except Exception:
        hour, minute = 19, 0

    # UTC+2 = Cairo (Africa/Cairo without DST — simple offset)
    now_cairo = datetime.utcnow() + timedelta(hours=2)
    today = now_cairo.replace(hour=hour, minute=minute, second=0, microsecond=0)
    active_days = _state.get("active_days", _ACTIVE_DAYS)
    for _ in range(8):
        if today.weekday() in active_days and today > now_cairo:
            return today.isoformat()
        today += timedelta(days=1)
    return today.isoformat()


def _run_news_job():
    """Fetch and store news sentiment for all EGX symbols."""
    print("[NEWS-SCHEDULER] Starting news sentiment fetch...")
    try:
        import sys, os
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        if project_root not in sys.path:
            sys.path.insert(0, project_root)

        import api.stock_ai as stock_ai
        from api.stock_ai import _init_supabase
        _init_supabase()

        from api.intraday_downloader import _fetch_egx_symbols
        from api.news_sentiment_engine import process_exchange_news

        symbols_raw = _fetch_egx_symbols()
        if not symbols_raw:
            print("[NEWS-SCHEDULER] No symbols found — skipping.")
            return False, 0

        # Filter to active symbols (basic check: non-empty list)
        print(f"[NEWS-SCHEDULER] Processing news for {len(symbols_raw)} EGX symbols...")
        ok, count = process_exchange_news("EGX", symbols_raw)
        return ok, count
    except Exception as e:
        print(f"[NEWS-SCHEDULER] Job error: {e}")
        return False, 0


def _worker():
    print("[NEWS-SCHEDULER] Worker thread started — will run news sentiment daily at 19:00 Cairo.")
    while not _stop_event.is_set():
        try:
            with _state_lock:
                enabled = _state["enabled"]
                active_days = _state.get("active_days", _ACTIVE_DAYS)
                run_time_str = _state.get("run_time", "19:00")

            next_run = _compute_next_run()
            with _state_lock:
                _state["next_run_at"] = next_run

            if not enabled:
                with _state_lock:
                    _state["status"] = "disabled"
                time.sleep(60)
                continue

            try:
                run_hour, run_minute = map(int, run_time_str.split(":"))
            except Exception:
                run_hour, run_minute = 19, 0

            now_cairo = datetime.utcnow() + timedelta(hours=2)
            current_minutes = now_cairo.hour * 60 + now_cairo.minute
            run_minutes = run_hour * 60 + run_minute
            is_active_day = now_cairo.weekday() in active_days

            # Fire within a 5-minute window of the scheduled time
            if is_active_day and run_minutes <= current_minutes < run_minutes + 5:
                with _state_lock:
                    _state["status"] = "running"

                print(f"[NEWS-SCHEDULER] Triggering news fetch at {now_cairo.strftime('%Y-%m-%d %H:%M')} Cairo")
                ok, count = _run_news_job()

                with _state_lock:
                    _state["status"] = "idle"
                    _state["last_run_at"] = datetime.utcnow().isoformat()
                    _state["last_run_status"] = "completed" if ok else "failed"
                    _state["last_count"] = count

                print(f"[NEWS-SCHEDULER] Done — {count} symbols processed, ok={ok}")
                # Sleep 6 minutes to skip past the 5-minute fire window
                time.sleep(360)
                continue

            with _state_lock:
                _state["status"] = "idle"
            time.sleep(30)

        except Exception as e:
            print(f"[NEWS-SCHEDULER] Worker error: {e}")
            time.sleep(60)


def start_news_scheduler():
    global _thread, _stop_event
    if _thread and _thread.is_alive():
        return
    _stop_event.clear()
    _thread = threading.Thread(target=_worker, daemon=True, name="news-scheduler")
    _thread.start()
    print("[NEWS-SCHEDULER] Scheduler thread started — daily at 19:00 Cairo.")


def stop_news_scheduler():
    global _stop_event
    _stop_event.set()
    print("[NEWS-SCHEDULER] Scheduler stopped.")
