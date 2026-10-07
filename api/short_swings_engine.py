"""
Short Swings Engine (الصفقات القصيرة ⚡ PRO)
Independent, decoupled swing trading engine for high-conviction momentum & trend-riding setups.
Features:
- 20-Day Base Breakout with Volume Surge (>= 140% of 20MA).
- Power Pullback to EMA10 in strong uptrends.
- Market Breadth Gate (>= 45% of liquid stocks above EMA50).
- Breakeven lock once price reaches +4.5% (effective starting the subsequent session).
- Conservative gap-down stop loss execution.
- EMA10 Trailing Stop (rides runners).
- Dynamic performance KPIs computed directly from executed historical trades.
"""
import os
import sys
import json
import gzip
import datetime as dt
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any, Optional
import numpy as np
import pandas as pd

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

CACHE_PATHS = [
    Path(__file__).parent / "data" / "short_swings_cache.json",
    Path("api/data/short_swings_cache.json"),
    Path("scratch/short_swings_cache.json"),
]

EXIT_REASON_LABELS = {
    "ema10_break": "كسر متوسط EMA10 (حماية أرباح)",
    "stop_be": "وقف التعادل (حماية رأس المال)",
    "stop_loss": "وقف الخسارة الأولي (-4%)",
    "max_time": "انتهاء المدة الزمنية القصوى (20 جلسة)"
}

