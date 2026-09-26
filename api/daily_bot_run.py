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
import math
import urllib.request
import urllib.parse
import pandas as pd
import numpy as np
from typing import List, Dict, Any, Tuple, Optional, Set

# Set project root path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_root, ".env"))
load_dotenv(os.path.join(project_root, "web", ".env.local"), override=True)

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
from api.web_origin import get_web_origin


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


def _should_send_weekly_report(trigger: str = "manual") -> bool:
    """Weekly Telegram report is scheduled-only and Sunday-only."""
    if str(trigger or "").strip().lower() != "scheduled":
        return False
    cairo_now = dt.datetime.utcnow() + dt.timedelta(hours=2)
    return cairo_now.weekday() == 6


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


def _detect_single_divergence(prices: pd.Series, indicator: pd.Series, ind_name: str = "RSI") -> Tuple[str, float, int]:
    """
    Detects divergence between a price series and an indicator series over a 15-day window.
    Returns: (divergence_type, strength, periods)
    """
    prices = pd.to_numeric(prices, errors="coerce").ffill().fillna(0.0)
    indicator = pd.to_numeric(indicator, errors="coerce").ffill().fillna(0.0)
    
    if len(prices) < 15 or len(indicator) < 15:
        return "NONE", 0.0, 0

    try:
        # Split into recent (last 5 days) and previous (10 days before)
        price_recent = prices.iloc[-5:]
        price_prev = prices.iloc[-15:-5]
        
        ind_recent = indicator.iloc[-5:]
        ind_prev = indicator.iloc[-15:-5]
        
        price_low_recent = price_recent.min()
        price_low_prev = price_prev.min()
        ind_low_recent = ind_recent.min()
        ind_low_prev = ind_prev.min()
        
        price_high_recent = price_recent.max()
        price_high_prev = price_prev.max()
        ind_high_recent = ind_recent.max()
        ind_high_prev = ind_prev.max()
        
        # Bullish Divergence: Price makes a lower low, Indicator makes a higher low
        if price_low_recent < price_low_prev and ind_low_recent > ind_low_prev:
            price_drop_pct = (price_low_prev - price_low_recent) / (price_low_prev or 1.0)
            
            if ind_name == "MACD":
                ind_std = indicator.std() or 1.0
                ind_rise_norm = (ind_low_recent - ind_low_prev) / ind_std
            else:
                ind_rise_norm = (ind_low_recent - ind_low_prev) / 50.0
                
            strength = min(1.0, max(0.3, (price_drop_pct * 12.0) + (ind_rise_norm * 0.7)))
            
            try:
                p_low_rec_idx = price_recent.idxmin()
                p_low_prev_idx = price_prev.idxmin()
                pos_rec = prices.index.get_loc(p_low_rec_idx)
                pos_prev = prices.index.get_loc(p_low_prev_idx)
                periods = int(pos_rec - pos_prev)
            except Exception:
                periods = 10
                
            return "BULLISH", float(strength), int(periods)
            
        # Bearish Divergence: Price makes a higher high, Indicator makes a lower high
        if price_high_recent > price_high_prev and ind_high_recent < ind_high_prev:
            price_rise_pct = (price_high_recent - price_high_prev) / (price_high_prev or 1.0)
            
            if ind_name == "MACD":
                ind_std = indicator.std() or 1.0
                ind_drop_norm = (ind_high_prev - ind_high_recent) / ind_std
            else:
                ind_drop_norm = (ind_high_prev - ind_high_recent) / 50.0
                
            strength = min(1.0, max(0.3, (price_rise_pct * 12.0) + (ind_drop_norm * 0.7)))
            
            try:
                p_high_rec_idx = price_recent.idxmax()
                p_high_prev_idx = price_prev.idxmax()
                pos_rec = prices.index.get_loc(p_high_rec_idx)
                pos_prev = prices.index.get_loc(p_high_prev_idx)
                periods = int(pos_rec - pos_prev)
            except Exception:
                periods = 10
                
            return "BEARISH", float(strength), int(periods)
            
    except Exception as e:
        print(f"[DIVERGENCE] Error calculating {ind_name} divergence: {e}")
        
    return "NONE", 0.0, 0


def _build_divergence_summary(rsi_div: str, macd_div: str, stoch_div: str, strength: float, periods: int) -> Optional[str]:
    divs = []
    if rsi_div != "NONE":
        divs.append(f"RSI ({'صعودي' if rsi_div == 'BULLISH' else 'هبوطي'})")
    if macd_div != "NONE":
        divs.append(f"MACD ({'صعودي' if macd_div == 'BULLISH' else 'هبوطي'})")
    if stoch_div != "NONE":
        divs.append(f"Stochastic ({'صعودي' if stoch_div == 'BULLISH' else 'هبوطي'})")
        
    if not divs:
        return None
        
    strength_pct = int(strength * 100)
    return f"تباعد {' و '.join(divs)} خلال {periods} فترة بقوة {strength_pct}%"


def calculate_indicators_for_symbol(
    symbol: str,
    exchange: str = "EGX",
    price_history: Optional[pd.DataFrame] = None,
) -> List[Dict[str, Any]]:
    """
    Calculate 20+ technical indicators for a given symbol.
    Returns a list of indicator records (for batch upsert) instead of
    upserting individually. Returns empty list on skip/error.
    """
    # The daily runner preloads the exchange once and passes each symbol's
    # history here.  Keep the narrow query as a fallback for direct callers.
    if price_history is not None and not price_history.empty:
        df = price_history.copy().tail(300)
        df.columns = [str(column).lower() for column in df.columns]
        if isinstance(df.index, pd.DatetimeIndex):
            df.index.name = "date"
        elif "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
            df.set_index("date", inplace=True)
        else:
            return []
    else:
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
        data.reverse()
        df = pd.DataFrame(data)
        df["date"] = pd.to_datetime(df["date"])
        df.set_index("date", inplace=True)

    if len(df) < 20:
        return []

    # Skip delisted/suspended stocks
    last_close_val = float(df["close"].iloc[-1]) if not df["close"].empty else 0.0
    last_date_val = df.index[-1]
    days_since = (pd.Timestamp.now() - last_date_val).days
    if last_close_val <= 0 or days_since > 30:
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
    last_indices = df.index[-1:]
    for idx in last_indices:
        date_str = idx.strftime("%Y-%m-%d")
        
        # Calculate divergences at each date slice
        prices_slice = close.loc[:idx]
        rsi_slice = rsi_14.loc[:idx]
        macd_slice = macd.loc[:idx]
        stoch_slice = stoch_k.loc[:idx]
        
        rsi_div, rsi_str, rsi_per = _detect_single_divergence(prices_slice, rsi_slice, "RSI")
        macd_div, macd_str, macd_per = _detect_single_divergence(prices_slice, macd_slice, "MACD")
        stoch_div, stoch_str, stoch_per = _detect_single_divergence(prices_slice, stoch_slice, "STOCH")
        
        div_types = [rsi_div, macd_div, stoch_div]
        strengths = [rsi_str, macd_str, stoch_str]
        periods_list = [rsi_per, macd_per, stoch_per]
        
        dominant_type = "NONE"
        dominant_strength = 0.0
        dominant_periods = 0
        
        for d_t, d_s, d_p in zip(div_types, strengths, periods_list):
            if d_t != "NONE" and d_s > dominant_strength:
                dominant_type = d_t
                dominant_strength = d_s
                dominant_periods = d_p
                
        summary_desc = _build_divergence_summary(rsi_div, macd_div, stoch_div, dominant_strength, dominant_periods)
        
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
            "rsi_divergence": rsi_div,
            "macd_divergence": macd_div,
            "stoch_divergence": stoch_div,
            "divergence_strength": float(dominant_strength),
            "divergence_periods": int(dominant_periods),
            "divergence_summary": summary_desc,
            "calculated_at": calc_ts
        }
        records.append(record)
    return records


def prune_technical_indicators_to_latest():
    """
    STRICT MAINTENANCE: Enforce exactly 1 single latest snapshot row per symbol in stock_technical_indicators.
    Deletes any older historical date rows so the table never accumulates duplicate date rows per stock.
    IMPORTANT: Paginates through the full table — Supabase default limit is 1000 rows.
    """
    try:
        # Paginate through ALL rows — don't rely on default 1000 limit
        all_rows = []
        page_size = 1000
        offset = 0
        while True:
            res = supabase.table("stock_technical_indicators").select("symbol, exchange, date").range(offset, offset + page_size - 1).execute()
            batch = res.data or []
            all_rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size

        if not all_rows:
            return

        from collections import defaultdict
        by_sym = defaultdict(list)
        for r in all_rows:
            by_sym[(r["symbol"], r.get("exchange", "EGX"))].append(r["date"])

        deleted_count = 0
        for (sym, ex), dates in by_sym.items():
            if len(dates) > 1:
                max_d = max(dates)
                try:
                    del_res = supabase.table("stock_technical_indicators").delete().eq("symbol", sym).eq("exchange", ex).lt("date", max_d).execute()
                    deleted_count += len(del_res.data or [])
                except Exception as del_err:
                    print(f"[PRUNE] Failed to prune old dates for {sym}: {del_err}")

        if deleted_count > 0:
            print(f"[PRUNE] Cleaned up {deleted_count} older date rows from stock_technical_indicators.")
        else:
            print(f"[PRUNE] Table is clean — {len(by_sym)} symbols, each with exactly 1 row.")
    except Exception as e:
        print(f"[PRUNE] Indicator table pruning error: {e}")



