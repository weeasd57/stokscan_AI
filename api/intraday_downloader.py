import os
import json
import time
import threading
import datetime as dt
from typing import Dict, List, Any, Optional, Tuple

import api.stock_ai as stock_ai
from api.intraday_provider import fetch_intraday_prices, normalize_provider

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "intraday_sync_state.json")

_downloader_thread = None
_downloader_lock = threading.Lock()
_catchup_thread = None
_catchup_lock = threading.Lock()

MAX_RUN_HISTORY = 60
MAX_SCHEDULER_LOGS = 200


def _default_state() -> Dict[str, Any]:
    return {
        "status": "idle",
        "last_run": None,
        "completed_symbols": [],
        "failed_symbols": [],
        "batch_size": 5,
        "timeframe": "15m",
        "provider": "tradingview",
        "sync_days": 180,
        "failed_reasons": {},
        "last_batch_logs": [],
        "catchup_status": "idle",
        "catchup_last_run": None,
        "catchup_progress": {"processed": 0, "total": 0, "remaining": 0},
        "scheduler": {
            "enabled": False,
            "run_time": "15:45",
            "timezone": "Africa/Cairo",
            "last_run_date": None,
            "total_runs": 0,
            "status": "idle",
            "last_run_at": None,
            "last_run_status": None,
        },
        "run_history": [],
        "scheduler_logs": [],
    }


def load_state() -> Dict[str, Any]:
    state = _default_state()
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                loaded = json.load(f)
                state.update(loaded)
                if "scheduler" in loaded and isinstance(loaded["scheduler"], dict):
                    state["scheduler"] = {**_default_state()["scheduler"], **loaded["scheduler"]}
        except Exception:
            pass
    return state


def save_state(state: Dict[str, Any]):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=4)
    except Exception as e:
        print(f"Error saving intraday sync state: {e}")


def append_run_history(entry: Dict[str, Any]):
    state = load_state()
    history = list(state.get("run_history") or [])
    history.insert(0, entry)
    state["run_history"] = history[:MAX_RUN_HISTORY]
    save_state(state)


def append_scheduler_log(msg: str):
    ts = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    state = load_state()
    logs = list(state.get("scheduler_logs") or [])
    logs.insert(0, line)
    state["scheduler_logs"] = logs[:MAX_SCHEDULER_LOGS]
    save_state(state)
    print(line)


