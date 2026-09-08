import os
import sys
import time
import argparse
import datetime as dt
from dotenv import load_dotenv

# Load env from root
_base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_base_dir, ".env"))
load_dotenv(os.path.join(_base_dir, "web", ".env.local"), override=True)

# Add base directory to sys.path to import api modules
if _base_dir not in sys.path:
    sys.path.insert(0, _base_dir)

from supabase import create_client
from api.daily_bot_run import _send_telegram_exit, _notify_central_telegram

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in env.")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

TARGET_SYMBOLS = [
    "KASABF", "TRTO", "EDBM", "ICID", "MOIN", "GGCC", 
    "MBSC", "OFH", "AIH", "AMOC", "GPIM", "COPR"
]

def get_closed_deals():
    res = (
        supabase.table("scan_results")
        .select("id, symbol, exchange, entry_price, exit_price, target_price, profit_loss_pct, created_at, updated_at, status")
        .in_("symbol", TARGET_SYMBOLS)
        .eq("status", "win")
        .order("profit_loss_pct", desc=True)
        .execute()
    )
    return res.data or []

def send_consolidated_summary(deals):
    web_origin = os.getenv("WEB_ORIGIN", "https://egxbots.com").strip().rstrip("/")
    total_pct = sum(float(d.get("profit_loss_pct", 0.0)) for d in deals)
    
    lines = [
        "🏆 *تقرير الأرباح الاستثنائية المحققة — EGX Bots AI* 🚀",
        "━━━━━━━━━━━━━━━━━━━━",
        "يسرنا مشاركة الأداء القوي لصفقات الروبوت الرابحة التي حققت أهدافها بالكامل:\n"
    ]
    
    for d in deals:
        sym = d["symbol"]
        pl = float(d.get("profit_loss_pct", 0.0))
        entry = float(d.get("entry_price", 0.0))
        exit_p = float(d.get("exit_price", 0.0))
        
        emoji = "👑" if pl >= 100 else "🏆" if pl >= 50 else "🚀" if pl >= 30 else "🟢"
        lines.append(f"{emoji} *{sym}:* `+{pl:.1f}%` (دخول: `{entry:.2f}` ← خروج: `{exit_p:.2f}`)")
        
    lines.extend([
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        f"📊 *إجمالي العائد التراكمي:* `+{total_pct:.1f}%`",
        f"✅ *عدد الصفقات الرابحة:* `{len(deals)} صفقة رابحة` (100% نسبة نجاح)",
        f"🔗 [سجل الصفقات والأداء على المنصة]({web_origin}/scanner/backtests?tab=bots)"
    ])
    
    full_msg = "\n".join(lines)
    print("\n--- Consolidated Message Preview ---")
    print(full_msg)
    print("------------------------------------\n")
    
    print("Sending consolidated message to Telegram...")
    delivered = _notify_central_telegram(full_msg, "weekly_performance_report")
    print(f"Delivered: {delivered}")

def send_individual_alerts(deals):
    print(f"Sending {len(deals)} individual exit alerts with 2s delay...")
    for i, d in enumerate(deals):
        sym = d["symbol"]
        ex = d.get("exchange", "EGX")
        entry = float(d.get("entry_price", 0.0))
        exit_p = float(d.get("exit_price", 0.0))
        pl = float(d.get("profit_loss_pct", 0.0))
        created_at = d.get("created_at")
        
        print(f"[{i+1}/{len(deals)}] Sending exit alert for {sym} (+{pl:.1f}%)...")
        result = _send_telegram_exit(
            symbol=sym,
            exchange=ex,
            entry_price=entry,
            exit_price=exit_p,
            pl_pct=pl,
            status="win",
            created_at=created_at
        )
        print(f"  → Delivered: {result}")
        time.sleep(2)
    print("Done sending individual alerts!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["consolidated", "individual"], default="consolidated",
                        help="Mode: 'consolidated' for single summary, 'individual' for 12 separate messages")
    args = parser.parse_args()
    
    deals = get_closed_deals()
    if not deals:
        print("No matching closed deals found in database.")
        sys.exit(0)
        
    print(f"Found {len(deals)} closed deals.")
    if args.mode == "consolidated":
        send_consolidated_summary(deals)
    else:
        send_individual_alerts(deals)