def _batch_upsert_indicators(all_records: List[Dict[str, Any]], batch_size: int = 200):
    """Upsert indicator records in large batches to minimize HTTP requests."""
    if not all_records:
        return
    for i in range(0, len(all_records), batch_size):
        batch = all_records[i:i + batch_size]
        try:
            # Delete old records for these symbols so we don't accumulate multiple dates, but preserve existing AI scores!
            batch_symbols = list(set([r["symbol"] for r in batch]))
            if batch_symbols:
                existing_scores = {}
                try:
                    res = supabase.table("stock_technical_indicators").select("symbol, king_ai_score, egx_ai_score").in_("symbol", batch_symbols).execute()
                    if res.data:
                        for row in res.data:
                            if row.get("king_ai_score") is not None or row.get("egx_ai_score") is not None:
                                existing_scores[row["symbol"]] = (row.get("king_ai_score"), row.get("egx_ai_score"))
                except Exception as e_score:
                    pass

                for rec in batch:
                    sym = rec.get("symbol")
                    if sym in existing_scores:
                        k_s, e_s = existing_scores[sym]
                        if k_s is not None and rec.get("king_ai_score") is None:
                            rec["king_ai_score"] = k_s
                        if e_s is not None and rec.get("egx_ai_score") is None:
                            rec["egx_ai_score"] = e_s

                supabase.table("stock_technical_indicators").delete().in_("symbol", batch_symbols).execute()
            supabase.table("stock_technical_indicators").upsert(batch).execute()
        except Exception as e:
            print(f"[INDICATORS] Batch upsert failed for batch {i//batch_size}: {e}")
            # Fallback: upsert individually
            for rec in batch:
                try:
                    supabase.table("stock_technical_indicators").delete().eq("symbol", rec["symbol"]).execute()
                    supabase.table("stock_technical_indicators").upsert(rec).execute()
                except Exception as e2:
                    print(f"[INDICATORS] Individual upsert failed for {rec.get('symbol')}: {e2}")

    # Enforce strict 1-row-per-stock constraint across entire table
    prune_technical_indicators_to_latest()


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


def _telegram_delivery_project_allowed() -> bool:
    """Only the configured production Supabase project may publish recommendations."""
    expected_ref = os.getenv("TELEGRAM_RECOMMENDATIONS_PROJECT_REF", "gfcmaxbtscmizsakarvc").strip().lower()
    supabase_url = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").strip().lower()
    if not expected_ref or not supabase_url:
        return False
    try:
        return urllib.parse.urlparse(supabase_url).hostname == f"{expected_ref}.supabase.co"
    except ValueError:
        return False


def _has_valid_telegram_event_claim(event_client: Any, event_id: Optional[str], claim_token: Optional[str], allowed_types: Set[str]) -> bool:
    if not _telegram_delivery_project_allowed():
        print("[TELEGRAM] Recommendation send blocked: Supabase project is not the configured production project.")
        return False
    from api.recommendation_events import verify_event_delivery_claim
    valid = verify_event_delivery_claim(event_client, event_id, claim_token, allowed_types)
    if not valid:
        print(f"[TELEGRAM] Recommendation send blocked: invalid or missing durable event claim ({event_id}).")
    return valid


def _adjustment_change_pct(adjustment: Dict[str, Any]) -> float:
    """Return the largest absolute target/stop change represented by an adjustment."""
    changes: List[float] = []
    for old_key, new_key in (("old_target", "new_target"), ("old_stop", "new_stop")):
        try:
            old_value = float(adjustment.get(old_key))
            new_value = float(adjustment.get(new_key))
        except (TypeError, ValueError):
            continue
        if old_value:
            changes.append(abs((new_value - old_value) / old_value) * 100.0)
    return max(changes, default=0.0)


def _send_telegram_adjustment(
    symbol: str,
    exchange: str,
    adjustment: dict,
    *,
    event_id: Optional[str] = None,
    claim_token: Optional[str] = None,
    event_client: Any = None,
):
    """Send the complete adjustment to VIP and a masked material teaser to Free."""
    if not _telegram_recommendation_writes_enabled():
        return False
    if not _has_valid_telegram_event_claim(event_client, event_id, claim_token, {"target_or_stop_adjusted"}):
        return False
    try:
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
        web_origin = get_web_origin()

        reason_ar = adjustment.get('reason_ar', adj_type)

        # The free channel receives only an upgrade notice for material moves;
        # never disclose the symbol, price, or target/stop values there. The
        # threshold is based on the actual target/stop change, not the stock's
        # current unrealised return.
        material_change_pct = _adjustment_change_pct(adjustment)
        if material_change_pct > 25:
            free_msg = (
                "📢 *إعلان: تحديث جوهري على إحدى التوصيات*\n"
                f"تم تعديل مستوى التوصية بنسبة تتجاوز `{material_change_pct:.1f}%`، "
                "والتفاصيل الكاملة متاحة حصرياً في قناة VIP.\n"
                f"🔗 اشترك الآن: {get_web_origin()}/pricing"
            )
            _notify_free_telegram(free_msg, "material_adjustment_teaser")

        msg = (
            f"{emoji} *تحديث ذكي على التوصية* 🔧\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💎 *السهم:* `{symbol}.{exchange}`\n"
            f"📌 {reason_ar}\n"
            f"💰 *السعر الحالي:* `{adjustment.get('current_price', '—')}` EGP\n"
        )
        if adjustment.get("old_target") and adjustment.get("new_target"):
            try:
                old_t = float(adjustment["old_target"])
                new_t = float(adjustment["new_target"])
                raise_pct = ((new_t - old_t) / old_t) * 100 if old_t > 0 else 0.0
                msg += f"🎯 *الهدف الأول:* `{old_t:.2f}` ➜ `{new_t:.2f}` EGP (`{raise_pct:+.1f}%`)\n"
                msg += f"🚀 *الهدف الثاني:* `{round(new_t * 1.10, 2):.2f}` EGP\n"
            except (TypeError, ValueError):
                msg += f"🎯 *الهدف الأول:* `{adjustment['old_target']}` ➜ `{adjustment['new_target']}` EGP\n"
        if adjustment.get("old_stop") and adjustment.get("new_stop"):
            msg += f"🛡️ *وقف الخسارة:* `{adjustment['old_stop']}` ➜ `{adjustment['new_stop']}` EGP\n"

        msg += f"\n📊 RSI: `{adjustment.get('rsi', '—')}` | ADX: `{adjustment.get('adx', '—')}`\n"
        msg += f"📈 *العائد الحالي:* `{adjustment.get('pl_pct', '—')}`%\n"
        msg += f"━━━━━━━━━━━━━━━━━━━━\n"
        msg += f"🔗 رابط المنصة: {web_origin}/scanner/backtests?tab=bots\n"

        return _notify_central_telegram(msg, "recommendation_adjustment")

    except Exception as e:
        print(f"[SMART_EVAL] Telegram notification failed: {e}")
        return False


def _telegram_recommendation_writes_enabled() -> bool:
    from api.recommendation_events import telegram_recommendations_read_only
    return not telegram_recommendations_read_only()


def _rollback_recommendation_change(recommendation_id: Any, expected_status: str, old_row: dict, failed_version: Optional[str] = None) -> bool:
    """Best-effort compensation when lifecycle event persistence fails."""
    restore = {
        key: old_row.get(key)
        for key in (
            "status", "exit_price", "last_close", "profit_loss_pct", "target_price",
            "stop_loss", "adjustments", "top_reasons", "features", "updated_at", "rich_details",
        )
        if key in old_row
    }
    try:
        (
            supabase.table("scan_results")
            .update(restore)
            .eq("id", recommendation_id)
            .eq("status", expected_status)
            .eq("updated_at", failed_version or old_row.get("updated_at"))
            .execute()
        )
        verify = (
            supabase.table("scan_results")
            .select("id,status,updated_at,status,exit_price,last_close,profit_loss_pct,target_price,stop_loss")
            .eq("id", recommendation_id)
            .eq("status", expected_status)
            .eq("updated_at", restore.get("updated_at"))
            .execute()
        )
        rows = getattr(verify, "data", None) or []
        if not rows:
            return False
        row = rows[0]
        return all(row.get(key) == restore.get(key) for key in ("status", "updated_at", "exit_price", "last_close", "profit_loss_pct", "target_price", "stop_loss"))
    except Exception as error:
        print(f"[EVALUATE] Lifecycle compensation failed for {recommendation_id}: {error}")
        return False


