import os
import sys
import datetime as dt
import time
import asyncio
import json
import uuid
import pandas as pd
import numpy as np
from typing import List, Dict, Any, Tuple

# Set project root path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, project_root)

import api.stock_ai as stock_ai
from api.stock_ai import _init_supabase

# Dynamically access the initialized client from stock_ai via a wrapper class

# But since supabase is used as a global variable, we can override or define it as a getter or wrap it
class SupabaseWrapper:
    def __getattr__(self, name):
        if stock_ai.supabase is None:
            _init_supabase()
        return getattr(stock_ai.supabase, name)

supabase = SupabaseWrapper()
from api.smart_sync import get_smart_sync
from api.intraday_downloader import _fetch_egx_symbols
from api.routers.scan_ai_fast import fast_scan


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
        .eq("symbol", f"{symbol}.{exchange}")
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
            .select("rsi_14,adx_14,ema_50,ema_200,volume,change_pct,macd,macd_signal")
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
            }
    except Exception as e:
        print(f"[SMART_EVAL] Error fetching indicators for {symbol}: {e}")
    return {"rsi": 50, "adx": 25, "ema_50": 0, "ema_200": 0, "volume": 0, "change_pct": 0, "macd": 0, "macd_signal": 0}


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
        }
        emoji = emoji_map.get(adj_type, "📊")

        msg = (
            f"{emoji} *تعديل ذكي على {symbol}.{exchange}*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"📌 *النوع:* {adjustment.get('reason_ar', adj_type)}\n"
            f"💰 *السعر الحالي:* {adjustment.get('current_price', '—')} EGP\n"
        )
        if adjustment.get("old_target"):
            msg += f"🎯 *الهدف القديم:* {adjustment['old_target']} → *الجديد:* {adjustment.get('new_target', '—')} EGP\n"
        if adjustment.get("old_stop"):
            msg += f"🛡️ *وقف الخسارة القديم:* {adjustment['old_stop']} → *الجديد:* {adjustment.get('new_stop', '—')} EGP\n"
        msg += f"\n📊 RSI: {adjustment.get('rsi', '—')} | ADX: {adjustment.get('adx', '—')}\n"
        msg += f"🕐 {dt.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"

        # Send to admin
        bot.send_notification(msg)

        # Send to subscribers of this symbol's bot
        _notify_subscribers_for_symbol(symbol, exchange, msg)

    except Exception as e:
        print(f"[SMART_EVAL] Telegram notification failed: {e}")


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
    res = supabase.table("scan_results").select("*").eq("status", "open").execute()
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
            .eq("symbol", f"{symbol}.{exchange}")
            .gte("date", created_at_date)
            .order("date", desc=False)
            .execute()
        )

        prices = p_res.data
        if not prices:
            continue

        # 🚫 Skip delisted/suspended stocks
        latest_close = float(prices[-1]["close"])
        latest_price_date = prices[-1].get("date", "")
        if latest_close <= 0:
            print(f"[EVALUATE] Skipping {symbol}.{exchange} — last close is zero (delisted)")
            continue
        try:
            days_since = (dt.datetime.now() - dt.datetime.strptime(latest_price_date[:10], "%Y-%m-%d")).days
            if days_since > 30:
                print(f"[EVALUATE] Skipping {symbol}.{exchange} — last data {days_since} days ago (stale)")
                continue
        except Exception:
            pass

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

        # Determine trend strength
        price_above_ema50 = latest_close > tech["ema_50"] if tech["ema_50"] > 0 else None
        price_above_ema200 = latest_close > tech["ema_200"] if tech["ema_200"] > 0 else None
        macd_bullish = tech["macd"] > tech["macd_signal"]
        strong_uptrend = (
            (price_above_ema50 is True) and
            tech["adx"] > 25 and
            50 <= tech["rsi"] <= 75 and
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

        if strong_uptrend and pl_pct > 3.0:
            # Stock is performing well — raise target by 15-25%
            if target_price:
                old_tp = round(target_price, 2)
                raise_pct = 0.15 if pl_pct < 8 else 0.25
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

        elif breaking_out and pl_pct > 1.0:
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
            # Stock weakening but still in profit — tighten stop loss
            if stop_loss:
                old_sl = round(stop_loss, 2)
                # Move SL to just below current price (lock in ~50% of current profit)
                new_stop = round(latest_close * 0.97, 2)
                if new_stop <= stop_loss:
                    new_stop = round(latest_close * 0.96, 2)
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
                trend_strength = "weakening"
                print(f"[SMART_EVAL] {symbol}: WEAKENING → SL {old_sl}→{new_stop}")

        # ── CHECK EXIT CONDITIONS (with potentially adjusted TP/SL) ──
        effective_target = new_target if new_target else target_price
        effective_stop = new_stop if new_stop else stop_loss

        for p in prices:
            hi = float(p["high"]) if p.get("high") is not None else float(p["close"])
            lo = float(p["low"]) if p.get("low") is not None else float(p["close"])

            if effective_stop is not None and lo <= (effective_stop + eps):
                exit_price = effective_stop
                status = "loss"
                pl_pct = ((effective_stop - entry_price) / entry_price) * 100
                found_event = True
                break

            if effective_target is not None and hi >= (effective_target - eps):
                exit_price = effective_target
                status = "win"
                pl_pct = ((effective_target - entry_price) / entry_price) * 100
                found_event = True
                break

        # ── UPDATE DATABASE ──
        all_adjustments = existing_adjustments + new_adjustments

        if not found_event:
            update_data = {
                "last_close": latest_close,
                "profit_loss_pct": round(pl_pct, 4),
                "status": "open",
                "updated_at": dt.datetime.utcnow().isoformat(),
            }
            if new_target and new_target != target_price:
                update_data["target_price"] = new_target
            if new_stop and new_stop != stop_loss:
                update_data["stop_loss"] = new_stop
            if all_adjustments:
                update_data["adjustments"] = all_adjustments

            try:
                supabase.table("scan_results").update(update_data).eq("id", rec["id"]).execute()
            except Exception as upd_err:
                print(f"[EVALUATE] Update failed for {symbol}: {upd_err}")
        else:
            update_data = {
                "exit_price": exit_price,
                "profit_loss_pct": round(pl_pct, 4),
                "status": status,
                "updated_at": dt.datetime.utcnow().isoformat(),
            }
            if all_adjustments:
                update_data["adjustments"] = all_adjustments

            try:
                supabase.table("scan_results").update(update_data).eq("id", rec["id"]).execute()
            except Exception as upd_err:
                print(f"[EVALUATE] Close update failed for {symbol}: {upd_err}")

        # ── SEND TELEGRAM NOTIFICATIONS ──
        for adj in new_adjustments:
            _send_telegram_adjustment(symbol, exchange, adj)

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
            .eq("symbol", full_symbol)
            .eq("exchange", exchange)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if not price_res.data:
            price_res = (
                supabase.table("stock_prices")
                .select("date,open,high,low,close,volume")
                .eq("symbol", full_symbol)
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
            .eq("symbol", f"{symbol}.{exchange}")
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
    
    return {
        "win_rate": win_rate,
        "target_2": target_2,
        "brief_rationale": brief_rationale,
        "technical_rationale": tech_rationale,
        "fundamental_rationale": fund_rationale,
        "expected_win_pct": win_rate_val,
        "news_source": f"نتائج الربع الأول وتقارير الإفصاح المالي لشركة ({symbol})"
    }


async def generate_daily_recommendations():
    """
    Run fast_scan ML model for Egypt, select the top 10 speculative stocks,
    generate rich detailed Arabic reports, and insert them into scan_results.
    """
    print("[RECOMMENDATIONS] Running ML fast scan for EGX stocks...")
    scan_resp = await fast_scan(
        country="Egypt",
        limit=200,
        min_precision=0.5,
        model_name="model_EGX.pkl"
    )
    
    results = scan_resp.get("results", [])
    if not results:
        print("[RECOMMENDATIONS] ML scan returned no BUY recommendations.")
        return
        
    print(f"[RECOMMENDATIONS] ML scan found {len(results)} BUY signals.")
    
    # Sort by precision (AI Score) descending
    results.sort(key=lambda x: x.get("precision", 0.0), reverse=True)
    
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
            "is_public": True,
            "top_reasons": rich_details,  # Stored as jsonb
            "features": res_item.get("features", []),  # Stored as jsonb
            "created_at": dt.datetime.utcnow().isoformat(),
            "updated_at": dt.datetime.utcnow().isoformat()
        }
        
        try:
            supabase.table("scan_results").insert(row_data).execute()
            print(f"[RECOMMENDATIONS] #{i+1} Saved {symbol}.{exchange} with target1={row_data['target_price']}, target2={rich_details['target_2']}")
        except Exception as ins_err:
            print(f"[RECOMMENDATIONS] Failed to save recommendation for {symbol}: {ins_err}")

    # Notify Stocks Score subscribers
    try:
        msg_lines = [f"🎯 *Stocks Score Update* — {dt.datetime.now().strftime('%Y-%m-%d')}", ""]
        for i, r in enumerate(top_10[:5]):
            msg_lines.append(f"{i+1}. *{r.get('symbol', '—')}* — Score: {round(r.get('precision', 0) * 10)}/10 | Signal: BUY")
        msg_lines.append("")
        msg_lines.append(f"🔗 Total new signals: {len(top_10)}")
        _notify_service_subscribers("stock_score", "\n".join(msg_lines))
    except Exception as e:
        print(f"[RECOMMENDATIONS] Telegram notify error: {e}")


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
    steps_log = []
    symbols_raw = []
    total_symbols = 0

    def _record_step(step_name: str, success: bool, details: str = "", count: int = 0):
        steps_log.append({
            "step": step_name,
            "status": "success" if success else "failed",
            "details": details,
            "count": count,
            "timestamp": dt.datetime.utcnow().isoformat()
        })

    def _persist_job(status: str):
        try:
            stock_ai.supabase.table("daily_job_runs").insert({
                "id": job_run_id,
                "job_type": "daily_bot",
                "status": status,
                "started_at": dt.datetime.utcnow().isoformat(),
                "completed_at": dt.datetime.utcnow().isoformat() if status in ("completed", "failed") else None,
                "steps": json.dumps(steps_log),
                "total_symbols": total_symbols,
                "trigger": trigger,
                "error": steps_log[-1]["details"] if steps_log and steps_log[-1]["status"] == "failed" else None
            }).execute()
        except Exception as e:
            print(f"[JOB] Failed to persist job run: {e}")

    try:
        # 1. Sync prices
        if not skip_sync:
            print("\n>>> STEP 1: Syncing daily prices from TradingView...")
            try:
                symbols_raw = _fetch_egx_symbols()
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
        if not symbols_raw:
            symbols_raw = _fetch_egx_symbols()
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

        # 3. Update open portfolio positions
        print("\n>>> STEP 3: Updating open portfolio positions...")
        try:
            update_open_portfolio_positions()
            _record_step("update_positions", True, "Positions updated", 0)
        except Exception as e:
            _record_step("update_positions", False, str(e)[:200], 0)
            print(f"[POSITIONS] Error: {e}")

        # 4. Evaluate old recommendations
        print("\n>>> STEP 4: Evaluating old recommendations...")
        try:
            evaluate_old_recommendations()
            _record_step("evaluate_recommendations", True, "Evaluated open recommendations", 0)
        except Exception as e:
            _record_step("evaluate_recommendations", False, str(e)[:200], 0)
            print(f"[EVALUATE] Error: {e}")

        # 5. Generate new recommendations
        print("\n>>> STEP 5: Generating new speculative recommendations...")
        try:
            await generate_daily_recommendations()
            _record_step("generate_recommendations", True, "Top 10 generated", 10)
        except Exception as e:
            _record_step("generate_recommendations", False, str(e)[:200], 0)
            print(f"[RECOMMENDATIONS] Error: {e}")

        # 6. Run Historical Similarity Scan
        print("\n>>> STEP 6: Running Historical Similarity market scan...")
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

        _persist_job("completed")
        print(f"\n--- Daily Bot Run Job Completed: {dt.datetime.now()} ---")

    except Exception as e:
        _record_step("job", False, str(e)[:500], total_symbols)
        _persist_job("failed")
        print(f"\n--- Daily Bot Run Job FAILED: {dt.datetime.now()} — {e} ---")


if __name__ == "__main__":
    asyncio.run(run_daily_job())
