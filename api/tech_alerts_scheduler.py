import time
import threading
import datetime as dt
import os
import requests
import json
from eodhd import APIClient

from api.stock_ai import supabase, _init_supabase
from api.routers.scan_tech import TechFilter
from api.symbols_local import load_symbols_for_country
from api.stock_ai import is_ticker_synced, get_stock_data_eodhd, add_technical_indicators, get_company_fundamentals

# ─── Scan cycle counter (used for deciding when to refresh prices) ────────────
_scan_cycle_count = 0

def start_alerts_scheduler():
    thread = threading.Thread(target=_alerts_worker_loop, daemon=True)
    thread.start()

def _alerts_worker_loop():
    global _scan_cycle_count
    print("[ALERTS SCHEDULER] Worker thread started.")
    # Wait a bit on startup to let the app initialize
    time.sleep(30)
    while True:
        try:
            _scan_cycle_count += 1
            # Refresh closing prices from EODHD before every scan
            _refresh_closing_prices_for_alerts()
            _check_and_trigger_alerts()
        except Exception as e:
            print(f"[ALERTS SCHEDULER] Error in check loop: {e}")
        # Run every 30 minutes
        time.sleep(1800)


def _refresh_closing_prices_for_alerts():
    """
    Before running the alert scan, pull the latest daily closing prices
    from EODHD for all synced Egyptian stocks. This ensures technical
    indicators are computed on up-to-date data (today's close).
    """
    _init_supabase()
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        print("[ALERTS SCHEDULER] EODHD API Key not set - skipping price refresh")
        return

    try:
        from api.symbols_local import load_symbols_for_country
        symbols_data = load_symbols_for_country("Egypt")
    except Exception as e:
        print(f"[ALERTS SCHEDULER] Failed to load Egyptian symbols: {e}")
        return

    api = APIClient(api_key)
    today = dt.date.today().isoformat()
    # Only refresh synced tickers to avoid rate-limit abuse
    synced = [(str(r.get("Code", r.get("Symbol", ""))), str(r.get("Exchange", "")))
              for r in symbols_data
              if is_ticker_synced(str(r.get("Code", r.get("Symbol", ""))), str(r.get("Exchange", "")))]

    refreshed = 0
    errors = 0
    for symbol, exchange in synced:
        if not symbol:
            continue
        try:
            # force_local=False so it actually downloads fresh data from EODHD
            df = get_stock_data_eodhd(
                api, symbol,
                from_date="2023-01-01",
                tolerance_days=5,
                exchange=exchange,
                force_local=False   # <-- pull fresh closing prices
            )
            if df is not None and not df.empty:
                refreshed += 1
        except Exception as e:
            errors += 1
            # Silently skip individual failures
            continue

    print(f"[ALERTS SCHEDULER] Price refresh complete: {refreshed} refreshed, {errors} errors out of {len(synced)} synced tickers")