def _send_telegram_exit(
    symbol: str,
    exchange: str,
    entry_price: float,
    exit_price: float,
    pl_pct: float,
    status: str,
    created_at: str = "",
    *,
    exit_reason: Optional[str] = None,
    event_id: Optional[str] = None,
    claim_token: Optional[str] = None,
    event_client: Any = None,
):
    """Send recommendation closures to both VIP and the Free channel."""
    if not _telegram_recommendation_writes_enabled():
        return False
    if not _has_valid_telegram_event_claim(event_client, event_id, claim_token, {"recommendation_closed", "recommendation_stale"}):
        return False
    try:
        web_origin = get_web_origin()
        emoji = "🎉" if status == "win" else ("🧹" if status == "stale" else "🛡️")
        reason_labels = {
            "target_hit": ("تحقيق الهدف", "Target hit"),
            "stop_hit": ("تنفيذ الوقف", "Stop executed"),
            "time_exit": ("انتهاء مدة الاحتفاظ", "Holding period ended"),
        }
        status_text_ar, status_text_en = reason_labels.get(exit_reason, (
            "إغلاق بربح" if status == "win" else ("بيانات قديمة / سهم غير نشط" if status == "stale" else "إغلاق بخسارة"),
            "Closed with profit" if status == "win" else ("Stale / Inactive" if status == "stale" else "Closed with loss"),
        ))

        pl_sign = "+" if pl_pct > 0 else ""

        duration_line = ""
        if created_at:
            try:
                start = dt.datetime.fromisoformat(str(created_at).replace("Z", ""))
                days_held = max((dt.datetime.utcnow() - start).days, 0)
                if days_held > 0:
                    duration_line = f"⏱️ *مدة الصفقة:* `{days_held}` يوم\n"
            except Exception:
                pass

        msg = (
            f"{emoji} *إغلاق توصية / Trade Closed* 🏁\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💎 *السهم:* `{symbol}.{exchange}`\n"
            f"📌 *النتيجة:* {status_text_ar} ({status_text_en})\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"📈 *سعر الدخول:* `{entry_price:.2f}` EGP\n"
            f"🏁 *سعر الخروج:* `{exit_price:.2f}` EGP\n"
            f"📊 *العائد قبل التكاليف:* `{pl_sign}{pl_pct:.2f}%`\n"
            f"{duration_line}"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🔗 رابط سجل الصفقات: {web_origin}/scanner/backtests?tab=bots"
        )

        return _notify_central_telegram(msg, "recommendation_exit")

    except Exception as e:
        print(f"[SMART_EVAL] Telegram exit notification failed for {symbol}: {e}")
        return False


def retry_pending_recommendation_telegram_events(limit: int = 10) -> int:
    """Retry failed recommendation notifications after DB state is durable."""
    from api.recommendation_events import claim_pending_telegram_events, update_telegram_delivery

    sent = 0
    for event in claim_pending_telegram_events(supabase, limit=limit):
        event_id = event.get("id")
        claim_token = event.get("retry_claim_token")
        old_values = event.get("old_values") or {}
        new_values = event.get("new_values") or {}
        symbol = old_values.get("symbol") or new_values.get("symbol")
        exchange = old_values.get("exchange") or new_values.get("exchange") or "EGX"
        if not symbol:
            update_telegram_delivery(supabase, event_id, success=False, error="Missing symbol in event snapshot", attempts_already_claimed=True, claim_token=claim_token)
            continue

        event_type = event.get("event_type")
        if event_type in {"recommendation_closed", "recommendation_stale"}:
            entry = float(old_values.get("entry_price") or 0)
            exit_price = float(event.get("price_at_event") or new_values.get("exit_price") or entry)
            pl_pct = float(new_values.get("profit_loss_pct") or old_values.get("profit_loss_pct") or 0)
            status = str(new_values.get("status") or ("stale" if event_type == "recommendation_stale" else "loss"))
            delivered = _send_telegram_exit(
                symbol, exchange, entry, exit_price, pl_pct, status, old_values.get("created_at", ""),
                exit_reason=((new_values.get("rich_details") or {}).get("evaluation") or {}).get("exit_reason"),
                event_id=event_id, claim_token=claim_token, event_client=supabase,
            )
        elif event_type == "target_or_stop_adjusted":
            adjustment_type = str((event.get("new_values") or {}).get("adjustment_type") or "target_raised")
            adjustment = {
                "type": adjustment_type,
                "reason_ar": "إعادة إرسال تحديث التوصية",
                "old_target": old_values.get("target_price"),
                "new_target": new_values.get("target_price"),
                "old_stop": old_values.get("stop_loss"),
                "new_stop": new_values.get("stop_loss"),
                "current_price": event.get("price_at_event"),
                "pl_pct": new_values.get("profit_loss_pct") or old_values.get("profit_loss_pct"),
            }
            delivered = _send_telegram_adjustment(
                symbol, exchange, adjustment,
                event_id=event_id, claim_token=claim_token, event_client=supabase,
            )
        else:
            update_telegram_delivery(supabase, event_id, success=False, error=f"Unsupported event type: {event_type}", attempts_already_claimed=True, claim_token=claim_token)
            continue

        update_telegram_delivery(supabase, event_id, success=delivered, error=None if delivered else "Telegram send failed", attempts_already_claimed=True, claim_token=claim_token)
        sent += int(bool(delivered))
    return sent


def generate_weekly_performance_report(trigger: str = "manual", chat_id: Optional[str] = None):
    """
    Calculate performance statistics for closed recommendations in the last 7 days
    and broadcast the report to all 'stock_score' subscribers (or send to a specific chat_id).
    """
    try:
        if not _should_send_weekly_report(trigger):
            print(f"[WEEKLY_REPORT] Skipped: scheduled Sunday only (trigger={trigger}).")
            return
        if not _telegram_recommendation_writes_enabled():
            print("[WEEKLY_REPORT] Telegram recommendation delivery is read-only/disabled.")
            return
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
        
        web_origin = get_web_origin()
        
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
            f"👉 رابط المنصة: {web_origin}/scanner/backtests?tab=bots\n"
        )
        
        # Delivery
        if chat_id:
            from api.telegram_bot import get_telegram_bot
            bot = get_telegram_bot()
            if bot:
                bot.send_notification(msg, chat_id=chat_id)
                print(f"[WEEKLY_REPORT] Sent report on-demand to chat_id: {chat_id}")
        else:
            _notify_vip_telegram(msg, "weekly_performance_report")
            free_msg = (
                f"📊 *ملخص أسبوعي مجاني / Weekly Summary*\n"
                f"📅 `{start_date_str}` → `{end_date_str}`\n\n"
                f"▪️ الصفقات المغلقة: `{total_closed}`\n"
                f"▪️ نسبة النجاح: `{win_rate:.1f}%`\n"
                f"▪️ متوسط العائد: `{avg_pnl:+.2f}%`"
            )
            _notify_free_telegram(free_msg, "weekly_performance_report_free")
            print("[WEEKLY_REPORT] Broadcasted weekly report to all stock_score subscribers.")
            
    except Exception as e:
        print(f"[WEEKLY_REPORT] Error generating report: {e}")
        import traceback
        traceback.print_exc()


class TelegramNotificationOutcome:
    """Boolean-compatible delivery result with Telegram post receipts."""

    def __init__(self, delivered: bool, receipts: Optional[List[dict]] = None):
        self.delivered = bool(delivered)
        self.receipts = receipts or []

    def __bool__(self) -> bool:
        return self.delivered


_VIP_TELEGRAM_SERVICE_TYPES = frozenset({
    "daily_recommendations",
    "daily_recommendations_manual",
    "recommendation_adjustment",
    "recommendation_exit_vip",
    "weekly_performance_report",
})

_FREE_TELEGRAM_SERVICE_TYPES = frozenset({
    "recommendation_exit",
    "weekly_performance_report_free",
    "free_summary",
})

def _resolve_vip_chat_target() -> str:
    from api.plan_limits import telegram_pro_channel_target

    # VIP traffic must never fall back to a public/recommendations target.
    # A missing destination is safer as an explicit failed delivery than a
    # successful post to the free channel.
    return str(telegram_pro_channel_target() or "").strip()


def _format_telegram_delivery_error(bot: Any) -> str:
    err = bot.get_last_delivery_error() if bot else None
    if not err:
        return "no Telegram API response captured"
    code = err.get("error_code")
    desc = err.get("description") or err
    return f"error_code={code} description={desc}"


def _deliver_telegram_message(message: str, chat_id: str, service_type: str, channel_label: str) -> TelegramNotificationOutcome:
    if not chat_id:
        print(f"[{channel_label}] Missing chat target for {service_type}.")
        return TelegramNotificationOutcome(False)
    try:
        from api.telegram_bot import get_telegram_bot

        bot = get_telegram_bot()
        if not bot:
            print(f"[{channel_label}] No Telegram bot instance found for {service_type}.")
            return TelegramNotificationOutcome(False)

        delivered = bot.send_notification(message, chat_id=str(chat_id), wait_for_delivery=True)
        receipts = bot.get_last_delivery_receipts() if delivered else []
        if delivered:
            print(f"[{channel_label}] Delivered {service_type} to {chat_id} receipts={receipts}")
        else:
            print(
                f"[{channel_label}] Failed {service_type} to {chat_id}: "
                f"{_format_telegram_delivery_error(bot)}"
            )
        return TelegramNotificationOutcome(delivered, receipts)
    except Exception as exc:
        print(f"[{channel_label}] {service_type} notification error: {exc}")
        return TelegramNotificationOutcome(False)


def _notify_free_telegram(message: str, service_type: str = "free_summary") -> bool:
    """Send the allowed free-channel content with the VIP upgrade footer."""
    from api.plan_limits import telegram_free_channel_target

    web_origin = get_web_origin()
    free_footer = (
        "━━━━━━━━━━━━━━━━━━━━\n"
        "📢 *إعلان Pro:* كل التوصيات وتعديلاتها والتفاصيل الكاملة تصل فوراً إلى قناة VIP.\n"
        "القناة المجانية تعرض الإغلاقات والملخص الأسبوعي والإعلانات المهمة فقط.\n"
        f"🔗 التفاصيل والاشتراك: {web_origin}/pricing"
    )
    message_with_footer = message.rstrip()
    if "كل التوصيات وتعديلاتها والتفاصيل الكاملة تصل" not in message_with_footer:
        message_with_footer = f"{message_with_footer}\n\n{free_footer}"

    outcome = _deliver_telegram_message(
        message_with_footer,
        telegram_free_channel_target(),
        service_type,
        "TELEGRAM_FREE",
    )
    return bool(outcome)


def _notify_vip_telegram(message: str, service_type: str = "vip") -> TelegramNotificationOutcome:
    """Send complete recommendations, updates, closures, and reports to VIP."""
    return _deliver_telegram_message(
        message,
        _resolve_vip_chat_target(),
        service_type,
        "VIP_NOTIFY",
    )