def compute_kpis_from_trades(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute performance KPIs dynamically from the actual list of closed trades."""
    if not trades:
        return {
            "profit_factor": 0.0,
            "win_rate_pct": 0.0,
            "total_return_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "avg_holding_days": 0.0,
            "avg_win_pct": 0.0,
            "avg_loss_pct": 0.0,
            "top_win_pct": 0.0,
            "monthly_trades_avg": 0.0,
            "total_trades": 0,
            "wins_count": 0,
            "losses_count": 0,
        }

    returns = [float(t.get("return_pct", 0.0)) for t in trades]
    sessions = [float(t.get("sessions") or t.get("holding_days") or 1) for t in trades]
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]

    win_rate = (len(wins) / len(returns)) * 100.0 if returns else 0.0
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))

    if gross_loss > 0:
        pf = round(gross_profit / gross_loss, 2)
    elif gross_profit > 0:
        pf = 99.0
    else:
        pf = 0.0

    avg_win = round(float(np.mean(wins)), 2) if wins else 0.0
    avg_loss = round(float(np.mean(losses)), 2) if losses else 0.0
    top_win = round(float(max(returns)), 2) if returns else 0.0
    avg_holding = round(float(np.mean(sessions)), 1) if sessions else 0.0

    # Equity curve calculation assuming equal risk allocation (1/15th max simultaneous slots)
    trade_returns = np.array(returns) / 100.0
    equity_curve = np.cumprod(1.0 + (trade_returns / 15.0))
    total_return = round(float((equity_curve[-1] - 1.0) * 100.0), 1) if len(equity_curve) else 0.0

    peak = np.maximum.accumulate(equity_curve)
    drawdowns = (equity_curve - peak) / peak
    max_dd = round(float(abs(np.min(drawdowns)) * 100.0), 1) if len(drawdowns) else 0.0

    # Monthly trades calculation
    exit_dates = [t["exit_date"] for t in trades if t.get("exit_date")]
    if exit_dates:
        try:
            min_d = dt.date.fromisoformat(min(exit_dates))
            max_d = dt.date.fromisoformat(max(exit_dates))
            months_count = max(1, (max_d.year - min_d.year) * 12 + (max_d.month - min_d.month) + 1)
            monthly_avg = round(len(trades) / months_count, 1)
        except Exception:
            monthly_avg = round(len(trades) / 12.0, 1)
    else:
        monthly_avg = 0.0

    return {
        "profit_factor": pf,
        "win_rate_pct": round(win_rate, 1),
        "total_return_pct": total_return,
        "max_drawdown_pct": max_dd,
        "avg_holding_days": avg_holding,
        "avg_win_pct": avg_win,
        "avg_loss_pct": avg_loss,
        "top_win_pct": top_win,
        "monthly_trades_avg": monthly_avg,
        "total_trades": len(trades),
        "wins_count": len(wins),
        "losses_count": len(losses),
    }

def _resolve_archive_path() -> Optional[Path]:
    """Dynamically locate the latest valid EGX stock prices snapshot across environments."""
    hf_cache_dir = Path.home() / ".cache" / "huggingface" / "hub" / "datasets--weeasdwee--egx-historical-prices" / "snapshots"
    if hf_cache_dir.exists():
        egx_files = sorted(hf_cache_dir.glob("*/prices/EGX/stock_prices.json.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
        if egx_files:
            return egx_files[0]
    
    project_candidates = [
        Path("api/data/stock_prices.json.gz"),
        Path("data/stock_prices.json.gz"),
        Path(__file__).parent / "data" / "stock_prices.json.gz",
    ]
    for p in project_candidates:
        if p.exists():
            return p
    return None

_METADATA_CACHE: Optional[Dict[str, Dict[str, Any]]] = None

def load_stock_metadata() -> Dict[str, Dict[str, Any]]:
    """Loads ticker names and sector metadata supporting case-insensitive schemas."""
    global _METADATA_CACHE
    if _METADATA_CACHE is not None:
        return _METADATA_CACHE

    meta_map: Dict[str, Dict[str, Any]] = {}
    
    # 1. Load from local symbol registries
    sym_dir = Path("symbols_data")
    if not sym_dir.exists():
        sym_dir = Path(__file__).parent / "symbols_data"
    if sym_dir.exists():
        for f in sym_dir.glob("Egypt_all_symbols_*.json"):
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                    for item in data:
                        raw_sym = item.get("Symbol") or item.get("symbol") or ""
                        ticker = raw_sym.upper().split(".")[0]
                        if ticker:
                            name_en = item.get("Name") or item.get("name") or item.get("name_en") or ticker
                            name_ar = item.get("ArabicName") or item.get("arabic_name") or item.get("NameAr") or item.get("name_ar") or name_en
                            sector = item.get("Sector") or item.get("sector") or "عام"
                            logo = item.get("Logo") or item.get("logo_url") or item.get("logo") or ""
                            meta_map[ticker] = {
                                "name_ar": name_ar,
                                "name_en": name_en,
                                "sector": sector,
                                "logo": logo
                            }
            except Exception as e:
                print(f"[SHORT_SWINGS] Warning loading metadata from {f}: {e}")

    # 2. Enrich from Supabase stocks table if available
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if supabase:
            res = supabase.table("stocks").select("symbol,name,name_ar").execute()
            for row in res.data or []:
                raw_sym = row.get("symbol") or ""
                ticker = raw_sym.upper().split(".")[0]
                if ticker:
                    if ticker not in meta_map:
                        meta_map[ticker] = {
                            "name_ar": row.get("name_ar") or row.get("name") or ticker,
                            "name_en": row.get("name") or ticker,
                            "sector": "عام",
                            "logo": ""
                        }
                    else:
                        if row.get("name_ar"):
                            meta_map[ticker]["name_ar"] = row["name_ar"]
                        if row.get("name"):
                            meta_map[ticker]["name_en"] = row["name"]
    except Exception as e:
        print(f"[SHORT_SWINGS] Warning enriching metadata from Supabase: {e}")

    _METADATA_CACHE = meta_map
    return meta_map

def compute_short_swings() -> Dict[str, Any]:
    """Generates the latest active and closed short swings with dynamic performance stats."""
    df = pd.DataFrame()
    
    # 1. Try standard history snapshot loader from api.hf_history_cache
    try:
        from api.hf_history_cache import load_history_snapshot
        snapshot_df = load_history_snapshot("EGX")
        if snapshot_df is not None and not snapshot_df.empty:
            df = snapshot_df.copy()
    except Exception as e:
        print(f"[SHORT_SWINGS] Snapshot loader unavailable: {e}")

    # 2. Fall back to resolved archive file
    if df.empty:
        archive_path = _resolve_archive_path()
        if archive_path and archive_path.exists():
            try:
                with gzip.open(archive_path, "rt", encoding="utf-8") as f:
                    raw = json.load(f)
                df = pd.DataFrame(raw)
            except Exception as e:
                print(f"[SHORT_SWINGS] Failed reading archive {archive_path}: {e}")

    # If no data is available at all, return cached result if valid or explicit unavailable state
    if df.empty:
        for cp in CACHE_PATHS:
            if cp.exists():
                try:
                    with open(cp, "r", encoding="utf-8") as fp:
                        cached = json.load(fp)
                        if cached and "kpis" in cached and cached.get("closed_trades"):
                            return cached
                except Exception:
                    pass
        return {
            "status": "unavailable",
            "kpis": compute_kpis_from_trades([]),
            "active_trades": [],
            "closed_trades": [],
            "total_active": 0,
            "total_closed": 0,
            "as_of": dt.date.today().isoformat()
        }

    # Normalize columns and filter EGX valid prices
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close", "volume"])
    
    # Filter strictly for positive finite prices and valid candle geometry
    valid_mask = (
        np.isfinite(df["open"]) & np.isfinite(df["high"]) & np.isfinite(df["low"]) & np.isfinite(df["close"]) & np.isfinite(df["volume"])
        & (df["open"] > 0) & (df["high"] > 0) & (df["low"] > 0) & (df["close"] > 0) & (df["volume"] >= 0)
        & (df["high"] >= df[["open", "close", "low"]].max(axis=1))
        & (df["low"] <= df[["open", "close", "high"]].min(axis=1))
    )
    if "exchange" in df.columns:
        valid_mask = valid_mask & (df["exchange"].astype(str).str.upper() == "EGX")
        
    df = df[valid_mask].sort_values(["symbol", "date"]).reset_index(drop=True)
    df = df[df["date"] >= "2024-01-01"].reset_index(drop=True)

    # Augment with live prices from Supabase strictly for EGX exchange
    max_archive_date = str(df["date"].max()) if not df.empty else "2024-01-01"
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if supabase:
            all_new = []
            page = 0
            page_size = 1000
            while True:
                res = (
                    supabase.table("stock_prices")
                    .select("symbol,exchange,date,open,high,low,close,volume")
                    .eq("exchange", "EGX")
                    .gt("date", max_archive_date)
                    .range(page * page_size, (page + 1) * page_size - 1)
                    .execute()
                )
                rows = res.data or []
                all_new.extend(rows)
                if len(rows) < page_size:
                    break
                page += 1
            if all_new:
                df_new = pd.DataFrame(all_new)
                for col in ["open", "high", "low", "close", "volume"]:
                    df_new[col] = pd.to_numeric(df_new[col], errors="coerce")
                df_new = df_new.dropna(subset=["open", "high", "low", "close", "volume"])
                new_valid = (
                    np.isfinite(df_new["open"]) & np.isfinite(df_new["high"]) & np.isfinite(df_new["low"]) & np.isfinite(df_new["close"]) & np.isfinite(df_new["volume"])
                    & (df_new["open"] > 0) & (df_new["high"] > 0) & (df_new["low"] > 0) & (df_new["close"] > 0) & (df_new["volume"] >= 0)
                    & (df_new["high"] >= df_new[["open", "close", "low"]].max(axis=1))
                    & (df_new["low"] <= df_new[["open", "close", "high"]].min(axis=1))
                )
                df_new = df_new[new_valid]
                if not df_new.empty:
                    df = pd.concat([df, df_new], ignore_index=True)
                    df = df.drop_duplicates(subset=["symbol", "date"], keep="last")
                    df = df.sort_values(["symbol", "date"]).reset_index(drop=True)
                    print(f"[SHORT_SWINGS] Merged {len(df_new)} live rows from Supabase (EGX); latest date: {df['date'].max()}")
    except Exception as merge_err:
        print(f"[SHORT_SWINGS] Warning: failed to merge live Supabase prices: {merge_err}")

    meta = load_stock_metadata()
    dates = sorted(df["date"].unique())

    # Build causal features per symbol
    groups = []
    for symbol, g in df.groupby("symbol", sort=False):
        g = g.copy().reset_index(drop=True)
        c = g["close"]
        h = g["high"]
        l = g["low"]
        v = g["volume"]
        o = g["open"]

        g["ema10"] = c.ewm(span=10, adjust=False).mean()
        g["ema20"] = c.ewm(span=20, adjust=False).mean()
        g["ema50"] = c.ewm(span=50, adjust=False).mean()

        prev_c = c.shift(1)
        tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
        g["atr14"] = tr.rolling(14).mean()
        g["atr_pct"] = g["atr14"] / c

        g["vol_ma20"] = v.rolling(20).mean()
        g["turnover"] = (c * v).rolling(20).mean()
        g["active_days"] = v.gt(0).rolling(20).sum()
        g["high20"] = h.rolling(20).max().shift(1)
        g["ret20"] = c / c.shift(20) - 1.0

        g["liquid"] = (
            (np.arange(len(g)) >= 30)
            & (g["turnover"] >= 1_000_000)
            & (g["active_days"] >= 15)
        )
        g["above_ema50"] = g["liquid"] & (c > g["ema50"])
        groups.append(g)

    df = pd.concat(groups, ignore_index=True)

    # Market breadth (lagged 1 day)
    breadth_raw = df[df["liquid"]].groupby("date")["above_ema50"].mean()
    df = df.merge(breadth_raw.shift(1).rename("breadth"), on="date", how="left")
    df["breadth"] = df["breadth"].fillna(0.5)

    mkt_ok = df["breadth"] >= 0.45
    trend_aligned = (
        df["liquid"]
        & (df["close"] > df["ema10"])
        & (df["ema10"] > df["ema20"])
        & (df["ema20"] > df["ema50"])
    )

    day_range = df["high"] - df["low"]
    close_pos = (df["close"] - df["low"]) / (day_range.replace(0, 1e-9))

    # Base Breakout
    sig_base_bo = (
        mkt_ok
        & trend_aligned
        & (df["close"] > df["high20"])
        & (df["volume"] >= df["vol_ma20"] * 1.4)
        & (df["close"] > df["open"])
        & (close_pos >= 0.70)
        & (df["ret20"] >= 0.05)
    )

    # Power Pullback
    sig_power_pb = (
        mkt_ok
        & trend_aligned
        & (df["ret20"] >= 0.08)
        & (df["low"] <= df["ema10"] * 1.01)
        & (df["close"] > df["ema10"])
        & (df["volume"] >= df["vol_ma20"] * 1.2)
        & (df["close"] > df["open"])
        & (close_pos >= 0.75)
    )

    df["signal"] = sig_base_bo | sig_power_pb
    df["sig_type"] = np.where(sig_base_bo, "اختراق قمة 20 جلسة مع انفجار سيولة", "ارتداد زخم من متوسط 10 أيام")

    next_date_map = dict(zip(dates, dates[1:]))
    market = {}
    for row in df[["symbol", "date", "open", "high", "low", "close", "volume", "turnover", "atr_pct", "ema10", "ema20"]].itertuples(index=False):
        market[(row.symbol, row.date)] = row

    sig_map = defaultdict(list)
    active_rows = df[df["signal"]][["symbol", "date", "close", "turnover", "sig_type", "ema10"]]
    for row in active_rows.itertuples(index=False):
        nxt = next_date_map.get(row.date)
        if nxt:
            sig_map[nxt].append({
                "symbol": row.symbol,
                "signal_date": row.date,
                "date": nxt,
                "close": row.close,
                "turnover": row.turnover,
                "sig_type": row.sig_type,
                "ema10": row.ema10
            })

    # Run execution simulation
    positions = {}
    closed_trades = []

    for i, day in enumerate(dates):
        # 1. Update breakeven activations scheduled from previous session
        for sym, p in positions.items():
            if p.get("be_pending_activation"):
                p["be_active"] = True
                p["sl_price"] = max(p["sl_price"], p["entry_price"] * 1.003)
                p["be_pending_activation"] = False

        # 2. Check exits at Open for yesterday's pending signals
        for sym in list(positions):
            p = positions[sym]
            b = market.get((sym, day))
            if not b or b.volume <= 0 or b.high == b.low:
                continue
            age = i - p["index"]

            if age >= 1 and p["pending"]:
                fill_price = b.open * (1 - 0.0015)
                ret_pct = (fill_price / p["entry_price"] - 1) * 100
                m_info = meta.get(sym.upper().split(".")[0], {})
                reason_code = p["pending"]
                closed_trades.append({
                    "symbol": sym,
                    "name_ar": m_info.get("name_ar", sym),
                    "name_en": m_info.get("name_en", sym),
                    "sector": m_info.get("sector", "عام"),
                    "entry_date": p["date"],
                    "exit_date": day,
                    "entry_price": round(p["entry_price"], 3),
                    "exit_price": round(fill_price, 3),
                    "return_pct": round(ret_pct, 2),
                    "max_gain_pct": round(p["max_gain"], 2),
                    "sessions": age,
                    "holding_days": age,
                    "reason": reason_code,
                    "exit_reason": EXIT_REASON_LABELS.get(reason_code, "إغلاق حسب الخطة"),
                    "trigger_type": p["sig_type"]
                })
                del positions[sym]

        # 3. Enter new positions at today's open based on yesterday's signals
        day_signals = sorted(sig_map.get(day, []), key=lambda s: -s["turnover"])
        for s in day_signals:
            if len(positions) >= 15 or s["symbol"] in positions:
                continue
            b = market.get((s["symbol"], day))
            if not b or b.volume <= 0 or b.high == b.low:
                continue

            limit_price = s["close"]
            # Max opening gap allowed: +2.0% (consistent with Telegram alerts & strategy docs)
            if b.open <= limit_price * 1.02:
                exec_price = b.open
            elif b.low <= limit_price:
                exec_price = limit_price
            else:
                continue

            fill = exec_price * (1 + 0.0015)
            positions[s["symbol"]] = {
                "symbol": s["symbol"],
                "date": day,
                "signal_date": s["signal_date"],
                "index": i,
                "entry_price": fill,
                "sl_price": fill * (1 - 0.04),
                "highest_high": fill,
                "max_gain": 0.0,
                "be_active": False,
                "be_pending_activation": False,
                "last": b.close,
                "sig_type": s["sig_type"],
                "pending": None
            }

        # 4. Intraday defensive stop checks & state updates (Strictly Causal Sequence)
        for sym in list(positions):
            p = positions[sym]
            b = market.get((sym, day))
            if not b:
                continue
            p["last"] = b.close
            age = i - p["index"]

            # First: Evaluate defensive stop loss against current session's low
            # For positions entered in earlier sessions (age >= 1)
            if age >= 1 and b.low <= p["sl_price"]:
                # Realistic Gap Fill Policy:
                # If market opened at or below stop loss (gap-down below stop), execute at open with slippage.
                # Otherwise, execute at stop price. In all cases, fill price cannot exceed b.high.
                if b.open <= p["sl_price"]:
                    raw_fill = min(b.high, b.open) * (1 - 0.0015)
                else:
                    raw_fill = max(b.low, p["sl_price"]) * (1 - 0.0015)
                fill_price = max(b.low * (1 - 0.0015), min(b.high, raw_fill))

                ret_pct = (fill_price / p["entry_price"] - 1) * 100
                m_info = meta.get(sym.upper().split(".")[0], {})
                reason_code = "stop_be" if p["be_active"] else "stop_loss"
                closed_trades.append({
                    "symbol": sym,
                    "name_ar": m_info.get("name_ar", sym),
                    "name_en": m_info.get("name_en", sym),
                    "sector": m_info.get("sector", "عام"),
                    "entry_date": p["date"],
                    "exit_date": day,
                    "entry_price": round(p["entry_price"], 3),
                    "exit_price": round(fill_price, 3),
                    "return_pct": round(ret_pct, 2),
                    "max_gain_pct": round(p["max_gain"], 2),
                    "sessions": age,
                    "holding_days": age,
                    "reason": reason_code,
                    "exit_reason": EXIT_REASON_LABELS.get(reason_code, "وقف خسارة"),
                    "trigger_type": p["sig_type"]
                })
                del positions[sym]
                continue

            # If not stopped out, update highest high and evaluate progression
            if b.high > p["highest_high"]:
                p["highest_high"] = b.high
                p["max_gain"] = max(p["max_gain"], (b.high / p["entry_price"] - 1) * 100)

            # Breakeven target (+4.5%): Schedule breakeven stop activation for the NEXT session
            # Eliminates intra-candle high/low ambiguity.
            gain = (b.high / p["entry_price"] - 1)
            if not p["be_active"] and not p.get("be_pending_activation") and gain >= 0.045:
                p["be_pending_activation"] = True

            # If already breakeven-secured and close falls below EMA10, schedule exit at next open
            if p["be_active"] and b.close < b.ema10:
                p["pending"] = "ema10_break"

            # Max holding period limit (20 sessions)
            if age >= 20 and not p["pending"]:
                p["pending"] = "max_time"

    last_date = dates[-1] if dates else dt.date.today().isoformat()
    active_output = []

    # 5. New Actionable Pending Signals detected at today's close for TOMORROW'S session:
    today_signals_df = df[(df["date"] == last_date) & (df["signal"])].sort_values("turnover", ascending=False)
    seen_symbols = set()
    for _, s_row in today_signals_df.iterrows():
        sym = s_row["symbol"]
        if sym in positions or sym in seen_symbols:
            continue
        seen_symbols.add(sym)
        close_price = round(float(s_row["close"]), 3)
        sl_price = round(close_price * 0.96, 3)
        m_info = meta.get(sym.upper().split(".")[0], {})
        active_output.append({
            "signal_id": f"{sym}_{last_date}",
            "symbol": sym,
            "name_ar": m_info.get("name_ar", sym),
            "name_en": m_info.get("name_en", sym),
            "sector": m_info.get("sector", "عام"),
            "entry_date": "جلسة الغد",
            "signal_date": last_date,
            "entry_price": close_price,
            "current_price": close_price,
            "reference_close": close_price,
            "return_pct": 0.0,
            "stop_loss": sl_price,
            "trailing_stop": sl_price,
            "ema10_trend": round(float(s_row["ema10"]), 3),
            "is_breakeven_protected": False,
            "max_gain_pct": 0.0,
            "trigger_type": s_row["sig_type"],
            "status": "إشارة دخول جديدة (جلسة الغد)",
            "is_pending_entry": True,
            "as_of": last_date
        })

    # 6. Active running positions (Strict separation from pending entries)
    for sym, p in positions.items():
        b = market.get((sym, last_date))
        curr_price = b.close if b else p["entry_price"]
        curr_gain = (curr_price / p["entry_price"] - 1) * 100
        active_stop = p["sl_price"]
        m_info = meta.get(sym.upper().split(".")[0], {})
        
        active_output.append({
            "signal_id": f"{sym}_{p.get('signal_date', p['date'])}",
            "symbol": sym,
            "name_ar": m_info.get("name_ar", sym),
            "name_en": m_info.get("name_en", sym),
            "sector": m_info.get("sector", "عام"),
            "entry_date": p["date"],
            "signal_date": p.get("signal_date", p["date"]),
            "entry_price": round(p["entry_price"], 3),
            "current_price": round(curr_price, 3),
            "reference_close": round(curr_price, 3),
            "return_pct": round(curr_gain, 2),
            "stop_loss": round(active_stop, 3),
            "trailing_stop": round(active_stop, 3),
            "ema10_trend": round(float(b.ema10), 3) if b else None,
            "is_breakeven_protected": p["be_active"],
            "max_gain_pct": round(p["max_gain"], 2),
            "trigger_type": p["sig_type"],
            "status": "مؤمنة بربح" if p["be_active"] else "قيد التداول",
            "is_pending_entry": False,
            "as_of": last_date
        })

    # Sort active output: pending signals first, then by return descending
    active_output.sort(key=lambda t: (0 if t.get("is_pending_entry") else 1, -float(t.get("return_pct", 0) or 0)))

    # Sort closed trades descending by exit date
    closed_trades.sort(key=lambda t: t["exit_date"], reverse=True)

    # Calculate dynamic performance metrics directly from all closed trades
    kpis = compute_kpis_from_trades(closed_trades)

    result = {
        "status": "ok",
        "kpis": kpis,
        "active_trades": active_output,
        "closed_trades": [t for t in closed_trades if t["exit_date"] >= "2026-01-01"],
        "total_active": len(active_output),
        "total_closed": len(closed_trades),
        "as_of": last_date
    }

    # Atomic write to cache files
    for cp in CACHE_PATHS:
        try:
            cp.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = cp.with_suffix(f".tmp.{os.getpid()}")
            with open(tmp_path, "w", encoding="utf-8") as fp:
                json.dump(result, fp, indent=2, ensure_ascii=False)
            os.replace(tmp_path, cp)
            break
        except Exception as write_err:
            print(f"[SHORT_SWINGS] Cache write failed for {cp}: {write_err}")
            continue

    return result

def get_cached_short_swings() -> Dict[str, Any]:
    for cp in CACHE_PATHS:
        if cp.exists():
            try:
                with open(cp, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                    if data and "kpis" in data:
                        return data
            except Exception:
                continue
    return compute_short_swings()

if __name__ == "__main__":
    res = compute_short_swings()
    print("Computed short swings successfully:")
    print("KPIs:", res.get("kpis"))
    print("Active:", len(res.get("active_trades", [])))
    print("Closed:", len(res.get("closed_trades", [])))
