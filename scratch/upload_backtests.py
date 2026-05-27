import os
import json
import datetime
from dotenv import load_dotenv

# Load env file from parent directory
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(project_root, ".env")
load_dotenv(dotenv_path=env_path)

from api.stock_ai import _init_supabase, supabase

def upload_local_backtests():
    # Force reinitialize Supabase after env is loaded
    _init_supabase(force=True)
    from api.stock_ai import supabase as active_supabase
    if not active_supabase:
        print("Error: Supabase is not initialized. Check your environment variables.")
        return
    
    # Alias active_supabase to supabase inside this function
    supabase = active_supabase

    local_dir = os.path.join(project_root, "backtests_local")
    if not os.path.isdir(local_dir):
        print(f"No directory found at {local_dir}")
        return

    files = [f for f in os.listdir(local_dir) if f.lower().endswith(".json")]
    if not files:
        print("No local backtest files found to upload.")
        return

    print(f"Found {len(files)} files to upload...")

    for fn in files:
        path = os.path.join(local_dir, fn)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                j = json.load(fh)
            
            # Extract fields
            model_name = j.get("model") or j.get("model_name") or (j.get("result") or {}).get("model_name")
            if not model_name:
                print(f"Skipping {fn} - missing model name.")
                continue

            result_payload = j.get("result") or j
            exchange = result_payload.get("exchange") or "EGX"
            start_date = result_payload.get("start_date")
            end_date = result_payload.get("end_date") or datetime.datetime.utcnow().date().isoformat()
            total_trades = result_payload.get("total_trades") or 0
            win_rate = result_payload.get("win_rate") or 0.0
            net_profit = result_payload.get("net_profit") or 0.0
            avg_return = result_payload.get("avg_return_per_trade") or 0.0
            trades = result_payload.get("trades_log") or result_payload.get("trades") or []
            
            # Simple check if already in Supabase
            check = supabase.table("backtests").select("id").eq("model_name", model_name).eq("start_date", start_date).eq("end_date", end_date).execute()
            if check.data:
                print(f"Backtest {model_name} ({start_date} to {end_date}) already exists in Supabase. Skipping.")
                continue

            # Upload
            payload = {
                "model_name": model_name,
                "exchange": exchange,
                "start_date": start_date,
                "end_date": end_date,
                "total_trades": total_trades,
                "win_rate": win_rate,
                "net_profit": net_profit,
                "avg_return_per_trade": avg_return,
                "trades_log": trades,
                "status": "completed",
                "profit_pct": result_payload.get("profit_pct") or net_profit,
                "benchmark_return_pct": result_payload.get("benchmark_return_pct"),
                "benchmark_name": result_payload.get("benchmark_name"),
            }

            res = supabase.table("backtests").insert(payload).execute()
            if res.data:
                print(f"Successfully uploaded: {model_name} ({start_date} to {end_date})")
                # Optionally delete or rename the file so we don't process it next time
                try:
                    os.rename(path, path + ".uploaded")
                except Exception as e:
                    print(f"Could not rename file {fn}: {e}")
            else:
                print(f"Failed to upload {fn}")

        except Exception as e:
            print(f"Error processing {fn}: {e}")

if __name__ == "__main__":
    upload_local_backtests()