def _notify_subscribers_for_symbol(symbol: str, exchange: str, message: str):
    """Send notification to all users subscribed to bots that track this symbol."""
    pass # Disabled: channel publication is handled by the central VIP/Free policy.


def _notify_service_subscribers(service_type: str, message: str):
    """Route service/recommendation notifications through the channel policy."""
    _notify_central_telegram(message, service_type)


def _notify_central_telegram(message: str, service_type: str = "central"):
    """Route Telegram notifications to VIP or free channels by service type."""
    if not _telegram_recommendation_writes_enabled():
        print(f"[CENTRAL_NOTIFY] Blocked {service_type} while recommendation delivery is read-only.")
        return False

    is_internal_report = service_type.endswith(("_digest", "_job_report", "_run_report", "similarity_report"))
    if service_type.startswith("step_failure") or service_type in {"central", "system_log"} or is_internal_report:
        print(f"[CENTRAL_NOTIFY] Blocked internal ops message ({service_type}).")
        return False

    if service_type == "recommendation_exit":
        vip_outcome = _notify_vip_telegram(message, "recommendation_exit_vip")
        free_delivered = _notify_free_telegram(message, service_type)
        return bool(vip_outcome) and free_delivered

    if service_type in _FREE_TELEGRAM_SERVICE_TYPES:
        return _notify_free_telegram(message, service_type)

    if service_type in _VIP_TELEGRAM_SERVICE_TYPES:
        return _notify_vip_telegram(message, service_type)

    # Legacy callers without an explicit route default to VIP for recommendation content.
    return _notify_vip_telegram(message, service_type)



def evaluate_old_recommendations(batch_id=None):
    """
    Evaluate public EGX recommendations using the versioned bar policy.
    Legacy rows preserve their published barriers and do not receive a newly
    invented time limit. New rows carry their immutable execution policy.
    """
    # PERF: Select only the columns we actually use — avoids pulling large JSONB fields like `top_reasons`/`features`
    query = supabase.table("scan_results").select(
        "id, symbol, exchange, entry_price, last_close, target_price, stop_loss, "
        "status, created_at, updated_at, profit_loss_pct, adjustments, rich_details"
    ).eq("status", "open").eq("is_public", True).eq("exchange", "EGX")
    if batch_id is not None:
        query = query.eq("batch_id", batch_id)
    res = query.execute()
    open_recs = res.data
    if not open_recs:
        print("[EVALUATE] No open recommendations to evaluate.")
        return 0

    print(f"[EVALUATE] Smart-evaluating {len(open_recs)} open recommendations...")
    updated_count = 0

    for rec in open_recs:
        symbol = rec["symbol"]
        exchange = rec.get("exchange", "EGX")

        entry_val = rec.get("entry_price")
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
            .select("date,open,high,low,close")
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


        from api.recommendation_policy import evaluate_bars
        details = rec.get("rich_details") if isinstance(rec.get("rich_details"), dict) else {}
        lifecycle = dict(details.get("evaluation") or {})
        policy = dict(details.get("recommendation_policy") or {})
        # Legacy rows have no independent bar cursor. Bootstrap once from their
        # last review, without rewriting old exits using today's raised stop.
        legacy_cursor = min(
            str(rec.get("updated_at") or rec.get("created_at"))[:10],
            str(latest_price_date)[:10],
        )
        cursor = str(lifecycle.get("last_evaluated_date") or legacy_cursor)
        try:
            if latest_close <= 0:
                outcome = {"status": "open"}
            else:
                outcome = evaluate_bars(
                    entry=entry_price, target=target_price, stop=stop_loss, bars=prices,
                    entry_date=created_at_date, cursor=cursor,
                    max_sessions=policy.get("max_sessions"),
                    trail_pct=policy.get("trail_pct"),
                )
        except (ValueError, TypeError) as error:
            print(f"[EVALUATE] Invalid data for {symbol}: {error}; leaving checkpoint unchanged.")
            continue
        if is_delisted_or_stale and outcome["status"] == "open":
            print(f"[EVALUATE] Closing stale/delisted recommendation for {symbol}.{exchange} — {reason}")
            try:
                stale_update = {
                    "status": "stale",
                    "exit_price": latest_close if latest_close > 0 else None,
                    "updated_at": dt.datetime.utcnow().isoformat()
                }
                stale_result = (
                    supabase.table("scan_results")
                    .update(stale_update)
                    .eq("id", rec["id"])
                    .eq("status", "open")
                    .eq("updated_at", rec.get("updated_at"))
                    .execute()
                )
                stale_verify = supabase.table("scan_results").select("id").eq("id", rec["id"]).eq("status", "stale").eq("updated_at", stale_update["updated_at"]).execute()
                if getattr(stale_verify, "data", None):
                    from api.recommendation_events import record_event, update_telegram_delivery, claim_event_delivery, event_values
                    event_rec = record_event(
                        supabase,
                        rec["id"],
                        "recommendation_stale",
                        old_values=event_values(rec),
                        new_values=stale_update,
                        price_at_event=latest_close if latest_close > 0 else None,
                    )
                    if not event_rec:
                        _rollback_recommendation_change(rec["id"], "stale", rec, stale_update.get("updated_at"))
                        continue
                    if event_rec and event_rec.get("id") and _telegram_recommendation_writes_enabled():
                        claim_token = claim_event_delivery(supabase, event_rec["id"])
                        if claim_token:
                            delivered = _send_telegram_exit(
                                symbol,
                                exchange,
                                entry_price,
                                latest_close if latest_close > 0 else entry_price,
                                ((latest_close - entry_price) / entry_price * 100) if entry_price else 0,
                                "stale",
                                created_at=created_at_date,
                                event_id=event_rec["id"],
                                claim_token=claim_token,
                                event_client=supabase,
                            )
                            update_telegram_delivery(supabase, event_rec["id"], success=delivered, claim_token=claim_token)
                else:
                    print(f"[EVALUATE] Stale recommendation {symbol} was already changed; skipping event.")
            except Exception as upd_err:
                print(f"[EVALUATE] Failed to close stale recommendation for {symbol}: {upd_err}")
            continue
        if outcome["last_close"] is None:
            continue
        status = outcome["status"]
        exit_price = outcome["exit_price"]
        found_event = exit_price is not None
        pl_pct = outcome["profit_loss_pct"]
        new_stop = outcome["stop_loss"]
        new_adjustments = outcome["adjustments"]
        update_applied = True
        trend_strength = policy.get("version", "legacy_preserved_barriers")
        existing_adjustments = rec.get("adjustments") or []
        if isinstance(existing_adjustments, str):
            try:
                existing_adjustments = json.loads(existing_adjustments)
            except (ValueError, TypeError):
                existing_adjustments = []
        if not isinstance(existing_adjustments, list):
            existing_adjustments = []
        lifecycle.update(
            last_evaluated_date=outcome["cursor"],
            sessions_held=outcome["sessions_held"],
            exit_reason=outcome["exit_reason"],
            closed_on=outcome["closed_on"],
        )
        details = {**details, "evaluation": lifecycle}

        # ── UPDATE DATABASE ──
        all_adjustments = existing_adjustments + new_adjustments

        if not found_event:
            update_data = {
                "rich_details": details,
                "last_close": latest_close,
                "profit_loss_pct": round(pl_pct, 4),
                "status": "open",
                "updated_at": dt.datetime.utcnow().isoformat(),
            }
            if new_stop is not None and new_stop != stop_loss:
                update_data["stop_loss"] = new_stop
            if all_adjustments:
                update_data["adjustments"] = all_adjustments

            try:
                normal_update = (
                    supabase.table("scan_results")
                    .update(update_data)
                    .eq("id", rec["id"])
                    .eq("status", "open")
                    .eq("updated_at", rec.get("updated_at"))
                    .execute()
                )
                normal_verify = supabase.table("scan_results").select("id").eq("id", rec["id"]).eq("status", "open").eq("updated_at", update_data["updated_at"]).execute()
                if not getattr(normal_verify, "data", None):
                    print(f"[EVALUATE] {symbol}: normal update skipped because recommendation changed concurrently.")
                    update_applied = False
                    new_adjustments = []
            except Exception as upd_err:
                print(f"[EVALUATE] Update failed for {symbol}: {upd_err}")
                update_applied = False
                new_adjustments = []
        else:
            _now_iso = dt.datetime.utcnow().isoformat()
            update_data = {
                "exit_price": exit_price,
                "rich_details": details,
                "stop_loss": new_stop,
                # BUG 3 FIX: update last_close to exit price so dashboard shows correct current value
                "last_close": exit_price,
                "profit_loss_pct": round(pl_pct, 4),
                "status": status,
                "updated_at": _now_iso,
            }
            if all_adjustments:
                update_data["adjustments"] = all_adjustments

            try:
                # OPTIMISTIC LOCK: only close if status is still 'open'
                close_res = (
                    supabase.table("scan_results")
                    .update(update_data)
                    .eq("id", rec["id"])
                    .eq("status", "open")
                    .eq("updated_at", rec.get("updated_at"))
                    .execute()
                )
                close_verify = supabase.table("scan_results").select("id").eq("id", rec["id"]).eq("status", status).eq("updated_at", update_data["updated_at"]).execute()
                if not getattr(close_verify, "data", None):
                    print(f"[EVALUATE] Recommendation {symbol} ({rec['id']}) already closed/changed by another process — skipping exit event.")
                    found_event = False
                    update_applied = False
                    new_adjustments = []
                else:
                    from api.recommendation_events import record_event, update_telegram_delivery, claim_event_delivery, event_values
                    event_rec = record_event(
                        supabase,
                        rec["id"],
                        "recommendation_closed",
                        old_values=event_values(rec),
                        new_values=update_data,
                        price_at_event=exit_price,
                    )
                    if not event_rec:
                        _rollback_recommendation_change(rec["id"], status, rec, update_data.get("updated_at"))
                        found_event = False
                        update_applied = False
                        new_adjustments = []
                        continue
                    if event_rec and event_rec.get("id") and _telegram_recommendation_writes_enabled():
                        claim_token = claim_event_delivery(supabase, event_rec["id"])
                        if claim_token:
                            delivered = _send_telegram_exit(
                                symbol, exchange, entry_price, exit_price, pl_pct, status,
                                exit_reason=outcome["exit_reason"],
                                created_at=created_at_date, event_id=event_rec["id"],
                                claim_token=claim_token, event_client=supabase,
                            )
                            update_telegram_delivery(supabase, event_rec["id"], success=delivered, claim_token=claim_token)
            except Exception as upd_err:
                print(f"[EVALUATE] Close update failed for {symbol}: {upd_err}")
                found_event = False
                update_applied = False
                new_adjustments = []

        # ── SEND TELEGRAM NOTIFICATIONS FOR ADJUSTMENTS ──
        # FIX: Only send adjustment notifications (e.g. "target raised") if we did
        # NOT close the position in the same run.
        if update_applied and not found_event and new_adjustments:
            from api.recommendation_events import record_event, update_telegram_delivery, invalidate_event, claim_event_delivery, event_values
            adjustment_event_ids = []
            for adj in new_adjustments:
                event_rec = record_event(
                    supabase,
                    rec["id"],
                    "target_or_stop_adjusted",
                    old_values=event_values(rec),
                    new_values={**update_data, "adjustment_type": adj.get("type")},
                    price_at_event=latest_close,
                    event_identity=adj.get("timestamp") or adj.get("type"),
                )
                if not event_rec:
                    _rollback_recommendation_change(rec["id"], "open", rec, update_data.get("updated_at"))
                    for created_event_id in adjustment_event_ids:
                        invalidate_event(supabase, created_event_id, "adjustment batch compensated after partial failure")
                    update_applied = False
                    break
                adjustment_event_ids.append(event_rec["id"])
                claim_token = claim_event_delivery(supabase, event_rec["id"]) if _telegram_recommendation_writes_enabled() else None
                if claim_token:
                    delivered = _send_telegram_adjustment(
                        symbol, exchange, adj, event_id=event_rec["id"],
                        claim_token=claim_token, event_client=supabase,
                    )
                    update_telegram_delivery(supabase, event_rec["id"], success=delivered, claim_token=claim_token)

        print(f"[EVALUATE] {symbol}: status={status}, return={pl_pct:.2f}%, trend={trend_strength}, adjustments={len(new_adjustments)}")
        if update_applied:
            updated_count += 1
    return updated_count


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

        # Check target/stop loss exit conditions
        target_price = pos.get("target_price")
        stop_price = pos.get("stop_price")
        
        hi = float(latest.get("high") or current_price)
        lo = float(latest.get("low") or current_price)
        
        exited = False
        exit_price = current_price
        status_val = "open"
        exit_reason = ""
        
        # Stop loss check (pessimistic / risk-first check)
        if stop_price is not None and lo <= float(stop_price):
            exited = True
            exit_price = float(stop_price)
            status_val = "hit_stop"
            exit_reason = "hit_stop"
        elif target_price is not None and hi >= float(target_price):
            exited = True
            exit_reason = "hit_target"
            exit_price = float(target_price)
            status_val = "hit_target"

        if exited:
            pnl_pct = ((exit_price - entry_price) / entry_price) * 100.0
            metadata["exit_reason"] = exit_reason
            metadata["exit_price"] = round(exit_price, 6)
            metadata["exit_pnl_pct"] = round(pnl_pct, 4)
            metadata["exit_at"] = dt.datetime.utcnow().isoformat()
            
            update_data = {
                "status": status_val,
                "status_price": exit_price,
                "status_at": dt.datetime.utcnow().isoformat(),
                "metadata": metadata,
                "updated_at": dt.datetime.utcnow().isoformat(),
            }
            try:
                supabase.table("positions").update(update_data).eq("id", pos["id"]).eq("status", "open").execute()
                print(f"[POSITIONS] Exited position {raw_symbol}: {exit_reason} at {exit_price:.4f} ({pnl_pct:+.2f}%)")
            except Exception as upd_err:
                print(f"[POSITIONS] Exit update failed for {raw_symbol}: {upd_err}")
                continue

            # Send Telegram Notification
            try:
                if not _telegram_recommendation_writes_enabled():
                    continue
                from api.telegram_bot import get_telegram_bot
                bot = get_telegram_bot()
                
                emoji = "🎉🎯" if status_val == "hit_target" else "🛡️⚠️"
                status_text_ar = "توصية ناجحة (تحقيق الهدف) ✅" if status_val == "hit_target" else "تفعيل وقف الخسارة 🛡️"
                status_text_en = "Target Hit (Profit) ✅" if status_val == "hit_target" else "Stop Loss Hit (Loss) 🛡️"
                
                msg = (
                    f"{emoji} *إغلاق صفقة في المحفظة / Closed Portfolio Position* 🏁\n"
                    f"━━━━━━━━━━━━━━━━━━━━\n"
                    f"💎 *السهم / Symbol:* `{raw_symbol}`\n"
                    f"📌 *النتيجة / Outcome:* {status_text_ar} / {status_text_en}\n"
                    f"📈 *سعر الدخول / Entry:* `{entry_price:.2f}` EGP\n"
                    f"💰 *سعر الخروج / Exit:* `{exit_price:.2f}` EGP\n"
                    f"📊 *صافي العائد / Return:* `{pnl_pct:+.2f}%`\n"
                    f"━━━━━━━━━━━━━━━━━━━━\n"
                )
                
                user_id = pos.get("user_id")
                telegram_chat_id = None
                if user_id:
                    prof_res = (
                        supabase.table("profiles")
                        .select("telegram_chat_id")
                        .eq("id", user_id)
                        .maybe_single()
                        .execute()
                    )
                    if prof_res and prof_res.data:
                        telegram_chat_id = prof_res.data.get("telegram_chat_id")
                
                if bot:
                    if telegram_chat_id:
                        bot.send_notification(msg, chat_id=str(telegram_chat_id))
                        print(f"[POSITIONS] Sent exit notification to user {user_id} (chat_id: {telegram_chat_id})")
                    else:
                        # Do not mix personal portfolio exits into the public
                        # recommendation channel. Public Telegram messages and
                        # weekly reports are sourced exclusively from scan_results.
                        print(f"[POSITIONS] No telegram_chat_id for user {user_id}; public delivery suppressed")
                else:
                    print(f"[POSITIONS] Telegram bot not initialized, could not send notification.")
            except Exception as e_notify:
                print(f"[POSITIONS] Telegram exit notification failed for {raw_symbol}: {e_notify}")
        else:
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


