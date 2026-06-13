#!/usr/bin/env python
"""
Simple CLI wrapper to run the Live Trading Bot
Usage: python run_live_bot.py --execution_mode VIRTUAL --model_path api/models/model_EGX.pkl
"""
import argparse
import sys
import os
import time
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from api.live_bot import LiveBot, BotConfig


def main():
    parser = argparse.ArgumentParser(description="Run Live Trading Bot")
    parser.add_argument(
        "--execution_mode",
        type=str,
        default="VIRTUAL",
        choices=["VIRTUAL", "TELEGRAM", "BOTH"],
        help="Execution mode (VIRTUAL for paper trading)"
    )
    parser.add_argument(
        "--model_path",
        type=str,
        default="api/models/model_EGX.pkl",
        help="Path to model file"
    )
    parser.add_argument(
        "--bot_id",
        type=str,
        default="primary",
        help="Bot ID"
    )
    parser.add_argument(
        "--virtual_cash",
        type=float,
        default=10000.0,
        help="Starting cash for virtual trading"
    )
    parser.add_argument(
        "--poll_seconds",
        type=int,
        default=120,
        help="Seconds between scans"
    )
    
    args = parser.parse_args()
    
    # EGX30 Stock Symbols (Top liquid stocks)
    egx_symbols = [
        "CIB", "COMI", "HDB", "OCDI", "ETEL", "ORWE", "ESRS",
        "PHDC", "HRHO", "SWDY", "TMGH", "AMER", "FWRY", "EAST",
        "AUTO", "EKHO", "JUFO", "MFPC", "BTFH", "MNHD"
    ]
    
    # Create bot configuration
    config = BotConfig(
        execution_mode=args.execution_mode,
        king_model_path=args.model_path,
        virtual_cash=args.virtual_cash,
        poll_seconds=args.poll_seconds,
        save_to_supabase=True,
        save_trades_to_supabase=True,
        use_schedule=True,  # Enable EGX market hours
        schedule_start_time="10:00",
        schedule_end_time="14:30",
        schedule_timezone="Africa/Cairo",
        schedule_days=[6, 0, 1, 2, 3],  # Sunday-Thursday (Cairo week)
        coins=egx_symbols,  # EGX30 stocks to monitor
        data_source="egx",  # Use EGX data source
    )
    
    print("=" * 80)
    print("🚀 STOKSCAN AI - LIVE TRADING BOT")
    print("=" * 80)
    print(f"📊 Mode: {args.execution_mode}")
    print(f"🤖 Model: {args.model_path}")
    print(f"💰 Starting Cash: {args.virtual_cash:,.2f} EGP")
    print(f"📈 Monitoring: {len(egx_symbols)} EGX30 stocks")
    print(f"⏰ Poll Interval: {args.poll_seconds} seconds")
    print(f"🕐 Market Hours: 10:00 AM - 2:30 PM (Cairo Time, Sun-Thu)")
    print("=" * 80)
    print()
    
    # Create and start bot
    bot = LiveBot(bot_id=args.bot_id, config=config)
    
    try:
        print("✅ Starting bot...")
        bot.start()
        
        print("✅ Bot is now running!")
        print("📝 Press Ctrl+C to stop")
        print()
        
        # Keep running until interrupted
        while True:
            time.sleep(1)
            
            # Print status every 60 seconds
            if int(time.time()) % 60 == 0:
                status = bot.get_status()
                print(f"\n📊 Status: {status['status']} | "
                      f"Activity: {status.get('current_activity', 'Unknown')} | "
                      f"Open Positions: {status.get('open_positions', 0)}")
                
    except KeyboardInterrupt:
        print("\n\n⚠️  Stopping bot...")
        bot.stop()
        print("✅ Bot stopped successfully")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        bot.stop()
        sys.exit(1)


if __name__ == "__main__":
    main()
