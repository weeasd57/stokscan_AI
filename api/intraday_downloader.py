import os
import json
import time
import threading
import datetime as dt
from typing import Dict, List, Any
import api.stock_ai as stock_ai
from api.tradingview_integration import fetch_tradingview_prices

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "intraday_sync_state.json")

_downloader_thread = None
_downloader_lock = threading.Lock()

def load_state() -> Dict[str, Any]:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "status": "idle",
        "last_run": None,
        "completed_symbols": [],
        "failed_symbols": [],
        "batch_size": 5,
        "timeframe": "15m"
    }

def save_state(state: Dict[str, Any]):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=4)
    except Exception as e:
        print(f"Error saving intraday sync state: {e}")

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

    # ── Primary Fallback: stock_fundamentals (1 row / symbol, fast) ──────────────────
    try:
        res = stock_ai.supabase.table("stock_fundamentals") \
            .select("symbol") \
            .eq("exchange", "EGX") \
            .execute()
        if res.data:
            syms = sorted(list(set(row["symbol"] for row in res.data if row.get("symbol"))))
            if syms:
                print(f"[INTRADAY] Got {len(syms)} EGX symbols from stock_fundamentals")
                return syms
    except Exception as e:
        print(f"[INTRADAY] stock_fundamentals query failed: {e}")

    # ── Secondary Fallback: paginate stock_prices ──────────────────────────────────────
    try:
        all_syms: set = set()
        page = 0
        PAGE_SIZE = 1000
        while True:
            res = stock_ai.supabase.table("stock_prices") \
                .select("symbol") \
                .eq("exchange", "EGX") \
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1) \
                .execute()
            if not res.data:
                break
            for row in res.data:
                if row.get("symbol"):
                    all_syms.add(row["symbol"])
            if len(res.data) < PAGE_SIZE:
                break  # last page
            page += 1
        syms = sorted(list(all_syms))
        print(f"[INTRADAY] Got {len(syms)} EGX symbols from stock_prices (paginated, {page+1} pages)")
        return syms
    except Exception as e:
        print(f"[INTRADAY] stock_prices paginated query failed: {e}")
        return []


def run_intraday_sync_batch() -> Dict[str, Any]:
    stock_ai._init_supabase()
    state = load_state()
    if state.get("status") != "syncing":
        return {"status": state.get("status"), "message": "Sync is not active (status is idle)."}

    # 1. Fetch all EGX symbols from local file (or fallback DB)
    db_symbols = _fetch_egx_symbols()

    if not db_symbols:
        return {"status": "error", "message": "No EGX symbols found."}

    batch_size = state.get("batch_size", 5)
    timeframe = state.get("timeframe", "15m")
    failed = set(state.get("failed_symbols", []))

    # 2. Get current DB stats to dynamically prioritize
    stats_list = []
    try:
        res = stock_ai.supabase.rpc("get_intraday_symbol_stats", {"p_exchange": "EGX", "p_timeframe": timeframe}).execute()
        if res.data:
            stats_list = res.data
    except Exception as e:
        print(f"[INTRADAY] Failed to fetch stats from DB: {e}")

    stats_map = {row["symbol"]: row for row in stats_list}
    db_completed = set(stats_map.keys())

    # 3. Classify remaining symbols
    # Missing: not in DB, and not in failed
    missing = [sym for sym in db_symbols if sym not in db_completed and sym not in failed]
    
    if missing:
        remaining = missing
        print(f"[INTRADAY] {len(missing)} missing symbols to sync. Prioritizing.")
    else:
        # Outdated or completed update queue: sort by last_ts ascending (oldest first)
        import dateutil.parser
        def get_last_ts(sym):
            row = stats_map.get(sym)
            if not row or not row.get("last_ts"):
                return dt.datetime.min.replace(tzinfo=dt.timezone.utc)
            try:
                # Handle potential timezone offsets or trailing Z
                ts_str = row["last_ts"]
                return dateutil.parser.isoparse(ts_str)
            except Exception:
                return dt.datetime.min.replace(tzinfo=dt.timezone.utc)
        
        completed_syms = [sym for sym in db_symbols if sym in db_completed]
        completed_syms.sort(key=get_last_ts)
        remaining = completed_syms
        print(f"[INTRADAY] No missing symbols. Refreshing completed symbols (oldest first).")

    if not remaining:
        state["status"] = "idle"
        save_state(state)
        return {
            "status": "idle",
            "message": "All symbols processed successfully! Sync completed."
        }

    # Process next batch
    batch = remaining[:batch_size]
    processed_this_run = []

    # Get last trading day from stock_prices
    last_date = dt.date.today()
    try:
        last_daily = stock_ai.supabase.table("stock_prices").select("date").eq("exchange", "EGX").order("date", desc=True).limit(1).execute()
        if last_daily.data:
            last_date_str = last_daily.data[0]["date"]
            last_date = dt.datetime.strptime(last_date_str, "%Y-%m-%d").date()
            print(f"[INTRADAY] Last daily trading day found: {last_date}")
        else:
            print(f"[INTRADAY] No daily stock_prices found, defaulting to today: {last_date}")
    except Exception as e:
        print(f"[INTRADAY] Failed to query last daily trading day: {e}, defaulting to today: {last_date}")

    # Compute start_date = last_date - 6 months (180 days)
    start_date = last_date - dt.timedelta(days=180)
    print(f"[INTRADAY] Sync range: {start_date} to {last_date}")

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def sync_one(sym):
        tv_symbol = f"{sym}.CA"
        success, msg = fetch_tradingview_prices(
            tv_symbol,
            max_days=365,
            timeframe=timeframe,
            start_date=start_date,
            end_date=last_date
        )
        return sym, success, msg

    # Using ThreadPoolExecutor to run them in parallel
    completed = set(db_completed)
    with ThreadPoolExecutor(max_workers=len(batch)) as executor:
        futures = {executor.submit(sync_one, sym): sym for sym in batch}
        for future in as_completed(futures):
            sym = futures[future]
            try:
                sym, success, msg = future.result()
                if success:
                    completed.add(sym)
                    failed.discard(sym)
                    processed_this_run.append(f"{sym}: Success - {msg}")
                else:
                    failed.add(sym)
                    processed_this_run.append(f"{sym}: Failed - {msg}")
            except Exception as e:
                failed.add(sym)
                processed_this_run.append(f"{sym}: Exception - {e}")

    state["completed_symbols"] = sorted(list(completed))
    state["failed_symbols"] = sorted(list(failed))
    state["last_run"] = dt.datetime.now().isoformat()
    save_state(state)

    return {
        "status": "syncing",
        "processed": processed_this_run,
        "completed_count": len(completed),
        "failed_count": len(failed),
        "total_count": len(db_symbols),
        "remaining_count": len(remaining) - len(batch)
    }

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
        # Sleep for 5 minutes (300 seconds)
        time.sleep(300)
