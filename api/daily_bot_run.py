import os
import sys
# Force UTF-8 encoding on standard output and error to prevent UnicodeEncodeError under Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import datetime as dt
import time
import asyncio
import json
import uuid
import urllib.request
import pandas as pd
import numpy as np
from typing import List, Dict, Any, Tuple, Optional, Set

# Set project root path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, project_root)

import api.stock_ai as stock_ai
from api.stock_ai import _init_supabase

# Dynamically access the initialized client from stock_ai via a wrapper class

# But since supabase is used as a global variable, we can override or define it as a getter or wrap it
class SupabaseWrapper:
    def __getattr__(self, name):
        if not stock_ai.supabase:
            _init_supabase()
        return getattr(stock_ai.supabase, name)

supabase = SupabaseWrapper()
from api.smart_sync import get_smart_sync
from api.intraday_downloader import _fetch_egx_symbols
from api.routers.scan_ai_fast import fast_scan
from api.market_status_gate import should_reject_new_buys


def _sync_latest_egx_inventory_from_eodhd() -> Tuple[bool, List[str], str]:
    """
    Fetch EGX symbols using free data providers (yfinance).
    No API key required anymore!
    """
    from api.free_data_provider import fetch_egx_symbols_free
    
    # Use free provider instead of EODHD
    ok, active_symbols, msg = fetch_egx_symbols_free()
    
    if not ok:
        return False, [], msg

    base_dir = os.path.join(project_root, "symbols_data")
    os.makedirs(base_dir, exist_ok=True)

    try:
        # Normalize symbols to standard format
        normalized_syms = []
        for sym in active_symbols:
            base_sym = sym.split(".")[0].upper()
            normalized_syms.append({
                "Symbol": base_sym,
                "Name": f"EGX Stock {base_sym}",
                "Exchange": "EGX",
                "Country": "Egypt",
                "Type": "Stock",
                "Currency": "EGP",
                "Isin": None,
            })

        timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Remove old symbol files
        for name in os.listdir(base_dir):
            if name.startswith("Egypt_all_symbols_") and name.endswith(".json"):
                try:
                    os.remove(os.path.join(base_dir, name))
                except Exception:
                    pass

        out_path = os.path.join(base_dir, f"Egypt_all_symbols_{timestamp}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(normalized_syms, f, indent=2, ensure_ascii=False)

        return True, active_symbols, f"Updated Egypt inventory with {len(active_symbols)} symbols (yfinance - FREE)"
    except Exception as e:
        return False, [], str(e)


def _mark_non_listed_egx_symbols(active_symbols: List[str]) -> Tuple[bool, str, int]:
    active_set = {str(sym).strip().upper() for sym in (active_symbols or []) if str(sym).strip()}
    if not active_set:
        return False, "No active EGX symbols provided", 0

    marked = 0
    page = 0
    page_size = 1000
    try:
        while True:
            res = (
                supabase.table("stock_fundamentals")
                .select("symbol,data")
                .eq("exchange", "EGX")
                .range(page * page_size, (page + 1) * page_size - 1)
                .execute()
            )
            rows = res.data or []
            if not rows:
                break

            updates = []
            for row in rows:
                symbol = str(row.get("symbol") or "").strip().upper()
                if not symbol:
                    continue
                is_listed = symbol in active_set
                data = row.get("data") if isinstance(row.get("data"), dict) else {}
                prev_listed = data.get("isListed")
                prev_status = data.get("listingStatus")
                next_status = "listed" if is_listed else "delisted"
                if prev_listed is is_listed and prev_status == next_status:
                    continue
                new_data = dict(data)
                new_data["isListed"] = is_listed
                new_data["listingStatus"] = next_status
                new_data["listingCheckedAt"] = dt.datetime.utcnow().isoformat()
                updates.append({
                    "symbol": symbol,
                    "exchange": "EGX",
                    "data": new_data,
                    "updated_at": dt.datetime.utcnow().isoformat(),
                })

            if updates:
                marked += len(updates)
                supabase.table("stock_fundamentals").upsert(updates, on_conflict="symbol,exchange").execute()

            if len(rows) < page_size:
                break
            page += 1

        return True, f"Marked {marked} EGX fundamentals rows against current listing", marked
    except Exception as e:
        return False, str(e), marked


def _refresh_egx_fundamentals_from_tradingview(symbols_raw: List[str], chunk_size: int = 50) -> Tuple[bool, str, int]:
    if not symbols_raw:
        return False, "No EGX symbols to refresh fundamentals", 0

    try:
        from api.tradingview_integration import fetch_tradingview_fundamentals_bulk

        total_updated = 0
        tickers = [f"{sym}.EGX" for sym in symbols_raw if sym]
        for i in range(0, len(tickers), chunk_size):
            chunk = tickers[i:i + chunk_size]
            result = fetch_tradingview_fundamentals_bulk(chunk)
            total_updated += len(result or {})
            time.sleep(1)
        return True, f"Refreshed fundamentals for {total_updated} symbols from TradingView", total_updated
    except Exception as e:
        return False, str(e), 0


def _should_run_weekly_inventory(trigger: str = "manual") -> bool:
    if str(trigger or "").strip().lower() != "scheduled":
        return True
    # Cairo time is UTC+2 or UTC+3. Let's add 2 hours as a safe approximation for day checks at 16:00
    cairo_now = dt.datetime.utcnow() + dt.timedelta(hours=2)
    cairo_weekday = cairo_now.weekday()
    print(f"[ADAPTIVE] Checking weekly inventory trigger. Cairo weekday: {cairo_weekday} (6 is Sunday)")
    return cairo_weekday == 6


def _filter_active_symbols(symbols_list: List[str]) -> List[str]:
    """
    Dynamically identify and exclude delisted/suspended/stale stocks.
    Priority order:
      1. If stock_fundamentals has listing status and isListed=false, exclude it.
      2. Otherwise, fall back to price staleness checks.
    If a stock has no records in the database at all, it is allowed so
    that we can sync its history for the first time.
    """
    print("[ACTIVE_FILTER] Dynamically filtering active symbols...")
    fundamentals_map: Dict[str, Dict[str, Any]] = {}
    fund_page = 0
    fund_page_size = 1000
    try:
        while True:
            fund_res = (
                supabase.table("stock_fundamentals")
                .select("symbol,data")
                .eq("exchange", "EGX")
                .range(fund_page * fund_page_size, (fund_page + 1) * fund_page_size - 1)
                .execute()
            )
            fund_rows = fund_res.data or []
            if not fund_rows:
                break
            for row in fund_rows:
                sym = str(row.get("symbol") or "").strip().upper()
                if sym:
                    fundamentals_map[sym] = row.get("data") if isinstance(row.get("data"), dict) else {}
            if len(fund_rows) < fund_page_size:
                break
            fund_page += 1
    except Exception as e:
        print(f"[ACTIVE_FILTER] Fundamentals listing fetch failed: {e}")

    all_data = []
    page = 0
    page_size = 1000
    while len(all_data) < 30000:
        try:
            res = (
                supabase.table("stock_prices")
                .select("symbol,close,date,volume")
                .eq("exchange", "EGX")
                .order("date", desc=True)
                .range(page * page_size, (page + 1) * page_size - 1)
                .execute()
            )
            if not res.data:
                break
            all_data.extend(res.data)
            if len(res.data) < page_size:
                break
            page += 1
        except Exception as e:
            print(f"[ACTIVE_FILTER] Error fetching page {page}: {e}")
            break

    if not all_data and not fundamentals_map:
        print("[ACTIVE_FILTER] No price/fundamental data found, using original symbols list.")
        return symbols_list

    try:
        inactive_symbols_set: Set[str] = set()

        for sym, data in fundamentals_map.items():
            if data.get("isListed") is False or str(data.get("listingStatus") or "").strip().lower() == "delisted":
                inactive_symbols_set.add(sym)

        if all_data:
            df = pd.DataFrame(all_data)
            df["date"] = pd.to_datetime(df["date"])

            # Get the latest record for each symbol
            latest_per_symbol = df.sort_values("date").groupby("symbol").last()

            now = pd.Timestamp.now()
            latest_per_symbol["days_since"] = (now - latest_per_symbol["date"]).dt.days

            stale_mask = (
                (latest_per_symbol["close"] <= 0) |
                (latest_per_symbol["days_since"] > 30) |
                (latest_per_symbol["volume"] == 0)
            )
            stale_symbols_set = set(str(sym).upper() for sym in latest_per_symbol[stale_mask].index)

            for sym in stale_symbols_set:
                data = fundamentals_map.get(sym)
                if not isinstance(data, dict) or data.get("isListed") is not True:
                    inactive_symbols_set.add(sym)

        filtered_symbols = [sym for sym in symbols_list if str(sym).strip().upper() not in inactive_symbols_set]
        excluded = [sym for sym in symbols_list if str(sym).strip().upper() in inactive_symbols_set]
        if excluded:
            print(f"[ACTIVE_FILTER] Excluded {len(excluded)} inactive/delisted symbols: {excluded}")
        print(f"[ACTIVE_FILTER] Active symbols: {len(filtered_symbols)} / {len(symbols_list)}")
        return filtered_symbols
    except Exception as e:
        print(f"[ACTIVE_FILTER] Error during filtering: {e}")
        return symbols_list



def calculate_and_save_indicators(symbol: str, exchange: str = "EGX"):
    """Wrapper to calculate and save indicators for a single symbol (backward compatibility)."""
    records = calculate_indicators_for_symbol(symbol, exchange)
    if records:
        _batch_upsert_indicators(records, batch_size=len(records))


def calculate_indicators_for_symbol(symbol: str, exchange: str = "EGX") -> List[Dict[str, Any]]:
    """
    Calculate 20+ technical indicators for a given symbol.
    Returns a list of indicator records (for batch upsert) instead of
    upserting individually. Returns empty list on skip/error.
    """
    # Fetch latest 300 daily bars from stock_prices (enough for 200-day SMA)
    res = (
        supabase.table("stock_prices")
        .select("date,open,high,low,close,volume")
        .eq("symbol", symbol)
        .eq("exchange", exchange)
        .order("date", desc=True)
        .limit(300)
        .execute()
    )
    
    data = res.data
    if not data or len(data) < 20:
        return []
    
    # Data comes in descending order from the query, reverse it
    data.reverse()
        
    df = pd.DataFrame(data)
    df["date"] = pd.to_datetime(df["date"])
    df.set_index("date", inplace=True)

    # Skip delisted/suspended stocks
    last_close_val = float(df["close"].iloc[-1]) if not df["close"].empty else 0.0
    last_date_val = df.index[-1]
    days_since = (pd.Timestamp.now() - last_date_val).days
    recent_vol = pd.to_numeric(df["volume"].tail(5), errors="coerce").fillna(0).sum()
    if last_close_val <= 0 or days_since > 30 or recent_vol == 0:
        return []

    close = pd.to_numeric(df["close"], errors="coerce").fillna(0.0)
    volume = pd.to_numeric(df["volume"], errors="coerce").fillna(0.0)
    high = pd.to_numeric(df["high"], errors="coerce").fillna(close) if "high" in df.columns else close
    low = pd.to_numeric(df["low"], errors="coerce").fillna(close) if "low" in df.columns else close
    
    # SMA
    sma_20 = close.rolling(20, min_periods=1).mean()
    sma_50 = close.rolling(50, min_periods=1).mean()
    sma_200 = close.rolling(200, min_periods=1).mean()
    
    # EMA
    ema_20 = close.ewm(span=20, adjust=False).mean()
    ema_50 = close.ewm(span=50, adjust=False).mean()
    ema_200 = close.ewm(span=200, adjust=False).mean()
    
    # RSI
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain_14 = gain.rolling(14, min_periods=1).mean()
    avg_loss_14 = loss.rolling(14, min_periods=1).mean()
    rs_14 = avg_gain_14 / avg_loss_14.replace(0.0, np.nan)
    rsi_14 = 100 - (100 / (1 + rs_14))
    rsi_14 = rsi_14.fillna(50)
    
    avg_gain_9 = gain.rolling(9, min_periods=1).mean()
    avg_loss_9 = loss.rolling(9, min_periods=1).mean()
    rs_9 = avg_gain_9 / avg_loss_9.replace(0.0, np.nan)
    rsi_9 = 100 - (100 / (1 + rs_9))
    rsi_9 = rsi_9.fillna(50)
    
    # MACD
    ema_12 = close.ewm(span=12, adjust=False).mean()
    ema_26 = close.ewm(span=26, adjust=False).mean()
    macd = ema_12 - ema_26
    macd_signal = macd.ewm(span=9, adjust=False).mean()
    macd_hist = macd - macd_signal
    
    # BB
    bb_middle = close.rolling(20, min_periods=1).mean()
    bb_std = close.rolling(20, min_periods=1).std().fillna(0.0)
    bb_upper = bb_middle + 2 * bb_std
    bb_lower = bb_middle - 2 * bb_std
    
    # ATR
    prev_close = close.shift(1)
    tr = pd.concat([
        (high - low).abs(),
        (high - prev_close).abs(),
        (low - prev_close).abs()
    ], axis=1).max(axis=1)
    atr_14 = tr.rolling(14, min_periods=1).mean()
    
    # ADX & DMI
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    tr_sm = tr.rolling(14, min_periods=1).mean()
    plus_dm_sm = pd.Series(plus_dm, index=close.index).rolling(14, min_periods=1).mean()
    minus_dm_sm = pd.Series(minus_dm, index=close.index).rolling(14, min_periods=1).mean()
    plus_di = (plus_dm_sm / tr_sm.replace(0.0, np.nan)) * 100
    minus_di = (minus_dm_sm / tr_sm.replace(0.0, np.nan)) * 100
    plus_di = plus_di.fillna(0)
    minus_di = minus_di.fillna(0)
    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan) * 100
    dx = dx.fillna(0)
    adx_14 = dx.rolling(14, min_periods=1).mean().fillna(0)
    
    # Stochastic
    low_14 = low.rolling(14, min_periods=1).min()
    high_14 = high.rolling(14, min_periods=1).max()
    stoch_k = (close - low_14) / (high_14 - low_14).replace(0.0, np.nan) * 100
    stoch_k = stoch_k.fillna(50)
    stoch_d = stoch_k.rolling(3, min_periods=1).mean().fillna(50)
    
    # CCI
    tp = (high + low + close) / 3
    sma_tp = tp.rolling(20, min_periods=1).mean()
    mad_tp = tp.rolling(20, min_periods=1).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True)
    cci_20 = (tp - sma_tp) / (0.015 * mad_tp.replace(0.0, np.nan))
    cci_20 = cci_20.fillna(0)
    
    # VWAP
    vwap_20 = (close * volume).rolling(20, min_periods=1).sum() / volume.rolling(20, min_periods=1).sum().replace(0.0, np.nan)
    vwap_20 = vwap_20.fillna(close)
    
    # ROC & Momentum & Volume indicators
    momentum_10 = close.diff(10).fillna(0.0)
    roc_12 = ((close - close.shift(12)) / close.shift(12).replace(0.0, np.nan) * 100).fillna(0.0)
    change_pct = (close.pct_change() * 100).fillna(0.0)
    vol_sma20 = volume.rolling(20, min_periods=1).mean().fillna(0.0)
    r_vol = (volume / vol_sma20.replace(0.0, np.nan)).fillna(1.0)
    
    # Build records for the last 5 days (returned for batch upsert)
    records = []
    calc_ts = dt.datetime.utcnow().isoformat()
    last_indices = df.index[-5:]
    for idx in last_indices:
        date_str = idx.strftime("%Y-%m-%d")
        record = {
            "symbol": symbol,
            "exchange": exchange,
            "date": date_str,
            "close": float(close.loc[idx]),
            "volume": int(volume.loc[idx]),
            "ema_20": float(ema_20.loc[idx]) if not pd.isna(ema_20.loc[idx]) else None,
            "ema_50": float(ema_50.loc[idx]) if not pd.isna(ema_50.loc[idx]) else None,
            "ema_200": float(ema_200.loc[idx]) if not pd.isna(ema_200.loc[idx]) else None,
            "sma_20": float(sma_20.loc[idx]) if not pd.isna(sma_20.loc[idx]) else None,
            "sma_50": float(sma_50.loc[idx]) if not pd.isna(sma_50.loc[idx]) else None,
            "sma_200": float(sma_200.loc[idx]) if not pd.isna(sma_200.loc[idx]) else None,
            "rsi_14": float(rsi_14.loc[idx]) if not pd.isna(rsi_14.loc[idx]) else None,
            "rsi_9": float(rsi_9.loc[idx]) if not pd.isna(rsi_9.loc[idx]) else None,
            "macd": float(macd.loc[idx]) if not pd.isna(macd.loc[idx]) else None,
            "macd_signal": float(macd_signal.loc[idx]) if not pd.isna(macd_signal.loc[idx]) else None,
            "macd_histogram": float(macd_hist.loc[idx]) if not pd.isna(macd_hist.loc[idx]) else None,
            "momentum_10": float(momentum_10.loc[idx]) if not pd.isna(momentum_10.loc[idx]) else None,
            "roc_12": float(roc_12.loc[idx]) if not pd.isna(roc_12.loc[idx]) else None,
            "atr_14": float(atr_14.loc[idx]) if not pd.isna(atr_14.loc[idx]) else None,
            "bb_upper": float(bb_upper.loc[idx]) if not pd.isna(bb_upper.loc[idx]) else None,
            "bb_middle": float(bb_middle.loc[idx]) if not pd.isna(bb_middle.loc[idx]) else None,
            "bb_lower": float(bb_lower.loc[idx]) if not pd.isna(bb_lower.loc[idx]) else None,
            "adx_14": float(adx_14.loc[idx]) if not pd.isna(adx_14.loc[idx]) else None,
            "plus_di": float(plus_di.loc[idx]) if not pd.isna(plus_di.loc[idx]) else None,
            "minus_di": float(minus_di.loc[idx]) if not pd.isna(minus_di.loc[idx]) else None,
            "stoch_k": float(stoch_k.loc[idx]) if not pd.isna(stoch_k.loc[idx]) else None,
            "stoch_d": float(stoch_d.loc[idx]) if not pd.isna(stoch_d.loc[idx]) else None,
            "vol_sma20": int(vol_sma20.loc[idx]) if not pd.isna(vol_sma20.loc[idx]) else None,
            "vwap_20": float(vwap_20.loc[idx]) if not pd.isna(vwap_20.loc[idx]) else None,
            "r_vol": float(r_vol.loc[idx]) if not pd.isna(r_vol.loc[idx]) else None,
            "cci_20": float(cci_20.loc[idx]) if not pd.isna(cci_20.loc[idx]) else None,
            "change_pct": float(change_pct.loc[idx]) if not pd.isna(change_pct.loc[idx]) else None,
            "calculated_at": calc_ts
        }
        records.append(record)
    return records


