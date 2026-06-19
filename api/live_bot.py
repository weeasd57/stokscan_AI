import json
import math
import os
import threading
import time
import traceback
import warnings
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import yfinance as yf

try:
    from tvDatafeed import Interval, TvDatafeed
except ImportError:
    TvDatafeed = None
    Interval = None

# We'll use the existing imports from the core bot logic
# assuming api module structure is available.
from api.model_utils import (
    align_for_king,
    align_pandas_categories_to_booster,
    get_primary_booster,
    reset_booster_cats,
    reset_nested_boosters,
)
from api.stock_ai import (
    _supabase_read_with_retry,
    _supabase_upsert_with_retry,
    supabase,
)
from api.strategy_engine import StrategyEngine
from api.virtual_market_adapter import create_virtual_market_client

warnings.filterwarnings("ignore")


@dataclass
class BotConfig:
    name: str = "Primary Bot"
    user_id: Optional[str] = None
    execution_mode: str = "TELEGRAM"  # "VIRTUAL" | "TELEGRAM" | "BOTH"
    telegram_chat_id: Optional[int] = -1003699330518
    telegram_token: Optional[str] = None
    coins: list[str] = None
    king_threshold: float = 0.85
    council_threshold: float = 0.25
    max_notional_usd: float = 1000.0
    pct_cash_per_trade: float = 0.15
    bars_limit: int = 500
    poll_seconds: int = 120
    timeframe: str = "1Hour"
    use_council: bool = True
    data_source: str = "binance"

    # Risk
    max_open_positions: int = 8
    enable_sells: bool = True
    target_pct: float = 0.10  # 10%
    stop_loss_pct: float = 0.035  # 3.5%
    hold_max_bars: int = 30
    use_trailing: bool = True
    trail_be_pct: float = 0.04
    trail_lock_trigger_pct: float = 0.06
    trail_lock_pct: float = 0.04

    # Virtual market adapter (for paper trading)
    virtual_key_id: Optional[str] = None
    virtual_secret_key: Optional[str] = None

    # Supabase integration
    save_to_supabase: bool = False  # Save polling data to Supabase
    save_trades_to_supabase: bool = True  # NEW: Save trade logs to Supabase

    # ===== Advanced Risk & Strategy =====
    daily_loss_limit: float = 1000.0
    max_consecutive_losses: int = 5
    min_volume_ratio: float = 0.3
    use_rsi_filter: bool = True
    use_trend_filter: bool = False
    use_dynamic_sizing: bool = True
    max_risk_per_trade_pct: float = 0.04

    # ===== Smart Bot Features =====
    # 1. Market Regime Detection
    use_market_regime: bool = True
    regime_adx_threshold: float = (
        14.0  # ADX > this = trending (Loosened for aggressive mode)
    )
    regime_sideways_size_mult: float = 0.5  # Reduce size in sideways

    # 2. Multi-Timeframe Confirmation
    use_mtf_confirmation: bool = False
    mtf_higher_timeframe: str = "4Hour"  # Higher TF to confirm

    # 3. Dynamic ATR-based TP/SL
    use_atr_exits: bool = True
    atr_sl_multiplier: float = 1.5
    atr_tp_multiplier: float = 2.5
    atr_period: int = 14
    exit_mode: str = "hybrid"  # "manual" | "atr_smart" | "hybrid"

    # 4. RSI Divergence
    use_rsi_divergence: bool = True

    # 5. Smart Exit (Momentum)
    use_smart_exit: bool = True
    smart_exit_rsi_threshold: float = 40.0
    smart_exit_volume_spike: float = 3.0

    # 6. Correlation Guard
    use_correlation_guard: bool = True
    max_correlation: float = 0.80

    # 7. Win Rate Feedback
    use_winrate_feedback: bool = False
    winrate_lookback: int = 10
    winrate_low_threshold: float = 0.30
    winrate_high_threshold: float = 0.70

    # 8. Cooldown Mechanism
    cooldown_minutes: int = 30  # Minutes to wait before re-entering the same symbol

    # 9. Time-of-Day Filter
    use_time_filter: bool = False

    # 10. Operating Schedule Filter
    use_schedule: bool = False
    schedule_start_time: str = "10:00"
    schedule_end_time: str = "14:30"
    schedule_timezone: str = "Africa/Cairo"
    schedule_days: Optional[List[int]] = None

    # 11. Signal Quality Score
    use_quality_score: bool = True
    min_quality_score: float = 50.0

    # 12. Partial Position Management
    use_partial_positions: bool = False  # Off by default (advanced)
    partial_entry_pct: float = 0.60
    partial_exit_pct: float = 0.50

    # 13. Monthly Signal Cap (EGX Strategy: Max 20 signals/month)
    monthly_signal_cap: int = 20  # Max entries per month (0 = unlimited)

    # ===== Live-Trading Shock Fixes =====
    # 14. Warm-up: min bars before any prediction (indicators need history)
    warmup_bars: int = 100
    # 15. Slippage buffer: assumed spread/slippage cost (0.5%)
    slippage_buffer_pct: float = 0.005
    # 16. Confidence haircut: subtracted from KING conf in live mode (anti-overfitting)
    live_confidence_haircut: float = 0.05

    # Trading Mode
    trading_mode: str = "aggressive"  # "defensive" | "aggressive" | "hybrid"

    # Model Paths
    king_model_path: str = "api/models/KING.pkl"
    council_model_path: str = "api/models/The_Council_Validator.pkl"

    # Cornix Direct Integration
    cornix_webhook_url: Optional[str] = None
    cornix_uuid: Optional[str] = None
    cornix_secret: Optional[str] = None

    # Virtual Trading Cash
    virtual_cash: float = 10000.0

    # Status
    status: str = "stopped"  # "running" | "stopped"


def _read_env(
    name: str, default: Optional[str] = None, required: bool = False
) -> Optional[str]:
    v = os.getenv(name, default)
    if required and not v:
        # Don't raise here for library usage, just return None or let caller handle
        return None
    return v


def _read_first_env(names: list[str], default: Optional[str] = None) -> Optional[str]:
    for n in names:
        v = os.getenv(n)
        if v:
            return v
    return default


def _parse_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    s = str(value).strip().lower()
    if s in {"1", "true", "yes", "y", "on"}:
        return True
    if s in {"0", "false", "no", "n", "off"}:
        return False
    return bool(default)


def _parse_float(value: Any, default: float) -> float:
    try:
        return float(str(value).strip())
    except Exception:
        return float(default)