def _build_daily_recommendations_message(
    recommendations: List[Dict[str, Any]],
    current_date: str,
    web_origin: str,
    *,
    title: str = "توصيات الذكاء الاصطناعي الجديدة",
) -> str:
    """Render a daily card from canonical ``scan_results`` rows only."""
    msg_lines = [
        f"🤖 *{title}*",
        f"📅 {current_date} | 🇪🇬 البورصة المصرية",
        "🔐 *محتوى Pro كامل* — التوصيات والتعديلات والتفاصيل الفنية لمشتركي VIP.",
        "━━━━━━━━━━━━━━━━━━━━\n",
    ]

    for idx, row in enumerate(recommendations):
        symbol = row.get("symbol")
        entry_price = float(row.get("entry_price") or 0.0)
        target_price = float(row.get("target_price") or 0.0)
        stop_loss = float(row.get("stop_loss") or 0.0)
        rich_details = row.get("top_reasons")
        if isinstance(rich_details, str):
            try:
                rich_details = json.loads(rich_details)
            except (TypeError, ValueError):
                rich_details = None
        stored_target_2 = rich_details.get("target_2") if isinstance(rich_details, dict) else None
        target_2 = float(stored_target_2) if stored_target_2 is not None else round(target_price * 1.10, 2)
        score = max(0, min(round(float(row.get("precision") or 0.5) * 10), 10))
        name = row.get("name") or symbol

        target_1_pct = ((target_price / entry_price - 1) * 100) if entry_price > 0 else 0.0
        target_2_pct = ((target_2 / entry_price - 1) * 100) if entry_price > 0 else 0.0
        stop_pct = ((stop_loss / entry_price - 1) * 100) if entry_price > 0 else 0.0
        score_bar = "▰" * score + "▱" * (10 - score)

        msg_lines.append(
            f"🔥 *{idx+1}. {symbol}* — {name}\n"
            f"💰 الدخول: `{entry_price:.2f}` EGP\n"
            f"🎯 هدف 1: `{target_price:.2f}` (`{target_1_pct:+.1f}%`) ← 🚀 هدف 2: `{target_2:.2f}` (`{target_2_pct:+.1f}%`)\n"
            f"🛑 الوقف: `{stop_loss:.2f}` (`{stop_pct:+.1f}%`)\n"
            f"⭐ `{score_bar}` `{score}/10`\n"
            "━━━━━━━━━━━━━━━━━━━━"
        )

    msg_lines.append(
        f"📊 *إجمالي التوصيات الجديدة:* `{len(recommendations)}` أسهم\n\n"
        "🔗 *الرسوم البيانية والتفاصيل الكاملة:*\n"
        f"👉 [اضغط هنا لفتح المنصة]({web_origin}/scanner/backtests?tab=bots)"
    )
    return "\n".join(msg_lines)