def _check_and_trigger_alerts():
    _init_supabase()
    if not supabase:
        print("[ALERTS SCHEDULER] Supabase client not initialized")
        return
        
    # Get active alerts
    res = supabase.table("technical_alerts").select("*").eq("is_active", True).execute()
    if not res.data:
        return
        
    alerts = res.data
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        print("[ALERTS SCHEDULER] EODHD API Key not set")
        return
        
    tg_token = os.getenv("ARTORO_AI_BOT")
    if not tg_token:
        print("[ALERTS SCHEDULER] ARTORO_AI_BOT token not configured, cannot send Telegram alerts.")
        return
        
    api = APIClient(api_key)
    
    for alert in alerts:
        alert_id = alert["id"]
        user_id = alert["user_id"]
        alert_name = alert["name"]
        filters_dict = alert["filters"]
        last_triggered_matches = alert.get("last_triggered_matches") or []
        
        # Get user's telegram_chat_id from profiles
        prof_res = supabase.table("profiles").select("telegram_chat_id").eq("id", user_id).execute()
        if not prof_res.data or not prof_res.data[0].get("telegram_chat_id"):
            # User hasn't set up Telegram chat id
            continue
            
        chat_id = prof_res.data[0]["telegram_chat_id"]
        
        # Build TechFilter
        try:
            # Backend expects country, limit, etc. Default country is Egypt.
            if "country" not in filters_dict:
                filters_dict["country"] = "Egypt"
            f = TechFilter(**filters_dict)
        except Exception as e:
            print(f"[ALERTS SCHEDULER] Invalid filters for alert {alert_id}: {e}")
            continue
            
        try:
            symbols_data = load_symbols_for_country(f.country)
        except Exception as e:
            print(f"[ALERTS SCHEDULER] Failed to load symbols for country {f.country}: {e}")
            continue
            
        cached_candidates = []
        others = []
        for row in symbols_data:
            sym = str(row.get("Code", row.get("Symbol", "")))
            ex = str(row.get("Exchange", ""))
            if is_ticker_synced(sym, ex):
                cached_candidates.append(row)
            else:
                others.append(row)
                
        sorted_candidates = cached_candidates + others
        candidates = sorted_candidates[:f.limit]
        
        matched_symbols = []
        
        for row in candidates:
            symbol = str(row.get("Code", row.get("Symbol", "")))
            exchange = str(row.get("Exchange", ""))
            if not symbol or not is_ticker_synced(symbol, exchange):
                continue
                
            try:
                # Use local data (already refreshed above by _refresh_closing_prices_for_alerts)
                # force_local=True here is safe — fresh data was pulled in the refresh step
                df = get_stock_data_eodhd(api, symbol, from_date="2023-01-01", tolerance_days=5, exchange=exchange, force_local=True)
                if df is None or df.empty:
                    continue
                df = add_technical_indicators(df)
                if df is None or df.empty:
                    continue
                last = df.iloc[-1]
                
                close = float(last.get("Close", 0))
                rsi = float(last.get("RSI", 0))
                ema50 = float(last.get("EMA_50", 0))
                ema200 = float(last.get("EMA_200", 0))
                volume = float(last.get("Volume", 0))
                momentum = float(last.get("Momentum", 0))
                atr14 = float(last.get("ATR_14", 0))
                adx14 = float(last.get("ADX_14", 0))
                stoch_k = float(last.get("STOCH_K", 0))
                roc12 = float(last.get("ROC_12", 0))
                vol_sma20 = float(last.get("VOL_SMA20", 0))
                vwap20 = float(last.get("VWAP_20", 0))
                
                # Apply filters
                if f.min_price and close < f.min_price: continue
                if f.rsi_min and rsi < f.rsi_min: continue
                if f.rsi_max and rsi > f.rsi_max: continue
                if f.above_ema50 and close <= ema50: continue
                if f.below_ema50 and close >= ema50: continue
                if f.above_ema200 and close <= ema200: continue
                if f.adx_min and adx14 < f.adx_min: continue
                if f.adx_max and adx14 > f.adx_max: continue
                if f.atr_min and atr14 < f.atr_min: continue
                if f.atr_max and atr14 > f.atr_max: continue
                if f.stoch_k_min and stoch_k < f.stoch_k_min: continue
                if f.stoch_k_max and stoch_k > f.stoch_k_max: continue
                if f.roc_min and roc12 < f.roc_min: continue
                if f.roc_max and roc12 > f.roc_max: continue
                if f.above_vwap20 and close <= vwap20: continue
                if f.volume_above_sma20 and volume <= vol_sma20: continue
                if f.golden_cross and ema50 <= ema200: continue
                
                # Fundamentals if needed
                if f.market_cap_min or f.market_cap_max or f.sector or f.industry:
                    funds = get_company_fundamentals(symbol) or {}
                    m_cap = funds.get("marketCap")
                    sec = funds.get("sector")
                    ind = funds.get("industry")
                    
                    if f.market_cap_min and (m_cap or 0) < f.market_cap_min: continue
                    if f.market_cap_max and (m_cap or 0) > f.market_cap_max: continue
                    if f.sector and f.sector.lower() not in (sec or "").lower(): continue
                    if f.industry and f.industry.lower() not in (ind or "").lower(): continue

                # AI Filter
                if f.use_ai_filter:
                    from api.stock_ai import run_pipeline
                    prediction = run_pipeline(
                        api_key=api_key,
                        ticker=symbol,
                        from_date="2020-01-01",
                        include_fundamentals=False,
                        tolerance_days=5,
                        exchange=exchange,
                        force_local=True
                    )
                    if prediction["tomorrowPrediction"] != 1: continue
                    if prediction["precision"] < f.min_ai_precision: continue

                # If passed all filters, it's a match!
                matched_symbols.append(symbol)
            except Exception as e:
                # print(f"[ALERTS SCHEDULER] Error processing symbol {symbol}: {e}")
                continue
                
        # Compare with last triggered matches
        new_matches = [s for s in matched_symbols if s not in last_triggered_matches]
        if new_matches:
            # We have new matches! Send Telegram notification
            msg = (
                f"🔔 *تنبيه الفاحص الفني: {alert_name}* 🔔\n\n"
                f"تم رصد أسهم جديدة تطابق شروط الفلتر الخاصة بك في سوق مصر:\n"
            )
            for sym in new_matches:
                msg += f"• *{sym}*\n"
                
            msg += f"\nإجمالي الأسهم المطابقة حالياً: {len(matched_symbols)}"
            
            # Send using bot_manager's bridge queue if available to preserve ordering/retries
            from api.live_bot import bot_manager
            bridge = getattr(bot_manager, "_telegram_bridge", None)
            if bridge:
                bridge._queue.append({"chat_id": int(chat_id), "text": msg, "parse_mode": "Markdown"})
                print(f"[ALERTS SCHEDULER] Queued telegram alert to bridge for {chat_id}")
            else:
                # Fallback to direct requests call
                url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
                try:
                    requests.post(url, json={"chat_id": int(chat_id), "text": msg, "parse_mode": "Markdown"}, timeout=15)
                    print(f"[ALERTS SCHEDULER] Sent direct telegram alert to {chat_id}")
                except Exception as ex:
                    print(f"[ALERTS SCHEDULER] Direct Telegram post failed: {ex}")
                    
            # Update database with matches and trigger timestamp
            supabase.table("technical_alerts").update({
                "last_triggered_at": dt.datetime.now().isoformat(),
                "last_triggered_matches": matched_symbols
            }).eq("id", alert_id).execute()
        elif set(matched_symbols) != set(last_triggered_matches):
            # If the matched list decreased or changed but has no NEW matches, we still update the DB
            # but don't notify to avoid spamming the user
            supabase.table("technical_alerts").update({
                "last_triggered_matches": matched_symbols
            }).eq("id", alert_id).execute()