def _parse_coins(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return raw
    coins = []
    for part in (str(raw or "")).split(","):
        s = part.strip().upper()
        if not s:
            continue
        coins.append(s)
    return coins


def _normalize_symbol(symbol: str) -> str:
    return (symbol or "").strip().upper().replace("/", "")


def _format_symbol_for_bot(symbol: str) -> str:
    """
    Virtual positions may return crypto like 'BTCUSD'. The bot/data sources generally use 'BTC/USD'.
    """
    s = (symbol or "").strip().upper()
    if not s:
        return s
    if "/" in s:
        return s
    if len(s) > 3 and (s.endswith("USD") or s.endswith("USDT")):
        base = s[:-3] if s.endswith("USD") else s[:-4]
        quote = "USD" if s.endswith("USD") else "USDT"
        return f"{base}/{quote}"
    return s


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        n = float(value)
        if not np.isfinite(n):
            return int(default)
        # Supabase `stock_prices.volume` is a bigint in this project; crypto volume can be fractional.
        return int(round(n))
    except Exception:
        return int(default)


def _to_intraday_timeframe(value: str) -> str:
    """
    Map UI/bot timeframe strings to the DB timeframe string (e.g. '5m', '1h', '1d').
    Accepts UI values like '5Min', '1Hour', '4Hour', as well as already-normalized values like '5m'.
    """
    import re

    s = (value or "").strip().lower()
    if not s:
        return "1h"

    # Already-normalized values
    allowed = {"1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"}
    if s in allowed:
        return s

    m = re.match(r"^\s*(\d+)\s*([a-z]+)\s*$", s)
    if not m:
        # Back-compat: treat legacy labels without a number as 1h/min/day.
        if "day" in s:
            return "1d"
        if "week" in s:
            return "1w"
        if "min" in s:
            return "1m"
        if "hour" in s:
            return "1h"
        return "1h"

    amount = int(m.group(1))
    unit_raw = m.group(2)

    if unit_raw in {"min", "mins", "minute", "minutes", "m"}:
        out = f"{amount}m"
    elif unit_raw in {"hour", "hours", "h"}:
        out = f"{amount}h"
    elif unit_raw in {"day", "days", "d"}:
        out = f"{amount}d" if amount != 1 else "1d"
    elif unit_raw in {"week", "weeks", "w"}:
        out = f"{amount}w" if amount != 1 else "1w"
    else:
        out = "1h"

    # Normalize common equivalents
    if out == "60m":
        out = "1h"
    if out == "24h":
        out = "1d"

    return (
        out
        if out in allowed
        else ("1m" if out.endswith("m") else ("1h" if out.endswith("h") else "1d"))
    )


class LiveBot:
    def __init__(self, bot_id: str = "primary", config: Optional[BotConfig] = None):
        self.bot_id = bot_id
        # Re-entrant: several public methods call `_log()` while holding the lock.
        # A plain Lock would deadlock and make `/bot/status` hang forever.
        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._logs = deque(maxlen=1000)
        self._trades = deque(maxlen=100)
        self._status = "stopped"  # stopped, running, error
        self._last_scan_time = None
        self._error_msg = None
        self._data_stream = {}  # {symbol: {source, count, timestamp, status, error}}
        self._started_at = None  # Track when bot started
        self._current_activity = "Initializing"

        # Default config from env or defaults
        self.config = config or self._build_default_config()

        # Models
        self.king_obj = None
        self.king_clf = None
        self.validator = None
        self.api = None
        self.barrier_mode = "percent"  # Track which mode the trained model used
        # Per-symbol runtime state for exit logic
        self._pos_state: Dict[str, Dict[str, Any]] = {}
        # Cooldown tracker
        self._cooldowns: Dict[str, datetime] = {}
        # Track last saved bar timestamp per symbol to avoid redundant Supabase writes
        self._last_save_bars_ts: Dict[str, str] = {}
        # Track latest prices for the virtual broker provider
        self._latest_prices: Dict[str, float] = {}
        # Warm-up tracker: per-symbol flag to ensure indicators are stable
        self._warmup_complete: Dict[str, bool] = {}
        # In-memory chart bars cache: {symbol: [{ts, open, high, low, close, volume}, ...]}
        # Used by /candles endpoint as fallback when Supabase save is disabled
        self._chart_bars: Dict[str, list] = {}

        # Risk & Limits Trackers
        self._consecutive_losses = 0
        self._daily_loss = 0.0
        self._last_reset_date = datetime.now(timezone.utc).date()

        # Monthly Signal Cap Tracker (EGX Strategy: Max 20 signals/month)
        self._signals_this_month: Dict[str, int] = {}  # {symbol: signal_count}
        self._month_tracking = (
            datetime.now(timezone.utc).year,
            datetime.now(timezone.utc).month,
        )

        # Pending trades queue for Supabase failover (in case upsert fails)
        self._pending_trades = []  # List to persist failed trades
        self._pending_trades_lock = threading.Lock()
        self._retry_pending_trades_event = threading.Event()

        # Telegram Bridge
        self.telegram_bridge = None

        # Load state from DB
        self._load_bot_state()

        # Finally, load last trades from Supabase to populate deque
        self._load_persistent_data()

    @property
    def sb(self):
        import api.stock_ai as stock_ai
        if not stock_ai.supabase:
            stock_ai._init_supabase()
        return stock_ai.supabase

    def _load_persistent_data(self):
        """Loads last trades from Supabase."""
        try:

            def _fetch_trades(sb):
                return (
                    sb.table("bot_trades")
                    .select("*")
                    .eq("bot_id", self.bot_id)
                    .order("timestamp", desc=True)
                    .limit(100)
                    .execute()
                )

            res = _supabase_read_with_retry(_fetch_trades, table_name="bot_trades")
            transformed = []
            if res and res.data:
                # We want them in chronological order for the deque
                trades = sorted(res.data, key=lambda x: x.get("timestamp", ""))

                # Transform DB records back to our internal trade dict format if needed
                for t in trades:
                    meta = t.get("metadata", {}) or {}
                    transformed.append(
                        {
                            "timestamp": t.get("timestamp"),
                            "symbol": t.get("symbol"),
                            "action": t.get("action") or meta.get("action", "UNKNOWN"),
                            "amount": t.get("amount"),
                            "price": t.get("price"),
                            "entry_price": t.get("entry_price"),
                            "pnl": t.get("pnl"),
                            "king_conf": t.get("king_conf"),
                            "council_conf": t.get("council_conf"),
                            "order_id": t.get("order_id"),
                        }
                    )
                self._trades = deque(transformed, maxlen=100)

            # Reconstruction Fallback: If pos_state is empty, try to infer it from history
            if not getattr(self, "_pos_state", None):
                self._log("Position state empty. Reconstructing from trade history...")
                reconstructed = {}  # norm_symbol -> state

                # Filter trades from last 48 hours to ignore "ghost" records from old sessions
                now_utc = datetime.now(timezone.utc)
                cutoff = now_utc - timedelta(hours=48)

                for t in transformed:
                    ts_str = t.get("timestamp")
                    try:
                        ts_dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        if ts_dt < cutoff:
                            continue  # Ignore old trades
                    except:
                        pass

                    action = (t.get("action") or "").upper()
                    sym = _normalize_symbol(t.get("symbol"))
                    oid = t.get("order_id")

                    if action == "BUY":
                        # If we have multiple BUYs for the same symbol (e.g. Signal + Virt),
                        # the latest one in the chronological loop will overwrite.
                        reconstructed[sym] = {
                            "entry_price": float(
                                t.get("price") or t.get("entry_price") or 0
                            ),
                            "entry_time": ts_str,
                            "amount": float(t.get("amount") or 0),
                            "bars_held": 0,
                            "current_stop": None,
                            "trail_mode": "NONE",
                            "symbol": t.get("symbol"),
                            "order_id": oid,
                        }
                    elif action == "SELL":
                        # In 1-pos-per-symbol logic, any SELL for this symbol closes it.
                        reconstructed.pop(sym, None)

                if reconstructed:
                    self._pos_state = reconstructed
                    self._log(
                        f"Recovered {len(reconstructed)} positions from history (48h window)."
                    )
        except Exception as e:
            self._log(f"Error loading trades from Supabase: {e}")

        # Loads last logs from Supabase
        try:

            def _fetch_logs(sb):
                return (
                    sb.table("bot_logs")
                    .select("*")
                    .eq("bot_id", self.bot_id)
                    .order("timestamp", desc=True)
                    .limit(200)
                    .execute()
                )

            res = _supabase_read_with_retry(_fetch_logs, table_name="bot_logs")
            if res and res.data:
                # Chronological for deque
                logs = sorted(res.data, key=lambda x: x.get("timestamp", ""))
                formatted_logs = [l.get("message") for l in logs if l.get("message")]
                self._logs = deque(formatted_logs, maxlen=1000)
        except Exception as e:
            print(f"Error loading logs from Supabase: {e}")

    def _save_bot_state(self):
        """Persist internal bot state to Supabase 'bot_states' table."""
        try:
            # Build a rich snapshot of every open position so a restart can fully recover
            active_trades_snapshot = {}
            for norm_sym, s in self._pos_state.items():
                active_trades_snapshot[norm_sym] = {
                    "symbol": s.get("symbol", norm_sym),
                    "entry_price": s.get("entry_price"),
                    "entry_time": s.get("entry_time"),
                    "notional": s.get("notional"),
                    "bars_held": s.get("bars_held", 0),
                    "last_held_ts": s.get("last_held_ts"),
                    "current_stop": s.get("current_stop"),
                    "target_price": s.get("target_price"),
                    "trail_mode": s.get("trail_mode", "NONE"),
                    "regime": s.get("regime"),
                    "quality_score": s.get("quality_score"),
                    "order_id": s.get("order_id"),
                    "cornix_status": s.get("cornix_status", "ACTIVE"),
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                }

            # Save the current virtual cash balance if broker exists
            cash_val = self.config.virtual_cash
            if self.api and hasattr(self.api, "_cash"):
                cash_val = float(self.api._cash)
            elif hasattr(self, "_virtual_cash"):
                cash_val = self._virtual_cash

            state = {
                "pos_state": active_trades_snapshot,
                "daily_loss": self._daily_loss,
                "consecutive_losses": self._consecutive_losses,
                "last_scan_time": self._last_scan_time,
                "saved_at": datetime.now(timezone.utc).isoformat(),
                "bot_version": "2.1",
                "total_open_positions": len(active_trades_snapshot),
                "virtual_cash": cash_val,
            }
            record = {
                "bot_id": self.bot_id,
                "state": state,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            _supabase_upsert_with_retry("bot_states", [record], on_conflict="bot_id")
            self._log(
                f"✅ State saved: {len(active_trades_snapshot)} active positions, cash={cash_val:.2f}"
            )
        except Exception as e:
            self._log(f"Error saving bot state: {e}")

    def _load_bot_state(self):
        """Restore bot state from Supabase 'bot_states' table."""
        try:

            def _fetch_state(sb):
                return (
                    sb.table("bot_states")
                    .select("*")
                    .eq("bot_id", self.bot_id)
                    .execute()
                )

            res = _supabase_read_with_retry(_fetch_state, table_name="bot_states")
            if res and res.data:
                state = res.data[0].get("state", {})
                self._pos_state = state.get("pos_state", {})
                self._daily_loss = float(state.get("daily_loss", 0.0))
                self._consecutive_losses = int(state.get("consecutive_losses", 0))
                self._virtual_cash = float(
                    state.get("virtual_cash", self.config.virtual_cash)
                )
                saved_at = state.get("saved_at", "unknown")
                positions_count = len(self._pos_state)
                self._log(
                    f"✅ State restored from {saved_at} — {positions_count} open positions, cash={self._virtual_cash:.2f}"
                )
                for sym, pos_data in self._pos_state.items():
                    entry = pos_data.get("entry_price", 0) or 0
                    entry_time = pos_data.get("entry_time", "?")
                    bars = pos_data.get("bars_held", 0)
                    self._log(
                        f"  → {sym}: entry={float(entry):.6f} "
                        f"time={entry_time} bars={bars}"
                    )
            else:
                self._virtual_cash = self.config.virtual_cash
                self._log(
                    f"No saved state found for bot_id={self.bot_id}, using config cash={self._virtual_cash:.2f}"
                )
        except Exception as e:
            self._virtual_cash = self.config.virtual_cash
            self._log(f"Error loading bot state: {e}")

    def _save_trade_persistent(self, trade_info: Dict[str, Any]):
        """Save a trade to Supabase and update stats."""
        try:
            # NEW: Save to Supabase (primary storage)
            if getattr(self.config, "save_trades_to_supabase", True):
                self._save_trade_to_supabase(trade_info)

            # Update performance (no longer writes to file)
            self._update_performance_stats()
        except Exception as e:
            self._log(f"Supabase Log Error: {e}")

    def _save_trade_to_supabase(self, trade: Dict[str, Any]):
        """Save a single trade record to Supabase 'bot_trades' table with fallback queue."""
        try:
            # Map JSON fields to DB columns
            record = {
                "bot_id": self.bot_id,
                "timestamp": trade.get("timestamp"),
                "symbol": trade.get("symbol"),
                "action": trade.get("action"),
                "amount": trade.get("amount"),
                "price": trade.get("price"),
                "entry_price": trade.get("entry_price"),
                "pnl": trade.get("pnl"),
                "king_conf": trade.get("king_conf"),
                "council_conf": trade.get("council_conf"),
                "order_id": trade.get("order_id"),
                "metadata": {
                    k: v
                    for k, v in trade.items()
                    if k
                    not in [
                        "timestamp",
                        "symbol",
                        "action",
                        "amount",
                        "price",
                        "entry_price",
                        "pnl",
                        "king_conf",
                        "council_conf",
                        "order_id",
                    ]
                },
            }

            # Clean numeric fields (ensure they are float or None, not INF/NAN)
            for k in [
                "amount",
                "price",
                "entry_price",
                "pnl",
                "king_conf",
                "council_conf",
            ]:
                if k in record:
                    v = record[k]
                    try:
                        fv = float(v)
                        record[k] = fv if np.isfinite(fv) else None
                    except (TypeError, ValueError):
                        record[k] = None

            self._log(
                f"DEBUG: Upserting trade to Supabase: {record['symbol']} {record['action']} ID={record['order_id']}"
            )
            _supabase_upsert_with_retry("bot_trades", [record], on_conflict="order_id")
        except Exception as e:
            self._log(
                f"Supabase Trade Log Error: {e}. Adding to pending queue for retry..."
            )
            # Add to pending queue for later retry
            with self._pending_trades_lock:
                if trade not in self._pending_trades:
                    self._pending_trades.append(trade)
            import traceback

            self._log(f"Traceback: {traceback.format_exc()}")

    def _retry_pending_trades(self):
        """Retry saving any trades that failed to save to Supabase."""
        with self._pending_trades_lock:
            if not self._pending_trades:
                return

            trades_to_retry = self._pending_trades.copy()
            self._pending_trades.clear()

        for trade in trades_to_retry:
            try:
                record = {
                    "bot_id": self.bot_id,
                    "timestamp": trade.get("timestamp"),
                    "symbol": trade.get("symbol"),
                    "action": trade.get("action"),
                    "amount": trade.get("amount"),
                    "price": trade.get("price"),
                    "entry_price": trade.get("entry_price"),
                    "pnl": trade.get("pnl"),
                    "king_conf": trade.get("king_conf"),
                    "council_conf": trade.get("council_conf"),
                    "order_id": trade.get("order_id"),
                    "metadata": {
                        k: v
                        for k, v in trade.items()
                        if k
                        not in [
                            "timestamp",
                            "symbol",
                            "action",
                            "amount",
                            "price",
                            "entry_price",
                            "pnl",
                            "king_conf",
                            "council_conf",
                            "order_id",
                        ]
                    },
                }

                # Clean numeric fields
                for k in [
                    "amount",
                    "price",
                    "entry_price",
                    "pnl",
                    "king_conf",
                    "council_conf",
                ]:
                    if k in record:
                        v = record[k]
                        try:
                            fv = float(v)
                            record[k] = fv if np.isfinite(fv) else None
                        except (TypeError, ValueError):
                            record[k] = None

                _supabase_upsert_with_retry(
                    "bot_trades", [record], on_conflict="order_id"
                )
                self._log(
                    f"✅ Successfully retried trade: {trade.get('symbol')} {trade.get('action')}"
                )
            except Exception as e:
                self._log(
                    f"Retry failed for trade {trade.get('order_id')}: {e}. Re-queuing..."
                )
                with self._pending_trades_lock:
                    if trade not in self._pending_trades:
                        self._pending_trades.append(trade)

    def _save_log_to_supabase(self, message: str):
        """Save a single log entry to Supabase 'bot_logs' table."""
        try:
            if not getattr(self.config, "save_to_supabase", True):
                return

            # Importance Filter: Only persist critical/trade-related logs to Supabase
            m = message.upper()
            # "noise" keywords that happen every scan/poll
            noise = [
                "IDLE",
                "FETCHING BARS",
                "SCAN CYCLE START",
                "EVALUATING EXIT",
                "PREPARING FEATURES",
                "PREDICTING KING",
                "VALIDATING COUNCIL",
                "IN COOLDOWN",
                "CHECKING DAILY LIMITS",
                "BARS FOUND",
                "SMART SCAN",
            ]

            is_important = any(
                k in m
                for k in [
                    "BUY",
                    "SELL",
                    "SIGNAL",
                    "CRITICAL",
                    "ERROR",
                    "REJECTED",
                    "LIMIT REACHED",
                    "REGIME",
                    "STARTED",
                    "STOPPED",
                ]
            )
            is_noise = any(k in m for k in noise)

            if is_noise and not is_important:
                return

            record = {
                "bot_id": self.bot_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": message,
                "level": "INFO",
            }

            # Use threaded execution to avoid blocking the main bot loop
            def _do_insert():
                try:
                    # Import here to ensure it's available in thread
                    from api.stock_ai import supabase

                    supabase.table("bot_logs").insert(record).execute()
                except:
                    pass

            threading.Thread(target=_do_insert, daemon=True).start()
        except Exception:
            pass

    # ── Trading Mode Overrides ──
    def _get_mode_overrides(self) -> dict:
        """Return effective parameter overrides for the current trading_mode."""
        mode = (self.config.trading_mode or "hybrid").lower()

        if mode == "defensive":
            return {
                "king_offset": 0.10,  # Harder to pass KING
                "council_offset": 0.05,  # Harder to pass COUNCIL
                "volume_mult": 1.5,  # Stricter volume (1.5x of config)
                "skip_trend_filter": False,  # Keep SMA20 trend filter ON
                "min_quality": 75,
                "sideways_size_mult": 0.30,  # Greatly reduced sizing in sideways
                "bear_size_mult": 0.0,  # Never trade in BEAR (blocked above)
            }
        elif mode == "aggressive":
            return {
                "king_offset": 0.0,  # Respected exact user setting
                "council_offset": 0.0,  # Respected exact user setting
                "volume_mult": 0.3,  # Relaxed volume (30% of config)
                "skip_trend_filter": True,  # Skip SMA20 trend filter
                "min_quality": 50,
                "sideways_size_mult": 1.0,  # No reduction in sideways
                "bear_size_mult": 0.50,  # Reduced size in BEAR
            }
        else:  # hybrid (default) - Balanced middle ground
            return {
                "king_offset": 0.0,
                "council_offset": 0.0,
                "volume_mult": 0.7,  # Relaxed from 1.0 (easier than default config)
                "skip_trend_filter": False,
                "min_quality": 55.0,  # Relaxed from 65.0
                "sideways_size_mult": 0.7,  # Less restrictive than 0.5
                "bear_size_mult": 0.3,  # Was 0.0 (Now allowing some BEAR trades)
            }

    def _check_signal_filters(
        self, symbol: str, bars: pd.DataFrame, mode_overrides: dict = None
    ) -> tuple[bool, str]:
        """Check additional technical filters before entering a trade."""
        return StrategyEngine.check_technical_filters(
            bars=bars,
            min_volume_ratio=self.config.min_volume_ratio,
            use_trend_filter=self.config.use_trend_filter,
            use_rsi_filter=self.config.use_rsi_filter,
            mode_overrides=mode_overrides,
        )

    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> float:
        """Calculate Relative Strength Index."""
        return StrategyEngine.calculate_rsi(prices, period)

    # ===================================================================
    #  SMART BOT FEATURES (10 Intelligence Modules)
    # ===================================================================

    def _calculate_adx(self, bars: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average Directional Index for trend strength."""
        return StrategyEngine.calculate_adx(bars, period)

    def _calculate_atr(self, bars: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average True Range."""
        return StrategyEngine.calculate_atr(bars, period)

    # ── Feature 1: Market Regime Detection ──────────────────────────────
    def _detect_market_regime(self, bars: pd.DataFrame) -> str:
        """
        Detect market regime: 'BULL', 'BEAR', or 'SIDEWAYS'.
        Uses ADX for trend strength and SMA50 slope for direction.
        """
        regime = StrategyEngine.detect_market_regime(
            bars=bars,
            use_market_regime=self.config.use_market_regime,
            regime_adx_threshold=self.config.regime_adx_threshold,
        )
        self._log(f"REGIME: {regime}")
        return regime

    # ── Feature 2: Multi-Timeframe Confirmation ─────────────────────────
    def _check_mtf_confirmation(self, symbol: str) -> tuple[bool, str]:
        """
        Confirm signal with higher timeframe trend.
        Returns (passed, message).
        """
        if not self.config.use_mtf_confirmation:
            return True, "MTF disabled"

        try:
            # Save current timeframe, fetch higher TF bars
            original_tf = self.config.timeframe
            self.config.timeframe = self.config.mtf_higher_timeframe
            htf_bars = self._get_bars(symbol, limit=60)
            self.config.timeframe = original_tf  # Restore

            if htf_bars.empty or len(htf_bars) < 20:
                return True, "MTF: insufficient HTF data, allowing"

            sma20 = htf_bars["close"].iloc[-20:].mean()
            current = htf_bars["close"].iloc[-1]

            # Add 3% tolerance
            sma20_tolerance = 0.03
            if current < sma20 * (1 - sma20_tolerance):
                return (
                    False,
                    f"MTF REJECTED: HTF price {current:.4f} < SMA20 tolerance {sma20 * (1 - sma20_tolerance):.4f}",
                )

            # Check slope of HTF SMA
            sma20_prev = (
                htf_bars["close"].iloc[-25:-5].mean() if len(htf_bars) >= 25 else sma20
            )
            slope = (sma20 - sma20_prev) / sma20_prev if sma20_prev > 0 else 0

            if slope < -0.01:
                return False, f"MTF REJECTED: HTF downtrend (slope={slope * 100:.2f}%)"

            return (
                True,
                f"MTF CONFIRMED (HTF SMA20={sma20:.4f}, slope={slope * 100:.2f}%)",
            )
        except Exception as e:
            self._log(f"MTF Error: {e}")
            return True, f"MTF Error: {e}"

    def _is_bar_stale(self, ts) -> bool:
        """
        Check if a bar timestamp is significantly behind system time.
        Helps prevent trading on old data from gaps or stale providers.
        """
        if ts == "unknown" or not ts:
            return False

        try:
            if isinstance(ts, str):
                # Handle ISO formats
                if ts.endswith("Z"):
                    ts = ts.replace("Z", "+00:00")
                dt_ts = datetime.fromisoformat(ts)
            elif hasattr(ts, "to_pydatetime"):
                dt_ts = ts.to_pydatetime()
            else:
                dt_ts = ts

            if dt_ts.tzinfo is None:
                dt_ts = dt_ts.replace(tzinfo=timezone.utc)

            now = datetime.now(timezone.utc)
            diff_seconds = (now - dt_ts).total_seconds()

            # Map timeframe to seconds for age comparison
            tf_str = _to_intraday_timeframe(self.config.timeframe)
            tf_seconds = 3600
            if tf_str.endswith("m"):
                tf_seconds = int(tf_str[:-1]) * 60
            elif tf_str.endswith("h"):
                tf_seconds = int(tf_str[:-1]) * 3600
            elif tf_str.endswith("d"):
                tf_seconds = int(tf_str[:-1]) * 86400

            # Check if this bot runs any stocks (symbols without a slash)
            has_stocks = any("/" not in c for c in (self.config.coins or []))

            # Allow up to 2.5 intervals of lag for crypto (default),
            # but allow a much larger lag for daily/weekly timeframes and stocks
            # to account for weekends, holidays, and exchange closures.
            if tf_str == "1d" or tf_str.endswith("d") or tf_str.endswith("w"):
                multiplier = 10.0  # Allow up to 10 days of lag for daily/weekly
            elif has_stocks:
                multiplier = 72.0  # Allow up to 72 hours of lag for stock intraday (covers weekends)
            else:
                multiplier = 2.5  # Default for crypto intraday

            max_age = tf_seconds * multiplier
            if diff_seconds > max_age:
                self._log(
                    f"STALE DATA DETECTED: Bar at {dt_ts} is {diff_seconds / 3600:.1f}h old (max allowed {max_age / 3600:.1f}h)."
                )
                return True
            return False
        except Exception as e:
            self._log(f"Error in recency check: {e}")
            return False  # Default to fresh if check fails

    # ── Feature 3: Dynamic ATR-based TP/SL ──────────────────────────────
    def _calculate_atr_exits(
        self, bars: pd.DataFrame, entry_price: float, regime: Optional[str] = None
    ) -> tuple[float, float]:
        """
        Calculate dynamic TP/SL based on ATR and exit_mode.
        Supports adaptive multipliers depending on the market regime if use_adaptive_exits is enabled.
        Returns (take_profit_price, stop_loss_price).
        """
        use_adaptive = getattr(self.config, "use_adaptive_exits", False)
        
        tp_mult = self.config.atr_tp_multiplier
        sl_mult = self.config.atr_sl_multiplier

        if use_adaptive:
            # If regime is not passed, try to detect it from the bars
            current_regime = regime or self._detect_market_regime(bars)
            if current_regime == "STRONG_BULL":
                tp_mult = 5.0
                sl_mult = 2.0
            elif current_regime == "BEAR":
                tp_mult = 2.0
                sl_mult = 1.0

        tp, sl = StrategyEngine.calculate_atr_exits(
            bars=bars,
            entry_price=entry_price,
            target_pct=self.config.target_pct,
            stop_loss_pct=self.config.stop_loss_pct,
            use_atr_exits=self.config.use_atr_exits,
            atr_sl_multiplier=sl_mult,
            atr_tp_multiplier=tp_mult,
            atr_period=self.config.atr_period,
            exit_mode=getattr(self.config, "exit_mode", "hybrid"),
        )
        self._log(
            f"ATR Exits: TP={tp:.4f} (+{((tp / entry_price) - 1) * 100:.1f}%), SL={sl:.4f} (-{(1 - (sl / entry_price)) * 100:.1f}%)"
        )
        return tp, sl

    # ── Feature 4: RSI Divergence Detection ─────────────────────────────
    def _detect_rsi_divergence(self, bars: pd.DataFrame) -> tuple[str, float]:
        """
        Detect RSI divergence.
        Returns ('BULLISH', boost), ('BEARISH', penalty), or ('NONE', 0).
        """
        if not self.config.use_rsi_divergence or len(bars) < 30:
            return "NONE", 0.0

        try:
            closes = bars["close"].values[-30:]
            rsi_series = []
            for i in range(14, len(closes)):
                rsi_series.append(self._calculate_rsi(pd.Series(closes[: i + 1]), 14))

            if len(rsi_series) < 10:
                return "NONE", 0.0

            # Find recent lows/highs in price and RSI
            price_recent = closes[-5:]
            price_prev = closes[-15:-5]
            rsi_recent = rsi_series[-5:]
            rsi_prev = rsi_series[-15:-5] if len(rsi_series) >= 15 else rsi_series[:5]

            price_low_recent = min(price_recent)
            price_low_prev = min(price_prev)
            rsi_low_recent = min(rsi_recent)
            rsi_low_prev = min(rsi_prev)

            price_high_recent = max(price_recent)
            price_high_prev = max(price_prev)
            rsi_high_recent = max(rsi_recent)
            rsi_high_prev = max(rsi_prev)

            # Bullish Divergence: price lower low, RSI higher low
            if price_low_recent < price_low_prev and rsi_low_recent > rsi_low_prev:
                self._log(f"RSI BULLISH DIVERGENCE detected")
                return "BULLISH", 0.05  # +5% confidence boost

            # Bearish Divergence: price higher high, RSI lower high
            if price_high_recent > price_high_prev and rsi_high_recent < rsi_high_prev:
                self._log(f"RSI BEARISH DIVERGENCE detected")
                return "BEARISH", -0.05  # -5% confidence penalty

            return "NONE", 0.0
        except Exception:
            return "NONE", 0.0

    # ── Feature 5: Smart Exit (Momentum-Based) ─────────────────────────
    def _check_smart_exit(
        self, symbol: str, bars: pd.DataFrame, entry_price: float, current_price: float
    ) -> tuple[bool, str]:
        """
        Check if momentum suggests an early exit.
        Returns (should_exit, reason).
        """
        return StrategyEngine.check_smart_exit(
            bars=bars,
            entry_price=entry_price,
            current_price=current_price,
            use_smart_exit=self.config.use_smart_exit,
            rsi_threshold=self.config.smart_exit_rsi_threshold,
            volume_spike_multiplier=self.config.smart_exit_volume_spike,
        )

    # ── Feature 6: Correlation Guard ────────────────────────────────────
    def _check_correlation_guard(
        self, symbol: str, bars: pd.DataFrame
    ) -> tuple[bool, float, str]:
        """
        Check if new position is too correlated with existing positions.
        Returns (allowed, size_multiplier, message).
        """
        if not self.config.use_correlation_guard or len(self._pos_state) == 0:
            return True, 1.0, "No correlation check needed"

        try:
            new_closes = bars["close"].iloc[-30:].values
            if len(new_closes) < 20:
                return True, 1.0, "Insufficient data for correlation"

            max_corr = 0.0
            most_corr_symbol = ""

            for existing_norm in self._pos_state:
                existing_sym = _format_symbol_for_bot(existing_norm)
                try:
                    existing_bars = self._get_bars(existing_sym, limit=30)
                    if existing_bars.empty or len(existing_bars) < 20:
                        continue
                    existing_closes = existing_bars["close"].iloc[-20:].values
                    new_trimmed = new_closes[-20:]

                    if len(new_trimmed) != len(existing_closes):
                        continue

                    corr = np.corrcoef(new_trimmed, existing_closes)[0, 1]
                    if np.isfinite(corr) and abs(corr) > max_corr:
                        max_corr = abs(corr)
                        most_corr_symbol = existing_sym
                except Exception:
                    continue

            if max_corr > self.config.max_correlation:
                msg = f"CORRELATION GUARD: {symbol} corr={max_corr:.2f} with {most_corr_symbol} (>{self.config.max_correlation})"
                self._log(msg)
                return False, 0.5, msg

            return True, 1.0, f"Correlation OK (max={max_corr:.2f})"
        except Exception as e:
            self._log(f"Correlation Guard Error: {e}")
            return True, 1.0, f"Correlation Error: {e}"

    # ── Feature 7: Win Rate Feedback Loop ───────────────────────────────
    def _get_adaptive_threshold(self, symbol: str) -> float:
        """
        Adjust the KING threshold based on recent win rate for this symbol.
        Returns the adjusted threshold.
        """
        if not self.config.use_winrate_feedback:
            return self.config.king_threshold

        try:
            norm = _normalize_symbol(symbol)
            symbol_trades = [
                t
                for t in self._trades
                if _normalize_symbol(t.get("symbol", "")) == norm
                and t.get("action") == "SELL"
            ]

            if len(symbol_trades) < 3:
                return self.config.king_threshold

            recent = symbol_trades[-self.config.winrate_lookback :]
            wins = sum(1 for t in recent if (t.get("pnl") or 0) > 0)
            win_rate = wins / len(recent) if recent else 0.5

            base = self.config.king_threshold
            if win_rate < self.config.winrate_low_threshold:
                adjusted = min(base + 0.10, 0.90)
                self._log(
                    f"WIN RATE ADJUST: {symbol} WR={win_rate:.0%} → threshold raised to {adjusted:.2f}"
                )
                return adjusted
            elif win_rate > self.config.winrate_high_threshold:
                adjusted = max(base - 0.05, 0.40)
                self._log(
                    f"WIN RATE ADJUST: {symbol} WR={win_rate:.0%} → threshold lowered to {adjusted:.2f}"
                )
                return adjusted

            return base
        except Exception:
            return self.config.king_threshold

    # ── Feature 8: Time-of-Day Filter ───────────────────────────────────
    def _is_good_time_to_trade(self, symbol: str) -> tuple[bool, str]:
        """
        Check if current time is suitable for trading.
        """
        if not self.config.use_time_filter:
            return True, "Time filter disabled"

        try:
            now = datetime.now(timezone.utc)
            hour = now.hour

            is_crypto = (
                "/" in symbol or symbol.endswith("USD") or symbol.endswith("USDT")
            )

            if is_crypto:
                # Avoid low-liquidity hours for crypto (UTC 00:00-04:00)
                if 0 <= hour < 4:
                    return False, f"Low liquidity period (UTC {hour}:00)"
            else:
                # US Market: avoid first/last 30 min of session
                # Market hours: 14:30 - 21:00 UTC
                minute = now.minute
                if hour == 14 and minute < 30:
                    return False, "Pre-market"
                if 14 <= hour < 15 and minute < 30:
                    return False, "First 30 min of market"
                if hour == 20 and minute > 30:
                    return False, "Last 30 min of market"
                if hour >= 21 or hour < 14:
                    return False, "After-hours"

            return True, "Good trading time"
        except Exception:
            return True, "Time check error, allowing"

    def _is_inside_schedule(self) -> tuple[bool, str]:
        if not getattr(self.config, "use_schedule", False):
            return True, "Schedule disabled"

        try:
            from zoneinfo import ZoneInfo

            tz_str = getattr(self.config, "schedule_timezone", "Africa/Cairo")
            if tz_str == "Local":
                now = datetime.now()
            else:
                try:
                    now = datetime.now(ZoneInfo(tz_str))
                except Exception:
                    now = datetime.now(ZoneInfo("Africa/Cairo"))

            # Check weekday
            weekday = now.weekday()  # Monday=0, Sunday=6
            allowed_days = getattr(self.config, "schedule_days", None)
            if allowed_days is None:
                allowed_days = [0, 1, 2, 3, 4, 5, 6]

            if weekday not in allowed_days:
                day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                current_day = day_names[weekday]
                allowed_day_names = [day_names[d] for d in allowed_days]
                return (
                    False,
                    f"Today ({current_day}) is not a scheduled trading day. Allowed: {', '.join(allowed_day_names)}",
                )

            # Check time
            start_str = getattr(self.config, "schedule_start_time", "10:00")
            end_str = getattr(self.config, "schedule_end_time", "14:30")

            try:
                start_h, start_m = map(int, start_str.split(":"))
                end_h, end_m = map(int, end_str.split(":"))
            except ValueError:
                return True, "Error parsing schedule times, bypassing"

            current_time = now.time()
            from datetime import time as dt_time

            start_time = dt_time(start_h, start_m)
            end_time = dt_time(end_h, end_m)

            if start_time <= end_time:
                inside = start_time <= current_time <= end_time
            else:
                inside = current_time >= start_time or current_time <= end_time

            if not inside:
                return (
                    False,
                    f"Outside operating hours ({start_str} to {end_str}). Current time: {current_time.strftime('%H:%M')}",
                )

            return True, "Inside scheduled hours"
        except Exception as e:
            return True, f"Error checking schedule: {e}"

    # ── Feature 9: Signal Quality Score ─────────────────────────────────
    def _calculate_signal_quality(
        self,
        king_conf: float,
        council_conf: Optional[float],
        bars: pd.DataFrame,
        regime: str,
        divergence: str,
    ) -> float:
        """
        Calculate a composite quality score (0-100) from all factors.
        """
        if not self.config.use_quality_score:
            return 100.0  # Bypass

        try:
            score = 0.0

            # KING confidence (30 points max)
            score += min(king_conf, 1.0) * 30

            # COUNCIL confidence (20 points max)
            if council_conf is not None:
                score += min(council_conf, 1.0) * 20
            else:
                score += 10  # Neutral if no council

            # Volume strength (15 points max)
            if len(bars) >= 25:
                recent_vol = bars["volume"].iloc[-5:].mean()
                avg_vol = bars["volume"].iloc[-25:-5].mean()
                vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1.0
                score += min(vol_ratio / 2.0, 1.0) * 15

            # Trend alignment (15 points max)
            if len(bars) >= 20:
                sma20 = bars["close"].iloc[-20:].mean()
                current = bars["close"].iloc[-1]
                if current > sma20:
                    above_pct = (current - sma20) / sma20
                    score += min(above_pct * 100, 1.0) * 15
                # Below = 0 points

            # RSI position (10 points max) - best around 40-60
            if len(bars) >= 25:
                rsi = self._calculate_rsi(bars["close"].iloc[-25:], 14)
                if 35 <= rsi <= 65:
                    score += 10
                elif 25 <= rsi < 35 or 65 < rsi <= 75:
                    score += 5

            # Market regime (10 points max)
            if regime == "BULL":
                score += 10
            elif regime == "SIDEWAYS":
                score += 5
            # BEAR = 0 points

            # Divergence bonus/penalty
            if divergence == "BULLISH":
                score += 5
            elif divergence == "BEARISH":
                score -= 5

            score = max(0, min(100, score))
            self._log(f"QUALITY SCORE: {score:.1f}/100")
            return score
        except Exception:
            return 50.0  # Neutral on error

    # ── Feature 10: Partial Position Sell ───────────────────────────────
    def _maybe_partial_sell(
        self, symbol: str, qty: float, current_price: float, entry_price: float
    ) -> bool:
        """
        Sell a partial position (50%) at intermediate target.
        Returns True if a partial sell was executed.
        """
        if not self.config.use_partial_positions:
            return False

        try:
            state = self._pos_state.get(_normalize_symbol(symbol), {})
            if state.get("partial_sold"):
                return False

            pnl_pct = (current_price - entry_price) / entry_price

            # Partial sell at 60% of target
            partial_target = self.config.target_pct * 0.6
            if pnl_pct >= partial_target:
                partial_qty = qty * self.config.partial_exit_pct
                self._log(
                    f"{symbol}: PARTIAL SELL ({self.config.partial_exit_pct * 100:.0f}%) at +{pnl_pct * 100:.1f}%"
                )

                if self.config.execution_mode != "TELEGRAM":
                    ok = self._sell_market(symbol, qty=partial_qty)
                    if ok:
                        self._pos_state[_normalize_symbol(symbol)] = {
                            **state,
                            "partial_sold": True,
                            "remaining_qty": qty - partial_qty,
                        }
                        return True
                else:
                    self._save_signal_record(
                        symbol,
                        current_price,
                        partial_qty * current_price,
                        0,
                        None,
                        action="PARTIAL_SELL",
                    )
                    self._pos_state[_normalize_symbol(symbol)] = {
                        **state,
                        "partial_sold": True,
                    }
                    return True

            return False
        except Exception as e:
            self._log(f"Partial Sell Error: {e}")
            return False

    def _calculate_position_size(
        self,
        symbol: str,
        cash: float,
        king_conf: float,
        council_conf: Optional[float],
        bars: pd.DataFrame,
    ) -> float:
        """Calculate dynamic position size based on confidence and volatility."""
        if not self.config.use_dynamic_sizing:
            return min(
                cash * self.config.pct_cash_per_trade, self.config.max_notional_usd
            )

        try:
            avg_conf = (
                (king_conf + council_conf) / 2
                if council_conf is not None
                else king_conf
            )

            # Volatility (Std Dev)
            closes = bars["close"].iloc[-20:]
            volatility = closes.std() / closes.mean()
            vol_factor = 1 / (1 + volatility * 10)

            # Risk-based sizing
            max_risk_usd = cash * self.config.max_risk_per_trade_pct
            risk_based_size = max_risk_usd / self.config.stop_loss_pct

            conf_multiplier = 0.5 + (avg_conf * 0.5)
            pos_size = risk_based_size * conf_multiplier * vol_factor

            # Constraints
            min_size = 50.0
            max_size = min(cash * 0.15, self.config.max_notional_usd)
            return max(min_size, min(pos_size, max_size))
        except Exception as e:
            self._log(f"Pos Sizing Error: {e}")
            return min(
                cash * self.config.pct_cash_per_trade, self.config.max_notional_usd
            )

    def _check_daily_limits(self) -> tuple[bool, str]:
        """Check daily loss and consecutive loss limits."""
        today = datetime.now(timezone.utc).date()
        if today > self._last_reset_date:
            self._daily_loss = 0.0
            self._consecutive_losses = 0
            self._last_reset_date = today
            self._log("Daily metrics reset.")

        if self._daily_loss < -self.config.daily_loss_limit:
            return False, f"Daily Loss Limit Reached (${self._daily_loss:.2f})"

        if self._consecutive_losses >= self.config.max_consecutive_losses:
            return False, f"Consecutive Loss Limit Reached ({self._consecutive_losses})"

        return True, "Limits OK"

    def _update_performance_stats(self):
        """Calculate stats from the in-memory trade deque."""
        try:
            trades = list(self._trades)
            sells = [t for t in trades if t.get("action") == "SELL"]
            wins = [t for t in sells if t.get("pnl", 0) > 0]
            total_pnl = sum(t.get("pnl", 0) for t in sells)

            # Note: We no longer write to a local _perf_file.
            # UI components and status endpoints calculate metrics on-the-fly or use self._trades.
            pass
        except Exception as e:
            print(f"Stats Error: {e}")

    def clear_logs(self):
        with self._lock:
            self._logs.clear()
            # Clear from Supabase if enabled
        try:
            from api.stock_ai import _init_supabase, supabase

            _init_supabase()
            if supabase:
                # Use a larger timeout/retry if possible, or just standard exec
                supabase.table("bot_logs").delete().eq("bot_id", self.bot_id).execute()
        except Exception as e:
            print(f"Error clearing Supabase logs: {e}")
        self._log("Logs cleared by user (local + database).")

    def reset_all_data(self):
        """Clears all data associated with this bot including trades, logs, open positions and resets cash."""
        with self._lock:
            self._logs.clear()
            self._trades.clear()
            self._pos_state.clear()
            self._daily_loss = 0.0
            self._consecutive_losses = 0
            self._virtual_cash = float(self.config.virtual_cash)
            if self.api and hasattr(self.api, "_cash"):
                self.api._cash = self._virtual_cash

        # Clear from Supabase
        try:
            from api.stock_ai import _init_supabase, supabase

            _init_supabase()
            if supabase:
                supabase.table("bot_logs").delete().eq("bot_id", self.bot_id).execute()
                supabase.table("bot_trades").delete().eq(
                    "bot_id", self.bot_id
                ).execute()
                supabase.table("bot_states").delete().eq(
                    "bot_id", self.bot_id
                ).execute()
        except Exception as e:
            print(f"Error resetting Supabase data for {self.bot_id}: {e}")

        # Re-save empty state
        self._save_bot_state()
        self._log("All bot results and history cleared by user.")

    def _log(self, msg: str):
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{self.config.name}] [{ts}] {msg}"
        with self._lock:
            try:
                print(line)  # Keep printing to stdout for convenience
            except UnicodeEncodeError:
                # Windows console might fail to print emojis or special characters if codepage is not utf-8
                print(line.encode("ascii", "replace").decode("ascii"))
            except Exception:
                pass
            self._logs.append(line)

        # NEW: Persist to Supabase
        self._save_log_to_supabase(line)

        # Optional: Send important logs to Telegram
        if self.telegram_bridge and self.config.execution_mode in ["TELEGRAM", "BOTH"]:
            # Only send orders and critical errors here. Signals handled separately.
            # User requested to suppress "VIRTUAL ORDER filled" spam.
            # User requested to suppress ALL sell-related messages from Telegram/Cornix.
            _msg_lower = msg.lower()
            is_sell_msg = any(
                kw in _msg_lower for kw in ["sell", "stop", "target", "time exit"]
            )
            if not is_sell_msg and (
                ("order" in _msg_lower or "CRITICAL" in msg)
                and "VIRTUAL ORDER filled" not in msg
            ):
                self.telegram_bridge.send_notification(
                    f"[INFO] *{self.config.name}*\n`{msg}`"
                )

    def set_telegram_bridge(self, bridge):
        self.telegram_bridge = bridge

    def _check_monthly_signal_cap(self, symbol: str) -> bool:
        """
        Check if monthly signal cap is reached for this symbol.
        Resets at the beginning of each month (UTC).

        Returns:
            True if signal is allowed, False if cap reached
        """
        if self.config.monthly_signal_cap <= 0:
            return True  # Unlimited signals

        current_year_month = (
            datetime.now(timezone.utc).year,
            datetime.now(timezone.utc).month,
        )

        # Reset counter if month changed
        if current_year_month != self._month_tracking:
            self._signals_this_month = {}
            self._month_tracking = current_year_month
            self._log(
                f"📅 Monthly signal cap reset for {current_year_month[0]}-{current_year_month[1]:02d}"
            )

        # Check current count
        current_count = self._signals_this_month.get(symbol, 0)

        if current_count >= self.config.monthly_signal_cap:
            self._log(
                f"⛔ Signal cap reached for {symbol}: {current_count}/{self.config.monthly_signal_cap} signals this month"
            )
            return False

        return True

    def _increment_monthly_signal_count(self, symbol: str):
        """Increment the signal counter for this symbol."""
        current_count = self._signals_this_month.get(symbol, 0)
        self._signals_this_month[symbol] = current_count + 1
        self._log(
            f"📊 Signal count for {symbol}: {self._signals_this_month[symbol]}/{self.config.monthly_signal_cap}"
        )

    def _get_precision(self, price: float) -> int:
        """Determine appropriate decimal precision based on price magnitude."""
        if price <= 0:
            return 2
        if price < 0.0001:
            return 8
        if price < 0.001:
            return 7
        if price < 0.01:
            return 6
        if price < 0.1:
            return 5
        if price < 1:
            return 4
        if price < 10:
            return 3
        if price < 1000:
            return 2
        return 1

    def _format_cornix_signal(
        self,
        symbol: str,
        price: float,
        target_pct: float = None,
        stop_pct: float = None,
        tp_price: float = None,
        sl_price: float = None,
    ) -> str:
        """Build a Cornix-compatible signal message.

        If tp_price/sl_price are given (from ATR), use those absolute prices.
        Otherwise fall back to percentage-based calculation.
        """
        precision = self._get_precision(price)

        # Entry zone: 2 ladder entries spread below current price
        # Optimized for RR 1:3 (0.2%, 1.0%)
        entry_offsets = [0.002, 0.01]
        entries = []
        for i, offset in enumerate(entry_offsets):
            val = round(price * (1 - offset), precision)
            if i > 0 and val >= entries[i - 1]:
                val = round(entries[i - 1] - (10**-precision), precision)
            entries.append(val)

        # Take-profit: use absolute ATR price if provided, else percentage
        if tp_price is not None:
            tp = round(tp_price, precision)
        else:
            t_pct = target_pct or self.config.target_pct
            tp = round(price * (1 + t_pct), precision)
        if tp <= entries[0]:
            tp = round(entries[0] + (10**-precision), precision)

        entry_lines = "\n".join(f"{i + 1}) {e}" for i, e in enumerate(entries))

        # Stop loss: use absolute ATR price if provided, else percentage
        if sl_price is not None:
            sl = round(sl_price, precision)
        else:
            s_pct = stop_pct or self.config.stop_loss_pct
            sl = round(price * (1 - s_pct), precision)
        lowest_entry = entries[-1]

        if sl >= lowest_entry:
            sl = round(lowest_entry * 0.99, precision)
            if sl >= lowest_entry:
                sl = round(lowest_entry - (10**-precision), precision)

        # ✅ Signal Sync Safety: Cornix will reject if SL is too close to (or above) current price
        # This happens due to exchange price discrepancies (e.g. Binance vs Huobi).
        # We enforce a mandatory 1.5% buffer below the signal price.
        max_allowed_sl = round(price * 0.985, precision)
        if sl > max_allowed_sl:
            self._log(
                f"SIGNAL SAFETY: Adjusting SL for {symbol} from {sl:.4f} to {max_allowed_sl:.4f} (1.5% safety buffer)"
            )
            sl = max_allowed_sl

        # Show exit mode in signal
        exit_mode = getattr(self.config, "exit_mode", "hybrid").upper()
        mode_label = f" [{exit_mode}]" if exit_mode != "MANUAL" else ""

        # Meta info for the signal
        meta_info = ""
        try:
            state = self._pos_state.get(_normalize_symbol(symbol), {})
            regime = state.get("regime", "N/A")
            quality = state.get("quality_score", 0)
            if regime != "N/A":
                meta_info = f"\n📊 Regime: {regime}\n🎯 Quality: {quality:.0f}"
        except:
            pass

        # Calculate % from entry (first entry price as reference)
        ref_entry = entries[0]
        tp_pct = ((tp - ref_entry) / ref_entry * 100) if ref_entry > 0 else 0
        sl_pct = ((sl - ref_entry) / ref_entry * 100) if ref_entry > 0 else 0
        rr_ratio = abs(tp_pct / sl_pct) if sl_pct != 0 else 0

        msg = (
            f"*#ARTORO SIGNAL: {symbol}*\n"
            f"Signal Type: Regular (Long){mode_label}\n"
            f"{meta_info}\n"
            f"\n"
            f"*Entry Targets:*\n"
            f"{entry_lines}\n"
            f"\n"
            f"*Take-Profit Targets:*\n"
            f"1) {tp}  ✅ `+{tp_pct:.2f}%`\n"
            f"\n"
            f"*Stop Targets:*\n"
            f"1) {sl}  🛑 `{sl_pct:.2f}%`\n"
            f"\n"
            f"⚖️ *Risk/Reward:* `1 : {rr_ratio:.1f}` ✅\n"
        )
        return msg

    def _format_cornix_close_signal(self, symbol: str) -> str:
        """Build a Cornix-compatible CLOSE signal message."""
        # Cornix expects the symbol WITHOUT a slash (e.g. CLOSE #ALICEUSDT not CLOSE #ALICE/USDT)
        clean_symbol = (symbol or "").replace("/", "")
        return f"CLOSE #{clean_symbol}"

    def _send_cornix_webhook_signal(
        self,
        symbol: str,
        price: float,
        action: str,
        url: str,
        tp_price: Optional[float] = None,
        sl_price: Optional[float] = None,
    ):
        """Helper to send JSON payload to Cornix Webhook."""
        import httpx

        try:
            # Clean symbol for Cornix (e.g. BTC/USDT -> BTCUSDT)
            clean_sym = symbol.replace("/", "").upper()

            # Map action to user's specified Cornix actions
            # User provided: "entry" for opening and "take_profit" for closing
            cornix_action = "entry" if action == "buy" else "take_profit"

            payload = {
                "uuid": getattr(self.config, "cornix_uuid", ""),
                "source": "tradingview_signal_bot",
                "secret": getattr(self.config, "cornix_secret", ""),
                "symbol": clean_sym,
                "action": cornix_action,
                # Advanced fields (Cornix will ignore them if not in Advanced mode)
                "price": price,
                "entry": [price],
                "take_profit": [tp_price] if tp_price else [],
                "stop_loss": sl_price if sl_price else 0.0,
            }
            with httpx.Client() as client:
                r = client.post(url, json=payload, timeout=10.0)
                if r.status_code == 200:
                    self._log(
                        f"SUCCESS: Direct Cornix Signal ({cornix_action}) sent for {symbol} ✅"
                    )
                else:
                    self._log(
                        f"ERROR: Cornix Webhook failed ({r.status_code}): {r.text}"
                    )
        except Exception as e:
            self._log(f"EXCEPTION sending Cornix Webhook: {e}")

    def _send_telegram_signal(
        self,
        symbol: str,
        price: float,
        notional: float = 0,
        king_conf: float = 0,
        council_conf: Optional[float] = None,
        bars: pd.DataFrame = None,
        action: str = "BUY",
    ):
        """Send a trade signal to Telegram in Cornix-compatible format.

        Exit levels are unified with Artoro AI config:
        - MANUAL     → uses config target_pct / stop_loss_pct directly
        - ATR_SMART  → uses ATR-calculated levels
        - HYBRID     → uses the safer (tighter) of ATR vs config % (mirrors Artoro AI logic)
        """
        tp_price = None
        sl_price = None

        if action.upper() == "BUY":
            mode = getattr(self.config, "exit_mode", "hybrid").lower()
            # Config-based levels (baseline)
            cfg_tp = price * (1 + self.config.target_pct)
            cfg_sl = price * (1 - self.config.stop_loss_pct)

            if mode == "manual":
                tp_price, sl_price = cfg_tp, cfg_sl
                self._log(
                    f"SIGNAL SYNC [{symbol}]: MANUAL → TP={cfg_tp:.4f} SL={cfg_sl:.4f}"
                )
            elif mode == "atr_smart" and bars is not None and not bars.empty:
                try:
                    tp_price, sl_price = self._calculate_atr_exits(bars, price)
                except Exception as e:
                    self._log(f"ATR signal calc error: {e}")
                    tp_price, sl_price = cfg_tp, cfg_sl
            else:  # HYBRID
                atr_tp, atr_sl = cfg_tp, cfg_sl
                if bars is not None and not bars.empty:
                    try:
                        atr_tp, atr_sl = self._calculate_atr_exits(bars, price)
                    except:
                        pass
                tp_price = min(atr_tp, cfg_tp)
                sl_price = max(atr_sl, cfg_sl)

        # 1. Direct Cornix Webhook (New)
        if (
            hasattr(self.config, "cornix_webhook_url")
            and self.config.cornix_webhook_url
        ):
            cornix_action = "close" if action.upper() == "SELL" else "buy"
            self._send_cornix_webhook_signal(
                symbol,
                price,
                cornix_action,
                self.config.cornix_webhook_url,
                tp_price=tp_price,
                sl_price=sl_price,
            )

        # 2. Telegram (Existing/Fallback)
        # Even if Cornix Webhook is on, we might still want the TG channel as a log/backup
        if self.telegram_bridge:
            if action.upper() == "SELL":
                msg = self._format_cornix_close_signal(symbol)
            else:
                msg = self._format_cornix_signal(
                    symbol, price, tp_price=tp_price, sl_price=sl_price
                )
            self.telegram_bridge.send_notification(msg)

    def _save_signal_record(
        self,
        symbol: str,
        price: float,
        notional: float,
        king_conf: float,
        council_conf: Optional[float] = None,
        action: str = "BUY",
        entry_price: Optional[float] = None,
        pnl: Optional[float] = None,
        reason: str = "SIGNAL",
    ):
        """Save a signal as a virtual trade in the history so it shows up in UI."""
        # For BUY: entry_price = buy price, pnl = 0
        # For SELL: entry_price = original buy price, pnl = profit/loss
        if entry_price is None and action == "BUY":
            entry_price = float(price)
        if pnl is None and action == "BUY":
            pnl = 0.0
        trade = {
            "timestamp": datetime.now().isoformat(),
            "symbol": symbol,
            "action": action,
            "amount": float(notional),
            "price": float(price),
            "entry_price": float(entry_price) if entry_price is not None else None,
            "pnl": float(pnl) if pnl is not None else None,
            "king_conf": float(king_conf),
            "council_conf": float(council_conf) if council_conf is not None else None,
            "order_id": f"signal_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{symbol.replace('/', '')}",
            "metadata": {"reason": reason},
        }
        self._trades.append(trade)
        self._save_trade_persistent(trade)
        self._log(f"{action} SIGNAL RECORDED: {symbol} @ {price:.4f} Reason: {reason}")

    def handle_cornix_event(self, event_data: dict):
        """Handle incoming updates from Cornix webhooks."""
        action = event_data.get("action", "").lower()
        symbol = event_data.get("symbol", "")
        price = float(event_data.get("price", 0))
        amount = float(event_data.get("amount", 0))
        pnl = float(event_data.get("pnl", 0))

        norm = _normalize_symbol(symbol)
        self._log(f"CORNIX EVENT: {action.upper()} for {symbol} @ {price:.4f}")

        with self._lock:
            if action == "trade_opened":
                # Update or create position state with actual Cornix data
                self._pos_state[norm] = {
                    "entry_price": price,
                    "entry_time": datetime.now(timezone.utc).isoformat(),
                    "bars_held": 0,
                    "amount": amount,
                    "notional": price * amount
                    if amount > 0
                    else self.config.max_notional_usd,
                    "status": "OPEN",
                    "source": "CORNIX",
                }
                self._log(f"Synced {symbol} OPEN with Cornix. Entry: {price:.4f}")

            elif action in ["target_hit", "stop_loss_hit", "trade_closed"]:
                state = self._pos_state.get(norm, {})
                entry_price = state.get(
                    "entry_price", price
                )  # Fallback to current price if unknown

                # Record the sell/close action
                reason = action.upper()
                self._save_signal_record(
                    symbol,
                    price,
                    amount * price if amount > 0 else 0,
                    king_conf=0,
                    action="SELL",
                    entry_price=entry_price,
                    pnl=pnl,
                    reason=reason,
                )

                # Remove from active positions if closed
                if action == "trade_closed" or (
                    action in ["target_hit", "stop_loss_hit"]
                ):
                    if norm in self._pos_state:
                        self._pos_state.pop(norm)
                        self._log(
                            f"Synced {symbol} CLOSE with Cornix. Exit: {price:.4f} PnL: {pnl:.2f}"
                        )

            # Save state after update
            self._save_bot_state()

    def send_test_notification(self, notify_type: str):
        """Send a mock notification for testing purposes (Telegram + Webhooks)."""
        symbol = "BTC/USDT"
        price = 65432.10

        has_tg = self.telegram_bridge is not None
        has_webhook = (
            hasattr(self.config, "cornix_webhook_url")
            and self.config.cornix_webhook_url
        )

        if notify_type in ["buy", "sell", "signal"]:
            action = "SELL" if notify_type == "sell" else "BUY"
            # This triggers both Telegram (if available) and Cornix Webhook (if available)
            self._send_telegram_signal(symbol, price, action=action)
            return (
                True,
                f"Test {notify_type.upper()} sent (TG={has_tg}, Webhook={has_webhook})",
            )

        # Generic message test (Telegram only)
        if has_tg:
            self.telegram_bridge.send_notification(
                f"🔔 TEST: {notify_type.upper()} notification from {self.config.name}"
            )
            return True, "Test notification sent to Telegram"

        return False, "No notification delivery method configured (Telegram or Webhook)"

    def _build_default_config(self) -> BotConfig:
        # Load default coins from CRYPTO.json to avoid hardcoded lists
        default_coins_str = "BTC/USDT,ETH/USDT,SOL/USDT,LTC/USDT,LINK/USDT"
        try:
            import json
            from pathlib import Path

            api_dir = Path(__file__).parent
            candidates = [
                api_dir.parent
                / "symbols_data"
                / "CRYPTO.json",  # local dev (project root)
                api_dir / "symbols_data" / "CRYPTO.json",  # HF (api/ is root)
                Path.cwd() / "symbols_data" / "CRYPTO.json",  # CWD fallback
            ]
            for crypto_path in candidates:
                if crypto_path.exists():
                    with open(crypto_path, "r", encoding="utf-8") as f:
                        all_syms = json.load(f)
                        # Take top 30 for default bot config
                        default_coins_str = ",".join(all_syms[:30])
                    break
        except Exception as e:
            print(f"Error loading default coins from CRYPTO.json: {e}")

        coins = _parse_coins(_read_env("LIVE_COINS", default_coins_str))

        return BotConfig(
            # Support both env var styles used across the repo/UI.
            coins=coins,
            telegram_chat_id=int(
                float(_read_env("TELEGRAM_CHAT_ID", "-1003699330518") or -1003699330518)
            ),
            telegram_token=_read_env("TELEGRAM_TOKEN"),
            king_threshold=_parse_float(_read_env("KING_THRESHOLD", "0.60"), 0.60),
            council_threshold=_parse_float(
                _read_env("COUNCIL_THRESHOLD", "0.35"), 0.35
            ),
            max_notional_usd=_parse_float(_read_env("MAX_NOTIONAL_USD", "500"), 500.0),
            pct_cash_per_trade=_parse_float(
                _read_env("PCT_CASH_PER_TRADE", "0.10"), 0.10
            ),
            bars_limit=int(float(_read_env("BARS_LIMIT", "500") or 500)),
            poll_seconds=int(float(_read_env("POLL_SECONDS", "300") or 300)),
            timeframe=str(_read_env("TIMEFRAME", "1Hour")),
            data_source=str(_read_env("LIVE_DATA_SOURCE", "binance") or "binance")
            .strip()
            .lower(),
            enable_sells=_parse_bool(_read_env("LIVE_ENABLE_SELLS", "1"), True),
            use_trailing=_parse_bool(_read_env("LIVE_USE_TRAILING", "1"), True),
            trail_be_pct=_parse_float(_read_env("LIVE_TRAIL_BE_PCT", "0.05"), 0.05),
            trail_lock_trigger_pct=_parse_float(
                _read_env("LIVE_TRAIL_LOCK_TRIGGER_PCT", "0.08"), 0.08
            ),
            trail_lock_pct=_parse_float(_read_env("LIVE_TRAIL_LOCK_PCT", "0.05"), 0.05),
            save_to_supabase=_parse_bool(
                _read_env("LIVE_SAVE_TO_SUPABASE", "0"), False
            ),
            # --- New Advanced Risk & Strategy ---
            target_pct=_parse_float(_read_env("LIVE_TARGET_PCT", "0.06"), 0.06),  # 6%
            stop_loss_pct=_parse_float(
                _read_env("LIVE_STOP_LOSS_PCT", "0.02"), 0.02
            ),  # 2%
            hold_max_bars=int(float(_read_env("LIVE_HOLD_MAX_BARS", "30") or 30)),
            daily_loss_limit=_parse_float(_read_env("DAILY_LOSS_LIMIT", "500"), 500.0),
            max_consecutive_losses=int(
                float(_read_env("MAX_CONSECUTIVE_LOSSES", "3") or 3)
            ),
            min_volume_ratio=_parse_float(_read_env("MIN_VOLUME_RATIO", "0.7"), 0.7),
            use_rsi_filter=_parse_bool(_read_env("USE_RSI_FILTER", "1"), True),
            use_trend_filter=_parse_bool(_read_env("USE_TREND_FILTER", "1"), True),
            use_dynamic_sizing=_parse_bool(_read_env("USE_DYNAMIC_SIZING", "1"), True),
            max_risk_per_trade_pct=_parse_float(
                _read_env("MAX_RISK_PER_TRADE_PCT", "0.02"), 0.02
            ),
            trading_mode=str(_read_env("TRADING_MODE", "hybrid") or "hybrid")
            .strip()
            .lower(),
            king_model_path=str(
                _read_env("LIVE_KING_MODEL_PATH", "api/models/KING_CRYPTO.pkl")
            ),
            council_model_path=str(
                _read_env("LIVE_COUNCIL_MODEL_PATH", "api/models/COUNCIL_CRYPTO.pkl")
            ),
            max_open_positions=int(
                float(_read_env("LIVE_MAX_OPEN_POSITIONS", "5") or 5)
            ),
            cornix_webhook_url=_read_env("CORNIX_WEBHOOK_URL"),
            cornix_uuid=_read_env("CORNIX_UUID"),
            cornix_secret=_read_env("CORNIX_SECRET"),
            use_schedule=_parse_bool(_read_env("LIVE_USE_SCHEDULE", "0"), False),
            schedule_start_time=str(_read_env("LIVE_SCHEDULE_START_TIME", "10:00")),
            schedule_end_time=str(_read_env("LIVE_SCHEDULE_END_TIME", "14:30")),
            schedule_timezone=str(_read_env("LIVE_SCHEDULE_TIMEZONE", "Africa/Cairo")),
            schedule_days=[0, 1, 2, 3, 4, 5, 6],
            use_atr_exits=_parse_bool(_read_env("LIVE_USE_ATR_EXITS", "1"), True),
            atr_sl_multiplier=_parse_float(
                _read_env("LIVE_ATR_SL_MULTIPLIER", "1.5"), 1.5
            ),
            atr_tp_multiplier=_parse_float(
                _read_env("LIVE_ATR_TP_MULTIPLIER", "2.5"), 2.5
            ),
            atr_period=int(float(_read_env("LIVE_ATR_PERIOD", "14") or 14)),
            exit_mode=str(_read_env("LIVE_EXIT_MODE", "hybrid") or "hybrid")
            .strip()
            .lower(),
            use_smart_exit=_parse_bool(_read_env("LIVE_USE_SMART_EXIT", "1"), True),
            smart_exit_rsi_threshold=_parse_float(
                _read_env("LIVE_SMART_EXIT_RSI_THRESHOLD", "40.0"), 40.0
            ),
            smart_exit_volume_spike=_parse_float(
                _read_env("LIVE_SMART_EXIT_VOLUME_SPIKE", "3.0"), 3.0
            ),
            use_market_regime=_parse_bool(
                _read_env("LIVE_USE_MARKET_REGIME", "1"), True
            ),
            regime_adx_threshold=_parse_float(
                _read_env("LIVE_REGIME_ADX_THRESHOLD", "14.0"), 14.0
            ),
            use_rsi_divergence=_parse_bool(
                _read_env("LIVE_USE_RSI_DIVERGENCE", "1"), True
            ),
            use_correlation_guard=_parse_bool(
                _read_env("LIVE_USE_CORRELATION_GUARD", "1"), True
            ),
            max_correlation=_parse_float(
                _read_env("LIVE_MAX_CORRELATION", "0.80"), 0.80
            ),
        )

    def update_config(self, updates: Dict[str, Any]):
        with self._lock:
            if self._status == "running":
                raise RuntimeError(
                    "Cannot update config while bot is running. Stop it first."
                )

            # Apply updates
            current = asdict(self.config)

            # Handle list parsing for coins if string provided
            if "coins" in updates and isinstance(updates["coins"], str):
                updates["coins"] = _parse_coins(updates["coins"])

            for k, v in updates.items():
                if k in current:
                    # Type conversion
                    if k in [
                        "king_threshold",
                        "council_threshold",
                        "max_notional_usd",
                        "pct_cash_per_trade",
                        "target_pct",
                        "stop_loss_pct",
                        "trail_be_pct",
                        "trail_lock_trigger_pct",
                        "trail_lock_pct",
                        "daily_loss_limit",
                        "min_volume_ratio",
                        "max_risk_per_trade_pct",
                        "regime_adx_threshold",
                        "regime_sideways_size_mult",
                        "atr_sl_multiplier",
                        "atr_tp_multiplier",
                        "smart_exit_rsi_threshold",
                        "smart_exit_volume_spike",
                        "max_correlation",
                        "winrate_low_threshold",
                        "winrate_high_threshold",
                        "min_quality_score",
                        "partial_entry_pct",
                        "partial_exit_pct",
                        "slippage_buffer_pct",
                        "live_confidence_haircut",
                    ]:
                        current[k] = _parse_float(v, current[k])
                    elif k in [
                        "bars_limit",
                        "poll_seconds",
                        "max_open_positions",
                        "hold_max_bars",
                        "max_consecutive_losses",
                        "atr_period",
                        "winrate_lookback",
                        "warmup_bars",
                    ]:
                        current[k] = int(float(v))
                    elif k == "telegram_chat_id":
                        if v is not None and str(v).strip():
                            current[k] = int(float(v))
                    elif k in [
                        "use_council",
                        "enable_sells",
                        "use_trailing",
                        "save_to_supabase",
                        "use_rsi_filter",
                        "use_trend_filter",
                        "use_dynamic_sizing",
                        "use_market_regime",
                        "use_mtf_confirmation",
                        "use_atr_exits",
                        "use_rsi_divergence",
                        "use_smart_exit",
                        "use_correlation_guard",
                        "use_winrate_feedback",
                        "use_time_filter",
                        "use_quality_score",
                        "use_partial_positions",
                        "use_schedule",
                    ]:
                        current[k] = _parse_bool(v, current[k])

                    elif k in [
                        "trading_mode",
                        "execution_mode",
                        "name",
                        "data_source",
                        "king_model_path",
                        "council_model_path",
                        "timeframe",
                        "exit_mode",
                        "status",
                        "schedule_start_time",
                        "schedule_end_time",
                        "schedule_timezone",
                    ]:
                        current[k] = str(v).strip()
                    elif k == "telegram_token":
                        if v:
                            current[k] = str(v).strip()
                    elif k == "schedule_days":
                        if isinstance(v, list):
                            current[k] = [int(x) for x in v]
                        else:
                            current[k] = v
                    else:
                        current[k] = v

            self.config = BotConfig(**current)
            self._log("Configuration updated.")

    def start(self):
        with self._lock:
            if self._status == "running":
                self._log("Bot is already running.")
                return

            self._stop_event.clear()
            self._error_msg = None
            self._status = "starting"
            self._started_at = datetime.now(timezone.utc).isoformat()

            # Ensure Virtual Broker is seeded with our restored pos_state
            if self.api and hasattr(self.api, "seed_positions_from_state"):
                self.api.seed_positions_from_state(self._pos_state)
                self._log(
                    f"Seeded virtual broker with {len(self._pos_state)} existing positions."
                )

            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
            self._status = "running"
            self._log("Bot started in background thread.")

    @property
    def is_running(self) -> bool:
        return self._status == "running"

    def stop(self):
        with self._lock:
            if self._status != "running":
                return
            self._log("Stopping bot...")
            self._status = "stopping"
            self._stop_event.set()
        # Persist state on shutdown so positions survive restart
        self._save_bot_state()

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            uptime_str = "N/A"
            if self._started_at:
                try:
                    start_dt = datetime.fromisoformat(
                        self._started_at.replace("Z", "+00:00")
                    )
                    dur = datetime.now(timezone.utc) - start_dt

                    # Format: 00d 00h 00m 00s
                    days = dur.days
                    hours, rem = divmod(dur.seconds, 3600)
                    minutes, seconds = divmod(rem, 60)
                    uptime_str = f"{days}d {hours:02}h {minutes:02}m {seconds:02}s"
                except:
                    pass

            return {
                "status": self._status,
                "config": asdict(self.config),
                "last_scan": self._last_scan_time,
                "error": self._error_msg,
                "data_stream": self._data_stream,
                "logs": self.get_safe_logs(500),  # Return last 500 logs
                "trades": self.get_safe_trades(50),
                "started_at": self._started_at,
                "uptime": uptime_str,
                "current_activity": self._current_activity,
                "active_positions_count": len(self._pos_state),
            }

    def get_safe_logs(self, limit: int = 1000) -> List[str]:
        """Returns a thread-safe copy of logs."""
        with self._lock:
            all_logs = list(self._logs)
            return all_logs[-limit:] if len(all_logs) > limit else all_logs

    def get_safe_trades(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Returns a thread-safe copy of trades."""
        with self._lock:
            all_trades = list(self._trades)
            return all_trades[-limit:] if len(all_trades) > limit else all_trades

    def _load_models(self):
        from api.backtest_radar import load_model, reconstruct_meta_model
        from api.council_validator import load_council_validator_from_path

        king_path = (
            str(self.config.king_model_path)
            .strip()
            .strip('"')
            .strip("'")
            .replace("👑", "")
            .replace("💎", "")
            .replace("🌋", "")
            .replace(" ", "")
            .replace(".pkl", "")
            + ".pkl"
        )
        # Wait, removing all spaces is dangerous if the path legitimately has spaces.
        # Just remove the emojis.
        king_path = (
            str(self.config.king_model_path)
            .strip()
            .strip('"')
            .strip("'")
            .replace("👑", "")
            .replace("💎", "")
            .replace("🌋", "")
            .replace(" .pkl", ".pkl")
            .replace("  .pkl", ".pkl")
        )
        self._log(f"Loading KING model from {repr(king_path)}...")
        king_art = load_model(king_path)
        if king_art is None:
            raise ValueError(f"Failed to load KING model from {king_path}")

        # Override config parameters using model metadata to align live trading with training/backtest
        if isinstance(king_art, dict):

            def _meta_get(name: str, default=None):
                v = king_art.get(name)
                if v is not None:
                    return v
                tp = king_art.get("trading_parameters") or king_art.get("tradingParameters")
                if isinstance(tp, dict):
                    v = tp.get(name)
                    if v is not None:
                        return v
                pm = (
                    king_art.get("primary_model")
                    if isinstance(king_art.get("primary_model"), dict)
                    else {}
                )
                if isinstance(pm, dict):
                    v = pm.get(name)
                    if v is not None:
                        return v
                    pm_tp = pm.get("trading_parameters") or pm.get("tradingParameters")
                    if isinstance(pm_tp, dict):
                        v = pm_tp.get(name)
                        if v is not None:
                            return v
                return default

            m_target = _meta_get("target_pct")
            m_sl = _meta_get("stop_loss_pct")
            m_hold = _meta_get("look_forward_days") or _meta_get("hold_max_bars")
            m_thresh = (
                _meta_get("optimal_threshold")
                or _meta_get("buy_threshold")
                or _meta_get("buyThreshold")
                or _meta_get("meta_threshold")
            )
            m_barrier_mode = (
                str(_meta_get("barrier_mode") or _meta_get("barrierMode") or "")
                .strip()
                .lower()
            )

            percent_mode = m_barrier_mode == "percent"
            if not m_barrier_mode:
                try:
                    percent_mode = float(m_target) < 1.0 and float(m_sl) < 1.0
                except Exception:
                    percent_mode = False

            # Strict validation check
            is_strict = os.getenv("STRICT_VALIDATION", "False").lower() in ("true", "1")
            if is_strict:
                mismatches = []
                if percent_mode:
                    if m_target is not None and float(m_target) > 0 and abs(self.config.target_pct - float(m_target)) > 1e-5:
                        mismatches.append(f"target_pct (config: {self.config.target_pct}, model: {m_target})")
                    if m_sl is not None and float(m_sl) > 0 and abs(self.config.stop_loss_pct - float(m_sl)) > 1e-5:
                        mismatches.append(f"stop_loss_pct (config: {self.config.stop_loss_pct}, model: {m_sl})")
                if m_hold is not None and int(m_hold) > 0 and int(m_hold) != self.config.hold_max_bars:
                    mismatches.append(f"hold_max_bars (config: {self.config.hold_max_bars}, model: {m_hold})")
                if m_thresh is not None and float(m_thresh) > 0 and abs(self.config.king_threshold - float(m_thresh)) > 1e-5:
                    mismatches.append(f"king_threshold (config: {self.config.king_threshold}, model: {m_thresh})")
                if mismatches:
                    raise ValueError(f"STRICT VALIDATION ERROR: Mismatches found: {', '.join(mismatches)}")

            if percent_mode:
                if m_target is not None and float(m_target) > 0:
                    self.config.target_pct = float(m_target)
                    self._log(
                        f"🟢 Overriding target_pct from model metadata: {self.config.target_pct:.1%}"
                    )
                if m_sl is not None and float(m_sl) > 0:
                    self.config.stop_loss_pct = float(m_sl)
                    self._log(
                        f"🟢 Overriding stop_loss_pct from model metadata: {self.config.stop_loss_pct:.1%}"
                    )
                self.barrier_mode = "percent"
            else:
                # ATR mode: need to use ATR multipliers instead of percentages
                self.barrier_mode = "atr"
                self._log(
                    f"⚠️ KING model was trained with ATR barrier mode. Will use ATR={self.config.atr_tp_multiplier}x TP / {self.config.atr_sl_multiplier}x SL multipliers in live trading."
                )
            if m_hold is not None and int(m_hold) > 0:
                self.config.hold_max_bars = int(m_hold)
                self._log(
                    f"🟢 Overriding hold_max_bars from model metadata: {self.config.hold_max_bars}"
                )
            if m_thresh is not None and float(m_thresh) > 0:
                self.config.king_threshold = float(m_thresh)
                self._log(
                    f"🟢 Overriding king_threshold from model metadata: {self.config.king_threshold:.2f}"
                )

        king_clf = reconstruct_meta_model(king_art)
        if king_clf is None:
            # Fallback if it's already a classifier
            king_clf = king_art

        from api.trading_config import TradingParameters
        self.trading_params = TradingParameters.from_model_artifact(king_art)

        council_path = (
            str(self.config.council_model_path)
            .strip()
            .strip('"')
            .strip("'")
            .replace("👑", "")
            .replace("💎", "")
            .replace("🌋", "")
            .replace(" .pkl", ".pkl")
            .replace("  .pkl", ".pkl")
        )
        self._log(f"Loading COUNCIL model from {repr(council_path)}...")
        # Note: load_council_validator_from_path handles its own loading internal to the pkl
        validator = load_council_validator_from_path(council_path)
        if validator is None:
            # We don't raise here because COUNCIL might be optional if use_council is False,
            # but usually it's better to have it if configured.
            self._log("Warning: COUNCIL validator failed to load.")

        return king_art, king_clf, validator

    def _sync_pos_state(self):
        """
        Sync internal _pos_state with actual virtual positions.
        """
        if self.config.execution_mode == "TELEGRAM":
            # In TELEGRAM mode there is no virtual broker, but still
            # persist the current _pos_state so it survives restarts.
            self._save_bot_state()
            return

        try:
            # Sync with the Virtual Broker (self.api)
            positions = self.api.list_positions()
            current_norms = set()

            p_list = []
            for p in positions:
                sym = str(getattr(p, "symbol", "") or "")
                norm = _normalize_symbol(sym)
                current_norms.add(norm)
                p_list.append(norm)

                if norm not in self._pos_state:
                    self._log(
                        f"Sync: New position found for {sym}. Adding to internal state."
                    )
                    self._pos_state[norm] = {
                        "entry_price": float(getattr(p, "avg_entry_price", 0)),
                        "entry_time": datetime.now(timezone.utc).isoformat(),
                        "bars_held": 0,
                        "current_stop": None,
                        "trail_mode": "NONE",
                    }

            # Prune closed positions
            to_remove = [norm for norm in self._pos_state if norm not in current_norms]
            for norm in to_remove:
                self._log(f"Sync: Pruning {norm} (no longer in virtual broker).")
                self._pos_state.pop(norm, None)

            # Save synced state
            self._save_bot_state()

            # Periodic debug log
            if datetime.now().minute % 5 == 0:  # Every 5 mins
                self._log(
                    f"DEBUG POS SYNC: Virtual({len(p_list)})={p_list} | Bot({len(self._pos_state)})={list(self._pos_state.keys())}"
                )

        except Exception as e:
            self._log(f"Sync Error: {e}")

    def _reset_booster_cats(self, obj):
        """Wrapper around model_utils.reset_booster_cats with logging."""
        reset_booster_cats(obj, logger=self._log)

    def _reset_nested_boosters(self, obj):
        """Wrapper around model_utils.reset_nested_boosters with logging."""
        reset_nested_boosters(obj, logger=self._log)

    def _get_primary_booster(self, obj):
        """Wrapper around model_utils.get_primary_booster."""
        return get_primary_booster(obj)

    def _align_pandas_categories_to_booster(
        self, X_in: pd.DataFrame, cat_cols: list, booster, cat_cols_order: list
    ):
        """Wrapper around model_utils.align_pandas_categories_to_booster."""
        return align_pandas_categories_to_booster(
            X_in, cat_cols, booster, cat_cols_order
        )

    def _align_for_king(
        self, X_src: pd.DataFrame, king_artifact: object
    ) -> pd.DataFrame:
        """Wrapper around model_utils.align_for_king with logging."""
        return align_for_king(X_src, king_artifact, logger=self._log)

    def _fetch_market_index_data(self, symbol: str) -> pd.DataFrame:
        """Fetch market index data from Supabase stock_prices table using pagination."""
        import api.stock_ai as stock_ai

        if not stock_ai.supabase:
            return pd.DataFrame()
        try:
            sym = symbol
            ex = None
            if "." in symbol:
                parts = symbol.split(".")
                sym = parts[0]
                ex = parts[1]
                if ex in ["CC", "CA"]:
                    ex = "EGX"

            offset = 0
            limit = 1000
            all_data = []
            while True:
                query = (
                    stock_ai.supabase.table("stock_prices")
                    .select("date, close")
                    .eq("symbol", sym)
                )
                if ex:
                    query = query.eq("exchange", ex)
                idx_res = (
                    query.order("date", desc=False)
                    .range(offset, offset + limit - 1)
                    .execute()
                )
                if not idx_res.data:
                    break
                all_data.extend(idx_res.data)
                if len(idx_res.data) < limit:
                    break
                offset += limit

            if all_data:
                df = pd.DataFrame(all_data)
                df["date"] = pd.to_datetime(df["date"])
                df = df.set_index("date").sort_index()
                return df
        except Exception as e:
            self._log(f"Error fetching market index {symbol} from DB: {e}")
        return pd.DataFrame()

    def _prepare_features(
        self,
        bars: pd.DataFrame,
        market_df: Optional[pd.DataFrame] = None,
        df_funds: Optional[pd.DataFrame] = None,
        symbol: Optional[str] = None,
    ) -> pd.DataFrame:
        from api.train_exchange_model import (
            add_massive_features,
            add_technical_indicators,
        )

        df = bars.copy()

        # TIMEZONE STANDARDIZATION: Ensure all timestamps are UTC
        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
            df = df.dropna(subset=["timestamp"]).sort_values("timestamp")
            df = df.set_index("timestamp")
        elif isinstance(df.index, pd.DatetimeIndex):
            # Ensure index is UTC
            if df.index.tz is None:
                df.index = df.index.tz_localize("UTC")
            else:
                df.index = df.index.tz_convert("UTC")

        # Standardize market_df if provided
        if market_df is not None and not market_df.empty:
            if isinstance(market_df.index, pd.DatetimeIndex):
                if market_df.index.tz is None:
                    market_df = market_df.copy()
                    market_df.index = market_df.index.tz_localize("UTC")
                elif market_df.index.tz.zone != "UTC":
                    market_df = market_df.copy()
                    market_df.index = market_df.index.tz_convert("UTC")

        df = df.replace([np.inf, -np.inf], np.nan)
        df = df.dropna(
            subset=[
                c for c in ["open", "high", "low", "close", "volume"] if c in df.columns
            ]
        )

        # Some TA feature generators crash on very short series (e.g., certain windowed indicators).
        # FIXED: raised from 50 to 100 to ensure robust indicator computation
        # (EMA200 needs 200 bars ideally, but 100 is a practical minimum)
        if len(df) < 100:
            self._log(f"Warning: Not enough bars for features ({len(df)} < 100)")
            return pd.DataFrame()

        try:
            feat = add_technical_indicators(df)
            if feat is None or feat.empty:
                return pd.DataFrame()

            # Join fundamentals and sector average returns BEFORE massive features to align with training
            if symbol and df_funds is not None and not df_funds.empty:
                feat["symbol"] = symbol
                feat = feat.join(df_funds.set_index("symbol"), on="symbol", how="left")

            if (
                hasattr(self, "_sector_returns_df")
                and self._sector_returns_df is not None
                and not self._sector_returns_df.empty
            ):
                symbol_sector = "Unknown"
                if df_funds is not None and not df_funds.empty:
                    match = df_funds[df_funds["symbol"] == symbol]
                    if not match.empty:
                        symbol_sector = match.iloc[0].get("sector", "Unknown")

                sec_df = self._sector_returns_df[
                    self._sector_returns_df["sector"] == symbol_sector
                ]
                if not sec_df.empty:
                    sec_df = sec_df.rename(
                        columns={"daily_return": "sector_avg_return"}
                    ).copy()
                    sec_df["date"] = pd.to_datetime(sec_df["date"])

                    feat = feat.reset_index()
                    idx_col = (
                        "timestamp"
                        if "timestamp" in feat.columns
                        else "index"
                        if "index" in feat.columns
                        else None
                    )
                    if idx_col:
                        feat["date_only"] = pd.to_datetime(feat[idx_col]).dt.date
                        sec_df["date_only"] = pd.to_datetime(sec_df["date"]).dt.date
                        feat = feat.merge(
                            sec_df[["date_only", "sector_avg_return"]],
                            on="date_only",
                            how="left",
                        )
                        feat = feat.drop(columns=["date_only"])
                        feat = feat.set_index(idx_col)
                    else:
                        feat["date_only"] = pd.to_datetime(feat.index).dt.date
                        sec_df["date_only"] = pd.to_datetime(sec_df["date"]).dt.date
                        feat = feat.merge(
                            sec_df[["date_only", "sector_avg_return"]],
                            on="date_only",
                            how="left",
                        )
                        feat = feat.drop(columns=["date_only"])

            feat = (
                add_massive_features.__wrapped__(feat)
                if hasattr(add_massive_features, "__wrapped__")
                else add_massive_features(feat)
            )

            if market_df is not None and not market_df.empty:
                from api.train_exchange_model import add_market_context

                # Both feat and market_aligned should already be UTC from _prepare_features
                # No additional timezone conversion needed
                feat = add_market_context(feat, market_df)

        except Exception as e:
            self._log(f"Feature generation error: {e}")
            import traceback

            self._log(traceback.format_exc())
            return pd.DataFrame()

        feat = feat.replace([np.inf, -np.inf], np.nan).fillna(0)
        return feat

    # REMOVED: Duplicate _process_bars definition was here.
    # REMOVED: Duplicate _handle_fetch_error definition was here.
    # The canonical versions are defined further below.

    def _get_bars(self, symbol: str, limit: int) -> pd.DataFrame:
        """Dispatcher to fetch bars based on symbol type and data source."""
        # Detect if it's likely a stock (no slash, 4 letters or explicitly dot-suffixed)
        is_crypto = "/" in symbol or symbol.endswith("USD") or symbol.endswith("USDT")

        # If the user explicitly sets a data source for the whole bot, we might respect it,
        # but for symbols like EGX ones, we need specific handling.
        source = (getattr(self.config, "data_source", "Virtual") or "Virtual").lower()

        # EGX Heuristic: 4 uppercase letters and no slash
        if (
            not is_crypto
            and len(symbol) <= 5
            and symbol.isupper()
            and "/" not in symbol
        ):
            # Since yfinance is broken for EGX symbols, route them to tvdata first
            self._log(f"Routing stock {symbol} to tvdata (Stock Detection)")
            return self._get_tvdata_bars(symbol, limit)

        if (
            symbol in self._data_stream
            and self._data_stream[symbol]["status"] == "ERROR"
            and "yfinance" not in self._data_stream[symbol].get("message", "")
        ):
            # If already failed on primary, might already be routed or need routing
            pass

        if is_crypto:
            return self._get_crypto_bars(symbol, limit)
        elif source == "tvdata":
            return self._get_tvdata_bars(symbol, limit)
        else:
            return self._get_stock_bars(symbol, limit)

    def _get_crypto_bars(self, symbol: str, limit: int) -> pd.DataFrame:
        """Fetch crypto bars (Binance default)."""
        # ✅ Strict Symbol Filter
        normalized_symbol = symbol.strip().upper()
        allowed_symbols = [s.strip().upper() for s in (self.config.coins or [])]

        if normalized_symbol not in allowed_symbols:
            self._log(f"{symbol}: NOT IN CONFIG - Rejecting fetch")
            return pd.DataFrame()

        try:
            from api.binance_data import fetch_binance_bars_df

            bars = fetch_binance_bars_df(
                symbol, timeframe=self.config.timeframe, limit=int(limit)
            )
            return self._process_bars(bars, symbol, "binance", limit)
        except Exception as e:
            return self._handle_fetch_error(e, symbol, limit)

    def _get_stock_bars(self, symbol: str, limit: int) -> pd.DataFrame:
        """Fetch stock bars."""
        # Try tvdata first to ensure EGX or other stock coverage
        try:
            bars = self._get_tvdata_bars(symbol, limit)
            if not bars.empty:
                return bars
        except Exception:
            pass

        try:
            return self._get_yfinance_bars(symbol, limit)
        except Exception as e:
            return self._handle_fetch_error(e, symbol, limit)

    def _process_bars(
        self, bars: pd.DataFrame, symbol: str, source: str, limit: int
    ) -> pd.DataFrame:
        if bars is None or bars.empty:
            self._data_stream[symbol] = {
                "source": source,
                "count": 0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "status": "EMPTY",
            }
            return pd.DataFrame()

        has_volume = False
        if "volume" in bars.columns:
            try:
                has_volume = float(bars["volume"].sum()) > 0
            except:
                pass

        self._data_stream[symbol] = {
            "source": source,
            "count": len(bars),
            "has_volume": has_volume,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "OK",
        }
        return bars.reset_index().tail(limit)

    def _handle_fetch_error(
        self, e: Exception, symbol: str, limit: int
    ) -> pd.DataFrame:
        err_msg = str(e)
        self._data_stream[symbol] = {
            "source": self.config.data_source,
            "count": 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "ERROR",
            "message": err_msg,
        }
        if (
            "451" in str(e)
            or "block" in str(e).lower()
            or "invalid symbol" in str(e).lower()
        ):
            self._log(f"Fetch failed for {symbol}: {e}. Trying yfinance fallback...")
            return self._get_yfinance_bars(symbol, limit)
        self._log(f"Error fetching bars for {symbol}: {e}")
        return pd.DataFrame()

    def _get_yfinance_bars(self, symbol: str, limit: int) -> pd.DataFrame:
        try:
            # Fallback for EGX symbols in yfinance: add .CA if not present and no dot
            if (
                symbol.isupper()
                and len(symbol) <= 5
                and "." not in symbol
                and "/" not in symbol
            ):
                yf_sym = f"{symbol}.CA"
            else:
                yf_sym = symbol.replace("/", "-")

            # Map timeframe
            tf_map = {
                "1Hour": "1h",
                "1min": "1m",
                "5min": "5m",
                "15min": "15m",
                "30Min": "30m",
                "4Hour": "4h",
                "1Day": "1d",
            }
            period_map = {
                "1h": "10d",
                "1m": "1d",
                "5m": "5d",
                "15m": "10d",
                "30m": "15d",
                "4h": "30d",
                "1d": "1y",
            }

            tf = tf_map.get(self.config.timeframe, "1h")
            period = period_map.get(tf, "10d")

            ticker = yf.Ticker(yf_sym)
            df = ticker.history(period=period, interval=tf)
            if df.empty:
                return pd.DataFrame()

            df = df.reset_index()
            df = df.rename(
                columns={
                    "Datetime": "timestamp",
                    "Date": "timestamp",
                    "Open": "open",
                    "High": "high",
                    "Low": "low",
                    "Close": "close",
                    "Volume": "volume",
                }
            )
            # Ensure UTC
            if df["timestamp"].dt.tz is None:
                df["timestamp"] = df["timestamp"].dt.tz_localize("UTC")
            else:
                df["timestamp"] = df["timestamp"].dt.tz_convert("UTC")

            return self._process_bars(df, symbol, "yfinance", limit)
        except Exception as e:
            self._handle_fetch_error(e, symbol, limit)
            self._log(f"yfinance fallback failed for {symbol}: {e}")
            return pd.DataFrame()

    def _get_tvdata_bars(self, symbol: str, limit: int) -> pd.DataFrame:
        """Fetch bars using tvDatafeed (TradingView)."""
        if TvDatafeed is None:
            self._log("tvDatafeed not installed. Falling back to yfinance.")
            return self._get_yfinance_bars(symbol, limit)

        try:
            from api.tradingview_integration import get_tradingview_exchange

            tv_exchange = get_tradingview_exchange(symbol)
            if (
                not tv_exchange
                and symbol.isupper()
                and len(symbol) <= 5
                and "/" not in symbol
            ):
                tv_exchange = "EGX"
            base_sym = symbol.split(".")[0] if "." in symbol else symbol

            # Map timeframe
            tf_map = {
                "1min": Interval.in_1_minute,
                "5min": Interval.in_5_minute,
                "15min": Interval.in_15_minute,
                "30Min": Interval.in_30_minute,
                "1Hour": Interval.in_1_hour,
                "4Hour": Interval.in_4_hour,
                "1Day": Interval.in_daily,
            }
            tf = tf_map.get(self.config.timeframe, Interval.in_1_hour)

            tv = TvDatafeed()
            df = tv.get_hist(
                symbol=base_sym,
                exchange=tv_exchange,
                interval=tf,
                n_bars=int(limit or 200),
            )

            if df is None or df.empty:
                self._log(f"tvDatafeed returned no data for {symbol}. Trying yfinance.")
                return self._get_yfinance_bars(symbol, limit)

            df = df.reset_index().rename(
                columns={
                    "datetime": "timestamp",
                    "open": "open",
                    "high": "high",
                    "low": "low",
                    "close": "close",
                    "volume": "volume",
                }
            )

            # Ensure UTC
            if df["timestamp"].dt.tz is None:
                df["timestamp"] = df["timestamp"].dt.tz_localize("UTC")
            else:
                df["timestamp"] = df["timestamp"].dt.tz_convert("UTC")

            return self._process_bars(df, symbol, "tvdata", limit)
        except Exception as e:
            self._log(f"tvDatafeed failed for {symbol}: {e}. Falling back to yfinance.")
            return self._get_yfinance_bars(symbol, limit)

    def _save_to_supabase(self, bars: pd.DataFrame, symbol: str):
        # Check if saving to Supabase is enabled
        if not getattr(self.config, "save_to_supabase", True):
            return

        if bars.empty:
            return

        try:
            # Crypto bars are intraday/time-series, so store them in `stock_bars_intraday`
            # (NOT `stock_prices`, which is daily and keyed by `date date`).
            exchange = "CRYPTO"
            timeframe = _to_intraday_timeframe(
                getattr(self.config, "timeframe", "") or ""
            )

            # Logic: Only save if the latest bar's timestamp has changed.
            # This keeps the DB storage aligned with the Timeframe, not the Poll Interval.
            latest_bar = bars.iloc[-1]
            latest_ts = str(
                latest_bar.get("timestamp") or getattr(latest_bar, "name", "")
            )

            if self._last_save_bars_ts.get(symbol) == latest_ts:
                # Already saved this bar, skip redundant upsert
                return

            rows = []
            # Make sure we have timestamp
            df = bars.reset_index() if "timestamp" not in bars.columns else bars.copy()
            if "timestamp" not in df.columns:
                return

            for _, row in df.iterrows():
                ts = row["timestamp"]
                # Convert timestamp to ISO/String for DB timestamptz
                ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)

                record = {
                    "symbol": symbol,
                    "exchange": exchange,
                    "timeframe": timeframe,
                    "ts": ts_str,
                    "open": float(row.get("open", 0)),
                    "high": float(row.get("high", 0)),
                    "low": float(row.get("low", 0)),
                    "close": float(row.get("close", 0)),
                    # volume is bigint in schema; crypto volume can be fractional.
                    "volume": _safe_int(row.get("volume", 0), default=0),
                }
                rows.append(record)

            if rows:
                # Supabase/Postgres throws `21000 ... cannot affect row a second time` if a single
                # upsert statement contains duplicate values for the conflict key.
                # Virtual bars can occasionally contain duplicate timestamps; dedupe by the conflict key.
                deduped: Dict[tuple[str, str, str, str], Dict[str, Any]] = {}
                for r in rows:
                    key = (
                        str(r.get("symbol")),
                        str(r.get("exchange")),
                        str(r.get("timeframe")),
                        str(r.get("ts")),
                    )
                    deduped[key] = r
                rows = list(deduped.values())

                if exchange == "CRYPTO":
                    from api.local_storage import save_crypto_bars_local

                    save_crypto_bars_local(symbol, timeframe, rows)
                    self._last_save_bars_ts[symbol] = latest_ts
                else:
                    _supabase_upsert_with_retry(
                        "stock_bars_intraday",
                        rows,
                        on_conflict="symbol,exchange,timeframe,ts",
                    )
                    self._last_save_bars_ts[symbol] = latest_ts
                    # self._log(f"Saved {len(rows)} bars for {symbol} to DB.")

        except Exception as e:
            self._log(f"DB Save Error {symbol}: {e}")

    def _has_open_position(self, symbol: str) -> bool:
        try:
            norm = _normalize_symbol(symbol)
            for p in self.api.list_positions():
                if _normalize_symbol(getattr(p, "symbol", "")) == norm:
                    return True
            return False
        except Exception:
            return False

    def _wait_for_fill(
        self, order_id: str, timeout_seconds: int = 10
    ) -> Optional[float]:
        """Check virtual order status and return the average fill price."""
        try:
            order = self.api.get_order(order_id)
            if order and order.status == "filled":
                return float(order.filled_avg_price)
        except Exception as e:
            self._log(f"Error checking fill for {order_id}: {e}")
        return None

    def _get_open_position(self, symbol: str):
        try:
            norm = _normalize_symbol(symbol)
            for p in self.api.list_positions():
                if _normalize_symbol(getattr(p, "symbol", "")) == norm:
                    return p
            return None
        except Exception:
            return None

    def _buy_market(self, symbol: str, notional_usd: float) -> bool:
        try:
            order = self.api.submit_order(
                symbol=symbol,
                notional=float(notional_usd),
                side="buy",
                type="market",
                time_in_force="gtc",
            )
            order_id = str(getattr(order, "id", "unknown"))
            self._log(
                f"Buy order submitted: {symbol} (${notional_usd:.2f}) - ID: {order_id}"
            )

            # Wait for fill to get accurate entry price
            avg_fill = self._wait_for_fill(order_id)

            # Preserve calculations (regime, quality) made in _run_loop
            self._pos_state[_normalize_symbol(symbol)].update(
                {
                    "symbol": symbol,
                    "entry_price": avg_fill,
                    "entry_time": datetime.now(timezone.utc).isoformat(),
                    "bars_held": 0,
                    "current_stop": None,
                    "target_price": None,  # Will be set by ATR or static config in next loop
                    "trail_mode": "NONE",
                    "order_id": order_id,  # Store BUY order_id for future linkage
                    "notional": float(
                        notional_usd
                    ),  # USD invested — used to derive qty for P/L
                }
            )
            trade = {
                "timestamp": datetime.now().isoformat(),
                "symbol": symbol,
                "action": "BUY",
                "amount": float(notional_usd),
                "price": avg_fill,
                "entry_price": avg_fill,
                "pnl": 0.0,
                "order_id": order_id,
            }
            self._trades.append(trade)
            self._save_trade_persistent(trade)

            if self.telegram_bridge and self.config.execution_mode in [
                "TELEGRAM",
                "BOTH",
            ]:
                price_str = f"${avg_fill:,.4f}" if avg_fill else "pending fill"
                state = self._pos_state.get(_normalize_symbol(symbol), {})

                msg = (
                    f"BUY EXECUTED\n"
                    f"━━━━━━━━━━━━━━━\n"
                    f"💎 Symbol: {symbol}\n"
                    f"💰 Price: {price_str}\n"
                    f"💵 Amount: ${float(notional_usd):,.2f}\n"
                    f"📊 Regime: {state.get('regime', 'N/A')}\n"
                    f"🎯 Quality: {state.get('quality_score', 0):.0f}\n"
                    f"━━━━━━━━━━━━━━━\n"
                    f"🤖 Bot: {self.config.name}"
                )
                self.telegram_bridge.send_notification(msg)
            return True
        except Exception as e:
            self._log(f"Buy failed for {symbol}: {e}")
            return False

    def _sell_market(
        self, symbol: str, qty: float, stop_price: Optional[float] = None
    ) -> bool:
        try:
            # Apply safety factor for crypto/floating point precision issues
            # Reduce by 0.01% to ensure available balance is sufficient, but don't drop below 1e-9
            is_crypto = (
                "/" in symbol
                or symbol.upper().endswith("USD")
                or symbol.upper().endswith("USDT")
            )
            safe_qty = float(qty)
            if is_crypto:
                reduced_qty = safe_qty * 0.9999
                # If reduction pushes it below min, keep it at a reasonable precision.
                # Virtual minimum for crypto 1e-8 is removed. We use 1e-6 as a safe floor.
                if reduced_qty < 1e-6 and safe_qty >= 1e-6:
                    safe_qty = 1e-6
                else:
                    safe_qty = reduced_qty

                self._log(f"DEBUG: Applying crypto safety factor: {qty} -> {safe_qty}")

            # If we are selling the full relative amount, try close_position for better precision
            # We assume it's a full sell if qty is very close to current pos qty (handled by caller or sync)
            order = None
            try:
                # If the caller is trying to sell everything (qty is almost max), use close_position
                pos = self._get_open_position(symbol)
                if (
                    pos
                    and abs(float(getattr(pos, "qty", 0)) - safe_qty) / safe_qty < 0.001
                ):
                    self._log(
                        f"Using close_position for {symbol} to ensure clean exit."
                    )
                    order = self.api.close_position(symbol, stop_price=stop_price)
                    order_id = str(
                        getattr(
                            order,
                            "id",
                            f"unknown_close_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                        )
                    )
                else:
                    order = self.api.submit_order(
                        symbol=symbol,
                        qty=safe_qty,
                        side="sell",
                        type="market",
                        time_in_force="gtc",
                        stop_price=stop_price,
                    )
                    order_id = str(
                        getattr(
                            order,
                            "id",
                            f"unknown_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{symbol.replace('/', '')}",
                        )
                    )
            except Exception as e:
                # Fallback to standard submit if close_position fails or other issue
                self._log(f"Standard sell fallback for {symbol}: {e}")
                order = self.api.submit_order(
                    symbol=symbol,
                    qty=safe_qty,
                    side="sell",
                    type="market",
                    time_in_force="gtc",
                    stop_price=stop_price,
                )
                order_id = str(
                    getattr(
                        order,
                        "id",
                        f"unknown_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{symbol.replace('/', '')}",
                    )
                )
            self._log(f"Sell order submitted: {symbol} ({qty}) - ID: {order_id}")

            # Wait for fill to get accurate exit price
            fill_price = self._wait_for_fill(order_id)

            # Calculate PnL and Track Limits
            pnl = 0.0
            entry_price = self._pos_state.get(_normalize_symbol(symbol), {}).get(
                "entry_price"
            )

            if entry_price and fill_price:
                qty_sold = float(qty)
                pnl = (fill_price - entry_price) * qty_sold
                self._daily_loss += pnl
                if pnl < 0:
                    self._consecutive_losses += 1
                else:
                    self._consecutive_losses = 0

            trade = {
                "timestamp": datetime.now().isoformat(),
                "symbol": symbol,
                "action": "SELL",
                "amount": float(qty),
                "price": fill_price,
                "entry_price": entry_price,
                "pnl": pnl,
                "order_id": order_id,
                "metadata": {
                    "parent_order_id": self._pos_state.get(
                        _normalize_symbol(symbol), {}
                    ).get("order_id")
                },
            }
            self._trades.append(trade)
            self._save_trade_persistent(trade)

            # NOTE: Sell notifications to Telegram are DISABLED to prevent
            # Cornix from processing them. Sell trades are still recorded
            # internally (trades list, Supabase, logs).
            # if self.telegram_bridge:
            #     emoji = "🟢" if pnl > 0 else "🔴"
            #     exit_str = f"${fill_price:,.4f}" if fill_price else "pending fill"
            #     pnl_pct = 0.0
            #     if entry_price and fill_price:
            #         pnl_pct = ((fill_price / entry_price) - 1) * 100
            #     msg = (
            #         f"SELL EXECUTED\n"
            #         f"━━━━━━━━━━━━━━━\n"
            #         f"💎 Symbol: {symbol}\n"
            #         f"💰 Exit Price: {exit_str} ({pnl_pct:+.2f}%)\n"
            #         f"💵 PnL: ${pnl:,.2f}\n"
            #         f"📈 Daily PnL: ${self._daily_loss:,.2f}\n"
            #         f"━━━━━━━━━━━━━━━\n"
            #         f"🤖 Bot: {self.config.name}"
            #     )
            #     self.telegram_bridge.send_notification(msg)

            self._pos_state.pop(_normalize_symbol(symbol), None)

            # Persist state after sell so positions survive restart
            self._save_bot_state()

            # 🧊 Cooldown: Ban symbol for X minutes
            self._cooldowns[_normalize_symbol(symbol)] = datetime.now(timezone.utc)
            self._log(
                f"🧊 COOLDOWN: {symbol} banned for {self.config.cooldown_minutes} mins."
            )

            return True
        except Exception as e:
            self._log(f"Sell failed for {symbol}: {e}")
            return False

    def _process_subscribers_exits(self, symbol: str, bars: pd.DataFrame):
        """
        Evaluate and process exits for all active subscriber positions in the database.
        """
        supabase = self.sb
        if bars is None or bars.empty:
            return

        try:
            last = bars.iloc[-1]
            hi = float(last.get("high", 0) or 0)
            lo = float(last.get("low", 0) or 0)
            close = float(last.get("close", 0) or 0)
        except Exception:
            return

        try:
            # Fetch all open positions for this symbol from supabase
            pos_res = (
                supabase.table("positions")
                .select("*")
                .eq("symbol", symbol)
                .eq("status", "open")
                .execute()
            )

            open_pos = pos_res.data or []

            for pos in open_pos:
                meta = pos.get("metadata") or {}
                if meta.get("bot_id") != self.bot_id:
                    continue

                user_id = pos.get("user_id")
                # Retrieve subscription details to get their parameters and Telegram info
                sub_res = (
                    supabase.table("bot_subscriptions")
                    .select("*")
                    .eq("bot_id", self.bot_id)
                    .eq("user_id", user_id)
                    .execute()
                )
                if not sub_res.data:
                    # User is no longer subscribed, but we should still exit their position if hit
                    prof_res = (
                        supabase.table("profiles")
                        .select(
                            "default_target_pct, default_stop_pct, telegram_chat_id, language, notification_channel"
                        )
                        .eq("id", user_id)
                        .maybe_single()
                        .execute()
                    )
                    prof = prof_res.data if (prof_res and prof_res.data) else {}
                    sub = {}
                else:
                    sub = sub_res.data[0]
                    prof_res = (
                        supabase.table("profiles")
                        .select(
                            "default_target_pct, default_stop_pct, telegram_chat_id, language, notification_channel"
                        )
                        .eq("id", user_id)
                        .maybe_single()
                        .execute()
                    )
                    prof = prof_res.data if (prof_res and prof_res.data) else {}

                # Resolve parameters
                target_pct = float(
                    sub.get("target_pct")
                    if sub.get("target_pct") is not None
                    else (
                        prof.get("default_target_pct")
                        if prof.get("default_target_pct") is not None
                        else 0.10
                    )
                )
                stop_loss_pct = float(
                    sub.get("stop_loss_pct")
                    if sub.get("stop_loss_pct") is not None
                    else (
                        prof.get("default_stop_pct")
                        if prof.get("default_stop_pct") is not None
                        else 0.035
                    )
                )
                telegram_chat_id = (
                    sub.get("telegram_chat_id")
                    if sub.get("telegram_chat_id")
                    else (
                        prof.get("telegram_chat_id")
                        if prof.get("telegram_chat_id")
                        else None
                    )
                )
                channel = (
                    prof.get("notification_channel")
                    if prof.get("notification_channel")
                    else "telegram"
                )
                lang = prof.get("language", "en")

                entry_price = float(pos.get("entry_price") or 0)
                if entry_price <= 0:
                    continue

                target_price = (
                    float(pos.get("target_price"))
                    if pos.get("target_price") is not None
                    else (entry_price * (1 + target_pct / 100.0))
                )
                stop_price = (
                    float(pos.get("stop_price"))
                    if pos.get("stop_price") is not None
                    else (entry_price * (1 - stop_loss_pct / 100.0))
                )

                # Check hold time (bars held)
                current_ts = str(last.get("timestamp") or getattr(last, "name", ""))
                last_held_ts = meta.get("last_held_ts")
                bars_held = int(meta.get("bars_held") or 0)

                if current_ts != last_held_ts:
                    bars_held += 1
                    meta["last_held_ts"] = current_ts
                    meta["bars_held"] = bars_held

                exited = False
                exit_reason = ""
                exit_price = close
                status_val = "closed_manual"

                if lo <= stop_price:
                    exited = True
                    exit_reason = "hit_stop"
                    exit_price = stop_price
                    status_val = "hit_stop"
                elif hi >= target_price:
                    exited = True
                    exit_reason = "hit_target"
                    exit_price = target_price
                    status_val = "hit_target"
                elif bars_held >= int(self.config.hold_max_bars):
                    exited = True
                    exit_reason = "time_exit"
                    exit_price = close
                    status_val = "closed_manual"

                if exited:
                    pnl_pct = ((exit_price / entry_price) - 1) * 100.0
                    supabase.table("positions").update(
                        {
                            "status": status_val,
                            "status_price": exit_price,
                            "status_at": datetime.now(timezone.utc).isoformat(),
                            "metadata": meta,
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }
                    ).eq("id", pos["id"]).execute()

                    self._log(
                        f"Subscriber {user_id} exited {symbol}: {exit_reason} at {exit_price:.4f} ({pnl_pct:+.2f}%)"
                    )

                    if sub.get("notifications_enabled", True) is not False:
                        bot_name = self.config.name
                        if lang == "ar":
                            reason_ar = {
                                "hit_target": "تم تحقيق الهدف 🎯",
                                "hit_stop": "ضرب وقف الخسارة 🛡️",
                                "time_exit": "الحد الأقصى لوقت الاحتفاظ ⏰",
                            }.get(exit_reason, "خروج")
                            msg = (
                                f"🔴 *إشارة خروج*\n"
                                f"━━━━━━━━━━━━━━━\n"
                                f"💎 الرمز: `{symbol}`\n"
                                f"💰 سعر الخروج: `{exit_price:.4f}`\n"
                                f"📊 النتيجة: `{pnl_pct:+.2f}%` ({reason_ar})\n"
                                f"━━━━━━━━━━━━━━━\n"
                                f"🤖 البوت: {bot_name}"
                            )
                        else:
                            reason_en = {
                                "hit_target": "Target Hit 🎯",
                                "hit_stop": "Stop Loss Hit 🛡️",
                                "time_exit": "Max Hold Time Reached ⏰",
                            }.get(exit_reason, "Exit")
                            msg = (
                                f"🔴 *EXIT SIGNAL*\n"
                                f"━━━━━━━━━━━━━━━\n"
                                f"💎 Symbol: `{symbol}`\n"
                                f"💰 Exit Price: `{exit_price:.4f}`\n"
                                f"📊 PnL: `{pnl_pct:+.2f}%` ({reason_en})\n"
                                f"━━━━━━━━━━━━━━━\n"
                                f"🤖 Bot: {bot_name}"
                            )

                        if self.telegram_bridge and telegram_chat_id:
                            self.telegram_bridge.send_notification(
                                msg, chat_id=telegram_chat_id
                            )
                else:
                    updated_stop = stop_price
                    trail_mode = meta.get("trail_mode", "NONE")
                    if self.config.use_trailing:
                        be_price = float(entry_price)
                        lock_price = float(entry_price) * (
                            1 + float(self.config.trail_lock_pct)
                        )
                        if (
                            hi
                            >= float(entry_price)
                            * (1 + float(self.config.trail_lock_trigger_pct))
                            and stop_price < lock_price
                        ):
                            updated_stop = lock_price
                            trail_mode = "+LOCK"
                        elif (
                            hi
                            >= float(entry_price)
                            * (1 + float(self.config.trail_be_pct))
                            and stop_price < be_price
                        ):
                            updated_stop = be_price
                            trail_mode = "BE"

                    if updated_stop != stop_price or bars_held != int(
                        pos.get("metadata", {}).get("bars_held", 0)
                    ):
                        meta["trail_mode"] = trail_mode
                        supabase.table("positions").update(
                            {
                                "stop_price": updated_stop,
                                "metadata": meta,
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                            }
                        ).eq("id", pos["id"]).execute()

        except Exception as ex:
            self._log(f"Error processing subscriber exits: {ex}")
            traceback.print_exc()

    def _process_subscribers_entries(
        self,
        symbol: str,
        bars: pd.DataFrame,
        price: float,
        king_conf: float,
        council_conf: Optional[float],
        regime: str,
        quality: float,
        subscribers_data: list,
    ):
        """
        Evaluate and process entries (Risk Firewall checks, position creation, Telegram message)
        for all active subscribers when a BUY signal is generated.
        """
        supabase = self.sb
        for sub_data in subscribers_data:
            user_id = sub_data["user_id"]
            chat_id = sub_data["telegram_chat_id"]
            lang = sub_data["language"]

            target_pct = sub_data["target_pct"]
            stop_loss_pct = sub_data["stop_loss_pct"]
            max_positions = sub_data["max_open_positions"]
            pct_cash = sub_data["pct_cash_per_trade"]

            # 🔥 NEW: Check monthly signal cap
            if not self._check_monthly_signal_cap(symbol):
                continue

            try:
                pos_count_res = (
                    supabase.table("positions")
                    .select("id", count="exact")
                    .eq("user_id", user_id)
                    .eq("status", "open")
                    .execute()
                )

                open_count = (
                    pos_count_res.count
                    if pos_count_res.count is not None
                    else len(pos_count_res.data or [])
                )

                # Check if this subscriber already has an open position for this specific symbol
                sym_pos_res = (
                    supabase.table("positions")
                    .select("id")
                    .eq("user_id", user_id)
                    .eq("symbol", symbol)
                    .eq("status", "open")
                    .execute()
                )

                if sym_pos_res.data:
                    continue

                if open_count >= max_positions:
                    self._log(
                        f"Subscriber {user_id} Risk Firewall: max open positions ({open_count}/{max_positions}) reached. Skipping entry."
                    )
                    continue

                # Calculate TP/SL based on barrier_mode (percent or ATR)
                if self.barrier_mode == "atr":
                    # ATR mode: use multipliers on ATR
                    atr_val = bars.iloc[-2].get("ATR_14", 1.0) if len(bars) > 1 else 1.0
                    target_price = price + (atr_val * self.config.atr_tp_multiplier)
                    stop_price = price - (atr_val * self.config.atr_sl_multiplier)
                    display_tp_pct = (target_price / price - 1) * 100
                    display_sl_pct = (1 - stop_price / price) * 100
                else:
                    # Percentage mode: use direct percentages
                    target_price = price * (1 + target_pct / 100.0)
                    stop_price = price * (1 - stop_loss_pct / 100.0)
                    display_tp_pct = target_pct
                    display_sl_pct = stop_loss_pct

                meta = {
                    "bot_id": self.bot_id,
                    "bars_held": 0,
                    "last_held_ts": str(
                        bars.iloc[-1].get("timestamp")
                        or getattr(bars.iloc[-1], "name", "")
                    ),
                    "trail_mode": "NONE",
                    "regime": regime,
                    "quality_score": quality,
                    "pct_cash_per_trade": pct_cash,
                }

                source_val = (
                    "ai_scanner"
                    if "ai" in self.bot_id or "primary" in self.bot_id
                    else "tech_scanner"
                )

                new_pos = {
                    "user_id": user_id,
                    "symbol": symbol,
                    "name": symbol,
                    "source": source_val,
                    "entry_price": price,
                    "entry_at": datetime.now(timezone.utc).isoformat(),
                    "target_pct": display_tp_pct,
                    "stop_pct": display_sl_pct,
                    "target_price": target_price,
                    "stop_price": stop_price,
                    "status": "open",
                    "metadata": meta,
                    "added_at": datetime.now(timezone.utc).isoformat(),
                }

                supabase.table("positions").insert(new_pos).execute()
                self._log(
                    f"Subscriber {user_id} entered position on {symbol} at {price:.4f} (TP={target_price:.4f} [{display_tp_pct:.1f}%], SL={stop_price:.4f} [{display_sl_pct:.1f}%])"
                )

                # Increment monthly signal counter
                self._increment_monthly_signal_count(symbol)

                if (
                    sub_data["subscription"].get("notifications_enabled", True)
                    is not False
                ):
                    bot_name = self.config.name
                    if lang == "ar":
                        msg = (
                            f"🟢 *إشارة شراء جديدة*\n"
                            f"━━━━━━━━━━━━━━━\n"
                            f"💎 الرمز: `{symbol}`\n"
                            f"💰 سعر الدخول: `{price:.4f}`\n"
                            f"🎯 الهدف ({display_tp_pct:.1f}%): `{target_price:.4f}`\n"
                            f"🛡️ وقف الخسارة ({display_sl_pct:.1f}%): `{stop_price:.4f}`\n"
                            f"━━━━━━━━━━━━━━━\n"
                            f"🤖 البوت: {bot_name}"
                        )
                    else:
                        msg = (
                            f"🟢 *NEW BUY SIGNAL*\n"
                            f"━━━━━━━━━━━━━━━\n"
                            f"💎 Symbol: `{symbol}`\n"
                            f"💰 Entry Price: `{price:.4f}`\n"
                            f"🎯 Target ({display_tp_pct:.1f}%): `{target_price:.4f}`\n"
                            f"🛡️ Stop Loss ({display_sl_pct:.1f}%): `{stop_price:.4f}`\n"
                            f"━━━━━━━━━━━━━━━\n"
                            f"🤖 Bot: {bot_name}"
                        )

                    channel = sub_data.get("notification_channel", "telegram")

                    if self.telegram_bridge and chat_id:
                        self.telegram_bridge.send_notification(msg, chat_id=chat_id)

            except Exception as entry_err:
                self._log(
                    f"Error executing entry for subscriber {user_id} on {symbol}: {entry_err}"
                )

    def _maybe_sell_position(self, symbol: str, bars: pd.DataFrame) -> bool:
        """
        Apply smart exits on the latest bar:
        - ATR-based dynamic TP/SL (Feature 3)
        - Smart momentum exit (Feature 5)
        - Partial position sell (Feature 10)
        - Trailing stop updates (BE / lock)
        - Time exit by bars held
        Returns True if a sell was sent.
        """
        if not self.config.enable_sells:
            return False

        pos = self._get_open_position(symbol)
        if pos is None:
            self._pos_state.pop(_normalize_symbol(symbol), None)
            return False

        if bars is None or bars.empty:
            return False

        try:
            last = bars.iloc[-1]
            hi = float(last.get("high", 0) or 0)
            lo = float(last.get("low", 0) or 0)
            close = float(last.get("close", 0) or 0)
        except Exception:
            return False

        state = self._pos_state.get(_normalize_symbol(symbol)) or {}
        entry_price = state.get("entry_price")
        if not entry_price:
            try:
                entry_price = float(getattr(pos, "avg_entry_price", 0) or 0) or None
            except Exception:
                entry_price = None

        if not entry_price or entry_price <= 0:
            return False

        # ── Feature 3: ATR-based dynamic TP/SL ──
        take_profit, stop_loss = self._calculate_atr_exits(bars, float(entry_price))

        current_stop = state.get("current_stop")
        if current_stop is None:
            current_stop = float(stop_loss)
        trail_mode = state.get("trail_mode") or "NONE"

        qty = (
            float(getattr(pos, "qty", 0) or 0)
            if pos
            else (state.get("notional", 100) / entry_price)
        )

        # ── Feature 5: Smart Exit (Momentum) ──
        should_smart_exit, smart_msg = self._check_smart_exit(
            symbol, bars, entry_price, close
        )
        if should_smart_exit:
            self._log(f"{symbol}: {smart_msg}")
            if self.config.execution_mode == "TELEGRAM":
                sell_pnl = (close - float(entry_price)) * qty
                self._save_signal_record(
                    symbol,
                    close,
                    qty * close,
                    0,
                    None,
                    action="SELL",
                    entry_price=float(entry_price),
                    pnl=sell_pnl,
                    reason="SMART",
                )
                self._send_telegram_signal(symbol, close, action="SELL")
                self._pos_state.pop(_normalize_symbol(symbol), None)
                self._save_bot_state()
                return True
            return self._sell_market(symbol, qty=qty)

        # ── Feature 10: Partial Position Sell ──
        self._maybe_partial_sell(symbol, qty, close, entry_price)

        # Standard Stop Loss check
        if lo <= float(current_stop):
            self._log(
                f"{symbol}: SELL (STOP) qty={qty} stop={current_stop:.6f} entry={entry_price:.6f}"
            )
            if self.config.execution_mode == "TELEGRAM":
                sell_pnl = (float(current_stop) - float(entry_price)) * qty
                self._save_signal_record(
                    symbol,
                    current_stop,
                    qty * current_stop,
                    0,
                    None,
                    action="SELL",
                    entry_price=float(entry_price),
                    pnl=sell_pnl,
                    reason="STOP",
                )
                self._send_telegram_signal(symbol, current_stop, action="SELL")
                self._pos_state.pop(_normalize_symbol(symbol), None)
                self._save_bot_state()
                self._log(f"SKIPPING Virtual Sell (Telegram-Only Mode)")
                return True
            return self._sell_market(symbol, qty=qty, stop_price=current_stop)

        # Target check
        if hi >= float(take_profit):
            self._log(
                f"{symbol}: SELL (TARGET) qty={qty} tp={take_profit:.6f} entry={entry_price:.6f}"
            )
            if self.config.execution_mode == "TELEGRAM":
                sell_pnl = (float(take_profit) - float(entry_price)) * qty
                self._save_signal_record(
                    symbol,
                    take_profit,
                    qty * take_profit,
                    0,
                    None,
                    action="SELL",
                    entry_price=float(entry_price),
                    pnl=sell_pnl,
                    reason="TARGET",
                )
                self._send_telegram_signal(symbol, take_profit, action="SELL")
                self._pos_state.pop(_normalize_symbol(symbol), None)
                self._save_bot_state()
                self._log(f"SKIPPING Virtual Sell (Telegram-Only Mode)")
                return True
            return self._sell_market(symbol, qty=qty)

        # Trailing stop updates (effective next bar)
        if self.config.use_trailing:
            be_price = float(entry_price)
            lock_price = float(entry_price) * (1 + float(self.config.trail_lock_pct))
            if (
                hi
                >= float(entry_price) * (1 + float(self.config.trail_lock_trigger_pct))
                and float(current_stop) < lock_price
            ):
                current_stop = lock_price
                trail_mode = "+LOCK"
            elif (
                hi >= float(entry_price) * (1 + float(self.config.trail_be_pct))
                and float(current_stop) < be_price
            ):
                current_stop = be_price
                trail_mode = "BE"

        # Logic: Only increment bars_held when we see a NEW bar timestamp.
        # This ensures the hold time is based on the Timeframe (e.g. 1h) and not the Poll Interval.
        current_ts = str(last.get("timestamp") or getattr(last, "name", ""))
        last_held_ts = state.get("last_held_ts")
        bars_held = int(state.get("bars_held") or 0)

        if current_ts != last_held_ts:
            bars_held += 1
            state["last_held_ts"] = current_ts  # update for next cycle

        if bars_held >= int(self.config.hold_max_bars):
            self._log(
                f"{symbol}: SELL (TIME) qty={qty} bars={bars_held} close={close:.6f}"
            )
            if self.config.execution_mode == "TELEGRAM":
                sell_pnl = (close - float(entry_price)) * qty
                self._save_signal_record(
                    symbol,
                    close,
                    qty * close,
                    0,
                    None,
                    action="SELL",
                    entry_price=float(entry_price),
                    pnl=sell_pnl,
                    reason="TIME",
                )
                self._send_telegram_signal(symbol, close, action="SELL")
                self._pos_state.pop(_normalize_symbol(symbol), None)
                self._save_bot_state()
                self._log(f"SKIPPING Virtual Sell (Telegram-Only Mode)")
                return True
            return self._sell_market(symbol, qty=qty)

        self._pos_state[_normalize_symbol(symbol)] = {
            **state,
            "entry_price": entry_price,
            "bars_held": bars_held,
            "last_held_ts": current_ts,
            "current_stop": float(current_stop),
            "target_price": float(take_profit),
            "trail_mode": trail_mode,
        }
        return False

    def _run_loop(self):
        try:
            self._log("Initializing models and virtual broker...")

            self._log("DEBUG: Creating Virtual Market client...")
            self.api = create_virtual_market_client(logger=self._log)
            if hasattr(self, "_virtual_cash"):
                self.api._cash = self._virtual_cash
            else:
                self.api._cash = self.config.virtual_cash

            # Set up price provider for the virtual broker to use our fetched bars
            def v_price_provider(sym):
                return self._latest_prices.get(_normalize_symbol(sym))

            self.api.set_price_provider(v_price_provider)

            # Hydrate virtual positions from persisted state if available
            if hasattr(self.api, "seed_positions_from_state"):
                self.api.seed_positions_from_state(self._pos_state)

            self._log("DEBUG: Virtual Market client created successfully.")

            self._current_activity = "Loading models"
            self.king_obj, self.king_clf, self.validator = self._load_models()
            self._log(f"Models loaded. Polling every {self.config.poll_seconds}s.")
            self._log(f"Coins: {', '.join(self.config.coins)}")
            self._log(
                f"Thresholds: KING>={self.config.king_threshold}, COUNCIL>={self.config.council_threshold}"
            )
            self._log(
                f"⚠️ LIVE-SAFETY: warmup={self.config.warmup_bars} bars, slippage={self.config.slippage_buffer_pct * 100:.1f}%, confidence_haircut={self.config.live_confidence_haircut:.2f}"
            )
            self._log(
                f"⚠️ LIVE-SAFETY: Using CLOSED bar features (shift-1) to prevent look-ahead bias"
            )

            while not self._stop_event.is_set():
                now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
                self._last_scan_time = now
                self._current_activity = f"--- SCAN CYCLE START ({now}) ---"
                self._log(self._current_activity)

                # Check Schedule
                self._current_activity = "Checking operating schedule"
                inside_sch, sch_msg = self._is_inside_schedule()
                if not inside_sch:
                    self._current_activity = f"Idle: {sch_msg}"
                    last_sch_log = getattr(self, "_last_sch_msg", None)
                    if last_sch_log != sch_msg:
                        self._log(f"SCHEDULE IDLE: {sch_msg}")
                        self._last_sch_msg = sch_msg

                    sleep_time = min(60, self.config.poll_seconds)
                    for _ in range(sleep_time):
                        if self._stop_event.is_set():
                            break
                        time.sleep(1)
                    continue
                else:
                    if getattr(self, "_last_sch_msg", None) is not None:
                        self._log("SCHEDULE ACTIVE: Back inside operating hours")
                        self._last_sch_msg = None

                # Check Daily Limits
                self._current_activity = "Checking daily limits"
                can_trade, limit_msg = self._check_daily_limits()
                if not can_trade:
                    self._log(f"LIMIT REACHED: {limit_msg}")
                    for _ in range(self.config.poll_seconds):
                        if self._stop_event.is_set():
                            break
                        time.sleep(1)
                    continue

                # Retry any pending trades that failed to save to Supabase
                self._current_activity = "Retrying pending trades"
                self._retry_pending_trades()

                # Sync positions first to ensure Risk Firewall is accurate
                self._current_activity = "Syncing position state"
                self._sync_pos_state()

                # Fetch active subscribers and profiles for this bot
                subscribers_data = []
                try:
                    if supabase:
                        sub_res = (
                            supabase.table("bot_subscriptions")
                            .select("*")
                            .eq("bot_id", self.bot_id)
                            .execute()
                        )
                        subs = sub_res.data or []
                        user_ids = [s["user_id"] for s in subs]
                        if user_ids:
                            prof_res = (
                                supabase.table("profiles")
                                .select("*")
                                .in_("id", user_ids)
                                .execute()
                            )
                            profiles_map = {p["id"]: p for p in (prof_res.data or [])}
                        else:
                            profiles_map = {}

                        for sub in subs:
                            prof = profiles_map.get(sub["user_id"]) or {}
                            subscribers_data.append(
                                {
                                    "subscription": sub,
                                    "profile": prof,
                                    "user_id": sub["user_id"],
                                    "target_pct": float(
                                        sub.get("target_pct")
                                        if sub.get("target_pct") is not None
                                        else (
                                            prof.get("default_target_pct")
                                            if prof.get("default_target_pct")
                                            is not None
                                            else 0.10
                                        )
                                    ),
                                    "stop_loss_pct": float(
                                        sub.get("stop_loss_pct")
                                        if sub.get("stop_loss_pct") is not None
                                        else (
                                            prof.get("default_stop_pct")
                                            if prof.get("default_stop_pct") is not None
                                            else 0.035
                                        )
                                    ),
                                    "max_open_positions": int(
                                        sub.get("max_open_positions")
                                        if sub.get("max_open_positions") is not None
                                        else self.config.max_open_positions
                                    ),
                                    "pct_cash_per_trade": float(
                                        sub.get("pct_cash_per_trade")
                                        if sub.get("pct_cash_per_trade") is not None
                                        else self.config.pct_cash_per_trade
                                    ),
                                    "telegram_chat_id": sub.get("telegram_chat_id")
                                    if sub.get("telegram_chat_id")
                                    else (
                                        prof.get("telegram_chat_id")
                                        if prof.get("telegram_chat_id")
                                        else None
                                    ),
                                    "notification_channel": prof.get(
                                        "notification_channel"
                                    )
                                    if prof.get("notification_channel")
                                    else "telegram",
                                    "language": prof.get("language", "en"),
                                }
                            )
                except Exception as sub_err:
                    self._log(f"Error fetching subscribers: {sub_err}")

                total_managed = len(self._pos_state)
                at_max_capacity = total_managed >= self.config.max_open_positions

                if at_max_capacity:
                    # SMART SCAN: Only scan symbols with open positions for exit management
                    active_symbols = [
                        sym for sym in self.config.coins if self._has_open_position(sym)
                    ]
                    scan_list = active_symbols
                    self._log(
                        f"SMART SCAN (EXIT-ONLY): {total_managed}/{self.config.max_open_positions} positions full. Monitoring {len(active_symbols)} active symbols for exits."
                    )
                else:
                    # Use configured coins list directly
                    scan_list = list(self.config.coins or [])

                    mode = (self.config.trading_mode or "hybrid").lower()
                    self._log(
                        f"Config: {self.config.timeframe} | {len(scan_list)} symbols | mode={self.config.execution_mode} | trade_mode={mode} | active_positions={total_managed}/{self.config.max_open_positions}"
                    )

                # Fetch market index context and fundamentals if model expects them
                import api.stock_ai as stock_ai

                exchange = "EGX"
                if isinstance(self.king_obj, dict):
                    exchange = self.king_obj.get("exchange") or "EGX"

                market_df = None
                uses_mkt = False
                uses_funds = False
                uses_sector_rel = False
                mkt_symbol = "EGX30.INDX"  # default fallback

                if isinstance(self.king_obj, dict):
                    pm = self.king_obj.get("primary_model") or {}
                    feature_names = list(
                        pm.get("feature_names")
                        or self.king_obj.get("meta_feature_names")
                        or []
                    )

                    uses_mkt = any(
                        f in feature_names
                        for f in [
                            "feat_mkt_trend",
                            "feat_mkt_volatility",
                            "feat_rel_strength",
                        ]
                    )
                    uses_funds = any(
                        f in feature_names
                        for f in [
                            "marketCap",
                            "peRatio",
                            "eps",
                            "dividendYield",
                            "fund_score",
                        ]
                    )
                    uses_sector_rel = any(
                        f in feature_names for f in ["feat_sector_rel_strength"]
                    )

                    uses_funds = uses_funds or uses_sector_rel

                    mkt_symbol = (
                        self.king_obj.get("exchange_index_symbol") or mkt_symbol
                    )
                    inputs = self.king_obj.get("data_inputs") or {}
                    if isinstance(inputs, dict):
                        mkt_symbol = inputs.get("exchange_index_symbol") or mkt_symbol

                    if exchange == "EGX":
                        mkt_symbol = "EGX30.INDX"
                    elif exchange == "US":
                        mkt_symbol = "GSPC.INDX"
                    elif exchange == "CRYPTO":
                        mkt_symbol = "BTC-USD"

                if uses_mkt and stock_ai.supabase:
                    self._log(f"Loading market index data for context: {mkt_symbol}")
                    market_df = self._fetch_market_index_data(mkt_symbol)
                    if not market_df.empty:
                        self._log(f"Loaded {len(market_df)} index rows from Supabase.")
                    else:
                        self._log(
                            f"Warning: Failed to load market index {mkt_symbol} from Supabase."
                        )

                df_funds = pd.DataFrame()
                if uses_funds and stock_ai.supabase and exchange != "CRYPTO":
                    try:
                        self._log(f"Loading fundamentals for exchange: {exchange}")
                        from api.train_exchange_model import (
                            fetch_fundamentals_for_exchange,
                        )

                        df_funds = fetch_fundamentals_for_exchange(
                            stock_ai.supabase, exchange
                        )
                        if not df_funds.empty:
                            self._log(
                                f"Loaded fundamentals for {len(df_funds)} symbols from Supabase."
                            )
                    except Exception as fund_err:
                        self._log(f"Error fetching fundamentals: {fund_err}")

                self._sector_returns_df = pd.DataFrame()
                if (
                    uses_sector_rel
                    and stock_ai.supabase
                    and exchange != "CRYPTO"
                    and df_funds is not None
                    and not df_funds.empty
                ):
                    try:
                        self._log(
                            "Fetching recent daily prices for sector relative strength calculation..."
                        )
                        recent_res = (
                            stock_ai.supabase.table("stock_prices")
                            .select("symbol, date, close")
                            .eq("exchange", exchange)
                            .order("date", desc=True)
                            .limit(2000)
                            .execute()
                        )
                        if recent_res.data:
                            df_recent = pd.DataFrame(recent_res.data)
                            if not df_recent.empty:
                                df_recent = df_recent.merge(
                                    df_funds[["symbol", "sector"]],
                                    on="symbol",
                                    how="left",
                                )
                                df_recent["sector"] = df_recent["sector"].fillna(
                                    "Unknown"
                                )
                                df_recent = df_recent.sort_values(["symbol", "date"])
                                df_recent["daily_return"] = (
                                    df_recent.groupby("symbol")["close"]
                                    .pct_change()
                                    .fillna(0.0)
                                )
                                self._sector_returns_df = (
                                    df_recent.groupby(
                                        ["date", "sector"], observed=False
                                    )["daily_return"]
                                    .mean()
                                    .reset_index()
                                )
                                self._log(
                                    f"Calculated sector average returns for {len(self._sector_returns_df)} date-sector combinations."
                                )
                    except Exception as sector_err:
                        self._log(
                            f"Warning: Could not calculate sector average returns: {sector_err}"
                        )

                for symbol in scan_list:
                    if self._stop_event.is_set():
                        break

                    # 🧊 Cooldown Check
                    norm_sym = _normalize_symbol(symbol)
                    if norm_sym in self._cooldowns:
                        last_exit = self._cooldowns[norm_sym]
                        elapsed = (
                            datetime.now(timezone.utc) - last_exit
                        ).total_seconds() / 60
                        if elapsed < self.config.cooldown_minutes:
                            self._log(
                                f"{symbol}: In Cooldown ({elapsed:.1f}/{self.config.cooldown_minutes}m) - Skipping."
                            )
                            continue
                        else:
                            del self._cooldowns[norm_sym]  # Expired

                    # ── Feature 8: Time-of-Day Filter (skip for exit-only mode) ──
                    if not at_max_capacity:
                        time_ok, time_msg = self._is_good_time_to_trade(symbol)
                        if not time_ok:
                            self._log(f"{symbol}: TIME FILTER - {time_msg}")
                            continue

                    self._current_activity = f"Fetching bars for {symbol}"
                    bars = self._get_bars(symbol, limit=self.config.bars_limit)
                    if bars.empty:
                        self._log(f"{symbol}: No bars found.")
                        continue

                    # ── WARM-UP BARRIER ──
                    # Indicators (EMA, RSI, Bollinger) produce garbage on insufficient history.
                    # Block predictions until we have enough bars for stable indicators.
                    # NOTE: We save bars to Supabase and update prices BEFORE this check
                    # so that charts always have data, even during warm-up.

                    # Update latest price for the virtual broker
                    self._latest_prices[_normalize_symbol(symbol)] = float(
                        bars.iloc[-1]["close"]
                    )

                    # Always cache bars in memory for chart display (works without Supabase)
                    try:
                        chart_rows = []
                        df_chart = (
                            bars.reset_index()
                            if "timestamp" not in bars.columns
                            else bars.copy()
                        )
                        if "timestamp" in df_chart.columns:
                            for _, row in df_chart.iterrows():
                                ts = row["timestamp"]
                                ts_str = (
                                    ts.isoformat()
                                    if hasattr(ts, "isoformat")
                                    else str(ts)
                                )
                                chart_rows.append(
                                    {
                                        "ts": ts_str,
                                        "open": float(row.get("open", 0)),
                                        "high": float(row.get("high", 0)),
                                        "low": float(row.get("low", 0)),
                                        "close": float(row.get("close", 0)),
                                        "volume": int(row.get("volume", 0))
                                        if row.get("volume")
                                        else 0,
                                    }
                                )
                            self._chart_bars[symbol] = chart_rows[
                                -300:
                            ]  # Keep last 300 bars
                    except Exception:
                        pass

                    # Save to Supabase (for chart display)
                    self._save_to_supabase(bars, symbol)

                    norm_sym_warmup = _normalize_symbol(symbol)
                    if len(bars) < self.config.warmup_bars:
                        if not self._warmup_complete.get(norm_sym_warmup):
                            self._log(
                                f"🥶 WARM-UP: {symbol} has {len(bars)}/{self.config.warmup_bars} bars — skipping prediction (indicators not stable)"
                            )
                        continue
                    elif not self._warmup_complete.get(norm_sym_warmup):
                        self._warmup_complete[norm_sym_warmup] = True
                        self._log(
                            f"✅ WARM-UP COMPLETE: {symbol} has {len(bars)} bars — indicators are now stable"
                        )

                    # Process subscriber exits
                    self._process_subscribers_exits(symbol, bars)

                    # If a position exists, apply sell logic first using the latest bar, then skip buy logic.
                    if self._has_open_position(symbol):
                        self._current_activity = f"Evaluating EXIT for {symbol}"
                        sold = self._maybe_sell_position(symbol, bars)
                        if sold:
                            continue
                        continue

                    # If at max capacity, skip all buy logic (only exits above)
                    if at_max_capacity:
                        continue

                    # Pass only closed bars to filters/regimes/quality scores to match prediction logic
                    closed_bars = bars.iloc[:-1].copy() if len(bars) > 1 else bars

                    # ── Feature 1: Market Regime Detection ──
                    regime = self._detect_market_regime(closed_bars)
                    mode = (self.config.trading_mode or "hybrid").lower()
                    mode_ov = self._get_mode_overrides()

                    if regime == "BEAR":
                        if mode == "aggressive":
                            self._log(
                                f"{symbol}: BEAR REGIME (aggressive mode) → allowing with reduced size"
                            )
                        else:
                            self._log(
                                f"{symbol}: BEAR REGIME - Skipping BUY signals (mode={mode})"
                            )
                            continue

                    self._current_activity = f"Preparing features for {symbol}"
                    features = self._prepare_features(
                        bars, market_df=market_df, df_funds=df_funds, symbol=symbol
                    )
                    if features.empty:
                        self._log(f"{symbol}: Features empty (insufficient data).")
                        continue

                    # ── LOOK-AHEAD BIAS FIX ──
                    # Use the CLOSED bar (second-to-last), not the current open bar.
                    # In backtest, all bars are closed. In live, bars.iloc[-1] is still forming.
                    if len(features) < 2:
                        self._log(
                            f"{symbol}: Not enough feature rows for closed-bar prediction (need >= 2)"
                        )
                        continue

                    X_all = features.iloc[
                        [-2]
                    ].copy()  # FIXED: was iloc[[-1]] (look-ahead bias)
                    closed_bar_ts = (
                        bars.iloc[-2].get("timestamp", "unknown")
                        if len(bars) >= 2
                        else "unknown"
                    )
                    self._log(
                        f"{symbol}: Predicting on CLOSED bar (ts={closed_bar_ts})"
                    )

                    if self._is_bar_stale(closed_bar_ts):
                        self._log(
                            f"{symbol}: Skipping prediction - CLOSED bar is stale."
                        )
                        continue
                    Xk = self._align_for_king(X_all, self.king_obj)

                    # Align categories to booster to prevent type mismatch crashes
                    try:
                        pm = self.king_obj.get("primary_model") or {}
                        cat_features = list(pm.get("categorical_features") or [])
                        primary_booster = self._get_primary_booster(self.king_clf)
                        Xk = self._align_pandas_categories_to_booster(
                            Xk,
                            cat_cols=[c for c in cat_features if c in Xk.columns],
                            booster=primary_booster,
                            cat_cols_order=cat_features,
                        )
                        if primary_booster is None or not (
                            cat_features
                            and hasattr(primary_booster, "pandas_categorical")
                        ):
                            self._reset_nested_boosters(self.king_clf)
                    except Exception as cat_err:
                        self._log(
                            f"Warning: Failed to align categories to booster: {cat_err}"
                        )

                    # ── Feature 7: Win Rate Adaptive Threshold ──
                    adaptive_threshold = self._get_adaptive_threshold(symbol)

                    self._current_activity = f"Predicting KING for {symbol}"
                    try:
                        king_conf_raw = float(self.king_clf.predict_proba(Xk)[:, 1][0])
                    except Exception:
                        continue

                    # ── ANTI-OVERFITTING: Confidence Haircut ──
                    # Models with 1000+ trees tend to be over-confident on live data.
                    # Apply a small pessimism tax to counteract overfitting optimism.
                    king_conf = king_conf_raw - self.config.live_confidence_haircut
                    if self.config.live_confidence_haircut > 0:
                        self._log(
                            f"{symbol}: KING raw={king_conf_raw:.3f} → live={king_conf:.3f} (haircut={self.config.live_confidence_haircut:.2f})"
                        )

                    # ── Feature 4: RSI Divergence ──
                    divergence_type, div_boost = self._detect_rsi_divergence(
                        closed_bars
                    )
                    adjusted_conf = king_conf + div_boost

                    effective_king_thresh = adaptive_threshold + mode_ov["king_offset"]
                    if adjusted_conf < effective_king_thresh:
                        self._log(
                            f"{symbol}: KING pass ({adjusted_conf:.2f} < {effective_king_thresh:.2f} [mode={mode}])"
                            + (
                                f" [div={divergence_type}, boost={div_boost:+.2f}]"
                                if divergence_type != "NONE"
                                else ""
                            )
                        )
                        continue

                    self._log(
                        f"SIGNAL: {symbol} KING={king_conf:.2f}"
                        + (
                            f" → adjusted={adjusted_conf:.2f} ({divergence_type} div)"
                            if div_boost != 0
                            else ""
                        )
                    )

                    if self.config.use_council:
                        self._current_activity = f"Validating COUNCIL for {symbol}"
                        try:
                            council_conf = float(
                                self.validator.predict_proba(
                                    X_all, primary_conf=np.asarray([king_conf])
                                )[:, 1][0]
                            )
                        except Exception:
                            continue

                        self._log(f"COUNCIL CHECK: {symbol} COUNCIL={council_conf:.2f}")

                        effective_council_thresh = (
                            self.config.council_threshold + mode_ov["council_offset"]
                        )
                        if council_conf < effective_council_thresh:
                            self._log(
                                f"COUNCIL REJECTED: {symbol} ({council_conf:.2f} < {effective_council_thresh:.2f} [mode={mode}])"
                            )
                            continue
                    else:
                        self._log(f"COUNCIL SKIPPED: {symbol}")
                        council_conf = None

                    # --- Technical Filters (mode-adjusted) ---
                    filter_ok, filter_msg = self._check_signal_filters(
                        symbol, closed_bars, mode_overrides=mode_ov
                    )
                    if not filter_ok:
                        self._log(
                            f"FILTER REJECTED: {symbol} - {filter_msg} [mode={mode}]"
                        )
                        continue

                    # ── Feature 2: Multi-Timeframe Confirmation ──
                    self._current_activity = f"MTF check for {symbol}"
                    mtf_ok, mtf_msg = self._check_mtf_confirmation(symbol)
                    self._log(f"{symbol}: {mtf_msg}")
                    if not mtf_ok:
                        continue

                    # ── Feature 9: Signal Quality Score (mode-adjusted) ──
                    quality = self._calculate_signal_quality(
                        king_conf, council_conf, closed_bars, regime, divergence_type
                    )
                    effective_quality_min = mode_ov["min_quality"]
                    if quality < effective_quality_min:
                        self._log(
                            f"QUALITY REJECTED: {symbol} score={quality:.1f} < {effective_quality_min} [mode={mode}]"
                        )
                        continue

                    # --- RISK FIREWALL: Max Open Trades ---
                    try:
                        total_managed = len(self._pos_state)
                        if total_managed >= self.config.max_open_positions:
                            msg = f"⚠️ *RISK FIREWALL ALERT*\n\nLimit Reached: {total_managed}/{self.config.max_open_positions} positions.\nSkipping signal for `{symbol}`.\n\n_Increase 'Max Open Trades' in settings if you want to allow more simultaneous positions._"
                            self._log(
                                f"RISK FIREWALL: Max positions reached ({total_managed}/{self.config.max_open_positions}). Skipping signal for {symbol}."
                            )
                            continue
                    except Exception as e:
                        self._log(f"Error checking Risk Firewall: {e}")

                    # ── Feature 6: Correlation Guard ──
                    corr_ok, corr_mult, corr_msg = self._check_correlation_guard(
                        symbol, bars
                    )
                    self._log(f"{symbol}: {corr_msg}")
                    if not corr_ok:
                        continue

                    # Signal Confirmed -> Execute trade
                    # The prediction uses iloc[-2], but execution MUST use the current live market price (iloc[-1]['close'])
                    last_price = float(bars.iloc[-1]["close"])

                    # ── SLIPPAGE BUFFER ──
                    # In reality, market orders fill at a worse price due to spread.
                    # Adjust the effective entry price upward to set realistic TP/SL.
                    effective_entry = last_price * (1 + self.config.slippage_buffer_pct)
                    if self.config.slippage_buffer_pct > 0:
                        self._log(
                            f"{symbol}: Slippage buffer: market_price={last_price:.4f} → effective_entry={effective_entry:.4f} (+{self.config.slippage_buffer_pct * 100:.1f}%)"
                        )

                    try:
                        account = self.api.get_account()
                        cash = float(getattr(account, "cash", 0) or 0)
                    except Exception:
                        cash = 0.0

                    # --- Dynamic Position Sizing ---
                    notional = self._calculate_position_size(
                        symbol, cash, king_conf, council_conf, bars
                    )

                    # Apply regime sizing adjustment (mode-aware)
                    if regime == "SIDEWAYS":
                        notional *= mode_ov["sideways_size_mult"]
                        self._log(
                            f"{symbol}: SIDEWAYS regime → size adjusted to ${notional:.2f} [mode={mode}]"
                        )
                    elif regime == "BEAR" and mode == "aggressive":
                        notional *= mode_ov["bear_size_mult"]
                        self._log(
                            f"{symbol}: BEAR regime (aggressive) → size reduced to ${notional:.2f}"
                        )

                    # Apply correlation multiplier
                    notional *= corr_mult

                    # Apply partial entry if enabled
                    if self.config.use_partial_positions:
                        notional *= self.config.partial_entry_pct
                        self._log(
                            f"{symbol}: Partial entry ({self.config.partial_entry_pct * 100:.0f}%) → ${notional:.2f}"
                        )

                    # Minimum notional check
                    if notional < 10:
                        self._log(
                            f"{symbol}: insufficient liquidity/cash (${notional:.2f})"
                        )
                        continue

                    self._send_telegram_signal(
                        symbol, last_price, notional, king_conf, council_conf, bars=bars
                    )

                    # Calculate ATR-based exits using effective_entry (includes slippage)
                    atr_tp, atr_sl = self._calculate_atr_exits(bars, effective_entry)

                    # Record position state for exit management (real or virtual)
                    self._pos_state[_normalize_symbol(symbol)] = {
                        "entry_price": effective_entry,  # Use slippage-adjusted price
                        "entry_time": datetime.now(timezone.utc).isoformat(),
                        "bars_held": 0,
                        "current_stop": atr_sl,
                        "trail_mode": "NONE",
                        "notional": notional,
                        "regime": regime,
                        "quality_score": quality,
                    }

                    # Execute real trade if not in Telegram-only mode
                    if self.config.execution_mode != "TELEGRAM":
                        self._log(
                            f"{symbol}: Placing BUY order for ${notional:.2f} (Quality={quality:.0f}, Regime={regime})"
                        )
                        try:
                            ok = self._buy_market(symbol, notional_usd=notional)
                            if ok:
                                self._log(f"{symbol}: BUY executed.")
                            else:
                                self._log(f"{symbol}: BUY failed.")
                        except Exception as ex:
                            self._log(f"Error executing buy for {symbol}: {ex}")
                    else:
                        # TELEGRAM mode: save signal record (virtual mode saves via _buy_market)
                        self._save_signal_record(
                            symbol,
                            last_price,
                            notional,
                            king_conf,
                            council_conf,
                            action="BUY",
                        )
                        self._log(
                            f"{symbol}: Telegram-Only Signal recorded. (Quality={quality:.0f}, Regime={regime})"
                        )

                    # Loop over all subscribers to process entries
                    if subscribers_data:
                        self._process_subscribers_entries(
                            symbol,
                            bars,
                            last_price,
                            king_conf,
                            council_conf,
                            regime,
                            quality,
                            subscribers_data,
                        )

                    # Persist state after position change so it survives restart
                    self._save_bot_state()

                # Wait for next poll or stop signal
                # Break it into small chunks to be responsive to stop
                for secs in range(self.config.poll_seconds):
                    if self._stop_event.is_set():
                        break
                    self._current_activity = (
                        f"Idle - Next scan in {self.config.poll_seconds - secs}s"
                    )
                    time.sleep(1)
                    # Periodic heartbeat save every 5 minutes
                    now_dt = datetime.now(timezone.utc)
                    if now_dt.minute % 5 == 0 and now_dt.second == 0:
                        self._save_bot_state()

            self._current_activity = "Stopped"
            self._log("Bot loop ended.")
            self._status = "stopped"

        except Exception as e:
            err = traceback.format_exc()
            self._log(f"CRITICAL ERROR: {e}")
            self._log(err)
            self._error_msg = str(e)
            self._status = "error"


# Bot Manager to handle multiple bots
class BotManager:
    def __init__(self):
        self._bots: Dict[str, LiveBot] = {}
        self._telegram_bridge = None
        self._load_bots()

    def set_telegram_bridge(self, bridge):
        self._telegram_bridge = bridge
        for bot in self._bots.values():
            bot.set_telegram_bridge(bridge)

    def _load_bots(self):
        """Load bot configurations from Supabase (primary) or state/bots.json (fallback)."""
        loaded_ids = set()

        # 1. Try loading from Supabase first
        try:

            def _fetch_configs(sb):
                return sb.table("bot_configs").select("*").execute()

            res = _supabase_read_with_retry(_fetch_configs, table_name="bot_configs")
            if res and res.data:
                for row in res.data:
                    bot_id = row.get("bot_id")
                    config_dict = row.get("config", {})
                    if bot_id and config_dict:
                        # Handle list to dict migration if needed
                        if "coins" in config_dict and isinstance(
                            config_dict["coins"], str
                        ):
                            config_dict["coins"] = _parse_coins(config_dict["coins"])

                        # Merge environment variables if missing or None in loaded config
                        for env_key, config_key in [
                            ("CORNIX_WEBHOOK_URL", "cornix_webhook_url"),
                            ("CORNIX_UUID", "cornix_uuid"),
                            ("CORNIX_SECRET", "cornix_secret"),
                        ]:
                            if config_dict.get(config_key) is None:
                                config_dict[config_key] = _read_env(env_key)

                        cfg = BotConfig(**config_dict)
                        # Ensure user_id from row overrides if it exists
                        if "user_id" in row and row["user_id"]:
                            cfg.user_id = row["user_id"]
                        bot = LiveBot(bot_id=bot_id, config=cfg)
                        self._bots[bot_id] = bot
                        loaded_ids.add(bot_id)

                        # Auto-start bot if it was saved as running!
                        if cfg.status == "running":
                            try:
                                print(
                                    f"[BotManager] Auto-starting bot '{bot_id}' because status is 'running'"
                                )
                                bot.start()
                            except Exception as e:
                                print(
                                    f"[BotManager] Error auto-starting bot '{bot_id}': {e}"
                                )

                        # Debug log for webhook detection
                        if cfg.cornix_webhook_url:
                            print(
                                f"[BotManager]  Bot '{bot_id}' config using Webhook: {cfg.cornix_webhook_url[:20]}..."
                            )
                        else:
                            print(
                                f"[BotManager]  Bot '{bot_id}' config has NO Webhook URL"
                            )
                if loaded_ids:
                    print(f"Loaded {len(loaded_ids)} bot(s) from Supabase.")
        except Exception as e:
            print(f"Supabase bot load error: {e}")

        # Ensure a 'primary' bot exists if none loaded
        if "primary" not in self._bots:
            self.create_bot("primary", "Primary Bot")

    def save_bots(self):
        """Save all bot configurations to Supabase."""
        try:
            # Sync to Supabase
            records = []
            for bid, bot in self._bots.items():
                records.append(
                    {
                        "bot_id": bid,
                        "user_id": bot.config.user_id,
                        "config": asdict(bot.config),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )

            if records:
                _supabase_upsert_with_retry(
                    "bot_configs", records, on_conflict="bot_id"
                )

        except Exception as e:
            print(f"Error saving bots: {e}")

    def create_bot(
        self,
        bot_id: str,
        name: str,
        virtual_key_id: str = None,
        virtual_secret_key: str = None,
        user_id: str = None,
    ) -> LiveBot:
        if bot_id in self._bots:
            raise ValueError(f"Bot ID {bot_id} already exists.")

        # Start with default config
        bot = LiveBot(bot_id=bot_id)
        bot.config.name = name
        bot.config.user_id = user_id

        # Apply custom keys if provided
        if virtual_key_id:
            bot.config.virtual_key_id = virtual_key_id
        if virtual_secret_key:
            bot.config.virtual_secret_key = virtual_secret_key

        if self._telegram_bridge:
            bot.set_telegram_bridge(self._telegram_bridge)

        self._bots[bot_id] = bot
        self.save_bots()
        return bot

    def delete_bot(self, bot_id: str):
        if bot_id == "primary":
            raise ValueError("Cannot delete primary bot.")
        if bot_id in self._bots:
            try:
                self._bots[bot_id].stop()
            except Exception as e:
                print(f"Error stopping bot on delete: {e}")
            del self._bots[bot_id]

            # Delete configuration, state, logs, and trades from Supabase so they don't reload
            try:
                from api.stock_ai import _init_supabase, supabase

                _init_supabase()
                if supabase:
                    supabase.table("bot_configs").delete().eq(
                        "bot_id", bot_id
                    ).execute()
                    supabase.table("bot_states").delete().eq("bot_id", bot_id).execute()
                    supabase.table("bot_logs").delete().eq("bot_id", bot_id).execute()
                    supabase.table("bot_trades").delete().eq("bot_id", bot_id).execute()
                    print(f"Successfully deleted bot {bot_id} data from Supabase.")
            except Exception as e:
                print(f"Error deleting bot {bot_id} from Supabase: {e}")

            self.save_bots()

    def get_bot(self, bot_id: str) -> Optional[LiveBot]:
        return self._bots.get(bot_id)

    def list_bots(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": bid,
                "name": bot.config.name,
                "status": bot.get_status()["status"],
                "mode": bot.config.execution_mode,
            }
            for bid, bot in self._bots.items()
        ]


# Global Manager Instance
bot_manager = BotManager()

# Backward compatibility for single-bot logic
bot_instance = bot_manager.get_bot("primary")