async def generate_daily_recommendations(
    model_name: Optional[str] = None,
    bulk_cache_ttl_seconds: Optional[int] = None,
):
    """
    Run fast_scan ML model for Egypt, select the top 10 speculative stocks,
    generate rich detailed Arabic reports, and insert them into scan_results.
    """
    from typing import Optional
    resolved_model = "model_EGX.bin"
    
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
            if not model_lower.endswith(".pkl") and not model_lower.endswith(".bin"):
                resolved_model = f"{model_name}.bin"
            else:
                resolved_model = model_name

    council_model = None
    validator_model = None
    if resolved_model in ["model_EGX.pkl", "model_EGX.bin"] or resolved_model.endswith("model_EGX.pkl") or resolved_model.endswith("model_EGX.bin"):
        council_model = "KING.bin"
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if os.path.exists(os.path.join(base_dir, "models", "The_Council_Validator.bin")):
            validator_model = "The_Council_Validator.bin"
        elif os.path.exists(os.path.join(base_dir, "api", "models", "The_Council_Validator.bin")):
            validator_model = "The_Council_Validator.bin"

    print(f"[RECOMMENDATIONS] Running ML fast scan for EGX stocks using model: {resolved_model} (council: {council_model}, validator: {validator_model})...")
    scan_resp = fast_scan(
        country="Egypt",
        limit=200,
        min_precision=0.5,
        model_name=resolved_model,
        council_model=council_model,
        validator_model=validator_model,
        bulk_cache_ttl_seconds=bulk_cache_ttl_seconds,
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
            if not math.isfinite(score):
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

    # Validate NEW setups only; a raised stop above entry on an existing trade
    # can be legitimate profit protection and is not an invalid historical setup.
    from api.recommendation_policy import valid_candidate, POLICY_VERSION
    valid_results = [item for item in results if valid_candidate(item)]
    print(f"[RECOMMENDATIONS] Valid entry/stop/target and R:R >= 1.5: {len(valid_results)} / {len(results)}")
    results = valid_results
    if not results:
        print("[RECOMMENDATIONS] No candidates passed trade-structure quality filters.")
        return 0
    
    # Calculate risk_adjusted_return for all candidates and adjust with news sentiment
    _init_supabase()
    for item in results:
        entry_p = float(item.get("last_close", 0.0)) if item.get("last_close") is not None else 0.0
        target_p = float(item.get("target_price", 0.0)) if item.get("target_price") is not None else 0.0
        stop_l = float(item.get("stop_loss", 0.0)) if item.get("stop_loss") is not None else 0.0
        prec = float(item.get("precision", 0.5)) if item.get("precision") is not None else 0.5
        if not math.isfinite(prec):
            prec = 0.0
        item["precision"] = prec
        
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
                        sentiment_mult = 1.0 + (float(score) * 0.25)
        except Exception as se_err:
            print(f"DEBUG: Error checking sentiment for rank adjustment of {item.get('symbol')}: {se_err}")
            
        adjusted_return = raw_rar * sentiment_mult
        item["risk_adjusted_return"] = adjusted_return if math.isfinite(adjusted_return) else 0.0

    # Sort by risk_adjusted_return descending to prioritize safer risk-reward profiles
    results.sort(key=lambda x: x.get("risk_adjusted_return", 0.0), reverse=True)
    
    # The database RPC checks and reserves capacity atomically across workers.
    daily_limit = max(1, min(5, int(os.getenv("PUBLIC_RECOMMENDATION_DAILY_LIMIT", "1"))))
    rolling_limit = max(1, min(30, int(os.getenv("PUBLIC_RECOMMENDATION_ROLLING_LIMIT", "20"))))
    open_limit = max(1, min(20, int(os.getenv("PUBLIC_RECOMMENDATION_OPEN_LIMIT", "10"))))
    max_sessions = max(1, int(os.getenv("PUBLIC_RECOMMENDATION_MAX_HOLD_SESSIONS", "20")))

    # Preserve entry-time scores/features: rescanning must not rewrite the data
    # needed to audit the original decision or advance its evaluation checkpoint.
    inserted_count = 0

    batch_id = str(uuid.uuid4())
    for i, res_item in enumerate(results):
        if inserted_count >= daily_limit:
            break
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
            "rich_details": {
                "recommendation_policy": {"version": POLICY_VERSION, "max_sessions": max_sessions, "trail_pct": None},
                "entry_snapshot": {
                    "target_price": res_item.get("target_price"), "stop_loss": res_item.get("stop_loss"),
                    "price_date": res_item.get("date"), "feature_names": res_item.get("feature_names", []),
                    "council_score": res_item.get("council_score"), "validator_score": res_item.get("validator_score"),
                    "execution": "published_close_reference_not_broker_fill",
                },
                "evaluation": {"last_evaluated_date": dt.datetime.now(dt.timezone.utc).date().isoformat()},
            },
            "created_at": dt.datetime.utcnow().isoformat(),
            "updated_at": dt.datetime.utcnow().isoformat()
        }
        
        try:
            publication = supabase.rpc("publish_public_recommendation", {
                "p_row": row_data, "p_daily_limit": daily_limit,
                "p_rolling_limit": rolling_limit, "p_open_limit": open_limit,
                "p_cooldown_days": 7,
            }).execute()
            published = publication.data or {}
            if published.get("status") == "inserted":
                inserted_count += 1
            else:
                reason = published.get("reason", "unknown")
                print(f"[RECOMMENDATIONS] Skipped {symbol}: {reason}")
                if reason in {"daily_capacity", "rolling_capacity", "open_capacity"}:
                    break
        except Exception as ins_err:
            # Missing RPC/network failure must never fall back to unbounded inserts.
            print(f"[RECOMMENDATIONS] Publication unavailable: {ins_err}")
            break

    # Re-read the rows created by this batch from the canonical table. Telegram
    # must use the exact same persisted snapshot that the website reads.
    persisted_recommendations = []
    if inserted_count:
        try:
            persisted_res = (
                supabase.table("scan_results")
                .select(
                    "id,batch_id,symbol,exchange,name,entry_price,target_price,"
                    "stop_loss,last_close,precision,status,created_at,top_reasons"
                )
                .eq("batch_id", batch_id)
                .eq("status", "open")
                .order("created_at")
                .execute()
            )
            persisted_recommendations = persisted_res.data or []
        except Exception as read_err:
            print(f"[RECOMMENDATIONS] Could not re-read newly persisted recommendations: {read_err}")

    print(
        f"[RECOMMENDATIONS] Batch result: {len(persisted_recommendations)} new rows ready for publication."
    )

    # Notify Stocks Score subscribers with beautiful detailed summary card
    try:
        web_origin = get_web_origin()
        current_date = dt.datetime.now().strftime("%Y-%m-%d")

        # Send only recommendations confirmed persisted in scan_results. Never
        # publish a Telegram row the website cannot read from the database.
        if not persisted_recommendations:
            print("[RECOMMENDATIONS] No new recommendations persisted to scan_results; skipping Telegram card.")
            return 0

        telegram_message = _build_daily_recommendations_message(
            persisted_recommendations,
            current_date,
            web_origin,
        )
        
        delivered = False
        if _telegram_recommendation_writes_enabled():
            delivered = _notify_central_telegram(telegram_message, "daily_recommendations")
        else:
            print("[RECOMMENDATIONS] Telegram recommendation delivery is read-only/disabled.")
        print(f"[RECOMMENDATIONS] {'Delivered' if delivered else 'Failed to deliver'} detailed recommendations for Telegram.")
        
        # Record today's date in market_cache to track sent status
        try:
            # The sender is asynchronous, so a queued message is not proof of
            # delivery. Keep the audit trail explicit and do not mark it sent
            # until the Telegram sender confirms ok=true.
            cache_res = supabase.table("market_cache").select("payload").eq("cache_key", "telegram_recommendations_sent").maybe_single().execute()
            existing_payload = getattr(cache_res, "data", None) if cache_res is not None else None
            payload = existing_payload.get("payload") if isinstance(existing_payload, dict) and existing_payload.get("payload") else {"sent_dates": [], "queued_dates": []}
            if delivered:
                if current_date not in payload.get("sent_dates", []):
                    payload.setdefault("sent_dates", []).append(current_date)
                deliveries = payload.setdefault("deliveries", {})
                if not isinstance(deliveries, dict):
                    deliveries = {}
                    payload["deliveries"] = deliveries
                deliveries[current_date] = {
                    "batch_id": batch_id,
                    "recommendation_ids": [str(row.get("id")) for row in persisted_recommendations if row.get("id")],
                    "symbols": [str(row.get("symbol")) for row in persisted_recommendations if row.get("symbol")],
                    "receipts": getattr(delivered, "receipts", []) or [],
                }
                supabase.table("market_cache").upsert({
                    "cache_key": "telegram_recommendations_sent",
                    "country": "Egypt",
                    "payload": payload,
                    "computed_at": dt.datetime.utcnow().isoformat()
                }).execute()
                print("[RECOMMENDATIONS] Recorded confirmed Telegram delivery status.")
        except Exception as cache_err:
            print(f"[RECOMMENDATIONS] Failed to record telegram sent status: {cache_err}")
    except Exception as e:
        print(f"[RECOMMENDATIONS] Telegram notify error: {e}")

    return len(persisted_recommendations)


