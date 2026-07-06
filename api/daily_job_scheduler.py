"""
Daily Job Scheduler — runs the daily bot job once per day at a configured time.
Starts as a daemon thread on server startup (like tech_alerts_scheduler).
"""
import os
import json
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Any, List


_scheduler_state: Dict[str, Any] = {
    "enabled": True,
    "run_time": "16:00",  # Cairo time — after market close
    "timezone": "Africa/Cairo",
    "active_days": [6, 0, 1, 2, 3],  # Sun-Thu
    "model_filter": "adaptive",
    "status": "idle",
    "next_run_at": None,
    "last_run_at": None,
    "last_run_status": None,
    "last_run_job_id": None,
    "total_runs": 0,
    "total_failed": 0,
}
_run_history: List[Dict[str, Any]] = []
_scheduler_lock = threading.RLock()
_scheduler_thread = None
_stop_event = threading.Event()

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "daily_job_config.json")


def _load_config():
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r") as f:
                loaded = json.load(f)
                _scheduler_state.update(loaded)
    except Exception:
        pass


def _save_config():
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump({
                "enabled": _scheduler_state["enabled"],
                "run_time": _scheduler_state["run_time"],
                "active_days": _scheduler_state["active_days"],
                "model_filter": _scheduler_state.get("model_filter", "adaptive"),
            }, f, indent=2)
    except Exception:
        pass


_load_config()


def get_scheduler_state() -> Dict[str, Any]:
    with _scheduler_lock:
        return dict(_scheduler_state, run_history=list(_run_history[-20:]))


def update_scheduler_config(patch: Dict[str, Any]) -> Dict[str, Any]:
    with _scheduler_lock:
        _scheduler_state.update(patch)
        _save_config()
        return dict(_scheduler_state)


def _record_run(job_id: str, status: str):
    with _scheduler_lock:
        _scheduler_state["last_run_at"] = datetime.utcnow().isoformat()
        _scheduler_state["last_run_status"] = status
        _scheduler_state["last_run_job_id"] = job_id
        _scheduler_state["total_runs"] += 1
        if status == "failed":
            _scheduler_state["total_failed"] += 1
        _run_history.append({
            "run_at": datetime.utcnow().isoformat(),
            "status": status,
            "job_id": job_id,
        })
        if len(_run_history) > 50:
            _run_history[:] = _run_history[-50:]


def _compute_next_run() -> str:
    run_time_str = _scheduler_state["run_time"]
    try:
        hour, minute = map(int, run_time_str.split(":"))
    except Exception:
        hour, minute = 16, 0

    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("Africa/Cairo"))
    except Exception:
        now = datetime.utcnow() + timedelta(hours=3)

    today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

    active_days = _scheduler_state.get("active_days", [0, 1, 2, 3, 6])
    for _ in range(8):
        if today.weekday() in active_days and today > now:
            return today.isoformat()
        today += timedelta(days=1)

    return today.isoformat()


def _scheduler_worker():
    global _scheduler_state
    print("[DAILY-JOB-SCHEDULER] Worker started.")

    while not _stop_event.is_set():
        try:
            # Poll configuration from Supabase market_cache to stay in sync with frontend
            try:
                from api.stock_ai import _init_supabase, supabase
                _init_supabase()
                if supabase:
                    res = supabase.table("market_cache").select("payload").eq("cache_key", "daily_job_schedule").maybe_single().execute()
                    if res.data and "payload" in res.data:
                        payload = res.data["payload"] or {}
                        with _scheduler_lock:
                            val_use_sched = payload.get("enabled")
                            _scheduler_state["enabled"] = val_use_sched if val_use_sched is not None else _scheduler_state["enabled"]
                            if payload.get("run_time"):
                                _scheduler_state["run_time"] = payload.get("run_time")
                            raw_days = payload.get("active_days")
                            if isinstance(raw_days, list):
                                # Convert JS weekdays (0=Sun, 6=Sat) to Python weekdays (0=Mon, 6=Sun)
                                py_days = [(d - 1) % 7 for d in raw_days]
                                _scheduler_state["active_days"] = py_days
            except Exception as sync_err:
                print(f"[DAILY-JOB-SCHEDULER] Config sync from Supabase failed: {sync_err}")

            with _scheduler_lock:
                enabled = _scheduler_state["enabled"]
                active_days = _scheduler_state.get("active_days", [0, 1, 2, 3, 6])

            if not enabled:
                with _scheduler_lock:
                    _scheduler_state["status"] = "disabled"
                    _scheduler_state["next_run_at"] = None
                time.sleep(30)
                continue

            try:
                from zoneinfo import ZoneInfo
                now_cairo = datetime.now(ZoneInfo("Africa/Cairo"))
            except Exception:
                now_cairo = datetime.utcnow() + timedelta(hours=3) # Fallback to UTC+3 (Egypt Summer Time)

            run_time_str = _scheduler_state["run_time"]

            try:
                run_hour, run_minute = map(int, run_time_str.split(":"))
            except Exception:
                run_hour, run_minute = 16, 0

            is_active_day = now_cairo.weekday() in active_days
            current_minutes = now_cairo.hour * 60 + now_cairo.minute
            run_minutes = run_hour * 60 + run_minute

            next_run = _compute_next_run()
            with _scheduler_lock:
                _scheduler_state["next_run_at"] = next_run

            if is_active_day and run_minutes <= current_minutes < run_minutes + 5:
                with _scheduler_lock:
                    _scheduler_state["status"] = "running"
                    model_filter = _scheduler_state.get("model_filter", "adaptive")

                print(f"[DAILY-JOB-SCHEDULER] Triggering daily job at {now_cairo} with model: {model_filter}")
                try:
                    import asyncio
                    from api.daily_bot_run import run_daily_job
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    loop.run_until_complete(run_daily_job(trigger="scheduled", model_filter=model_filter))
                    loop.close()
                    _record_run("scheduled", "completed")
                except Exception as e:
                    print(f"[DAILY-JOB-SCHEDULER] Job failed: {e}")
                    _record_run("scheduled", "failed")

                with _scheduler_lock:
                    _scheduler_state["status"] = "idle"

                time.sleep(120)
                continue

            with _scheduler_lock:
                _scheduler_state["status"] = "idle"
            time.sleep(30)

        except Exception as e:
            print(f"[DAILY-JOB-SCHEDULER] Worker error: {e}")
            time.sleep(60)


def start_daily_job_scheduler():
    global _scheduler_thread, _stop_event
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _stop_event.clear()
    _scheduler_thread = threading.Thread(target=_scheduler_worker, daemon=True, name="daily-job-scheduler")
    _scheduler_thread.start()
    print("[DAILY-JOB-SCHEDULER] Scheduler thread started.")


def stop_daily_job_scheduler():
    global _stop_event
    _stop_event.set()
    print("[DAILY-JOB-SCHEDULER] Scheduler stopped.")