def get_last_market_close_date() -> dt.date:
    last_date = dt.date.today()
    stock_ai._init_supabase()
    if not stock_ai.supabase:
        return last_date
    try:
        last_daily = (
            stock_ai.supabase.table("stock_prices")
            .select("date")
            .eq("exchange", "EGX")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if last_daily.data:
            last_date_str = last_daily.data[0]["date"]
            last_date = dt.datetime.strptime(last_date_str, "%Y-%m-%d").date()
    except Exception as e:
        print(f"[INTRADAY] Failed to query last market close: {e}")
    return last_date


def get_intraday_stats_map(timeframe: str) -> Dict[str, dict]:
    stats_map: Dict[str, dict] = {}
    stock_ai._init_supabase()
    if not stock_ai.supabase:
        return stats_map
    try:
        res = stock_ai.supabase.rpc(
            "get_intraday_symbol_stats",
            {"p_exchange": "EGX", "p_timeframe": timeframe},
        ).execute()
        if res.data:
            stats_map = {row["symbol"]: row for row in res.data}
    except Exception as e:
        print(f"[INTRADAY] Failed to fetch stats from DB: {e}")
    return stats_map


def _parse_last_ts(row: Optional[dict]) -> Optional[dt.datetime]:
    if not row or not row.get("last_ts"):
        return None
    try:
        import dateutil.parser
        return dateutil.parser.isoparse(row["last_ts"])
    except Exception:
        return None


def symbol_needs_catchup(sym: str, stats_map: Dict[str, dict], last_close: dt.date) -> bool:
    row = stats_map.get(sym)
    last_ts = _parse_last_ts(row)
    if not last_ts:
        return True
    return last_ts.date() < last_close


def compute_symbol_date_range(
    sym: str,
    stats_map: Dict[str, dict],
    last_close: dt.date,
    smart: bool = True,
    fallback_days: int = 180,
) -> Tuple[dt.date, dt.date]:
    """Return (start_date, end_date) for a symbol sync."""
    end_date = last_close
    if smart:
        last_ts = _parse_last_ts(stats_map.get(sym))
        if last_ts:
            start_date = last_ts.date() - dt.timedelta(days=1)
            if start_date > end_date:
                start_date = end_date
            return start_date, end_date
    start_date = end_date - dt.timedelta(days=fallback_days)
    return start_date, end_date


def sync_symbol_intraday(
    sym: str,
    timeframe: str,
    provider: str,
    start_date: dt.date,
    end_date: dt.date,
    max_days: int = 365,
) -> Tuple[bool, str]:
    return fetch_intraday_prices(
        sym,
        timeframe=timeframe,
        start_date=start_date,
        end_date=end_date,
        provider=provider,
        max_days=max_days,
    )


def _fetch_egx_symbols() -> List[str]:
    """
    Fetch all EGX symbols reliably.
    Primary Strategy: Load from local JSON file using symbols_local.
    Fallback Strategy: Fetch from stock_fundamentals and stock_prices from Supabase.
    """
    try:
        from api.symbols_local import load_symbols_for_country
        data = load_symbols_for_country("Egypt")
        symbols = []
        for item in data:
            sym = item.get("Symbol") or item.get("symbol") or item.get("Code")
            ex = item.get("Exchange") or item.get("exchange")
            if sym and (ex == "EGX" or not ex):
                symbols.append(sym)
        if symbols:
            unique_symbols = sorted(list(set(symbols)))
            print(f"[INTRADAY] Loaded {len(unique_symbols)} EGX symbols from local Egypt file.")
            return unique_symbols
    except Exception as e:
        print(f"[INTRADAY] Failed to load symbols using symbols_local: {e}")

    print("[INTRADAY] Falling back to Supabase database query for EGX symbols...")
    stock_ai._init_supabase()
    if not stock_ai.supabase:
        return []

    try:
        res = (
            stock_ai.supabase.table("stock_fundamentals")
            .select("symbol")
            .eq("exchange", "EGX")
            .execute()
        )
        if res.data:
            syms = sorted(list(set(row["symbol"] for row in res.data if row.get("symbol"))))
            if syms:
                print(f"[INTRADAY] Got {len(syms)} EGX symbols from stock_fundamentals")
                return syms
    except Exception as e:
        print(f"[INTRADAY] stock_fundamentals query failed: {e}")

    try:
        all_syms: set = set()
        page = 0
        PAGE_SIZE = 1000
        while True:
            res = (
                stock_ai.supabase.table("stock_prices")
                .select("symbol")
                .eq("exchange", "EGX")
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
                .execute()
            )
            if not res.data:
                break
            for row in res.data:
                if row.get("symbol"):
                    all_syms.add(row["symbol"])
            if len(res.data) < PAGE_SIZE:
                break
            page += 1
        syms = sorted(list(all_syms))
        print(f"[INTRADAY] Got {len(syms)} EGX symbols from stock_prices (paginated, {page+1} pages)")
        return syms
    except Exception as e:
        print(f"[INTRADAY] stock_prices paginated query failed: {e}")
        return []


def _build_sync_queue(
    db_symbols: List[str],
    stats_map: Dict[str, dict],
    failed: set,
    catchup_only: bool = False,
    last_close: Optional[dt.date] = None,
) -> List[str]:
    db_completed = set(stats_map.keys())
    missing = [sym for sym in db_symbols if sym not in db_completed and sym not in failed]

    if catchup_only and last_close:
        outdated = [
            sym
            for sym in db_symbols
            if sym not in failed and symbol_needs_catchup(sym, stats_map, last_close)
        ]
        outdated.sort(
            key=lambda s: _parse_last_ts(stats_map.get(s)) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)
        )
        return outdated

    if missing:
        return missing

    def get_last_ts(sym):
        ts = _parse_last_ts(stats_map.get(sym))
        return ts or dt.datetime.min.replace(tzinfo=dt.timezone.utc)

    completed_syms = [sym for sym in db_symbols if sym in db_completed]
    completed_syms.sort(key=get_last_ts)
    return completed_syms