def _refresh_market_status_cache():
    """Prefetch last 180 days of EGX30, EGX100, and USD/EGP using FREE data providers (yfinance)."""
    from api.free_data_provider import get_market_status_free
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    try:
        # Fetch market data using free providers
        res_data = get_market_status_free(period="1y")
        egx30_data = res_data.get("egx30", [])
        egx100_data = res_data.get("egx100", [])
        usdegp_data = res_data.get("usdegp", [])

        regime = res_data.get("regime", "sideways")
        egx30_return = res_data.get("egx30_return", 0.0)
        
        print(f"[MARKET_STATUS] Fetched market data (FREE): {len(egx30_data)} EGX30 rows, {len(usdegp_data)} USD/EGP rows, regime={regime}")
        
        # Save to local file cache in api/symbols_data/market_status.json
        cache_path = os.path.join(base_dir, "symbols_data", "market_status.json")
        
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(res_data, f, ensure_ascii=False, indent=2)
        print(f"[MARKET_STATUS] Market status cache successfully saved to {cache_path}")

        # Save to market_cache table in Supabase
        try:
            from api.stock_ai import _init_supabase as _init_sb, supabase as _sb
            _init_sb()
            if _sb:
                _sb.table("market_cache").upsert({
                    "cache_key": "market_status_Egypt",
                    "country": "Egypt",
                    "payload": res_data,
                    "computed_at": dt.datetime.now(dt.timezone.utc).isoformat()
                }).execute()
                print("[MARKET_STATUS] Market status successfully upserted to market_cache in Supabase")
        except Exception as se_cache:
            print(f"[MARKET_STATUS] Failed to upsert to market_cache table in Supabase: {se_cache}")

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
                
                # Ensure these index symbols exist in stock_fundamentals to satisfy foreign key constraints
                for idx_symbol, idx_exchange, _ in INDEX_META:
                    try:
                        _sb.table("stock_fundamentals").upsert({
                            "symbol": idx_symbol,
                            "exchange": idx_exchange,
                            "data": {
                                "company_name": f"{idx_symbol} Index/Rate",
                                "country": "Egypt"
                            },
                            "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()
                        }, on_conflict="symbol,exchange").execute()
                    except Exception as fe:
                        print(f"[MARKET_STATUS] Warning: Failed to ensure {idx_symbol} in fundamentals: {fe}")
                        
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
                                "volume": int(float(r.get("volume", r.get("Volume", 0)) or 0)),
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

            # Pre-calculate and cache individual stock macro correlations in Supabase
            try:
                from api.symbols_local import load_symbols_for_country
                from api.macro_correlation import calculate_macro_correlation
                symbols_data = load_symbols_for_country("Egypt")
                syms = sorted(set(
                    str(row.get("Symbol", row.get("symbol", row.get("Code", "")))).strip().upper()
                    for row in symbols_data
                    if str(row.get("Symbol", row.get("symbol", row.get("Code", "")))).strip()
                ))
                syms = [s for s in syms if s and s != "COMI"]

                print(f"[MARKET_STATUS] Pre-calculating macro correlations for {len(syms)} EGX symbols...")
                correlation_cache_rows = []
                for sym in syms:
                    try:
                        res_corr = calculate_macro_correlation(sym)
                        if res_corr and res_corr.get("symbol"):
                            correlation_cache_rows.append({
                                "cache_key": f"macro_correlation_{sym}",
                                "country": "Egypt",
                                "payload": res_corr,
                                "computed_at": dt.datetime.now(dt.timezone.utc).isoformat()
                            })
                    except Exception as sym_err:
                        print(f"[MARKET_STATUS] Error calculating correlation for {sym}: {sym_err}")

                if correlation_cache_rows:
                    from api.stock_ai import supabase as _sb
                    # Upsert in chunks of 50 to avoid request payload limits
                    for i in range(0, len(correlation_cache_rows), 50):
                        chunk = correlation_cache_rows[i:i + 50]
                        _sb.table("market_cache").upsert(chunk, on_conflict="cache_key,country").execute()
                    print(f"[MARKET_STATUS] Successfully cached {len(correlation_cache_rows)} individual stock correlations in Supabase")
            except Exception as e_indiv:
                print(f"[MARKET_STATUS] Failed to pre-calculate individual correlations: {e_indiv}")

        except Exception as me:
            print(f"[MARKET_STATUS] Error updating macro correlation cache: {me}")
            
        return True, "Market status cache updated successfully (using FREE data providers)"
    except Exception as e:
        print(f"[MARKET_STATUS] Error fetching market status: {e}")
        return False, f"Error: {e}"


