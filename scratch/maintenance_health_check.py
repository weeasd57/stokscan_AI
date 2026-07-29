import sys
import os
import json
from datetime import datetime

# Force UTF-8 encoding
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api.stock_ai import _init_supabase, supabase

def run_health_check():
    print("=" * 60)
    print("🛡️ EGXBots Daily Maintenance & Health Audit")
    print(f"Timestamp: {datetime.utcnow().isoformat()} UTC")
    print("=" * 60)

    _init_supabase()
    
    tables_to_check = [
        "stock_prices",
        "stock_fundamentals",
        "stock_technical_indicators",
        "scan_results",
        "market_cache",
        "daily_job_runs",
        "backtests",
        "market_heatmap",
        "model_metadata",
        "system_config"
    ]
    
    print("\n📊 1. Supabase Database Table Audits:")
    print("-" * 60)
    for table in tables_to_check:
        try:
            res = supabase.table(table).select("*", count="exact").limit(1).execute()
            count = res.count if res.count is not None else len(res.data)
            print(f"  • {table:<30}: {count:>8} records")
        except Exception as e:
            print(f"  • {table:<30}: ❌ Error: {e}")

    print("\n📅 2. Latest Data Timestamps:")
    print("-" * 60)
    try:
        res = supabase.table("stock_prices").select("date").order("date", desc=True).limit(1).execute()
        if res.data:
            print(f"  • Latest Stock Price Date       : {res.data[0]['date']}")
    except Exception as e:
        print(f"  • Latest Stock Price Date       : ❌ {e}")

    try:
        res = supabase.table("daily_job_runs").select("*").order("created_at", desc=True).limit(1).execute()
        if res.data:
            run = res.data[0]
            print(f"  • Last Daily Job Run            : {run.get('created_at')} | Status: {run.get('status')} | Details: {run.get('summary', '')[:50]}")
        else:
            print("  • Last Daily Job Run            : No run records found")
    except Exception as e:
        print(f"  • Last Daily Job Run            : ❌ {e}")

    print("\n💱 3. Market Cache Audit:")
    print("-" * 60)
    try:
        res = supabase.table("market_cache").select("cache_key, updated_at").execute()
        if res.data:
            for item in res.data:
                print(f"  • Cache Key: {item.get('cache_key'):<25} | Updated: {item.get('updated_at')}")
        else:
            print("  • Market Cache                  : Empty")
    except Exception as e:
        print(f"  • Market Cache                  : ❌ {e}")

    print("\n🤖 4. Model Metadata Check:")
    print("-" * 60)
    try:
        res = supabase.table("model_metadata").select("model_name, updated_at, win_rate, total_signals").execute()
        if res.data:
            for model in res.data:
                print(f"  • Model: {model.get('model_name'):<15} | Win Rate: {model.get('win_rate')}% | Signals: {model.get('total_signals')} | Updated: {model.get('updated_at')}")
        else:
            print("  • Model Metadata                : No records found")
    except Exception as e:
        print(f"  • Model Metadata                : ❌ {e}")

    print("=" * 60)
    print("✅ Audit completed.")

if __name__ == "__main__":
    run_health_check()
