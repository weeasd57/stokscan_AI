#!/usr/bin/env python
"""
CLI entry point to execute the stock scan daily bot run.
Calculates indicators, evaluates old recommendations, and syncs prices.

Usage:
    python run_daily_bot_job.py              # Normal run
    python run_daily_bot_job.py --dry-run    # Dry run (no trades)
    python run_daily_bot_job.py --model KING # Run specific model only
"""
import os
import sys
import time
import asyncio
import argparse
import logging
from datetime import datetime, timezone
from dotenv import load_dotenv

# Ensure correct path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

# Force UTF-8 encoding on standard output and error to prevent UnicodeEncodeError under Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Load environment variables
load_dotenv(os.path.join(project_root, ".env"))
from api.scripts.update_market_cache import main as update_market_cache

# ── Logging Setup ──────────────────────────────────────────────────────────
LOG_DIR = os.path.join(project_root, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

log_filename = os.path.join(
    LOG_DIR,
    f"daily_bot_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.log"
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_filename, encoding="utf-8"),
    ],
)

logger = logging.getLogger("daily_bot_job")

from api.daily_bot_run import run_daily_job as _run_daily_job_inner


def _init_telegram_bridge():
    """Initialize Telegram bridge if ARTORO_AI_BOT token is present and bridge not already running."""
    try:
        from api.telegram_bot import get_telegram_bot, start_telegram_bridge
        if get_telegram_bot():
            return
        token = os.getenv("ARTORO_AI_BOT", "").strip()
        if token:
            start_telegram_bridge(token, None)
            logger.info("Telegram bridge initialized for CLI job")
    except Exception as e:
        logger.warning(f"Failed to initialize Telegram bridge: {e}")


def _flush_telegram_queue(timeout: int = 10):
    """Wait for the Telegram outbound queue to drain before script termination."""
    try:
        from api.telegram_bot import get_telegram_bot
        bot = get_telegram_bot()
        if not bot:
            return
        deadline = time.time() + timeout
        while time.time() < deadline and len(bot._queue) > 0:
            time.sleep(0.5)
        if len(bot._queue) > 0:
            logger.warning(f"Telegram queue still has {len(bot._queue)} messages after {timeout}s wait")
    except Exception as e:
        logger.warning(f"Telegram queue flush error: {e}")

# ── CLI Argument Parsing ───────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(
        description="Run the daily AI bot job: scan stocks, evaluate positions, sync prices."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without executing actual trades (simulation mode)."
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Run only a specific model (e.g., KING, NANO, THE_BOT)."
    )
    parser.add_argument(
        "--skip-sync",
        action="store_true",
        help="Skip price synchronization step."
    )
    return parser.parse_args()

# ── Main ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    args = parse_args()

    logger.info("=" * 60)
    logger.info("🚀 Daily Bot Job Started")
    logger.info(f"   Dry run: {args.dry_run}")
    logger.info(f"   Model filter: {args.model or 'ALL'}")
    logger.info(f"   Skip sync: {args.skip_sync}")
    logger.info(f"   Log file: {log_filename}")
    logger.info("=" * 60)

    start_time = datetime.now(timezone.utc)

    try:
        _init_telegram_bridge()
        asyncio.run(_run_daily_job_inner(
            dry_run=args.dry_run,
            model_filter=args.model,
            skip_sync=args.skip_sync,
        ))
        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        logger.info(f"✅ Daily Bot Job completed successfully in {elapsed:.1f}s")
        # Refresh market cache after successful bot execution
        try:
            update_market_cache()
            logger.info("✅ Market cache refreshed successfully")
        except Exception as e:
            logger.error(f"❌ Failed to refresh market cache: {e}", exc_info=True)
        _flush_telegram_queue(timeout=10)
        sys.exit(0)

    except KeyboardInterrupt:
        logger.warning("⚠️  Job interrupted by user (Ctrl+C)")
        _flush_telegram_queue(timeout=5)
        sys.exit(130)

    except Exception as e:
        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        logger.error(f"❌ Daily Bot Job FAILED after {elapsed:.1f}s: {e}", exc_info=True)
        _flush_telegram_queue(timeout=5)
        sys.exit(1)
