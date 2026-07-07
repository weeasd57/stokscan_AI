import os
import sys

# Add root folder to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from api.daily_bot_run import _refresh_market_status_cache
from api.scripts.update_market_cache import main as update_market_cache

def run():
    print("🚀 Rebuilding complete market status and macro correlation cache...")
    ok, msg = _refresh_market_status_cache()
    if ok:
        print(f"✅ Success: {msg}")
    else:
        print(f"❌ Failed: {msg}")

    print("\n🚀 Rebuilding sector heatmap and liquidity timeline cache...")
    try:
        update_market_cache()
        print("✅ Success: Sector heatmap and timeline cache refreshed")
    except Exception as e:
        print(f"❌ Failed: {e}")

if __name__ == "__main__":
    run()
