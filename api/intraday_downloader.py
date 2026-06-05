import os
import json
import time
import threading
import datetime as dt
from typing import Dict, List, Any
from api.stock_ai import supabase, _init_supabase
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

def run_intraday_sync_batch() -> Dict[str, Any]:
    _init_supabase()
    state = load_state()
    if state.get("status") != "syncing":
        return {"status": state.get("status"), "message": "Sync is not active (status is idle)."}

    # 1. Fetch all EGX symbols from database
    try:
        res = supabase.table("stock_prices").select("symbol").eq("exchange", "EGX").execute()
        db_symbols = sorted(list(set(row["symbol"] for row in res.data))) if res.data else []
    except Exception as e:
        print(f"Error fetching EGX symbols: {e}")
        return {"status": "error", "message": f"DB Error: {e}"}

    if not db_symbols:
        return {"status": "error", "message": "No EGX symbols found in DB."}

    completed = set(state.get("completed_symbols", []))
    failed = set(state.get("failed_symbols", []))
    batch_size = state.get("batch_size", 5)
    timeframe = state.get("timeframe", "15m")

    # Filter out already processed
    remaining = [sym for sym in db_symbols if sym not in completed and sym not in failed]

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
    
    for sym in batch:
        # Form TV symbol format (e.g. COMI.CA)
        tv_symbol = f"{sym}.CA"
        # Fetch 1 year of 15m data (365 days)
        success, msg = fetch_tradingview_prices(tv_symbol, max_days=365, timeframe=timeframe)
        
        if success:
            completed.add(sym)
            processed_this_run.append(f"{sym}: Success - {msg}")
        else:
            failed.add(sym)
            processed_this_run.append(f"{sym}: Failed - {msg}")

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