def _batch_upsert_indicators(all_records: List[Dict[str, Any]], batch_size: int = 200):
    """Upsert indicator records in large batches to minimize HTTP requests."""
    if not all_records:
        return
    for i in range(0, len(all_records), batch_size):
        batch = all_records[i:i + batch_size]
        try:
            supabase.table("stock_technical_indicators").upsert(batch).execute()
        except Exception as e:
            print(f"[INDICATORS] Batch upsert failed for batch {i//batch_size}: {e}")
            # Fallback: upsert individually
            for rec in batch:
                try:
                    supabase.table("stock_technical_indicators").upsert(rec).execute()
                except Exception as e2:
                    print(f"[INDICATORS] Individual upsert failed for {rec.get('symbol')}: {e2}")


def _fetch_technical_snapshot(symbol: str, exchange: str) -> dict:
    """Fetch latest technical indicators for smart evaluation."""
    try:
        t_res = (
            supabase.table("stock_technical_indicators")
            .select("rsi_14,adx_14,ema_50,ema_200,volume,change_pct,macd,macd_signal,vol_sma20")
            .eq("symbol", symbol)
            .eq("exchange", exchange)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if t_res.data:
            row = t_res.data[0]
            return {
                "rsi": float(row.get("rsi_14", 50)),
                "adx": float(row.get("adx_14", 25)),
                "ema_50": float(row.get("ema_50", 0)),
                "ema_200": float(row.get("ema_200", 0)),
                "volume": int(row.get("volume", 0)),
                "change_pct": float(row.get("change_pct", 0)),
                "macd": float(row.get("macd", 0) or 0),
                "macd_signal": float(row.get("macd_signal", 0) or 0),
                "vol_sma20": float(row.get("vol_sma20", 0) or 0),
            }
    except Exception as e:
        print(f"[SMART_EVAL] Error fetching indicators for {symbol}: {e}")
    return {"rsi": 50, "adx": 25, "ema_50": 0, "ema_200": 0, "volume": 0, "change_pct": 0, "macd": 0, "macd_signal": 0, "vol_sma20": 0}


def _send_telegram_adjustment(symbol: str, exchange: str, adjustment: dict):
    """Send adjustment notification via Telegram to subscribers."""
    try:
        from api.telegram_bot import get_telegram_bot
        bot = get_telegram_bot()
        if not bot:
            return

        adj_type = adjustment.get("type", "adjustment")
        emoji_map = {
            "target_raised": "🎯📈",
            "target_lowered": "🎯📉",
            "stop_raised": "🛡️📈",
            "stop_lowered": "🛡️📉",
            "trend_weakening": "⚠️📉",
            "trend_strengthening": "🚀📈",
            "acceleration_breakout": "🚀⚡",
        }
        emoji = emoji_map.get(adj_type, "📊")
        web_origin = os.getenv("WEB_ORIGIN", "https://egxbots.com").strip().rstrip("/")

        reason_ar = adjustment.get('reason_ar', adj_type)
        reason_en = adjustment.get('reason_en', adj_type)

        msg = (
            f"{emoji} *تعديل ذكي على التوصية / Smart Update* 🔧\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💎 *السهم:* `{symbol}.{exchange}`\n"
            f"📌 *التعديل:* {reason_ar}\n"
            f"     *{reason_en}*\n"
            f"💰 *السعر الحالي:* `{adjustment.get('current_price', '—')}` EGP\n"
        )
        if adjustment.get("old_target") and adjustment.get("new_target"):
            msg += f"🎯 *الهدف:* `{adjustment['old_target']}` ➔ `{adjustment['new_target']}` EGP\n"
        if adjustment.get("old_stop") and adjustment.get("new_stop"):
            msg += f"🛡️ *وقف الخسارة:* `{adjustment['old_stop']}` ➔ `{adjustment['new_stop']}` EGP\n"
            
        msg += f"\n📊 *المؤشرات:* RSI: `{adjustment.get('rsi', '—')}` | ADX: `{adjustment.get('adx', '—')}`\n"
        msg += f"📈 *العائد الحالي للفكرة:* `{adjustment.get('pl_pct', '—')}%`\n"
        msg += f"━━━━━━━━━━━━━━━━━━━━\n"
        msg += f"🔗 [تحديثات الفكرة على المنصة]({web_origin}/scanner/backtests?tab=bots)"

        # Send to admin
        bot.send_notification(msg)

        # Send to subscribers of this symbol's bot
        _notify_subscribers_for_symbol(symbol, exchange, msg)

    except Exception as e:
        print(f"[SMART_EVAL] Telegram notification failed: {e}")


def _send_telegram_exit(symbol: str, exchange: str, entry_price: float, exit_price: float, pl_pct: float, status: str):
    """Send exit notification via Telegram to subscribers."""
    try:
        from api.telegram_bot import get_telegram_bot
        bot = get_telegram_bot()
        if not bot:
            return

        web_origin = os.getenv("WEB_ORIGIN", "https://egxbots.com").strip().rstrip("/")
        emoji = "🎉🎯" if status == "win" else "🛡️⚠️"
        status_text_ar = "توصية ناجحة (تحقيق الهدف) ✅" if status == "win" else "تفعيل وقف الخسارة 🛡️"
        status_text_en = "Target Hit (Profit) ✅" if status == "win" else "Stop Loss Hit (Loss) 🛡️"

        msg = (
            f"{emoji} *إغلاق صفقة / Close Signal* 🏁\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💎 *السهم:* `{symbol}.{exchange}`\n"
            f"📌 *النتيجة:* {status_text_ar} / {status_text_en}\n"
            f"📈 *سعر الدخول:* `{entry_price:.2f}` EGP\n"
            f"💰 *سعر الخروج:* `{exit_price:.2f}` EGP\n"
            f"📊 *صافي العائد:* `{pl_pct:+.2f}%`\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🔗 *لمتابعة الصفقات التاريخية والتحليلات:*\n"
            f"👉 [اضغط هنا لفتح المنصة]({web_origin}/scanner/backtests?tab=bots)\n"
        )

        # Send to admin
        bot.send_notification(msg)

        # Send to subscribers of this symbol's bot
        _notify_subscribers_for_symbol(symbol, exchange, msg)

    except Exception as e:
        print(f"[SMART_EVAL] Telegram exit notification failed for {symbol}: {e}")


def generate_weekly_performance_report(trigger: str = "manual", chat_id: Optional[str] = None):
    """
    Calculate performance statistics for closed recommendations in the last 7 days
    and broadcast the report to all 'stock_score' subscribers (or send to a specific chat_id).
    """
    try:
        print("[WEEKLY_REPORT] Starting weekly performance report generation...")
        seven_days_ago = (dt.datetime.utcnow() - dt.timedelta(days=7)).isoformat()
        
        # Fetch closed recommendations in last 7 days
        res = (
            supabase.table("scan_results")
            .select("symbol, exchange, entry_price, exit_price, profit_loss_pct, status, updated_at")
            .in_("status", ["win", "loss"])
            .gte("updated_at", seven_days_ago)
            .execute()
        )
        
        closed_recs = res.data or []
        total_closed = len(closed_recs)
        
        # Calculate stats
        win_count = sum(1 for r in closed_recs if r.get("status") == "win")
        win_rate = (win_count / total_closed * 100) if total_closed > 0 else 0.0
        
        total_pnl = sum(float(r.get("profit_loss_pct") or 0.0) for r in closed_recs)
        avg_pnl = (total_pnl / total_closed) if total_closed > 0 else 0.0
        
        best_trade = None
        worst_trade = None
        
        if closed_recs:
            # Sort by profit_loss_pct
            sorted_recs = sorted(closed_recs, key=lambda x: float(x.get("profit_loss_pct") or 0.0))
            worst_trade = sorted_recs[0]
            best_trade = sorted_recs[-1]
            
        # Fetch current active/open recommendations (top 5 by creation date or precision)
        open_res = (
            supabase.table("scan_results")
            .select("symbol, exchange, entry_price, last_close, profit_loss_pct, precision, created_at")
            .eq("status", "open")
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )
        open_recs = open_res.data or []
        
        # Format active positions list
        active_lines = []
        for r in open_recs:
            sym = r["symbol"]
            ex = r.get("exchange", "EGX")
            ep = float(r.get("entry_price") or 0.0)
            cp = float(r.get("last_close") or ep)
            pnl = float(r.get("profit_loss_pct") or 0.0)
            score = round(float(r.get("precision") or 0.5) * 10)
            icon = "🟢" if pnl >= 0 else "🔴"
            active_lines.append(
                f"▪️ *{sym}.{ex}* | دخول: `{ep:.2f}` | حالي: `{cp:.2f}` ({icon} `{pnl:+.2f}%` | التقييم: `{score}/10`)"
            )
        active_positions_str = "\n".join(active_lines) if active_lines else "▫️ لا توجد توصيات مفتوحة حالياً."
        
        # Format the best and worst trade strings
        best_str = "—"
        if best_trade:
            best_str = f"*{best_trade['symbol']}.{best_trade.get('exchange', 'EGX')}* بمكسب `{float(best_trade['profit_loss_pct']):+.2f}%` 🚀"
            
        worst_str = "—"
        if worst_trade:
            worst_str = f"*{worst_trade['symbol']}.{worst_trade.get('exchange', 'EGX')}* بخسارة `{float(worst_trade['profit_loss_pct']):+.2f}%` 🛡️"
            
        # Date strings for title
        start_date_str = (dt.datetime.utcnow() - dt.timedelta(days=7)).strftime("%Y-%m-%d")
        end_date_str = dt.datetime.utcnow().strftime("%Y-%m-%d")
        
        web_origin = os.getenv("WEB_ORIGIN", "https://egxbots.com").strip().rstrip("/")
        
        # Build the final message
        msg = (
            f"📊 *التقرير الأسبوعي للأداء / Weekly Report* 📊\n"
            f"📅 *الفترة:* من `{start_date_str}` إلى `{end_date_str}`\n"
            f"━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📈 *ملخص الأداء المغلق / Closed Performance Summary:*\n"
            f"▪️ *الصفقات المغلقة:* `{total_closed}` صفقة\n"
            f"▪️ *نسبة النجاح (Win Rate):* `{win_rate:.1f}%` 🎯\n"
            f"▪️ *متوسط العائد لكل صفقة:* `{avg_pnl:+.2f}%`\n"
            f"▪️ *العائد التراكمي الإجمالي:* `{total_pnl:+.2f}%`\n\n"
            f"🏆 *أفضل صفقة (Best Trade):*\n"
            f"▫️ {best_str}\n\n"
            f"📉 *أسوأ صفقة (Worst Trade):*\n"
            f"▫️ {worst_str}\n\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💼 *توصيات مفتوحة حالياً (آخر 5) / Active Positions:*\n"
            f"{active_positions_str}\n\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🔗 *لمتابعة الصفقات والتقارير الفنية الكاملة:*\n"
            f"👉 [اضغط هنا لفتح المنصة]({web_origin}/scanner/backtests?tab=bots)\n"
        )
        
        # Delivery
        if chat_id:
            from api.telegram_bot import get_telegram_bot
            bot = get_telegram_bot()
            if bot:
                bot.send_notification(msg, chat_id=chat_id)
                print(f"[WEEKLY_REPORT] Sent report on-demand to chat_id: {chat_id}")
        else:
            _notify_service_subscribers("stock_score", msg)
            print("[WEEKLY_REPORT] Broadcasted weekly report to all stock_score subscribers.")
            
    except Exception as e:
        print(f"[WEEKLY_REPORT] Error generating report: {e}")
        import traceback
        traceback.print_exc()


def _notify_subscribers_for_symbol(symbol: str, exchange: str, message: str):
    """Send notification to all users subscribed to bots that track this symbol."""
    _notify_service_subscribers("ai_bot", message)


def _notify_service_subscribers(service_type: str, message: str):
    """Send notification to all users subscribed to a specific service."""
    try:
        from api.telegram_bot import get_telegram_bot
        bot = get_telegram_bot()
        if not bot:
            return

        # Find subscribers with notifications enabled for this service
        sub_res = (
            supabase.table("bot_subscriptions")
            .select("user_id, telegram_chat_id, notifications_enabled")
            .eq("service_type", service_type)
            .eq("notifications_enabled", True)
            .execute()
        )
        if not sub_res.data:
            return

        notified = set()
        for sub in sub_res.data:
            user_id = sub.get("user_id")
            if user_id in notified:
                continue
            notified.add(user_id)

            chat_id = sub.get("telegram_chat_id")
            if not chat_id:
                # Fallback to profile telegram_chat_id
                prof_res = (
                    supabase.table("profiles")
                    .select("telegram_chat_id")
                    .eq("id", user_id)
                    .maybe_single()
                    .execute()
                )
                if prof_res.data and prof_res.data.get("telegram_chat_id"):
                    chat_id = prof_res.data["telegram_chat_id"]

            if chat_id:
                bot.send_notification(message, chat_id=str(chat_id))
    except Exception as e:
        print(f"[SERVICE_NOTIFY] {service_type} notification error: {e}")


def evaluate_old_recommendations():
    """
    SMART evaluation of open recommendations with dynamic TP/SL adjustment.
    
    Logic:
    - If stock in strong uptrend (price > EMA50, ADX > 25, RSI 50-75): RAISE target
    - If stock weakening (RSI dropping < 40, price < EMA50): TIGHTEN stop loss
    - If stock breaking out (MACD crossover, volume spike): RAISE target aggressively
    - Track all adjustments in 'adjustments' jsonb field
    """
    # PERF: Select only the columns we actually use — avoids pulling large JSONB fields like `top_reasons`/`features`
    res = supabase.table("scan_results").select(
        "id, symbol, exchange, entry_price, last_close, target_price, stop_loss, "
        "status, created_at, updated_at, profit_loss_pct, adjustments"
    ).eq("status", "open").execute()
    open_recs = res.data
    if not open_recs:
        print("[EVALUATE] No open recommendations to evaluate.")
        return

    print(f"[EVALUATE] Smart-evaluating {len(open_recs)} open recommendations...")

    for rec in open_recs:
        symbol = rec["symbol"]
        exchange = rec.get("exchange", "EGX")

        entry_val = rec.get("entry_price") or rec.get("last_close")
        if entry_val is None:
            print(f"[EVALUATE] Entry price missing for {symbol}.{exchange}. Skipping.")
            continue

        entry_price = float(entry_val)
        if entry_price <= 0.0:
            continue

        target_price = float(rec["target_price"]) if rec.get("target_price") is not None else None
        stop_loss = float(rec["stop_loss"]) if rec.get("stop_loss") is not None else None
        created_at_date = (rec.get("created_at") or "")[:10]

        # Fetch price history
        p_res = (
            supabase.table("stock_prices")
            .select("date,high,low,close")
            .eq("symbol", symbol)
            .eq("exchange", exchange)
            .gte("date", created_at_date)
            .order("date", desc=False)
            .execute()
        )

        prices = p_res.data
        if not prices:
            continue

        # 🚫 Handle delisted/suspended stocks by closing them
        latest_close = float(prices[-1]["close"])
        latest_price_date = prices[-1].get("date", "")
        
        is_delisted_or_stale = False
        reason = ""
        
        if latest_close <= 0:
            is_delisted_or_stale = True
            reason = "last close is zero (delisted)"
        else:
            try:
                days_since = (dt.datetime.now() - dt.datetime.strptime(latest_price_date[:10], "%Y-%m-%d")).days
                if days_since > 30:
                    is_delisted_or_stale = True
                    reason = f"last data {days_since} days ago (stale)"
            except Exception:
                pass

        if is_delisted_or_stale:
            print(f"[EVALUATE] Closing stale/delisted recommendation for {symbol}.{exchange} — {reason}")
            try:
                supabase.table("scan_results").update({
                    "status": "stale",
                    "exit_price": latest_close if latest_close > 0 else None,
                    "updated_at": dt.datetime.utcnow().isoformat()
                }).eq("id", rec["id"]).execute()
            except Exception as upd_err:
                print(f"[EVALUATE] Failed to close stale recommendation for {symbol}: {upd_err}")
            continue

        # Get technical snapshot for smart logic
        tech = _fetch_technical_snapshot(symbol, exchange)
        pl_pct = ((latest_close - entry_price) / entry_price) * 100

        # Load existing adjustments
        existing_adjustments = rec.get("adjustments") or []
        if isinstance(existing_adjustments, str):
            try:
                existing_adjustments = json.loads(existing_adjustments)
            except Exception:
                existing_adjustments = []

        status = "open"
        exit_price = None
        found_event = False
        new_adjustments = []
        eps = 0.00001

        # ── SMART ADJUSTMENT LOGIC ──
        new_target = target_price
        new_stop = stop_loss
        trend_strength = "neutral"

        # SMART 1: Cooldown — check if a target-raise adjustment was already made in the last 3 days
        today_str = dt.datetime.utcnow().strftime("%Y-%m-%d")
        _three_days_ago = (dt.datetime.utcnow() - dt.timedelta(days=3)).strftime("%Y-%m-%d")
        recent_target_raise = any(
            a.get("type") in ("target_raised", "acceleration_breakout")
            and (a.get("timestamp", "")[:10]) >= _three_days_ago
            for a in existing_adjustments
        )

        # SMART 4: Max holding period — after 45 days start tightening stop to force a close
        days_held = 0
        try:
            days_held = (dt.datetime.utcnow() - dt.datetime.strptime(created_at_date, "%Y-%m-%d")).days
        except Exception:
            pass

        # Determine trend strength
        price_above_ema50 = latest_close > tech["ema_50"] if tech["ema_50"] > 0 else None
        price_above_ema200 = latest_close > tech["ema_200"] if tech["ema_200"] > 0 else None
        macd_bullish = tech["macd"] > tech["macd_signal"]
        
        # Calculate relative volume for acceleration detection
        r_vol = 1.0
        if tech.get("vol_sma20") and tech["vol_sma20"] > 0 and tech.get("volume") and tech["volume"] > 0:
            r_vol = tech["volume"] / tech["vol_sma20"]
        
        # ── NEW: Acceleration Breakout Detection ──
        # When ADX>50 + Volume>2x + RSI>70, the stock is in full acceleration mode
        # These are the stocks that generated +72% (TYCN) and +43% (EASB)
        acceleration_breakout = (
            tech["adx"] > 50 and
            r_vol > 2.0 and
            tech["rsi"] > 70 and
            (price_above_ema50 is True) and
            macd_bullish
        )
        
        strong_uptrend = (
            (price_above_ema50 is True) and
            tech["adx"] > 25 and
            tech["rsi"] >= 50 and  # Allow high RSI — momentum, not overbought
            macd_bullish
        )
        weakening = (
            tech["rsi"] < 40 or
            (price_above_ema50 is False and tech["adx"] < 20)
        )
        breaking_out = (
            tech["rsi"] > 60 and
            tech["adx"] > 30 and
            macd_bullish and
            tech["change_pct"] > 2.0
        )

        # ── ACCELERATION BREAKOUT → Maximum target expansion ──
        # SMART 1: Only raise if no target-raise done in last 3 days (prevents exponential compounding)
        if acceleration_breakout and pl_pct > 2.0 and not recent_target_raise:
            if target_price:
                old_tp = round(target_price, 2)
                # SMART 2: Raise target by 20% (was 40% — too aggressive, caused unreachable targets)
                new_target = round(target_price * 1.20, 2)
                # Widen stop loss to give room — move to entry+5% if profitable enough
                if stop_loss and pl_pct > 8.0:
                    new_stop = round(entry_price * 1.05, 2)  # Lock +5% profit
                elif stop_loss and pl_pct > 5.0:
                    new_stop = round(entry_price * 1.02, 2)  # Lock +2%
                adj = {
                    "type": "acceleration_breakout",
                    "reason_ar": "تسارع سعري قوي — ADX عالي + سيولة مرتفعة + زخم شرائي — رفع الهدف 20%",
                    "reason_en": "Acceleration breakout — High ADX + Volume surge + Strong momentum — target raised 20%",
                    "old_target": old_tp,
                    "new_target": new_target,
                    "old_stop": round(stop_loss, 2) if stop_loss else None,
                    "new_stop": new_stop if new_stop != stop_loss else None,
                    "adx": round(tech["adx"], 1),
                    "rsi": round(tech["rsi"], 1),
                    "r_vol": round(r_vol, 2),
                    "current_price": round(latest_close, 2),
                    "pl_pct": round(pl_pct, 2),
                    "timestamp": dt.datetime.utcnow().isoformat(),
                }
                new_adjustments.append(adj)
                trend_strength = "acceleration"
                print(f"[SMART_EVAL] {symbol}: ACCELERATION BREAKOUT → target {old_tp}→{new_target} (ADX={tech['adx']:.0f}, R_VOL={r_vol:.1f}x)")

        elif strong_uptrend and pl_pct > 3.0 and not recent_target_raise:
            # Stock is performing well — raise target by 15% (3-day cooldown prevents compounding)
            if target_price:
                old_tp = round(target_price, 2)
                raise_pct = 0.15  # Fixed 15% raise — was 25% for pl>8, too aggressive
                new_target = round(target_price * (1 + raise_pct), 2)
                # Also trail stop loss up to lock profits
                if stop_loss and pl_pct > 5.0:
                    new_stop = round(entry_price * 1.02, 2)  # Move SL to +2% from entry
                adj = {
                    "type": "target_raised",
                    "reason_ar": "السهم في ترند صاعد قوي - رفع الهدف",
                    "reason_en": "Strong uptrend - target raised",
                    "old_target": old_tp,
                    "new_target": new_target,
                    "old_stop": round(stop_loss, 2) if stop_loss else None,
                    "new_stop": new_stop if new_stop != stop_loss else None,
                    "current_price": round(latest_close, 2),
                    "rsi": round(tech["rsi"], 1),
                    "adx": round(tech["adx"], 1),
                    "pl_pct": round(pl_pct, 2),
                    "timestamp": dt.datetime.utcnow().isoformat(),
                }
                new_adjustments.append(adj)
                trend_strength = "strong_bull"
                print(f"[SMART_EVAL] {symbol}: UPTREND → target {old_tp}→{new_target}, SL→{new_stop}")

        elif breaking_out and pl_pct > 1.0 and not recent_target_raise:
            # Breaking out — aggressive target raise
            if target_price:
                old_tp = round(target_price, 2)
                new_target = round(target_price * 1.20, 2)
                adj = {
                    "type": "target_raised",
                    "reason_ar": "اختراق قوي مع زخم شرائي - رفع الهدف",
                    "reason_en": "Strong breakout - aggressive target raise",
                    "old_target": old_tp,
                    "new_target": new_target,
                    "current_price": round(latest_close, 2),
                    "rsi": round(tech["rsi"], 1),
                    "adx": round(tech["adx"], 1),
                    "pl_pct": round(pl_pct, 2),
                    "timestamp": dt.datetime.utcnow().isoformat(),
                }
                new_adjustments.append(adj)
                trend_strength = "breakout"
                print(f"[SMART_EVAL] {symbol}: BREAKOUT → target {old_tp}→{new_target}")

        elif weakening and pl_pct > 0:
            # Stock weakening but still in profit — tighten stop loss or close if near target
            # SMART 3: If very close to target (within 2%), just let it close naturally — don't tighten
            effective_tp_for_weak = new_target if new_target else target_price
            near_target = (
                effective_tp_for_weak is not None
                and latest_close >= effective_tp_for_weak * 0.98
            )
            if near_target:
                print(f"[SMART_EVAL] {symbol}: WEAKENING but within 2% of target — holding, no SL change")
            elif stop_loss is not None:
                old_sl = round(stop_loss, 2)
                # BUG 1 FIX: Only apply the tighter stop if it's ABOVE the current stop loss
                # Using 0.97 of current price to lock ~50% of unrealised profit
                candidate_stop = round(latest_close * 0.97, 2)
                if candidate_stop > stop_loss:
                    new_stop = candidate_stop
                    adj = {
                        "type": "stop_raised",
                        "reason_ar": "ضعف الزخم - تضييق وقف الخسارة لحماية الأرباح",
                        "reason_en": "Momentum weakening - stop loss tightened",
                        "old_stop": old_sl,
                        "new_stop": new_stop,
                        "current_price": round(latest_close, 2),
                        "rsi": round(tech["rsi"], 1),
                        "adx": round(tech["adx"], 1),
                        "pl_pct": round(pl_pct, 2),
                        "timestamp": dt.datetime.utcnow().isoformat(),
                    }
                    new_adjustments.append(adj)
                    print(f"[SMART_EVAL] {symbol}: WEAKENING → SL raised {old_sl}→{new_stop}")
                else:
                    print(f"[SMART_EVAL] {symbol}: WEAKENING but proposed SL {candidate_stop} <= current SL {old_sl} — skipping adjustment")
            trend_strength = "weakening"

        # SMART 4: Max holding period — after 45 days without exit, start tightening stop
        if days_held >= 45 and not found_event and trend_strength == "neutral":
            if stop_loss is not None:
                old_sl = round(stop_loss, 2)
                # Trail stop aggressively to force a close within the next few sessions
                candidate_stop = round(latest_close * 0.98, 2)
                if candidate_stop > stop_loss:
                    new_stop = candidate_stop
                    adj = {
                        "type": "stop_raised",
                        "reason_ar": f"انتهاء مدة الاحتفاظ ({days_held} يوم) - تضييق وقف الخسارة",
                        "reason_en": f"Max holding period ({days_held} days) - tightening stop to force close",
                        "old_stop": old_sl,
                        "new_stop": new_stop,
                        "current_price": round(latest_close, 2),
                        "pl_pct": round(pl_pct, 2),
                        "days_held": days_held,
                        "timestamp": dt.datetime.utcnow().isoformat(),
                    }
                    new_adjustments.append(adj)
                    trend_strength = "max_holding"
                    print(f"[SMART_EVAL] {symbol}: MAX HOLDING ({days_held}d) → SL raised {old_sl}→{new_stop}")

        # ── CHECK EXIT CONDITIONS (with potentially adjusted TP/SL) ──
        # FIX: If we just raised the target in this run (strong uptrend / breakout),
        # skip exit evaluation to avoid the contradictory "target raised → immediately closed" behavior.
        # The new target will be evaluated in the next run.
        # BUG 6 FIX: Include "weakening" — a stop adjustment also changes effective_stop,
        # so we skip exit on the same run to avoid contradictory notifications.
        target_just_raised = trend_strength in ("acceleration", "strong_bull", "breakout", "weakening")

        # BUG 4 FIX: Use `is not None` instead of truthiness to handle stop_loss = 0.0 correctly
        effective_target = new_target if new_target is not None else target_price
        effective_stop = new_stop if new_stop is not None else stop_loss

        # FIX: Use updated_at (last bot review date) instead of created_at as the
        # cutoff for bar evaluation.  This prevents re-discovering old target hits
        # on bars that were already evaluated in previous runs.
        last_review_date = (rec.get("updated_at") or rec.get("created_at") or "")[:10]

        if not target_just_raised:
            for p in prices:
                p_date = p.get("date", "")
                # Skip bars already evaluated in previous runs (or the entry day)
                if p_date <= last_review_date:
                    continue

                hi = float(p["high"]) if p.get("high") is not None else float(p["close"])
                lo = float(p["low"]) if p.get("low") is not None else float(p["close"])

                if effective_stop is not None and lo <= (effective_stop + eps):
                    exit_price = effective_stop
                    pl_pct = ((effective_stop - entry_price) / entry_price) * 100
                    status = "win" if pl_pct >= 0.0 else "loss"
                    found_event = True
                    break

                if effective_target is not None and hi >= (effective_target - eps):
                    exit_price = effective_target
                    pl_pct = ((effective_target - entry_price) / entry_price) * 100
                    status = "win" if pl_pct >= 0.0 else "loss"
                    found_event = True
                    break
        else:
            print(f"[EVALUATE] {symbol}: Skipping exit check — target just raised (trend={trend_strength})")

        # ── UPDATE DATABASE ──
        all_adjustments = existing_adjustments + new_adjustments

        if not found_event:
            update_data = {
                "last_close": latest_close,
                "profit_loss_pct": round(pl_pct, 4),
                "status": "open",
                "updated_at": dt.datetime.utcnow().isoformat(),
            }
            if new_target is not None and new_target != target_price:
                update_data["target_price"] = new_target
            if new_stop is not None and new_stop != stop_loss:
                update_data["stop_loss"] = new_stop
            if all_adjustments:
                update_data["adjustments"] = all_adjustments

            try:
                supabase.table("scan_results").update(update_data).eq("id", rec["id"]).execute()
            except Exception as upd_err:
                print(f"[EVALUATE] Update failed for {symbol}: {upd_err}")
        else:
            _now_iso = dt.datetime.utcnow().isoformat()
            update_data = {
                "exit_price": exit_price,
                # BUG 3 FIX: update last_close to exit price so dashboard shows correct current value
                "last_close": exit_price,
                "profit_loss_pct": round(pl_pct, 4),
                "status": status,
                "updated_at": _now_iso,
            }
            if all_adjustments:
                update_data["adjustments"] = all_adjustments

            try:
                supabase.table("scan_results").update(update_data).eq("id", rec["id"]).execute()
            except Exception as upd_err:
                print(f"[EVALUATE] Close update failed for {symbol}: {upd_err}")

        # ── SEND TELEGRAM NOTIFICATIONS ──
        # FIX: Only send adjustment notifications (e.g. "target raised") if we are
        # NOT closing the position in the same run. Sending both is contradictory.
        if not found_event:
            for adj in new_adjustments:
                _send_telegram_adjustment(symbol, exchange, adj)

        if found_event:
            _send_telegram_exit(symbol, exchange, entry_price, exit_price, pl_pct, status)

        print(f"[EVALUATE] {symbol}: status={status}, return={pl_pct:.2f}%, trend={trend_strength}, adjustments={len(new_adjustments)}")


def _split_symbol_exchange(raw_symbol: str, default_exchange: str = "EGX") -> Tuple[str, str, str]:
    symbol = (raw_symbol or "").strip()
    if "." in symbol:
        base_symbol, exchange = symbol.rsplit(".", 1)
    else:
        base_symbol, exchange = symbol, default_exchange
    full_symbol = f"{base_symbol}.{exchange}"
    return base_symbol, exchange, full_symbol


def update_open_portfolio_positions():
    """
    Update only open portfolio positions with the latest market price and P/L details.
    Closed positions are intentionally ignored so the bot never re-manages them.
    """
    res = supabase.table("positions").select("*").eq("status", "open").execute()
    open_positions = res.data or []
    if not open_positions:
        print("[POSITIONS] No open portfolio positions to update.")
        return

    print(f"[POSITIONS] Updating {len(open_positions)} open portfolio positions...")
    for pos in open_positions:
        raw_symbol = pos.get("symbol")
        if not raw_symbol:
            print(f"[POSITIONS] Missing symbol for position {pos.get('id')}. Skipping.")
            continue

        base_symbol, exchange, full_symbol = _split_symbol_exchange(raw_symbol)
        price_res = (
            supabase.table("stock_prices")
            .select("date,open,high,low,close,volume")
            .eq("symbol", base_symbol)
            .eq("exchange", exchange)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if not price_res.data:
            price_res = (
                supabase.table("stock_prices")
                .select("date,open,high,low,close,volume")
                .eq("symbol", base_symbol)
                .order("date", desc=True)
                .limit(1)
                .execute()
            )

        if not price_res.data:
            print(f"[POSITIONS] No latest price found for {full_symbol}. Skipping.")
            continue

        latest = price_res.data[0]
        current_price = float(latest.get("close") or 0.0)
        if current_price <= 0.0:
            print(f"[POSITIONS] Latest close <= 0 for {full_symbol}. Skipping.")
            continue

        # 🚫 Skip delisted/suspended stocks
        latest_price_date = latest.get("date", "")
        try:
            days_since = (dt.datetime.now() - dt.datetime.strptime(str(latest_price_date)[:10], "%Y-%m-%d")).days
            if days_since > 30:
                print(f"[POSITIONS] Skipping {full_symbol} — last data {days_since} days ago (stale/delisted)")
                continue
        except Exception:
            pass

        entry_val = pos.get("entry_price")
        entry_price = float(entry_val) if entry_val is not None else current_price
        if entry_price <= 0.0:
            entry_price = current_price

        change_pct = ((current_price - entry_price) / entry_price) * 100.0
        metadata = pos.get("metadata") or {}
        metadata.update({
            "bot_managed": True,
            "symbol_base": base_symbol,
            "exchange": exchange,
            "entry_price": round(entry_price, 6),
            "current_price": round(current_price, 6),
            "price_change_pct": round(change_pct, 4),
            "latest_price_date": latest.get("date"),
            "latest_open": latest.get("open"),
            "latest_high": latest.get("high"),
            "latest_low": latest.get("low"),
            "latest_volume": latest.get("volume"),
            "last_portfolio_update": dt.datetime.utcnow().isoformat(),
        })

        update_data = {
            "entry_price": entry_price,
            "status_price": current_price,
            "metadata": metadata,
            "updated_at": dt.datetime.utcnow().isoformat(),
        }
        if not pos.get("entry_at"):
            update_data["entry_at"] = pos.get("added_at") or dt.datetime.utcnow().isoformat()

        try:
            supabase.table("positions").update(update_data).eq("id", pos["id"]).eq("status", "open").execute()
            print(f"[POSITIONS] Updated {raw_symbol}: current={current_price:.4f}, change={change_pct:+.2f}%")
        except Exception as upd_err:
            print(f"[POSITIONS] Update failed for {raw_symbol}: {upd_err}")


def generate_arabic_rationale(result: dict) -> dict:
    """
    Generate rich Arabic rationale text based on the calculated technical indicators
    and fundamentals of a stock, matching the deep-research-report format.
    """
    symbol = result["symbol"]
    exchange = result["exchange"]
    last_close = result["last_close"]
    precision = result["precision"]
    
    # 1. Fetch latest indicators from DB
    rsi = 50.0
    adx = 25.0
    ema_50 = last_close
    ema_200 = last_close
    volume = 0
    change_pct = 0.0
    
    try:
        t_res = (
            supabase.table("stock_technical_indicators")
            .select("rsi_14,adx_14,ema_50,ema_200,volume,change_pct")
            .eq("symbol", symbol)
            .eq("exchange", exchange)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if t_res.data:
            row = t_res.data[0]
            rsi = float(row.get("rsi_14", 50.0))
            adx = float(row.get("adx_14", 25.0))
            ema_50 = float(row.get("ema_50", last_close))
            ema_200 = float(row.get("ema_200", last_close))
            volume = int(row.get("volume", 0))
            change_pct = float(row.get("change_pct", 0.0))
    except Exception as e:
        print(f"[RATIONALE] Error fetching indicators for rationale: {e}")

    # 2. Fetch fundamentals
    sector = "Real Estate"
    pe = None
    eps = None
    
    try:
        f_res = (
            supabase.table("stock_fundamentals")
            .select("data")
            .eq("symbol", symbol)
            .eq("exchange", exchange)
            .execute()
        )
        if f_res.data:
            fund_data = f_res.data[0].get("data", {}) or {}
            sector = fund_data.get("Sector", fund_data.get("sector", fund_data.get("industry", "Real Estate")))
            pe = fund_data.get("peRatio", fund_data.get("pe", None))
            eps = fund_data.get("eps", None)
    except Exception as e:
        print(f"[RATIONALE] Error fetching fundamentals for rationale: {e}")

    # Map sector to Arabic
    sector_ar_map = {
        "Real Estate": "العقارات والتطوير العقاري",
        "Financial Services": "الخدمات المالية غير المصرفية",
        "Construction": "البناء والتشييد",
        "Materials": "المواد الخام والتعدين",
        "Utilities": "المرافق والطاقة",
        "Health Care": "الرعاية الصحية والأدوية",
        "Food & Beverage": "الأغذية والمشروبات",
        "Telecom": "الاتصالات وتكنولوجيا المعلومات",
        "Chemicals": "الكيماويات والأسمدة",
        "Industrial Goods": "الصناعات التحويلية والسلع الصناعية"
    }
    sector_ar = sector_ar_map.get(sector, "القطاع العام للمضاربة")
    
    # 3. Generate Technical Rationale
    tech_bullets = []
    if rsi >= 70:
        tech_bullets.append(f"مؤشر القوة النسبية (RSI) مرتفع عند ~{rsi:.0f} مما يوضح وجود اندفاع شرائي قوي وتواجد السهم في مناطق تشبع شراء.")
    elif rsi <= 35:
        tech_bullets.append(f"مؤشر القوة النسبية (RSI) منخفض عند ~{rsi:.0f} مما يدل على وصول السهم لمنطقة تشبع بيعي وبدء ارتداد شرائي فني.")
    else:
        tech_bullets.append(f"مؤشر القوة النسبية (RSI) مستقر عند ~{rsi:.0f} مما يفتح مجالاً لمزيد من الصعود الفني المستقر دون تشبع.")
        
    if adx >= 25:
        tech_bullets.append(f"مؤشر الاتجاه (ADX) عند ~{adx:.0f} يؤكد وجود اتجاه صاعد واضح قوي يدعم استمرار الزخم.")
    else:
        tech_bullets.append(f"مؤشر الاتجاه (ADX) عند ~{adx:.0f} يشير إلى مرحلة تجميع وبداية ترند فني جديد.")
        
    if last_close > ema_50:
        tech_bullets.append(f"يستقر سعر السهم فوق المتوسط المتحرك لـ 50 يوم ({ema_50:.2f} جنيه) مما يعطي إشارة إيجابية على المدى القصير.")
    else:
        tech_bullets.append(f"يتداول السهم بالقرب من دعم فني هام مع توقعات بارتداد صعودي فوق المتوسط 50 يوم.")
        
    tech_rationale = " ".join(tech_bullets)
    
    # 4. Generate Fundamental Rationale
    fund_bullets = []
    fund_bullets.append(f"ينتمي السهم لقطاع {sector_ar} وهو قطاع داعم وقوي.")
    if pe:
        try:
            pe_val = float(pe)
            fund_bullets.append(f"يتداول السهم بمكرر ربحية (P/E) معقول يقارب {pe_val:.1f}x مما يجعله خياراً جذاباً.")
        except:
            pass
    if eps:
        try:
            eps_val = float(eps)
            fund_bullets.append(f"سجلت الشركة ربحية سهم (EPS) بلغت {eps_val:.2f} جنيه مما يدعم النمو التشغيلي المستقبلي.")
        except:
            pass
            
    fund_rationale = " ".join(fund_bullets)
    
    # 5. Expected success rate
    win_rate_val = int(precision * 100)
    if win_rate_val < 50:
        win_rate_val = 52
    elif win_rate_val > 95:
        win_rate_val = 90 # Cap expected win rate conservatively
        
    win_rate = f"{win_rate_val}%"
    
    # 6. Targets
    target_1 = result["target_price"]
    target_2 = round(target_1 * 1.10, 2)
    stop_loss = result["stop_loss"]
    
    # 7. Brief Rationale
    brief_rationale = (
        f"يُظهر سهم «{symbol}» فرصة مضاربية ممتازة بدعم من مؤشر القوة النسبية RSI ({rsi:.0f}) ومؤشر الاتجاه ADX ({adx:.0f}). "
        f"تم تحديد سعر دخول مقترح حول {last_close:.2f} جنيه، مستهدفين هدفاً أولاً عند {target_1:.2f} جنيه وهدفاً ثانياً عند {target_2:.2f} جنيه، "
        f"مع وضع وقف خسارة عند {stop_loss:.2f} جنيه لحماية المحفظة."
    )

    # 7.5 Fetch real news headlines
    news_source = f"نتائج الربع الأول وتقارير الإفصاح المالي لشركة ({symbol})"
    try:
        sym_clean = symbol.split(".")[0].upper()
        res = (
            supabase.table("stock_news_sentiment")
            .select("headlines, sources")
            .eq("symbol", sym_clean)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if res.data and res.data[0].get("headlines"):
            headlines = res.data[0]["headlines"]
            sources = res.data[0]["sources"]
            if headlines:
                headline_str = headlines[0]
                if " - " in headline_str:
                    headline_str = headline_str.split(" - ")[0]
                source_str = sources[0] if sources else "Google News"
                news_source = f"أخبار البورصة: «{headline_str}» (المصدر: {source_str})"
    except Exception as e:
        print(f"[RATIONALE] Error fetching news for rationale: {e}")
    
    return {
        "win_rate": win_rate,
        "target_2": target_2,
        "brief_rationale": brief_rationale,
        "technical_rationale": tech_rationale,
        "fundamental_rationale": fund_rationale,
        "expected_win_pct": win_rate_val,
        "news_source": news_source
    }


async def generate_daily_recommendations(model_name: Optional[str] = None):
    """
    Run fast_scan ML model for Egypt, select the top 10 speculative stocks,
    generate rich detailed Arabic reports, and insert them into scan_results.
    """
    from typing import Optional
    resolved_model = "model_EGX.pkl"
    
    # ── Load EGX30 index data unconditionally for trend check and adaptive selection ──
    market_df = None
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    index_path = os.path.join(base_dir, "symbols_data", "EGX30-INDEX.json")
    if os.path.exists(index_path):
        try:
            with open(index_path, "r") as f:
                idx_data = json.load(f)
            market_df = pd.DataFrame(idx_data)
            market_df['date'] = pd.to_datetime(market_df['date'])
            market_df.set_index('date', inplace=True)
            print("[RECOMMENDATIONS] Market context (EGX30) loaded from JSON.")
        except Exception as json_err:
            print(f"[WARNING] Failed to load EGX30 index from JSON: {json_err}")

    if market_df is None or market_df.empty:
        print("[RECOMMENDATIONS] Loading EGX30 index from Supabase...")
        try:
            offset = 0
            limit = 1000
            all_data = []
            while True:
                idx_res = (
                    supabase.table("stock_prices")
                    .select("date, close, open, high, low, volume")
                    .eq("symbol", "EGX30")
                    .eq("exchange", "INDX")
                    .order("date", desc=False)
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
                market_df = pd.DataFrame(all_data)
                market_df["date"] = pd.to_datetime(market_df["date"])
                market_df = market_df.set_index("date").sort_index()
                print(f"[RECOMMENDATIONS] Loaded {len(market_df)} EGX30 index rows from Supabase.")
        except Exception as db_err:
            print(f"[WARNING] Failed to load EGX30 index from Supabase: {db_err}")

    # Standardize column casing and ensure standard columns exist for trend/regime checks
    if market_df is not None and not market_df.empty:
        rename_map = {}
        for src, dst in {
            "close": "Close",
            "high": "High",
            "low": "Low",
            "volume": "Volume",
            "open": "Open",
        }.items():
            if src in market_df.columns:
                rename_map[src] = dst
        if rename_map:
            market_df = market_df.rename(columns=rename_map)

        if "Close" in market_df.columns:
            if "High" not in market_df.columns:
                market_df["High"] = market_df["Close"]
            if "Low" not in market_df.columns:
                market_df["Low"] = market_df["Close"]
            if "Volume" not in market_df.columns:
                market_df["Volume"] = 0.0

            # ── Run EGX30 Trend Safety Check (Circuit Breaker) ──
            from api.circuit_breaker_detector import CircuitBreakerDetector
            detector = CircuitBreakerDetector()
            if not detector.is_egx30_trend_safe(market_df):
                print("[RECOMMENDATIONS] ⚠️ EGX30 is under its 50-day SMA. Halting recommendations generation due to market trend circuit breaker!")
                return 0

    if model_name:
        model_lower = model_name.lower().strip()
        if model_lower == "adaptive":
            print("[RECOMMENDATIONS] Resolving model using AdaptiveModelSelector...")
            try:
                from api.adaptive_model_selector import AdaptiveModelSelector
                if market_df is not None and not market_df.empty and "Close" in market_df.columns:
                    selector = AdaptiveModelSelector()
                    regime_info = selector.detect_market_regime(market_df)
                    recommended_path = regime_info.recommended_model
                    resolved_model = os.path.basename(recommended_path)
                    print(f"[RECOMMENDATIONS] Adaptive selector detected regime: {regime_info.regime} (confidence: {regime_info.confidence:.2f}) -> Selected: {resolved_model}")
                else:
                    print(f"[WARNING] Close column missing in index data. Falling back to default model: {resolved_model}")
            except Exception as e:
                print(f"[WARNING] Error running AdaptiveModelSelector: {e}. Falling back to default model: {resolved_model}")
        else:
            if not model_lower.endswith(".pkl"):
                resolved_model = f"{model_name}.pkl"
            else:
                resolved_model = model_name

    council_model = None
    validator_model = None
    if resolved_model == "model_EGX.pkl" or resolved_model.endswith("model_EGX.pkl"):
        council_model = "KING.pkl"
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if os.path.exists(os.path.join(base_dir, "models", "The_Council_Validator.pkl")):
            validator_model = "The_Council_Validator.pkl"
        elif os.path.exists(os.path.join(base_dir, "api", "models", "The_Council_Validator.pkl")):
            validator_model = "The_Council_Validator.pkl"

    print(f"[RECOMMENDATIONS] Running ML fast scan for EGX stocks using model: {resolved_model} (council: {council_model}, validator: {validator_model})...")
    scan_resp = fast_scan(
        country="Egypt",
        limit=200,
        min_precision=0.5,
        model_name=resolved_model,
        council_model=council_model,
        validator_model=validator_model
    )
    
    results = scan_resp.get("results", [])
    if not results:
        print("[RECOMMENDATIONS] ML scan returned no BUY recommendations.")
        return 0
        
    print(f"[RECOMMENDATIONS] ML scan found {len(results)} BUY signals.")

    if council_model:
        def _normalize_percent_score(value: object, default: float = 0.0) -> float:
            try:
                score = float(value)
            except Exception:
                return float(default)
            if score <= 1.0:
                score *= 100.0
            return score

        try:
            env_thresh = os.getenv("COUNCIL_THRESHOLD", "55.0")
            council_threshold = _normalize_percent_score(env_thresh, default=55.0)
        except Exception:
            council_threshold = 55.0

        filtered_results = []
        for item in results:
            score = _normalize_percent_score(item.get("council_score", 0.0))
            item["council_score"] = round(score, 1)
            if score >= council_threshold:
                filtered_results.append(item)
            else:
                print(f"[RECOMMENDATIONS] Filtered out {item.get('symbol')} due to low council score: {score:.1f}% < {council_threshold:.1f}%")
        
        print(f"[RECOMMENDATIONS] Council filtering: {len(results)} -> {len(filtered_results)} candidates remaining.")
        results = filtered_results
        if not results:
            print("[RECOMMENDATIONS] No candidates passed council consensus filtering.")
            return 0
    
    # Calculate risk_adjusted_return for all candidates and adjust with news sentiment
    _init_supabase()
    for item in results:
        entry_p = float(item.get("last_close", 0.0)) if item.get("last_close") is not None else 0.0
        target_p = float(item.get("target_price", 0.0)) if item.get("target_price") is not None else 0.0
        stop_l = float(item.get("stop_loss", 0.0)) if item.get("stop_loss") is not None else 0.0
        prec = float(item.get("precision", 0.5)) if item.get("precision") is not None else 0.5
        
        expected_ret = target_p - entry_p
        expected_risk = entry_p - stop_l
        
        raw_rar = 0.0
        if expected_risk > 0:
            raw_rar = prec * (expected_ret / expected_risk)
            
        # Get today's news sentiment from Supabase
        sentiment_mult = 1.0
        try:
            if supabase:
                sym_clean = item.get("symbol", "").split(".")[0].upper()
                res = (
                    supabase.table("stock_news_sentiment")
                    .select("sentiment_score, news_count")
                    .eq("symbol", sym_clean)
                    .order("date", desc=True)
                    .limit(1)
                    .execute()
                )
                if res.data:
                    record = res.data[0]
                    if record.get("news_count", 0) > 0:
                        score = record.get("sentiment_score", 0.0)
                        # Adjustment formula: mult = 1 + score * 0.25
                        sentiment_mult = 1.0 + (score * 0.25)
        except Exception as se_err:
            print(f"DEBUG: Error checking sentiment for rank adjustment of {item.get('symbol')}: {se_err}")
            
        item["risk_adjusted_return"] = raw_rar * sentiment_mult

    # Sort by risk_adjusted_return descending to prioritize safer risk-reward profiles
    results.sort(key=lambda x: x.get("risk_adjusted_return", 0.0), reverse=True)
    
    # Take the top 10 speculative stocks
    top_10 = results[:10]
    
    batch_id = str(uuid.uuid4())
    for i, res_item in enumerate(top_10):
        symbol = res_item.get("symbol")
        exchange = res_item.get("exchange", "EGX")
        if not symbol:
            continue
            
        # Calculate rich details
        rich_details = generate_arabic_rationale(res_item)
        
        row_data = {
            "batch_id": batch_id,
            "user_id": None,
            "symbol": symbol,
            "exchange": exchange,
            "name": res_item.get("name", symbol),
            "model_name": scan_resp.get("model", "model_EGX.pkl"),
            "country": "Egypt",
            "last_close": float(res_item.get("last_close", 0.0)) if res_item.get("last_close") is not None else 0.0,
            "precision": float(res_item.get("precision", 0.5)) if res_item.get("precision") is not None else 0.5,
            "signal": "BUY",
            "status": "open",
            "entry_price": float(res_item.get("last_close", 0.0)) if res_item.get("last_close") is not None else 0.0,
            "target_price": float(res_item.get("target_price", 0.0)) if res_item.get("target_price") is not None else 0.0,
            "stop_loss": float(res_item.get("stop_loss", 0.0)) if res_item.get("stop_loss") is not None else 0.0,
            "risk_adjusted_return": float(res_item.get("risk_adjusted_return", 0.0)),
            "is_public": True,
            "top_reasons": rich_details,  # Stored as jsonb
            "features": res_item.get("features", []),  # Stored as jsonb
            "created_at": dt.datetime.utcnow().isoformat(),
            "updated_at": dt.datetime.utcnow().isoformat()
        }
        
        try:
            # Check if there is already an open recommendation for this symbol
            existing = (
                supabase.table("scan_results")
                .select("id")
                .eq("symbol", symbol)
                .eq("status", "open")
                .execute()
            )
            if existing.data:
                rec_id = existing.data[0]["id"]
                update_data = {
                    "precision": row_data["precision"],
                    "risk_adjusted_return": row_data["risk_adjusted_return"],
                    "features": row_data["features"],
                    "updated_at": row_data["updated_at"]
                }
                supabase.table("scan_results").update(update_data).eq("id", rec_id).execute()
                print(f"[RECOMMENDATIONS] #{i+1} Updated existing open recommendation for {symbol}.{exchange}")
            else:
                # Avoid hard failure if some DB columns are missing in the remote schema.
                safe_row_data = dict(row_data)
                safe_row_data.pop("top_reasons", None)
                safe_row_data.pop("features", None)
                supabase.table("scan_results").insert(safe_row_data).execute()
                print(f"[RECOMMENDATIONS] #{i+1} Saved {symbol}.{exchange} with target1={row_data['target_price']}, target2={rich_details['target_2']}, risk_adjusted_return={row_data['risk_adjusted_return']:.4f}")
        except Exception as ins_err:
            print(f"[RECOMMENDATIONS] Failed to save/update recommendation for {symbol}: {ins_err}")

    # Notify Stocks Score subscribers with beautiful detailed summary card
    try:
        web_origin = os.getenv("WEB_ORIGIN", "https://egxbots.com").strip().rstrip("/")
        current_date = dt.datetime.now().strftime("%Y-%m-%d")
        
        msg_lines = [
            f"🚀 *توصيات الذكاء الاصطناعي الجديدة / New AI Recommendations* 🚀",
            f"📅 *التاريخ:* `{current_date}`",
            f"━━━━━━━━━━━━━━━━━━━━\n"
        ]
        
        # SMART 6 FIX: Send all top 10 (was top 5 — users missed half the recommendations)
        for idx, r in enumerate(top_10):
            sym = r.get("symbol")
            ex = r.get("exchange", "EGX")
            ep = float(r.get("last_close" if r.get("last_close") is not None else "entry_price", 0.0))
            tp = float(r.get("target_price", 0.0))
            sl = float(r.get("stop_loss", 0.0))
            tp2 = round(tp * 1.10, 2)
            score = round(float(r.get("precision", 0.5)) * 10)
            name = r.get("name", sym)
            
            msg_lines.append(
                f"🔥 *#{idx+1} {sym}.{ex}* | {name}\n"
                f"▪️ *الدخول المقترح:* `{ep:.2f}` EGP\n"
                f"▪️ *الهدف الأول:* `{tp:.2f}` | *الهدف الثاني:* `{tp2:.2f}`\n"
                f"▪️ *وقف الخسارة:* `{sl:.2f}`\n"
                f"▪️ *تقييم الزخم (Score):* `{score}/10` ⚡\n"
                f"━━━━━━━━━━━━━━━━━━━━"
            )
            
        msg_lines.append(
            f"📈 *إجمالي الإشارات الجديدة:* `{len(top_10)}` أسهم\n\n"
            f"🔗 *لمتابعة الرسوم البيانية والتفاصيل الكاملة:*\n"
            f"👉 [اضغط هنا لفتح المنصة]({web_origin}/scanner/backtests?tab=bots)"
        )
        
        _notify_service_subscribers("stock_score", "\n".join(msg_lines))
        print("[RECOMMENDATIONS] Sent beautiful detailed recommendations to Telegram.")
    except Exception as e:
        print(f"[RECOMMENDATIONS] Telegram notify error: {e}")

    return len(top_10)


def _refresh_market_status_cache():
    """Prefetch last 180 days of EGX30, EGX100, and USD/EGP using FREE data providers (yfinance)."""
    from api.free_data_provider import get_market_status_free
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    try:
        # Fetch market data using free providers
        res_data = get_market_status_free(period="6mo")
        egx30_data = res_data.get("egx30", [])
        egx100_data = res_data.get("egx100", [])
        usdegp_data = res_data.get("usdegp", [])
        regime = res_data.get("regime", "sideways")
        egx30_return = res_data.get("egx30_return", 0.0)
        
        print(f"[MARKET_STATUS] Fetched market data (FREE): {len(egx30_data)} EGX30 rows, regime={regime}")
        
        # Save to local file cache in api/symbols_data/market_status.json
        cache_path = os.path.join(base_dir, "symbols_data", "market_status.json")
        
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(res_data, f, ensure_ascii=False, indent=2)
        print(f"[MARKET_STATUS] Market status cache successfully saved to {cache_path}")

        # Upsert index rows to Supabase so the runtime fallback always has fresh data
        try:
            from api.stock_ai import _init_supabase as _init_sb, supabase as _sb
            _init_sb()
            if _sb:
                INDEX_META = [
                    ("EGX30", "INDX", egx30_data),
                    ("EGX100", "INDX", egx100_data),
                    ("USDEGP", "FOREX", usdegp_data),
                ]
                total_upserted = 0
                for idx_symbol, idx_exchange, idx_rows in INDEX_META:
                    if not idx_rows or not isinstance(idx_rows, list):
                        continue
                    batch = []
                    for r in idx_rows:
                        try:
                            d = r.get("date", r.get("Date"))
                            if not d:
                                continue
                            batch.append({
                                "symbol": idx_symbol,
                                "exchange": idx_exchange,
                                "date": str(d)[:10],
                                "open": float(r.get("open", r.get("Open", 0)) or 0),
                                "high": float(r.get("high", r.get("High", 0)) or 0),
                                "low": float(r.get("low", r.get("Low", 0)) or 0),
                                "close": float(r.get("close", r.get("Close", 0)) or 0),
                                "volume": float(r.get("volume", r.get("Volume", 0)) or 0),
                            })
                        except Exception:
                            continue
                    # Chunk to avoid request size limits
                    for i in range(0, len(batch), 100):
                        chunk = batch[i:i + 100]
                        try:
                            _sb.table("stock_prices").upsert(chunk, on_conflict="symbol,exchange,date").execute()
                            total_upserted += len(chunk)
                        except Exception as ue:
                            print(f"[MARKET_STATUS] Index upsert chunk failed for {idx_symbol}: {ue}")
                if total_upserted:
                    print(f"[MARKET_STATUS] Upserted {total_upserted} index price rows to Supabase")
        except Exception as ie:
            print(f"[MARKET_STATUS] Index Supabase upsert skipped: {ie}")
        
        # Update macro history correlation cache
        try:
            from api.macro_correlation import build_or_update_macro_history
            build_or_update_macro_history()
            print("[MARKET_STATUS] Macro correlation history cache updated successfully")
        except Exception as me:
            print(f"[MARKET_STATUS] Error updating macro correlation cache: {me}")
            
        return True, "Market status cache updated successfully (using FREE data providers)"
    except Exception as e:
        print(f"[MARKET_STATUS] Error fetching market status: {e}")
        return False, f"Error: {e}"


async def run_daily_job(dry_run: bool = False, model_filter: str = None, skip_sync: bool = False, trigger: str = "manual"):
    print(f"--- Daily Bot Run Job Started: {dt.datetime.now()} ---")
    if dry_run:
        print("[DRY RUN] Simulation mode — no actual trades will be executed.")
    if model_filter:
        print(f"[FILTER] Running only for model: {model_filter}")
    if skip_sync:
        print("[SKIP] Price synchronization will be skipped.")

    _init_supabase()
    if not supabase:
        print("[ERROR] Supabase client could not be initialized.")
        return

    job_run_id = str(uuid.uuid4())
    job_start_time = dt.datetime.utcnow().isoformat()
    steps_log = []
    active_steps = {}
    symbols_raw = []
    total_symbols = 0

    def _persist_job(status: str):
        try:
            last_failed = next(
                (step for step in reversed(steps_log) if step.get("status") == "failed"),
                None,
            )
            stock_ai.supabase.table("daily_job_runs").upsert({
                "id": job_run_id,
                "job_type": "daily_bot",
                "status": status,
                "started_at": job_start_time,
                "completed_at": dt.datetime.utcnow().isoformat() if status in ("completed", "failed") else None,
                "steps": json.dumps(steps_log),
                "total_symbols": total_symbols,
                "trigger": trigger,
                "error": last_failed.get("details") if last_failed else None,
            }).execute()
        except Exception as e:
            print(f"[JOB] Failed to persist job run: {e}")

    def _append_step_log(step_name: str, status: str, details: str = "", count: int = 0, extra: Optional[Dict[str, Any]] = None):
        payload = {
            "step": step_name,
            "status": status,
            "details": str(details or "")[:1000],
            "count": int(count or 0),
            "timestamp": dt.datetime.utcnow().isoformat(),
            "sequence": len(steps_log) + 1,
        }
        if extra:
            payload.update(extra)
        steps_log.append(payload)
        _persist_job("running")

    def _start_step(step_name: str, details: str = ""):
        active_steps[step_name] = time.time()
        _append_step_log(step_name, "started", details, 0)

    def _record_step(step_name: str, success: bool, details: str = "", count: int = 0):
        started_at = active_steps.pop(step_name, None)
        status = "success" if success else "failed"
        if success and str(details or "").strip().lower().startswith("skipped"):
            status = "skipped"
        extra = {}
        if started_at is not None:
            extra["duration_ms"] = int((time.time() - started_at) * 1000)
        _append_step_log(step_name, status, details, count, extra)

    try:
        # Initial status insert
        _persist_job("running")
        # 0. Refresh EGX inventory weekly only for scheduled runs
        if _should_run_weekly_inventory(trigger):
            print("\n>>> STEP 0: Refreshing EGX listed symbols inventory from EODHD...")
            _start_step("sync_inventory", "Refreshing EGX listed symbols inventory from EODHD")
            try:
                inv_ok, inv_symbols, inv_msg = _sync_latest_egx_inventory_from_eodhd()
                _record_step("sync_inventory", inv_ok, inv_msg, len(inv_symbols))
                print(f"[INVENTORY] {inv_msg}")

                if inv_ok and inv_symbols:
                    _start_step("mark_non_listed", "Marking symbols not present in latest EGX inventory")
                    mark_ok, mark_msg, mark_count = _mark_non_listed_egx_symbols(inv_symbols)
                    _record_step("mark_non_listed", mark_ok, mark_msg, mark_count)
                    print(f"[LISTING] {mark_msg}")
            except Exception as e:
                _record_step("sync_inventory", False, str(e)[:200], 0)
                print(f"[INVENTORY] Error: {e}")
        else:
            _record_step("sync_inventory", True, "Skipped - weekly scheduled refresh only", 0)
            print("\n>>> STEP 0: Skipping EGX inventory refresh today (weekly scheduled run only).")

        # 1. Sync prices
        if not skip_sync:
            print("\n>>> STEP 1: Syncing daily prices from TradingView...")
            _start_step("sync_prices", "Syncing EGX daily prices from TradingView")
            try:
                if not symbols_raw:
                    symbols_raw = _fetch_egx_symbols()  # PERF: cached — reused across steps 1, 2, 2.5
                    symbols_raw = _filter_active_symbols(symbols_raw)
                symbols = [f"{sym}.EGX" for sym in symbols_raw if sym]
                total_symbols = len(symbols)
                print(f"[SYNC] Found {total_symbols} symbols to sync.")
                syncer = get_smart_sync()
                syncer.sync_exchange_prices("EGX", symbols, max_days=365)
                _record_step("sync_prices", True, f"Synced {total_symbols} symbols", total_symbols)
            except Exception as e:
                _record_step("sync_prices", False, str(e)[:200], 0)
                print(f"[SYNC] Error: {e}")
        else:
            print("\n>>> STEP 1: Skipping price sync (--skip-sync).")
            _record_step("sync_prices", True, "Skipped", 0)

        # 2. Calculate technical indicators (parallel + batch upsert)
        print("\n>>> STEP 2: Calculating technical indicators (parallel)...")
        _start_step("calculate_indicators", "Calculating technical indicators in parallel and upserting results")
        if not symbols_raw:
            symbols_raw = _fetch_egx_symbols()
            symbols_raw = _filter_active_symbols(symbols_raw)
            if not total_symbols:
                total_symbols = len(symbols_raw)
        ind_success = 0
        ind_fail = 0
        all_indicator_records = []
        try:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            
            def _calc_one(sym):
                try:
                    return sym, calculate_indicators_for_symbol(sym, "EGX"), None
                except Exception as e:
                    return sym, [], e

            with ThreadPoolExecutor(max_workers=15) as executor:
                futures = {executor.submit(_calc_one, sym): sym for sym in symbols_raw}
                for future in as_completed(futures):
                    sym, records, err = future.result()
                    if err:
                        ind_fail += 1
                        print(f"[INDICATORS] Error for {sym}: {err}")
                    else:
                        ind_success += 1
                        all_indicator_records.extend(records)
            
            # Batch upsert all records at once
            if all_indicator_records:
                print(f"[INDICATORS] Batch upserting {len(all_indicator_records)} records...")
                _batch_upsert_indicators(all_indicator_records, batch_size=200)
            
            _record_step("calculate_indicators", ind_fail == 0, f"{ind_success} success, {ind_fail} failed, {len(all_indicator_records)} records", ind_success + ind_fail)
        except Exception as e:
            _record_step("calculate_indicators", False, str(e)[:200], 0)
            print(f"[INDICATORS] Error: {e}")

        # 2.5 Fetch & Analyze News Sentiment
        print("\n>>> STEP 2.5: Fetching and analyzing news sentiment...")
        _start_step("news_sentiment", "Fetching and analyzing news sentiment from Google News RSS")
        try:
            from api.news_sentiment_engine import process_exchange_news
            if not symbols_raw:
                symbols_raw = _fetch_egx_symbols()
                symbols_raw = _filter_active_symbols(symbols_raw)
            
            # Fetch and process news sentiment for all active EGX symbols
            ok, count = process_exchange_news("EGX", symbols_raw)
            _record_step("news_sentiment", ok, f"Processed news for {count} symbols", count)
        except Exception as e:
            _record_step("news_sentiment", False, str(e)[:200], 0)
            print(f"[NEWS_SENTIMENT] Error: {e}")

        # 3. Update open portfolio positions
        print("\n>>> STEP 3: Updating open portfolio positions...")
        _start_step("update_positions", "Updating open portfolio positions")
        try:
            update_open_portfolio_positions()
            _record_step("update_positions", True, "Positions updated", 0)
        except Exception as e:
            _record_step("update_positions", False, str(e)[:200], 0)
            print(f"[POSITIONS] Error: {e}")

        # 4. Evaluate old recommendations
        print("\n>>> STEP 4: Evaluating old recommendations...")
        _start_step("evaluate_recommendations", "Evaluating open/old recommendations")
        try:
            evaluate_old_recommendations()
            _record_step("evaluate_recommendations", True, "Evaluated open recommendations", 0)
        except Exception as e:
            _record_step("evaluate_recommendations", False, str(e)[:200], 0)
            print(f"[EVALUATE] Error: {e}")

        # 4.5 Refresh Market Status so Step 5 gate uses today's data, not yesterday's cache
        print("\n>>> STEP 4.5: Refreshing Market Status cache before recommendation gate...")
        _start_step("refresh_market_status_for_gate", "Refreshing market status for buy gate")
        try:
            ok_gate_refresh, msg_gate_refresh = _refresh_market_status_cache()
            _record_step("refresh_market_status_for_gate", ok_gate_refresh, (msg_gate_refresh or "")[:200], 0)
        except Exception as e:
            _record_step("refresh_market_status_for_gate", False, str(e)[:200], 0)
            print(f"[MARKET_GATE] Could not refresh market status before gate: {e}")

        # 5. Generate new recommendations
        print("\n>>> STEP 5: Generating new speculative recommendations...")
        _start_step("generate_recommendations", f"Generating recommendations using {model_filter or 'default'} model")
        try:
            market_gate = should_reject_new_buys()
            if market_gate.get("blocked"):
                msg = f"Skipped - {market_gate.get('reason')}"
                print(f"[MARKET_GATE] {msg}")
                _record_step("generate_recommendations", True, msg[:200], 0)
            else:
                generated_count = await generate_daily_recommendations(model_name=model_filter)
                _record_step("generate_recommendations", True, f"Generated {generated_count} recommendations using {model_filter or 'default'}", int(generated_count or 0))
        except Exception as e:
            _record_step("generate_recommendations", False, str(e)[:200], 0)
            print(f"[RECOMMENDATIONS] Error: {e}")

        # 6. Run Historical Similarity Scan
        print("\n>>> STEP 6: Running Historical Similarity market scan...")
        _start_step("historical_similarity", "Running market-wide historical similarity scan")
        try:
            from api.historical_similarity import run_market_wide_similarity_scan, publish_similarity_report
            results = run_market_wide_similarity_scan(
                k=10,
                forward_days=10,
                target_return=0.05,
                stop_loss=-0.03,
                search_scope="same_symbol",
                max_workers=15
            )
            if results:
                published = publish_similarity_report({
                    "name": f"Daily Similarity Scan - {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}",
                    "scans": results,
                    "k": 10,
                    "forward_days": 10,
                    "target_return": 0.05,
                    "stop_loss": -0.03
                })
                # Notify Historical Similarity subscribers
                try:
                    top = sorted(results, key=lambda x: x.get("stats", {}).get("win_rate", 0), reverse=True)[:5]
                    msg_lines = [f"📊 *Historical Similarity Report* — {dt.datetime.now().strftime('%Y-%m-%d')}", ""]
                    for r in top:
                        stats = r.get("stats", {})
                        wr = stats.get("win_rate", 0) * 100
                        avg = stats.get("average_return", 0) * 100
                        msg_lines.append(f"• *{r.get('symbol', '—')}* — Win Rate: {wr:.1f}% | Avg Return: {avg:+.2f}%")
                    msg_lines.append("")
                    msg_lines.append(f"🔗 Total setups: {len(results)}")
                    _notify_service_subscribers("historical_similarity", "\n".join(msg_lines))
                except Exception as e:
                    print(f"[SIMILARITY] Telegram notify error: {e}")
            _record_step("historical_similarity", True, f"{len(results)} symbols scanned", len(results))
        except Exception as e:
            _record_step("historical_similarity", False, str(e)[:200], 0)
            print(f"[SIMILARITY] Error: {e}")

        # 7. Run Weekly Performance Report (on Sunday)
        if _should_run_weekly_inventory(trigger):
            print("\n>>> STEP 7: Running Weekly Performance Report...")
            _start_step("weekly_performance_report", "Generating weekly performance report")
            try:
                generate_weekly_performance_report(trigger=trigger)
                _record_step("weekly_performance_report", True, "Weekly performance report generated and sent", 0)
            except Exception as e:
                _record_step("weekly_performance_report", False, str(e)[:200], 0)
                print(f"[WEEKLY_REPORT] Error: {e}")

        # 8. Refresh Market Status (EGX30, EGX100, USD/EGP indices) from EODHD
        print("\n>>> STEP 8: Prefetching and refreshing Market Status cache from EODHD...")
        _start_step("refresh_market_status", "Refreshing Market Status cache from EODHD")
        try:
            ok, msg = _refresh_market_status_cache()
            _record_step("refresh_market_status", ok, msg, 0)
        except Exception as e:
            _record_step("refresh_market_status", False, str(e)[:200], 0)
            print(f"[MARKET_STATUS] Error: {e}")

        # 9. Run Weekly Adaptive Retraining (on Sunday)
        if _should_run_weekly_inventory(trigger):
            print("\n>>> STEP 9: Running Weekly Adaptive Retraining...")
            _start_step("weekly_adaptive_retraining", "Running adaptive retraining on recent EGX mistakes")
            try:
                from api.adaptive_learning import ActiveLearner, ManualRetrainer, update_actuals
                print("[ADAPTIVE] Updating actual outcomes for EGX...")
                update_actuals(exchange="EGX", look_forward_days=20)
                
                print("[ADAPTIVE] Initializing adaptive retraining for EGX model...")
                learner = ActiveLearner("EGX")
                if learner.model:
                    retrainer = ManualRetrainer("EGX")
                    mistakes = retrainer.fetch_mistakes(lookback_days=90)
                    if mistakes:
                        new_booster = retrainer.retrain_on_mistakes(learner, mistakes)
                        if new_booster:
                            import joblib
                            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                            model_path = os.path.join(base_dir, "models", "model_EGX.pkl")
                            try:
                                if os.path.exists(model_path):
                                    data = joblib.load(model_path)
                                    if isinstance(data, dict) and data.get("kind") == "lgbm_booster":
                                        data["model_str"] = new_booster.model_to_string()
                                        joblib.dump(data, model_path)
                                    else:
                                        joblib.dump(new_booster, model_path)
                                else:
                                    joblib.dump(new_booster, model_path)
                                print(f"[ADAPTIVE] Weekly retraining completed successfully with {len(mistakes)} mistakes.")
                                _record_step("weekly_adaptive_retraining", True, f"Retrained on {len(mistakes)} mistakes", len(mistakes))
                            except Exception as save_err:
                                print(f"[ADAPTIVE] Failed to save retrained model: {save_err}")
                                _record_step("weekly_adaptive_retraining", False, f"Failed to save: {save_err}", 0)
                        else:
                            print("[ADAPTIVE] Retraining failed to produce a new booster.")
                            _record_step("weekly_adaptive_retraining", False, "Retraining failed", 0)
                    else:
                        print("[ADAPTIVE] No recent mistakes found for retraining.")
                        _record_step("weekly_adaptive_retraining", True, "Skipped - no mistakes found", 0)
                else:
                    print("[ADAPTIVE] EGX model not found for retraining.")
                    _record_step("weekly_adaptive_retraining", False, "Model not found", 0)
            except Exception as e:
                _record_step("weekly_adaptive_retraining", False, str(e)[:200], 0)
                print(f"[ADAPTIVE] Weekly retraining failed with error: {e}")

        _persist_job("completed")
        print(f"\n--- Daily Bot Run Job Completed: {dt.datetime.now()} ---")

    except Exception as e:
        _record_step("job", False, str(e)[:500], total_symbols)
        _persist_job("failed")
        print(f"\n--- Daily Bot Run Job FAILED: {dt.datetime.now()} — {e} ---")


if __name__ == "__main__":
    asyncio.run(run_daily_job())
