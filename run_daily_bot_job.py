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

from api.daily_bot_run import run_daily_job

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
        asyncio.run(run_daily_job(
            dry_run=args.dry_run,
            model_filter=args.model,
            skip_sync=args.skip_sync,
        ))
        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        logger.info(f"✅ Daily Bot Job completed successfully in {elapsed:.1f}s")
        sys.exit(0)

    except KeyboardInterrupt:
        logger.warning("⚠️  Job interrupted by user (Ctrl+C)")
        sys.exit(130)

    except Exception as e:
        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        logger.error(f"❌ Daily Bot Job FAILED after {elapsed:.1f}s: {e}", exc_info=True)
        sys.exit(1)
