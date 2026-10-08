"""
Daily Job Scheduler — runs separate midday market refresh and full after-close jobs.
Starts as a daemon thread on server startup (like tech_alerts_scheduler).
"""
import os
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from api.daily_job_outcome import scheduler_result_status


_scheduler_state: Dict[str, Any] = {
    "enabled": True,
    "midday_run_time": "12:15",
    "run_time": "17:00",  # Cairo time — after market close
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
_last_vip_revocation_at = 0.0
_last_short_swings_retry_at = 0.0
_last_phase_attempts = {}
_completed_phases = set()
_DEFAULT_STALE_RUN_MINUTES = 90


def _positive_interval_seconds(name: str, default: int, minimum: int = 60) -> int:
    """Read a polling interval without allowing an accidental tight loop."""
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default

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
                "midday_run_time": _scheduler_state["midday_run_time"],
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


def _parse_run_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _run_last_activity_at(row: Dict[str, Any]) -> Optional[datetime]:
    """Use the newest persisted step heartbeat, with ``started_at`` as fallback."""
    timestamps = [_parse_run_timestamp(row.get("started_at"))]
    steps = row.get("steps") or []
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except (TypeError, ValueError):
            steps = []
    if isinstance(steps, list):
        timestamps.extend(
            _parse_run_timestamp(step.get("timestamp"))
            for step in steps
            if isinstance(step, dict)
        )
    valid = [timestamp for timestamp in timestamps if timestamp is not None]
    return max(valid) if valid else None


def _stale_run_after_minutes() -> int:
    try:
        return max(30, int(os.getenv("DAILY_JOB_STALE_RUN_MINUTES", str(_DEFAULT_STALE_RUN_MINUTES))))
    except (TypeError, ValueError):
        return _DEFAULT_STALE_RUN_MINUTES


def _has_executable_steps(row: Dict[str, Any]) -> bool:
    steps = row.get("steps") or []
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except (TypeError, ValueError):
            steps = []
    if isinstance(steps, list):
        return any(isinstance(step, dict) and bool(step.get("step")) for step in steps)
    return False


def _daily_job_ran_today(today: str, phase: str = "close") -> bool:
    """Check the durable ledger and recover runs that stopped heartbeating.

    A process crash can leave a row in ``running`` forever.  Only a run with a
    recent persisted step heartbeat blocks another scheduled/catch-up attempt;
    stale rows are retained for audit but marked failed.
    """
    key = f"{today}:{phase}"
    if key in _completed_phases:
        return True
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if not supabase:
            return True  # Unavailable durable ledger must not grant a new run.
        local_start = datetime.fromisoformat(today).replace(tzinfo=_now_cairo().tzinfo)
        utc_start = local_start.astimezone(timezone.utc)
        utc_end = (local_start + timedelta(days=1)).astimezone(timezone.utc)
        result = (
            supabase.table("daily_job_runs")
            .select("id,status,started_at,steps")
            .eq("job_type", "daily_midday" if phase == "midday" else "daily_bot")
            .gte("started_at", utc_start.isoformat())
            .lt("started_at", utc_end.isoformat())
            .in_("status", ["running", "completed", "failed"])
            .order("started_at", desc=True)
            .limit(10)
            .execute()
        )
        now_utc = datetime.now(timezone.utc)
        stale_after = timedelta(minutes=_stale_run_after_minutes())
        has_completed_run = False
        has_active_run = False
        for row in result.data or []:
            if row.get("status") == "completed":
                has_completed_run = True
                continue
            if row.get("status") == "failed":
                if _has_executable_steps(row):
                    has_completed_run = True
                continue
            if row.get("status") != "running":
                continue
            last_activity = _run_last_activity_at(row)
            if last_activity and now_utc - last_activity < stale_after:
                has_active_run = True
                continue

            run_id = row.get("id")
            if run_id:
                stale_minutes = int((now_utc - (last_activity or now_utc)).total_seconds() // 60)
                stale_reason = f"Scheduler recovery: no job heartbeat for {stale_minutes} minutes."
                try:
                    supabase.table("daily_job_runs").update({
                        "status": "failed",
                        "completed_at": now_utc.isoformat(),
                        "error": stale_reason,
                    }).eq("id", run_id).eq("status", "running").execute()
                    if _has_executable_steps(row):
                        has_completed_run = True  # Resume its failed stages; do not replay the whole job.
                    print(f"[DAILY-JOB-SCHEDULER] Marked stale run {run_id} as failed.")
                except Exception as cleanup_error:
                    print(f"[DAILY-JOB-SCHEDULER] Could not mark stale run {run_id} failed: {cleanup_error}")
        if has_completed_run:
            _completed_phases.add(key)
        return has_completed_run or has_active_run
    except Exception as exc:
        print(f"[DAILY-JOB-SCHEDULER] Durable run check failed: {exc}")
        return True


def _minutes(value):
    hour, minute = map(int, str(value).split(":"))
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ValueError("Invalid schedule time")
    return hour * 60 + minute


def _due_phase(now):
    from api.egx_trading_calendar import is_egx_session
    if not is_egx_session(now):
        return None
    if not _scheduler_state.get("enabled") or now.weekday() not in _scheduler_state["active_days"]:
        return None
    current = now.hour * 60 + now.minute
    if current >= _minutes(_scheduler_state["run_time"]):
        return "close"
    # A missed midday run is not replayed after the session has closed.
    if _minutes(_scheduler_state["midday_run_time"]) <= current < 14 * 60 + 30:
        return "midday"
    return None


def _execute_phase(phase, source):
    import asyncio
    try:
        from api.daily_bot_run import run_daily_job
        result = asyncio.run(run_daily_job(trigger="scheduled", phase=phase,
                           model_filter=_scheduler_state.get("model_filter", "adaptive")))
        _record_run(result.get("job_run_id", source), scheduler_result_status(result))
    except Exception as exc:
        print(f"[DAILY-JOB-SCHEDULER] {phase} run failed: {exc}")
        _record_run(source, "failed")
    finally:
        with _scheduler_lock:
            _scheduler_state["status"] = "idle"


def _claim_phase_in_process(now, phase):
    key = f"{now.date().isoformat()}:{phase}"
    with _scheduler_lock:
        last = _last_phase_attempts.get(key, {})
        if (_scheduler_state.get("status") == "running" or last.get("attempts", 0) >= 3
                or time.monotonic() - last.get("at", -100000) < 900):
            return False
        if _daily_job_ran_today(now.date().isoformat(), phase):
            _last_phase_attempts[key] = {"at": time.monotonic(), "attempts": last.get("attempts", 0)}
            return False
        if len(_last_phase_attempts) > 10:
            _last_phase_attempts.clear()
        _last_phase_attempts[key] = {"at": time.monotonic(), "attempts": last.get("attempts", 0) + 1}
        _scheduler_state["status"] = "running"
        _scheduler_state["current_phase"] = phase
        return True


def run_startup_catchup() -> bool:
    """Recover only the appropriate missing phase after an HF restart."""
    now = _now_cairo()
    phase = _due_phase(now)
    if not phase or not _claim_phase_in_process(now, phase):
        return False
    threading.Thread(target=_execute_phase, args=(phase, "startup_catchup"),
                     daemon=True, name="daily-job-startup-catchup").start()
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
        "midday_run_time": _scheduler_state["midday_run_time"],
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
        if isinstance(payload.get("midday_run_time"), str):
            _minutes(payload["midday_run_time"])
            _scheduler_state["midday_run_time"] = payload["midday_run_time"]
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
            .eq("country", "Egypt")
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
    safe_patch = {key: value for key, value in (patch or {}).items() if key in {"enabled", "run_time", "midday_run_time", "active_days", "model_filter"}}
    midday = _minutes(safe_patch.get("midday_run_time", _scheduler_state["midday_run_time"]))
    close = _minutes(safe_patch.get("run_time", _scheduler_state["run_time"]))
    if not 10 * 60 <= midday < 14 * 60 + 30 or close < 14 * 60 + 30:
        raise ValueError("Midday must be during the session and close run after 14:30 Cairo")
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
                {"cache_key": "daily_job_schedule", "country": "Egypt", "payload": payload},
                on_conflict="cache_key,country",
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
        if status in ("failed", "partial"):
            _scheduler_state["total_failed"] += 1
        _run_history.append({
            "run_at": datetime.utcnow().isoformat(),
            "status": status,
            "job_id": job_id,
        })
        if len(_run_history) > 50:
            _run_history[:] = _run_history[-50:]


def _compute_next_run() -> str:
    from api.egx_trading_calendar import is_egx_session
    now = _now_cairo()
    candidates = []
    for offset in range(8):
        day = now + timedelta(days=offset)
        if day.weekday() not in _scheduler_state["active_days"] or not is_egx_session(day):
            continue
        for value in (_scheduler_state["midday_run_time"], _scheduler_state["run_time"]):
            minutes = _minutes(value)
            candidate = day.replace(hour=minutes // 60, minute=minutes % 60, second=0, microsecond=0)
            if candidate > now:
                candidates.append(candidate)
    return min(candidates).isoformat() if candidates else None


def _retry_short_swings(now):
    if not _scheduler_state.get("enabled") or now.weekday() not in _scheduler_state["active_days"]:
        return
    with _scheduler_lock:
        if _scheduler_state.get("status") == "running":
            return
        _scheduler_state["status"] = "running"
    try:
        from api.daily_stage_recovery import retry_failed_daily_stages
        result = retry_failed_daily_stages(now)
        if result:
            print(f"[DAILY-JOB-SCHEDULER] Independent phase recovery: {result}")
    finally:
        with _scheduler_lock:
            _scheduler_state["status"] = "idle"


def _scheduler_worker():
    global _scheduler_state, _last_recommendation_retry_at, _last_vip_revocation_at, _last_short_swings_retry_at
    print("[DAILY-JOB-SCHEDULER] Worker started.")

    # Pending Telegram events are exceptional retries, not a realtime queue.
    # VIP expiry is even less urgent and must not scan subscriptions every minute.
    retry_interval = _positive_interval_seconds("TELEGRAM_RETRY_INTERVAL_SECONDS", 900)
    vip_revocation_interval = _positive_interval_seconds("VIP_REVOCATION_INTERVAL_SECONDS", 21600, 300)

    while not _stop_event.is_set():
        try:
            with _scheduler_lock:
                enabled = _scheduler_state["enabled"]
                active_days = _scheduler_state.get("active_days", [0, 1, 2, 3, 6])

            # Retry delivery is a separate operational concern from the daily
            # evaluator. Keep it alive even when the daily job is paused.
            now_monotonic = time.monotonic()
            if now_monotonic - _last_recommendation_retry_at >= retry_interval:
                try:
                    from api.daily_bot_run import retry_pending_recommendation_telegram_events
                    retry_pending_recommendation_telegram_events(limit=10)
                except Exception as retry_err:
                    print(f"[DAILY-JOB-SCHEDULER] Recommendation retry failed: {retry_err}")
                _last_recommendation_retry_at = now_monotonic

            if now_monotonic - _last_vip_revocation_at >= vip_revocation_interval:
                try:
                    from api.telegram_pro_invites import revoke_expired_pro_members
                    revoke_expired_pro_members()
                except Exception as revoke_err:
                    print(f"[DAILY-JOB-SCHEDULER] VIP revocation check failed: {revoke_err}")
                _last_vip_revocation_at = now_monotonic

            if not enabled:
                with _scheduler_lock:
                    _scheduler_state["status"] = "disabled"
                    _scheduler_state["next_run_at"] = None
                time.sleep(30)
                continue

            now_cairo = _now_cairo()
            with _scheduler_lock:
                _scheduler_state["next_run_at"] = _compute_next_run()
            phase = _due_phase(now_cairo)
            if phase and _claim_phase_in_process(now_cairo, phase):
                print(f"[DAILY-JOB-SCHEDULER] Triggering {phase} job at {now_cairo}")
                _execute_phase(phase, "scheduled")
                continue
            if now_monotonic - _last_short_swings_retry_at >= retry_interval:
                try:
                    _retry_short_swings(now_cairo)
                except Exception as error:
                    print(f"[DAILY-JOB-SCHEDULER] Short-swings recovery failed: {error}")
                _last_short_swings_retry_at = now_monotonic
            _stop_event.wait(30)

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