def _process_symbol_batch(
    batch: List[str],
    timeframe: str,
    provider: str,
    stats_map: Dict[str, dict],
    last_close: dt.date,
    smart_dates: bool,
    fallback_days: int,
) -> Tuple[List[str], set, set, Dict[str, str]]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    processed_logs: List[str] = []
    completed = set(stats_map.keys())
    failed: set = set()
    failed_reasons: Dict[str, str] = {}

    def sync_one(sym):
        start_date, end_date = compute_symbol_date_range(
            sym, stats_map, last_close, smart=smart_dates, fallback_days=fallback_days
        )
        return sym, sync_symbol_intraday(
            sym, timeframe, provider, start_date, end_date, max_days=fallback_days
        )

    with ThreadPoolExecutor(max_workers=max(1, len(batch))) as executor:
        futures = {executor.submit(sync_one, sym): sym for sym in batch}
        for future in as_completed(futures):
            sym = futures[future]
            try:
                sym, (success, msg) = future.result()
                if success:
                    completed.add(sym)
                    failed.discard(sym)
                    failed_reasons.pop(sym, None)
                    processed_logs.append(f"{sym}: Success - {msg}")
                else:
                    failed.add(sym)
                    failed_reasons[sym] = msg
                    processed_logs.append(f"{sym}: Failed - {msg}")
            except Exception as e:
                failed.add(sym)
                failed_reasons[sym] = str(e)
                processed_logs.append(f"{sym}: Exception - {e}")

    return processed_logs, completed, failed, failed_reasons


def run_intraday_sync_batch() -> Dict[str, Any]:
    stock_ai._init_supabase()
    state = load_state()
    if state.get("status") != "syncing":
        return {"status": state.get("status"), "message": "Sync is not active (status is idle)."}

    db_symbols = _fetch_egx_symbols()
    if not db_symbols:
        return {"status": "error", "message": "No EGX symbols found."}

    batch_size = int(state.get("batch_size", 5))
    timeframe = state.get("timeframe", "15m")
    provider = normalize_provider(state.get("provider"))
    fallback_days = int(state.get("sync_days", 180))
    failed = set(state.get("failed_symbols", []))
    failed_reasons = dict(state.get("failed_reasons", {}))

    stats_map = get_intraday_stats_map(timeframe)
    last_close = get_last_market_close_date()
    remaining = _build_sync_queue(db_symbols, stats_map, failed, catchup_only=False)

    if not remaining:
        state["status"] = "idle"
        save_state(state)
        return {"status": "idle", "message": "All symbols processed successfully! Sync completed."}

    batch = remaining[:batch_size]
    processed_logs, completed, batch_failed, batch_failed_reasons = _process_symbol_batch(
        batch,
        timeframe,
        provider,
        stats_map,
        last_close,
        smart_dates=True,
        fallback_days=fallback_days,
    )

    failed.update(batch_failed)
    failed_reasons.update(batch_failed_reasons)

    timestamp = dt.datetime.now().strftime("%I:%M:%S %p")
    state["completed_symbols"] = sorted(list(completed))
    state["failed_symbols"] = sorted(list(failed))
    state["failed_reasons"] = failed_reasons
    state["last_batch_logs"] = [f"[{timestamp}] {log}" for log in processed_logs]
    state["last_run"] = dt.datetime.now().isoformat()
    save_state(state)

    return {
        "status": "syncing",
        "processed": processed_logs,
        "completed_count": len(completed),
        "failed_count": len(failed),
        "total_count": len(db_symbols),
        "remaining_count": len(remaining) - len(batch),
        "provider": provider,
    }