def update_market_heatmap():
    """
    Fetch all active EGX symbols, their latest prices, volume, percent change,
    and fundamentals (sector), then upsert into public.market_heatmap.
    """
    print("\n>>> STEP 2.7: Pre-computing and saving Sector Heatmap to Supabase...")
    try:
        from api.symbols_local import load_symbols_for_country
        symbols_data = load_symbols_for_country("Egypt")
        if not symbols_data:
            print("[HEATMAP] No symbols loaded for Egypt.")
            return False, "No symbols loaded"

        symbol_pairs = []
        company_names = {}
        for row in symbols_data:
            sym = str(row.get("Code", row.get("Symbol", ""))).strip()
            ex = str(row.get("Exchange", "")).strip()
            name = str(row.get("Name", row.get("Company", sym))).strip()
            if sym and ex:
                symbol_pairs.append((sym, ex))
                company_names[f"{sym}|{ex}"] = name

        # Fetch fundamentals and technicals
        from api.routers.scan_tech import _fetch_company_fundamentals, _fetch_latest_technical_indicators
        fundamentals = _fetch_company_fundamentals(symbol_pairs)
        tech_rows = _fetch_latest_technical_indicators(symbol_pairs)

        def _local_safe_float(val, default=0.0):
            try:
                if val is None:
                    return default
                return float(val)
            except Exception:
                return default

        # Build list of records to insert
        records_to_upsert = []
        captured_at = dt.datetime.now(dt.timezone.utc).isoformat()
        
        for sym, ex in symbol_pairs:
            key = f"{sym}|{ex}"
            tech = tech_rows.get(key)
            fund = fundamentals.get(key) or {}

            close = _local_safe_float(tech.get("close") if tech else None)
            volume = _local_safe_float(tech.get("volume") if tech else None)
            change_pct = _local_safe_float(tech.get("change_pct") if tech else None)
            raw_sec = fund.get("Sector", fund.get("sector", fund.get("industry", "Speculative Sector")))
            
            # Using close * volume as cap/money_flow proxy
            cap = (close * volume) if (close and volume) else 0.0

            records_to_upsert.append({
                "exchange": ex,
                "symbol": sym,
                "sector": raw_sec,
                "change_pct": change_pct,
                "volume": volume,
                "cap": cap,
                "source": "daily_job",
                "captured_at": captured_at
            })

        if records_to_upsert:
            # First, let's delete records older than 7 days to prevent database bloat
            try:
                seven_days_ago = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)).isoformat()
                supabase.table("market_heatmap").delete().lt("captured_at", seven_days_ago).execute()
            except Exception as del_err:
                print(f"[HEATMAP] Failed to prune old heatmap records: {del_err}")

            # Batch insert
            for i in range(0, len(records_to_upsert), 100):
                chunk = records_to_upsert[i:i+100]
                supabase.table("market_heatmap").insert(chunk).execute()
            
            print(f"[HEATMAP] Successfully saved {len(records_to_upsert)} records to market_heatmap.")
            return True, f"Saved {len(records_to_upsert)} symbols"
        else:
            return False, "No records to save"
    except Exception as e:
        print(f"[HEATMAP] Error pre-computing heatmap: {e}")
        return False, str(e)


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
    job_start_time = dt.datetime.now(dt.timezone.utc).isoformat()
    steps_log = []
    active_steps = {}
    symbols_raw = []
    total_symbols = 0
    daily_bulk_prices: Dict[str, pd.DataFrame] = {}
    daily_bulk_cache_ttl = 2 * 60 * 60

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

        if not success and status == "failed":
            alert_msg = (
                f"⚠️ *تنبيه فشل StokScan AI*:\n"
                f"• الخطوة: *{step_name}* فشلت\n"
                f"• التفاصيل: {str(details)[:300]}"
            )
            print(f"[TELEGRAM_ALERT] Immediate step failure (Telegram notification disabled): {alert_msg}")
            # Disabled sending system step failure alerts to the group
            # try:
            #     _notify_central_telegram(alert_msg, f"step_failure_{step_name}")
            # except Exception as e_alert:
            #     print(f"[TELEGRAM_ALERT] Failed to send immediate step failure alert: {e_alert}")

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
                # The writer has finished: discard stale scanner data before the
                # job preloads its one shared EGX snapshot below.
                stock_ai.clear_exchange_bulk_cache("EGX")
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

            # One exchange-level load replaces one Supabase request per symbol.
            # It is also reused by both ML scans and historical similarity.
            daily_bulk_prices = stock_ai._get_exchange_bulk_data(
                "EGX",
                bypass_min_limit=True,
                cache_ttl_seconds=daily_bulk_cache_ttl,
            )
            
            def _calc_one(sym):
                try:
                    return sym, calculate_indicators_for_symbol(
                        sym,
                        "EGX",
                        daily_bulk_prices.get(sym.upper()),
                    ), None
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

        # 2.2 Update AI Scores for all symbols in stock_technical_indicators
        print("\n>>> STEP 2.2: Updating AI ML Scores for all stocks in DB...")
        _start_step("ml_scores_update", "Calculating KING and EGX model scores for all stocks")
        try:
            from api.update_ml_scores import update_all_scores
            update_all_scores(bulk_cache_ttl_seconds=daily_bulk_cache_ttl)
            _record_step("ml_scores_update", True, "Successfully updated AI ML Scores in DB", 1)
        except Exception as e:
            _record_step("ml_scores_update", False, str(e)[:200], 0)
            print(f"[ML_SCORES] Error updating scores: {e}")

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

        # 2.6 Corporate Actions Sweep (rights issues / splits / dividends / bonus
        # shares) — targeted Google News RSS queries. Runs ONCE per day here;
        # the chat pipeline never invokes this (it only reads the table and
        # caches its own keyless web findings with origin = 'chat_cache').
        print("\n>>> STEP 2.6: Fetching corporate actions (اكتتابات/توزيعات/تجزئة/منح)...")
        _start_step("corporate_actions", "Fetching and classifying corporate actions from Google News RSS")
        try:
            from api.corporate_actions_engine import process_exchange_corporate_actions
            if not symbols_raw:
                symbols_raw = _fetch_egx_symbols()
                symbols_raw = _filter_active_symbols(symbols_raw)

            ok_ca, ca_count = process_exchange_corporate_actions("EGX", symbols_raw, days_back=30)
            _record_step("corporate_actions", ok_ca, f"Stored/refreshed {ca_count} corporate actions", ca_count)
        except Exception as e:
            _record_step("corporate_actions", False, str(e)[:200], 0)
            print(f"[CORPORATE_ACTIONS] Error: {e}")

        # 2.7 Pre-compute and save Sector Heatmap
        print("\n>>> STEP 2.7: Pre-computing and saving Sector Heatmap...")
        _start_step("precompute_heatmap", "Pre-computing and saving Sector Heatmap to Supabase")
        try:
            ok_h, msg_h = update_market_heatmap()
            _record_step("precompute_heatmap", ok_h, msg_h, 0)
        except Exception as e:
            _record_step("precompute_heatmap", False, str(e)[:200], 0)
            print(f"[HEATMAP] Error pre-computing heatmap: {e}")

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

        # Retry Telegram notifications only after all recommendation state
        # updates are durable in Supabase.
        print("\n>>> STEP 4.1: Retrying failed recommendation notifications...")
        _start_step("recommendation_telegram_retries", "Retrying failed recommendation Telegram events")
        try:
            retry_count = retry_pending_recommendation_telegram_events(limit=10)
            _record_step("recommendation_telegram_retries", True, f"Retried {retry_count} Telegram events", retry_count)
        except Exception as e:
            _record_step("recommendation_telegram_retries", False, str(e)[:200], 0)
            print(f"[RECOMMENDATION_RETRY] Error: {e}")

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
                generated_count = await generate_daily_recommendations(
                    model_name=model_filter,
                    bulk_cache_ttl_seconds=daily_bulk_cache_ttl,
                )
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
                forward_days=20,
                target_return=0.05,
                stop_loss=-0.03,
                search_scope="same_symbol",
                max_workers=15
            )
            if results:
                # Prune old similarity reports (older than 7 days) to prevent db bloat
                try:
                    seven_days_ago = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)).isoformat()
                    supabase.table("similarity_reports").delete().lt("updated_at", seven_days_ago).execute()
                    print("[SIMILARITY] Pruned similarity reports older than 7 days.")
                except Exception as del_err:
                    print(f"[SIMILARITY] Failed to prune old similarity reports: {del_err}")

                published = publish_similarity_report({
                    "name": f"Daily Similarity Scan - {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}",
                    "scans": results,
                    "k": 10,
                    "forward_days": 20,
                    "target_return": 0.05,
                    "stop_loss": -0.03
                })
            _record_step("historical_similarity", True, f"{len(results)} symbols scanned", len(results))
        except Exception as e:
            _record_step("historical_similarity", False, str(e)[:200], 0)
            print(f"[SIMILARITY] Error: {e}")

        # 7. Run Weekly Performance Report (on Sunday)
        if _should_send_weekly_report(trigger):
            print("\n>>> STEP 7: Running Weekly Performance Report...")
            _start_step("weekly_performance_report", "Generating weekly performance report")
            try:
                generate_weekly_performance_report(trigger=trigger)
                _record_step("weekly_performance_report", True, "Weekly performance report generated and sent", 0)
            except Exception as e:
                _record_step("weekly_performance_report", False, str(e)[:200], 0)
                print(f"[WEEKLY_REPORT] Error: {e}")
        else:
            _record_step("weekly_performance_report", True, "Skipped - scheduled Sunday only", 0)

        # 8. Refresh Market Status (EGX30, EGX100, USD/EGP indices) from EODHD
        print("\n>>> STEP 8: Prefetching and refreshing Market Status cache from EODHD...")
        _start_step("refresh_market_status", "Refreshing Market Status cache from EODHD")
        try:
            ok, msg = _refresh_market_status_cache()
            _record_step("refresh_market_status", ok, msg, 0)
        except Exception as e:
            _record_step("refresh_market_status", False, str(e)[:200], 0)
            print(f"[MARKET_STATUS] Error: {e}")

        # 9.1 Rebase the immutable history archive infrequently. The scanner
        # already combines this archive with a 45-day live Supabase tail, so a
        # monthly Dataset commit keeps long history current without turning HF
        # storage into another high-frequency operational database.
        if trigger == "scheduled" and daily_bulk_prices:
            print("\n>>> STEP 9.1: Checking private HF history snapshot rebase...")
            _start_step("hf_history_rebase", "Checking whether the EGX history archive needs a monthly rebase")
            try:
                from api.hf_history_cache import (
                    frame_from_symbol_map,
                    publish_history_snapshot,
                    should_rebase_snapshot,
                )
                rebase_days = int(os.getenv("HF_HISTORY_REBASE_DAYS", "30"))
                if should_rebase_snapshot("EGX", days=rebase_days):
                    snapshot_frame = frame_from_symbol_map("EGX", daily_bulk_prices)
                    metadata = publish_history_snapshot("EGX", snapshot_frame)
                    _record_step(
                        "hf_history_rebase",
                        True,
                        f"Published {metadata.get('rows', 0)} rows through {metadata.get('last_date')}",
                        int(metadata.get("rows", 0)),
                    )
                else:
                    _record_step("hf_history_rebase", True, "Skipped - current archive is within rebase window", 0)
            except Exception as history_err:
                # HF is an optimization layer; a failed archive refresh must
                # never invalidate the daily prices stored in Supabase.
                _record_step("hf_history_rebase", False, str(history_err)[:200], 0)
                print(f"[HF-HISTORY] Rebase failed: {history_err}")

        # ── STEP: Accumulation / Distribution Scan ──────────────────────────
        # يُشغَّل يومياً بعد الإغلاق لتحديث stock_scans_summary بإشارات Wyckoff
        print("\n>>> STEP: Running Accumulation & Distribution Scan...")
        _start_step("accumulation_scan", "Wyckoff accumulation/distribution scanner — updates stock_scans_summary")
        try:
            import sys as _sys
            import os as _os
            _scripts_dir = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", "scripts"))
            if not _os.path.isdir(_scripts_dir):
                _cwd_scripts = _os.path.abspath(_os.path.join(_os.getcwd(), "scripts"))
                if _os.path.isdir(_cwd_scripts):
                    _scripts_dir = _cwd_scripts
            if _scripts_dir not in _sys.path:
                _sys.path.insert(0, _scripts_dir)
            from accumulation_scanner import (
                get_supabase as _acc_get_supabase,
                fetch_all_symbols as _acc_fetch_symbols,
                fetch_recent_technicals as _acc_fetch_tech,
                analyze_symbol as _acc_analyze,
                upsert_results as _acc_upsert,
            )
            _acc_sb = _acc_get_supabase()
            _acc_symbols = _acc_fetch_symbols(_acc_sb)
            _acc_tech = _acc_fetch_tech(_acc_sb, _acc_symbols, 30)
            _acc_results = []
            for _sym, _rows in _acc_tech.items():
                _analysis = _acc_analyze(_rows)
                if _analysis is not None:
                    _analysis["symbol"] = _sym
                    _acc_results.append(_analysis)
            _acc_saved = _acc_upsert(_acc_sb, _acc_results)
            _acc_acc_count = sum(1 for r in _acc_results if r.get("signal") == "accumulation")
            _acc_dist_count = sum(1 for r in _acc_results if r.get("signal") == "distribution")
            print(f"   ✅ Scan complete: {_acc_saved} records saved | acc={_acc_acc_count} dist={_acc_dist_count}")
            _record_step("accumulation_scan", True, f"Saved {_acc_saved} records (acc={_acc_acc_count}, dist={_acc_dist_count})", _acc_saved)
        except Exception as e_scan:
            print(f"   ⚠️  Accumulation scan failed: {e_scan}")
            _record_step("accumulation_scan", False, str(e_scan)[:300])

        _persist_job("completed")
        try:
            from api.cache_invalidation import invalidate_daily_cache

            invalidate_daily_cache(steps_log)
        except Exception as e_cache:
            print(f"[CACHE] Daily cache invalidation skipped: {e_cache}")
        print(f"\n--- Daily Bot Run Job Completed: {dt.datetime.now()} ---")

    except Exception as e:
        _record_step("job", False, str(e)[:500], total_symbols)
        _persist_job("failed")
        print(f"\n--- Daily Bot Run Job FAILED: {dt.datetime.now()} — {e} ---")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-sync", action="store_true")
    args = parser.parse_args()
    asyncio.run(run_daily_job(skip_sync=args.skip_sync))
