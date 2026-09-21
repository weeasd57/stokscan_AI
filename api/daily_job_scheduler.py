"""
Daily Job Scheduler — runs the daily bot job once per day at a configured time.
Starts as a daemon thread on server startup (like tech_alerts_scheduler).
"""
import os
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List


_scheduler_state: Dict[str, Any] = {
    "enabled": True,
    "run_time": "16:00",  # Cairo time — after market close
    "timezone": "Africa/Cairo",
    # Python weekday numbering: Monday=0 .. Sunday=6.
    # Sunday-Thursday is therefore [0, 1, 2, 3, 6].
    "active_days": [0, 1, 2, 3, 6],
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
_last_recommendation_retry_at = 0.0

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


def _now_cairo() -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Africa/Cairo"))
    except Exception:
        return datetime.utcnow() + timedelta(hours=3)


def _daily_job_ran_today(today: str) -> bool:
    """Use the durable job ledger so restarts cannot lose today's run state."""
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if not supabase:
            return False
        local_start = datetime.fromisoformat(today).replace(tzinfo=_now_cairo().tzinfo)
        utc_start = local_start.astimezone(timezone.utc)
        utc_end = (local_start + timedelta(days=1)).astimezone(timezone.utc)
        result = (
            supabase.table("daily_job_runs")
            .select("status")
            .eq("job_type", "daily_bot")
            .gte("started_at", utc_start.isoformat())
            .lt("started_at", utc_end.isoformat())
            .in_("status", ["running", "completed"])
            .limit(1)
            .execute()
        )
        return bool(result.data)
    except Exception as exc:
        print(f"[DAILY-JOB-SCHEDULER] Durable run check failed: {exc}")
        return False


def run_startup_catchup() -> bool:
    """Run a missed active-day job once after a late server restart."""
    with _scheduler_lock:
        if not _scheduler_state.get("enabled"):
            return False
        run_time = str(_scheduler_state.get("run_time", "16:00"))
        active_days = list(_scheduler_state.get("active_days", [0, 1, 2, 3, 6]))
        model_filter = _scheduler_state.get("model_filter", "adaptive")
    now = _now_cairo()
    try:
        hour, minute = map(int, run_time.split(":", 1))
    except Exception:
        hour, minute = 16, 0
    if now.weekday() not in active_days or (now.hour, now.minute) < (hour, minute):
        return False
    today = now.date().isoformat()
    if _daily_job_ran_today(today):
        print(f"[DAILY-JOB-SCHEDULER] Startup catch-up skipped; {today} already ran.")
        return False

    def _run():
        import asyncio
        from api.daily_bot_run import run_daily_job
        try:
            asyncio.run(run_daily_job(trigger="startup_catchup", model_filter=model_filter))
            _record_run("startup_catchup", "completed")
        except Exception as exc:
            print(f"[DAILY-JOB-SCHEDULER] Startup catch-up failed: {exc}")
            _record_run("startup_catchup", "failed")

    with _scheduler_lock:
        if _scheduler_state.get("status") == "running":
            return False
        _scheduler_state["status"] = "running"
    threading.Thread(target=_run, daemon=True, name="daily-job-startup-catchup").start()
    print(f"[DAILY-JOB-SCHEDULER] Startup catch-up started for {today}.")
    return True


def _js_days_to_python(days: Any) -> List[int]:
    """Admin UI uses Sun=0 while Python's datetime uses Mon=0."""
    if not isinstance(days, list):
        return list(_scheduler_state.get("active_days", [0, 1, 2, 3, 6]))
    return sorted({(int(day) - 1) % 7 for day in days if isinstance(day, (int, float)) and 0 <= int(day) <= 6})


def _python_days_to_js(days: Any) -> List[int]:
    if not isinstance(days, list):
        return []
    return sorted({(int(day) + 1) % 7 for day in days if isinstance(day, (int, float)) and 0 <= int(day) <= 6})


def _schedule_payload() -> Dict[str, Any]:
    return {
        "enabled": bool(_scheduler_state["enabled"]),
        "run_time": _scheduler_state["run_time"],
        "active_days": _python_days_to_js(_scheduler_state["active_days"]),
        "model_filter": _scheduler_state.get("model_filter", "adaptive"),
    }


def _apply_persisted_schedule(payload: Dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        return
    with _scheduler_lock:
        if isinstance(payload.get("enabled"), bool):
            _scheduler_state["enabled"] = payload["enabled"]
        if isinstance(payload.get("run_time"), str):
            _scheduler_state["run_time"] = payload["run_time"]
        if isinstance(payload.get("active_days"), list):
            _scheduler_state["active_days"] = _js_days_to_python(payload["active_days"])
        if isinstance(payload.get("model_filter"), str):
            _scheduler_state["model_filter"] = payload["model_filter"]


def _hydrate_config_from_supabase() -> None:
    """Read schedule once at process start; the worker never polls settings."""
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if not supabase:
            return
        res = (
            supabase.table("market_cache")
            .select("payload")
            .eq("cache_key", "daily_job_schedule")
            .maybe_single()
            .execute()
        )
        payload = (res.data or {}).get("payload")
        if isinstance(payload, dict):
            _apply_persisted_schedule(payload)
            _save_config()
            print("[DAILY-JOB-SCHEDULER] Loaded schedule once from Supabase.")
    except Exception as exc:
        print(f"[DAILY-JOB-SCHEDULER] Startup config load failed: {exc}")


def get_scheduler_state() -> Dict[str, Any]:
    with _scheduler_lock:
        state = dict(_scheduler_state, run_history=list(_run_history[-20:]))
        state["active_days"] = _python_days_to_js(state.get("active_days"))
        return state


def update_scheduler_config(patch: Dict[str, Any]) -> Dict[str, Any]:
    safe_patch = {key: value for key, value in (patch or {}).items() if key in {"enabled", "run_time", "active_days", "model_filter"}}
    with _scheduler_lock:
        if "active_days" in safe_patch:
            _scheduler_state["active_days"] = _js_days_to_python(safe_patch.pop("active_days"))
        _scheduler_state.update(safe_patch)
        _save_config()
        payload = _schedule_payload()

    # Persist on the settings write path. This replaces the old query every
    # 30 seconds while still surviving a Docker Space restart.
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if supabase:
            supabase.table("market_cache").upsert(
                {"cache_key": "daily_job_schedule", "payload": payload},
                on_conflict="cache_key",
                returning="minimal",
            ).execute()
    except Exception as exc:
        print(f"[DAILY-JOB-SCHEDULER] Failed to persist schedule: {exc}")
    return get_scheduler_state()


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
    global _scheduler_state, _last_recommendation_retry_at
    print("[DAILY-JOB-SCHEDULER] Worker started.")

    while not _stop_event.is_set():
        try:
            with _scheduler_lock:
                enabled = _scheduler_state["enabled"]
                active_days = _scheduler_state.get("active_days", [0, 1, 2, 3, 6])

            # Retry delivery is a separate operational concern from the daily
            # evaluator. Keep it alive even when the daily job is paused.
            now_monotonic = time.monotonic()
            if now_monotonic - _last_recommendation_retry_at >= 60:
                try:
                    from api.daily_bot_run import retry_pending_recommendation_telegram_events
                    retry_pending_recommendation_telegram_events(limit=10)
                    from api.local_payments import revoke_expired_pro_members
                    revoke_expired_pro_members()
                except Exception as retry_err:
                    print(f"[DAILY-JOB-SCHEDULER] Recommendation retry failed: {retry_err}")
                _last_recommendation_retry_at = now_monotonic

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
    _hydrate_config_from_supabase()
    run_startup_catchup()
    _stop_event.clear()
    _scheduler_thread = threading.Thread(target=_scheduler_worker, daemon=True, name="daily-job-scheduler")
    _scheduler_thread.start()
    print("[DAILY-JOB-SCHEDULER] Scheduler thread started.")


def stop_daily_job_scheduler():
    global _stop_event
    _stop_event.set()
    print("[DAILY-JOB-SCHEDULER] Scheduler stopped.")