def run_smart_catchup_batch() -> Dict[str, Any]:
    """Process one batch of symbols that need catch-up (last_ts < last market close)."""
    stock_ai._init_supabase()
    state = load_state()

    db_symbols = _fetch_egx_symbols()
    if not db_symbols:
        return {"done": True, "message": "No EGX symbols found."}

    batch_size = int(state.get("batch_size", 5))
    timeframe = state.get("timeframe", "15m")
    provider = normalize_provider(state.get("provider"))
    fallback_days = int(state.get("sync_days", 180))
    failed = set(state.get("failed_symbols", []))
    failed_reasons = dict(state.get("failed_reasons", {}))

    stats_map = get_intraday_stats_map(timeframe)
    last_close = get_last_market_close_date()
    remaining = _build_sync_queue(
        db_symbols, stats_map, failed, catchup_only=True, last_close=last_close
    )

    total_needing = len(remaining)
    if not remaining:
        state["catchup_progress"] = {"processed": total_needing, "total": total_needing, "remaining": 0}
        save_state(state)
        return {"done": True, "message": "All symbols are up to date.", "remaining": 0}

    batch = remaining[:batch_size]
    processed_logs, completed, batch_failed, batch_failed_reasons = _process_symbol_batch(
        batch,
        timeframe,
        provider,
        stats_map,
        last_close,
        smart_dates=True,
        fallback_days=fallback_days,
    )

    failed.update(batch_failed)
    failed_reasons.update(batch_failed_reasons)

    timestamp = dt.datetime.now().strftime("%I:%M:%S %p")
    state["completed_symbols"] = sorted(list(completed))
    state["failed_symbols"] = sorted(list(failed))
    state["failed_reasons"] = failed_reasons
    state["last_batch_logs"] = [f"[{timestamp}] [CATCHUP] {log}" for log in processed_logs]
    state["last_run"] = dt.datetime.now().isoformat()
    state["catchup_last_run"] = state["last_run"]

    remaining_after = max(0, total_needing - len(batch))
    processed_so_far = total_needing - remaining_after
    state["catchup_progress"] = {
        "processed": processed_so_far,
        "total": total_needing,
        "remaining": remaining_after,
    }
    save_state(state)

    return {
        "done": remaining_after == 0,
        "processed": processed_logs,
        "remaining": remaining_after,
        "total_needing": total_needing,
        "last_close": last_close.isoformat(),
        "provider": provider,
    }


def _smart_catchup_worker(source: str = "manual"):
    state = load_state()
    state["catchup_status"] = "running"
    save_state(state)
    append_scheduler_log(f"[CATCHUP] Started ({source})")

    success_count = 0
    fail_count = 0
    try:
        while True:
            res = run_smart_catchup_batch()
            if res.get("processed"):
                for log in res["processed"]:
                    if "Success" in log:
                        success_count += 1
                    elif "Failed" in log or "Exception" in log:
                        fail_count += 1
            if res.get("done"):
                append_scheduler_log(
                    f"[CATCHUP] Completed ({source}): {success_count} ok, {fail_count} failed"
                )
                append_run_history(
                    {
                        "run_at": dt.datetime.now().isoformat(),
                        "status": "ok" if fail_count == 0 else "partial",
                        "source": source,
                        "summary": f"{success_count} synced, {fail_count} failed",
                        "success_count": success_count,
                        "fail_count": fail_count,
                    }
                )
                break
            time.sleep(20)
    except Exception as e:
        append_scheduler_log(f"[CATCHUP] Error ({source}): {e}")
        append_run_history(
            {
                "run_at": dt.datetime.now().isoformat(),
                "status": "error",
                "source": source,
                "summary": str(e),
            }
        )
    finally:
        state = load_state()
        state["catchup_status"] = "idle"
        save_state(state)


def start_smart_catchup_job(source: str = "manual") -> Tuple[bool, str]:
    global _catchup_thread
    with _catchup_lock:
        state = load_state()
        if state.get("catchup_status") == "running":
            return False, "Smart catch-up is already running"
        _catchup_thread = threading.Thread(
            target=_smart_catchup_worker, args=(source,), daemon=True
        )
        _catchup_thread.start()
        return True, "Smart catch-up started in background"


def start_intraday_downloader():
    global _downloader_thread
    with _downloader_lock:
        if _downloader_thread is not None and _downloader_thread.is_alive():
            return
        _downloader_thread = threading.Thread(target=_downloader_worker_loop, daemon=True)
        _downloader_thread.start()
        print("[INTRADAY DOWNLOADER] Thread started successfully.")


def _downloader_worker_loop():
    print("[INTRADAY DOWNLOADER] Worker loop started. Waiting 45s for app startup...")
    time.sleep(45)
    while True:
        try:
            state = load_state()
            if state.get("status") == "syncing":
                print("[INTRADAY DOWNLOADER] Running batch sync...")
                res = run_intraday_sync_batch()
                print("[INTRADAY DOWNLOADER] Batch sync result:", res)
        except Exception as e:
            print("[INTRADAY DOWNLOADER] Error in loop:", e)
        time.sleep(300)
