"""
Daily intraday catch-up scheduler — runs once per day after EGX close.
"""

import threading
import datetime as dt
import time
from typing import Any, Dict, List

import pytz

from api.intraday_downloader import (
    load_state,
    save_state,
    start_smart_catchup_job,
    append_run_history,
    append_scheduler_log,
)

EGX_TZ = pytz.timezone("Africa/Cairo")
DEFAULT_RUN_TIME = "15:45"

_scheduler_thread = None
_scheduler_lock = threading.Lock()


def _default_scheduler() -> Dict[str, Any]:
    return {
        "enabled": False,
        "run_time": DEFAULT_RUN_TIME,
        "timezone": "Africa/Cairo",
        "last_run_date": None,
        "total_runs": 0,
        "status": "idle",
        "last_run_at": None,
        "last_run_status": None,
    }


def get_scheduler_state() -> Dict[str, Any]:
    state = load_state()
    sched = dict(_default_scheduler())
    sched.update(state.get("scheduler") or {})
    sched["catchup_status"] = state.get("catchup_status", "idle")
    sched["provider"] = state.get("provider", "tradingview")
    sched["run_history"] = list(state.get("run_history") or [])[-60:]
    sched["live_logs"] = list(state.get("scheduler_logs") or [])[-100:]
    return sched


def set_scheduler_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    state = load_state()
    sched = dict(_default_scheduler())
    sched.update(state.get("scheduler") or {})

    if "enabled" in payload:
        sched["enabled"] = bool(payload["enabled"])
    if "run_time" in payload:
        sched["run_time"] = str(payload["run_time"])
    if "timezone" in payload:
        sched["timezone"] = str(payload["timezone"])

    state["scheduler"] = sched
    save_state(state)
    append_scheduler_log(f"[CONFIG] Intraday scheduler updated: enabled={sched['enabled']}, run_time={sched['run_time']}")
    return get_scheduler_state()


def _parse_run_time(run_time: str) -> dt.time:
    try:
        parts = run_time.strip().split(":")
        return dt.time(int(parts[0]), int(parts[1]))
    except Exception:
        return dt.time(15, 45)


def _should_run_today(sched: Dict[str, Any], now_cairo: dt.datetime) -> bool:
    if not sched.get("enabled"):
        return False

    run_t = _parse_run_time(sched.get("run_time", DEFAULT_RUN_TIME))
    if now_cairo.time() < run_t:
        return False

    today_str = now_cairo.date().isoformat()
    if sched.get("last_run_date") == today_str:
        return False

    # EGX trades Sun–Thu; skip Fri/Sat
    if now_cairo.weekday() in (4, 5):
        return False

    return True


def _mark_daily_run(sched: Dict[str, Any], status: str, summary: str = ""):
    state = load_state()
    sched = dict(_default_scheduler())
    sched.update(state.get("scheduler") or {})

    now_cairo = dt.datetime.now(EGX_TZ)
    sched["last_run_date"] = now_cairo.date().isoformat()
    sched["last_run_at"] = now_cairo.isoformat()
    sched["last_run_status"] = status
    sched["total_runs"] = int(sched.get("total_runs") or 0) + 1
    sched["status"] = "idle"

    state["scheduler"] = sched
    save_state(state)

    append_run_history(
        {
            "run_at": sched["last_run_at"],
            "status": status,
            "source": "scheduler",
            "summary": summary,
        }
    )


def start_intraday_scheduler():
    global _scheduler_thread
    with _scheduler_lock:
        if _scheduler_thread is not None and _scheduler_thread.is_alive():
            return
        _scheduler_thread = threading.Thread(target=_scheduler_worker_loop, daemon=True)
        _scheduler_thread.start()
        append_scheduler_log("[SCHEDULER] Intraday daily scheduler thread started.")


def _scheduler_worker_loop():
    time.sleep(60)
    while True:
        try:
            state = load_state()
            sched = dict(_default_scheduler())
            sched.update(state.get("scheduler") or {})

            now_cairo = dt.datetime.now(EGX_TZ)
            if _should_run_today(sched, now_cairo):
                append_scheduler_log(f"[SCHEDULER] Triggering daily intraday catch-up at {now_cairo.strftime('%H:%M')} Cairo")
                sched["status"] = "running"
                state["scheduler"] = sched
                save_state(state)

                started, msg = start_smart_catchup_job(source="scheduler")
                if started:
                    _mark_daily_run(sched, "ok", msg)
                    append_scheduler_log(f"[SCHEDULER] Daily catch-up started: {msg}")
                else:
                    _mark_daily_run(sched, "skipped", msg)
                    append_scheduler_log(f"[SCHEDULER] Skipped: {msg}")
        except Exception as e:
            append_scheduler_log(f"[SCHEDULER] Error: {e}")
        time.sleep(60)
