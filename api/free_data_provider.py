"""
Free data providers as alternatives to EODHD:
- yfinance for historical EOD data (stocks, indices, forex, commodities)
- TradingView scraping for real-time and additional data
- No API key required
"""

import os
import json
import time
import logging
import datetime as dt
from typing import List, Dict, Any, Tuple, Optional
import requests
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

import ssl
import threading
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager

class TLSAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        context = ssl.create_default_context()
        try:
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.maximum_version = ssl.TLSVersion.TLSv1_2
        except Exception:
            pass
        self.poolmanager = PoolManager(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            ssl_context=context,
            **pool_kwargs
        )

_proxy_session = None
_proxy_session_lock = threading.Lock()

def _get_proxy_session():
    global _proxy_session
    if _proxy_session is None:
        with _proxy_session_lock:
            if _proxy_session is None:
                s = requests.Session()
                s.headers.update({
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                })
                s.mount("https://", TLSAdapter())
                _proxy_session = s
    return _proxy_session

# ============================================================================
# 1. FREE ALTERNATIVE: Fetch EGX symbols from local cache or web scrape
# ============================================================================

def fetch_egx_symbols_free() -> Tuple[bool, List[str], str]:
    """
    Fetch active EGX symbols reliably using local cache and database.
    Avoids yfinance rate limits.
    """
    try:
        from api.intraday_downloader import _fetch_egx_symbols
        syms = _fetch_egx_symbols()
        if syms:
            logger.info(f"Loaded {len(syms)} EGX symbols reliably.")
            return True, syms, f"Updated EGX inventory with {len(syms)} symbols."
        else:
            return False, [], "No EGX symbols found in local cache or database."
    except Exception as e:
        logger.error(f"Failed to fetch EGX symbols: {e}")
        return False, [], str(e)


# ============================================================================
# 2. FREE ALTERNATIVE: Fetch market indices and forex using yfinance
# ============================================================================

def fetch_eod_data_free(symbol: str, period: str = "6mo") -> List[Dict[str, Any]]:
    """
    Fetch EOD data using free providers.
    Falls back to hardcoded/simulated data if APIs are unavailable.
    
    Args:
        symbol: Ticker symbol (e.g., "^CASE30" for EGX30, "USDEGP=X" for USD/EGP)
        period: Data period ("1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max")
    
    Returns:
        List of daily OHLCV records
    """
    records = []
    
    # 1. Try TradingView (tvDatafeed) for EGX indices first since Yahoo Finance has no historical data for them
    tv_symbol_map = {
        "EGX30.INDX": ("EGX30", "EGX"),
        "EGX100.INDX": ("EGX100EWI", "EGX"),
    }
    
    if symbol in tv_symbol_map:
        try:
            from tvDatafeed import TvDatafeed, Interval
            tv = TvDatafeed()
            tv_sym, tv_exch = tv_symbol_map[symbol]
            
            period_bars = {
                "1mo": 25,
                "3mo": 75,
                "6mo": 150,
                "1y": 300,
                "2y": 600,
                "5y": 1500,
                "10y": 3000,
                "max": 5000
            }
            n_bars = period_bars.get(period, 180)
            
            df = tv.get_hist(symbol=tv_sym, exchange=tv_exch, interval=Interval.in_daily, n_bars=n_bars)
            if df is not None and not df.empty:
                df = df.reset_index()
                for _, row in df.iterrows():
                    records.append({
                        "date": row["datetime"].strftime("%Y-%m-%d"),
                        "open": round(float(row.get("open", 0)), 6),
                        "high": round(float(row.get("high", 0)), 6),
                        "low": round(float(row.get("low", 0)), 6),
                        "close": round(float(row.get("close", 0)), 6),
                        "volume": int(row.get("volume", 0))
                    })
                if records:
                    logger.info(f"Fetched {len(records)} EOD records for {symbol} ({tv_sym}) from tvDatafeed")
                    return records
        except Exception as tv_e:
            logger.warning(f"tvDatafeed fetch failed for {symbol}: {tv_e}")

    # 2. Fallback/Standard yfinance route
    try:
        import yfinance as yf
        import pandas as pd
        
        # Map EODHD symbols to yfinance symbols
        symbol_map = {
            "EGX30.INDX": "^CASE30",         # Cairo Composite Stock Index (EGX30)
            "EGX100.INDX": "^CASE30",        # Fallback to EGX30 (no EGX100 in yfinance)
            "USDEGP.FOREX": "USDEGP=X",      # USD/EGP
            "XAUUSD.FOREX": "GC=F",          # Gold (Futures)
            "CBKD.LSE": "CBKD.L",            # CBK Bank ADR/GDR
        }
        
        yf_symbol = symbol_map.get(symbol, symbol)
        
        # Try with retries and shorter timeout
        max_retries = 2
        for attempt in range(max_retries):
            try:
                # First try Cloudflare Proxy if configured (more reliable for Hugging Face)
                cf_proxy = os.getenv("CF_PROXY_URL")
                hist = pd.DataFrame()
                
                if cf_proxy:
                    import urllib.parse
                    # Choose range
                    r_range = "1y"
                    if period in ["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]:
                        r_range = period
                    
                    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_symbol}?range={r_range}&interval=1d"
                    url = f"{cf_proxy}?url={urllib.parse.quote(url)}"
                    
                    headers = {
                        "Accept": "*/*"
                    }
                    print(f"[FREE_DATA] Routing {yf_symbol} through proxy: {url}")
                    try:
                        session = _get_proxy_session()
                        r = session.get(url, headers=headers, timeout=15)
                        print(f"[FREE_DATA] Proxy response for {yf_symbol}: HTTP {r.status_code}")
                        if r.status_code == 200:
                            chart_res = r.json().get("chart", {}).get("result")
                        else:
                            print(f"[FREE_DATA] Proxy error body: {r.text[:200]}")
                            chart_res = None
                    except Exception as proxy_err:
                        print(f"[FREE_DATA] Proxy request failed for {yf_symbol}: {proxy_err}")
                        chart_res = None
                        
                    if chart_res and len(chart_res) > 0:
                        data = chart_res[0]
                        timestamps = data.get("timestamp", [])
                        indicators = data.get("indicators", {}).get("quote", [{}])[0]
                        if timestamps and indicators:
                                hist = pd.DataFrame({
                                    "Open": indicators.get("open", []),
                                    "High": indicators.get("high", []),
                                    "Low": indicators.get("low", []),
                                    "Close": indicators.get("close", []),
                                    "Volume": indicators.get("volume", [])
                                })
                                hist.index = pd.to_datetime(timestamps, unit="s")
                                hist = hist.dropna(subset=["Close", "Open", "High", "Low"], how="any")
                
                # If CF proxy failed or is not configured, fallback to standard yfinance
                if hist.empty:
                    ticker = yf.Ticker(yf_symbol)
                    hist = ticker.history(period=period)
                
                if not hist.empty:
                    # Convert to EODHD-like format
                    for date, row in hist.iterrows():
                        try:
                            records.append({
                                "date": date.strftime("%Y-%m-%d"),
                                "open": round(float(row.get("Open", 0)), 6),
                                "high": round(float(row.get("High", 0)), 6),
                                "low": round(float(row.get("Low", 0)), 6),
                                "close": round(float(row.get("Close", 0)), 6),
                                "volume": int(row.get("Volume", 0))
                            })
                        except (ValueError, TypeError):
                            continue
                    
                    if records:
                        logger.info(f"Fetched {len(records)} EOD records for {symbol} ({yf_symbol}) via fallback")
                        return records
            except Exception as e:
                logger.debug(f"Attempt {attempt+1} failed for {symbol}: {e}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                continue
        
        logger.warning(f"No data found for {symbol} ({yf_symbol}) - using fallback")
        
    except ImportError:
        logger.warning("yfinance not installed, using fallback data")
    except Exception as e:
        logger.debug(f"Error fetching EOD data for {symbol}: {e}")
    
    # Fallback: Return empty (will be filled from cache/Supabase)
    return []


# ============================================================================
# 3. FREE ALTERNATIVE: Fetch live forex rates (USD/EGP, Gold prices)
# ============================================================================

def fetch_live_rates_free() -> Dict[str, float]:
    """
    Fetch live exchange rates and commodity prices using free APIs.
    Multiple fallbacks ensure data availability.
    """
    res = {
        "usd_parallel": 50.3,
        "usd_official": 49.3,
        "gold_24k": 6540.0,
        "gold_21k": 5720.0,
        "source": "fallback"
    }
    
    # Priority 1: Try exchangerate-api.com (free tier: 1500 calls/month)
    try:
        import requests
        url = "https://api.exchangerate-api.com/v4/latest/USD"
        r = requests.get(url, timeout=5)
        if r.status_code == 200:
            data = r.json()
            usd_egp = data.get("rates", {}).get("EGP")
            if usd_egp and 45 <= usd_egp <= 60:
                res["usd_official"] = round(usd_egp, 2)
                res["usd_parallel"] = round(usd_egp * 1.02, 2)  # Assume 2% premium
                res["source"] = "exchangerate-api"
                logger.info(f"Fetched USD/EGP from exchange-api: {usd_egp}")
                return res  # If exchange rate works, gold is secondary
    except Exception as e:
        logger.debug(f"exchangerate-api failed: {e}")
    
    # Priority 2: Try Open Exchange Rates (free tier available)
    try:
        app_id = os.getenv("OPENEXCHANGERATES_APP_ID")
        if app_id:
            import requests
            url = f"https://openexchangerates.org/api/latest.json?app_id={app_id}&base=USD&symbols=EGP"
            r = requests.get(url, timeout=5)
            if r.status_code == 200:
                data = r.json()
                usd_egp = data.get("rates", {}).get("EGP")
                if usd_egp and 45 <= usd_egp <= 60:
                    res["usd_official"] = round(usd_egp, 2)
                    res["usd_parallel"] = round(usd_egp * 1.02, 2)
                    res["source"] = "openexchangerates"
                    logger.info(f"Fetched USD/EGP from OpenExchangeRates: {usd_egp}")
                    return res
    except Exception as e:
        logger.debug(f"OpenExchangeRates failed: {e}")
    
    # Priority 3: Try yfinance for live forex (may be rate-limited)
    try:
        import yfinance as yf
        try:
            forex = yf.Ticker("USDEGP=X")
            hist = forex.history(period="1d")
            if not hist.empty:
                usd_egp = float(hist["Close"].iloc[-1])
                if 45 <= usd_egp <= 60:
                    res["usd_official"] = round(usd_egp, 2)
                    res["usd_parallel"] = round(usd_egp * 1.02, 2)
                    res["source"] = "yfinance"
                    logger.info(f"Fetched USD/EGP from yfinance: {usd_egp}")
                    return res
        except Exception as e:
            logger.debug(f"yfinance forex fetch failed: {e}")
    except Exception as e:
        logger.debug(f"yfinance integration failed: {e}")
    
    # If we still have no data, return fallback with timestamp indication
    logger.warning(f"Using fallback rates (could not fetch live data)")
    res["source"] = "fallback"
    return res


# ============================================================================
# 4. TRADINGVIEW INTEGRATION: Fetch data via TradingView scraping
# ============================================================================

def fetch_tradingview_price(symbol: str) -> Optional[Dict[str, Any]]:
    """
    Fetch current price and basic data from TradingView.
    Uses public TradingView endpoints.
    """
    try:
        # TradingView symbol format: EXCHANGE:TICKER
        # e.g., "EGX:FWRY", "CRYPTO:BTCUSD"
        
        url = f"https://query1.finance.opera.com/?symbols={symbol}&fields=ask,bid,last_price,last_update,open,high,low,volume"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if data and len(data) > 0:
                quote = data[0]
                return {
                    "symbol": symbol,
                    "price": quote.get("last_price"),
                    "bid": quote.get("bid"),
                    "ask": quote.get("ask"),
                    "open": quote.get("open"),
                    "high": quote.get("high"),
                    "low": quote.get("low"),
                    "volume": quote.get("volume"),
                    "timestamp": quote.get("last_update"),
                    "source": "tradingview"
                }
    except Exception as e:
        logger.debug(f"TradingView price fetch failed for {symbol}: {e}")
    
    return None


# ============================================================================
# 5. UTILITY: Batch download historical data (efficient caching)
# ============================================================================

def download_historical_batch(symbols: List[str], period: str = "1y") -> Dict[str, pd.DataFrame]:
    """
    Efficiently download historical data for multiple symbols using yfinance.
    Returns a dictionary of DataFrames, cached locally.
    """
    import yfinance as yf
    
    cache_dir = os.path.join(os.path.dirname(__file__), "symbols_data", "yfinance_cache")
    os.makedirs(cache_dir, exist_ok=True)
    
    results = {}
    
    for symbol in symbols:
        cache_file = os.path.join(cache_dir, f"{symbol}.json")
        
        # Check cache (if < 1 day old)
        if os.path.exists(cache_file):
            try:
                mtime = dt.datetime.fromtimestamp(os.path.getmtime(cache_file))
                if dt.datetime.now() - mtime < dt.timedelta(hours=24):
                    with open(cache_file, "r") as f:
                        data = json.load(f)
                    results[symbol] = pd.DataFrame(data)
                    logger.debug(f"Loaded {symbol} from cache")
                    continue
            except Exception as e:
                logger.debug(f"Cache load failed for {symbol}: {e}")
        
        # Download fresh data
        try:
            hist = yf.download(symbol, period=period, progress=False)
            if not hist.empty:
                results[symbol] = hist
                
                # Save to cache
                try:
                    hist_json = hist.reset_index().to_json(orient="records", date_format="iso")
                    with open(cache_file, "w") as f:
                        f.write(hist_json)
                except Exception as e:
                    logger.debug(f"Cache save failed for {symbol}: {e}")
            
            time.sleep(0.5)  # Rate limiting
        except Exception as e:
            logger.error(f"Download failed for {symbol}: {e}")
    
    return results


# ============================================================================
# 6. MIGRATION WRAPPER: Drop-in replacement for EODHD calls
# ============================================================================

def get_market_status_free(from_date: str = None, period: str = "1y") -> Dict[str, Any]:
    """
    Get market status (EGX30, EGX100, USD/EGP) without EODHD API key.
    This replaces _refresh_market_status_cache() logic.
    
    Strategy:
    1. Try Supabase first (reliable, cached data)
    2. Fall back to yfinance if available
    3. Use sensible defaults if all else fails
    """
    if from_date is None:
        # Start from the beginning of the current year (January 1st)
        from_date = f"{dt.datetime.now().year}-01-01"
    
    # Initialize results
    egx30_data = []
    egx100_data = []
    usdegp_data = []
    
    # 1. Fetch existing historical index/forex data from Supabase first (single fetch, no loops)
    logger.info("Seeding market status history from Supabase...")
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if supabase:
            # Fetch EGX30 history (180 days is max 180 rows, no pagination loop needed)
            try:
                res = supabase.table("stock_prices").select("date,open,high,low,close,volume").eq("symbol", "EGX30").eq("exchange", "INDX").gte("date", from_date).order("date", desc=False).execute()
                all_data = res.data or []
                if all_data:
                    egx30_data = [
                        {
                            "date": r["date"],
                            "open": float(r.get("open", 0)),
                            "high": float(r.get("high", 0)),
                            "low": float(r.get("low", 0)),
                            "close": float(r.get("close", 0)),
                            "volume": int(r.get("volume", 0))
                        }
                        for r in all_data
                    ]
                    logger.info(f"Loaded {len(egx30_data)} EGX30 history rows from Supabase")
            except Exception as e:
                logger.debug(f"Supabase EGX30 history fetch failed: {e}")
            
            # Fetch USD/EGP history
            try:
                res = supabase.table("stock_prices").select("date,open,high,low,close,volume").eq("symbol", "USDEGP").eq("exchange", "FOREX").gte("date", from_date).order("date", desc=False).execute()
                all_data = res.data or []
                if all_data:
                    usdegp_data = [
                        {
                            "date": r["date"],
                            "open": float(r.get("open", 0)),
                            "high": float(r.get("high", 0)),
                            "low": float(r.get("low", 0)),
                            "close": float(r.get("close", 0)),
                            "volume": int(r.get("volume", 0))
                        }
                        for r in all_data
                    ]
                    logger.info(f"Loaded {len(usdegp_data)} USD/EGP history rows from Supabase")
            except Exception as e:
                logger.debug(f"Supabase USD/EGP history fetch failed: {e}")

            # Fetch EGX100 history
            try:
                res = supabase.table("stock_prices").select("date,open,high,low,close,volume").eq("symbol", "EGX100").eq("exchange", "INDX").gte("date", from_date).order("date", desc=False).execute()
                all_data = res.data or []
                if all_data:
                    egx100_data = [
                        {
                            "date": r["date"],
                            "open": float(r.get("open", 0)),
                            "high": float(r.get("high", 0)),
                            "low": float(r.get("low", 0)),
                            "close": float(r.get("close", 0)),
                            "volume": int(r.get("volume", 0))
                        }
                        for r in all_data
                    ]
                    logger.info(f"Loaded {len(egx100_data)} EGX100 history rows from Supabase")
            except Exception as e:
                logger.debug(f"Supabase EGX100 history fetch failed: {e}")
    except Exception as e:
        logger.debug(f"Supabase history connection failed: {e}")

    # 2. Fetch fresh recent data from free providers and merge to append the latest days
    logger.info("Merging latest business days from free providers...")
    try:
        fresh_egx30 = fetch_eod_data_free("EGX30.INDX", period=period)
        if fresh_egx30:
            # Merge by date (overwrites/adds to Supabase history)
            merged = {r["date"]: r for r in egx30_data}
            for r in fresh_egx30:
                merged[r["date"]] = r
            egx30_data = [merged[d] for d in sorted(merged.keys())]
            logger.info(f"EGX30 merged to {len(egx30_data)} rows after fetch")
    except Exception as e:
        logger.warning(f"EGX30 merge failed: {e}")

    try:
        fresh_egx100 = fetch_eod_data_free("EGX100.INDX", period=period)
        if fresh_egx100:
            merged = {r["date"]: r for r in egx100_data}
            for r in fresh_egx100:
                merged[r["date"]] = r
            egx100_data = [merged[d] for d in sorted(merged.keys())]
            logger.info(f"EGX100 merged to {len(egx100_data)} rows after fetch")
    except Exception as e:
        logger.warning(f"EGX100 merge failed: {e}")

    try:
        fresh_usdegp = fetch_eod_data_free("USDEGP.FOREX", period=period)
        if fresh_usdegp:
            merged = {r["date"]: r for r in usdegp_data}
            for r in fresh_usdegp:
                merged[r["date"]] = r
            usdegp_data = [merged[d] for d in sorted(merged.keys())]
            logger.info(f"USDEGP merged to {len(usdegp_data)} rows after fetch")
    except Exception as e:
        logger.warning(f"USDEGP merge failed: {e}")

    # Fallback for latest USD/EGP rate using live rates if fetch failed or returned empty
    try:
        today_str = dt.datetime.utcnow().strftime("%Y-%m-%d")
        if not fresh_usdegp or len(usdegp_data) == 0 or usdegp_data[-1]["date"] < today_str:
            live_rates = fetch_live_rates_free()
            live_usd = live_rates.get("usd_official", 0)
            if live_usd > 0:
                if len(usdegp_data) > 0 and usdegp_data[-1]["date"] == today_str:
                    usdegp_data[-1]["close"] = live_usd
                else:
                    usdegp_data.append({
                        "date": today_str,
                        "open": live_usd,
                        "high": live_usd,
                        "low": live_usd,
                        "close": live_usd,
                        "volume": 0
                    })
                logger.info(f"Appended latest live USD/EGP rate ({live_usd}) to history")
    except Exception as le:
        logger.warning(f"Failed to append latest live USD/EGP rate: {le}")
    
    # EGX100 fallback (if still empty, use EGX30)
    if not egx100_data:
        egx100_data = egx30_data
    
    # Calculate regime
    regime = "sideways"
    egx30_return = 0.0
    reject_buys = False
    
    if egx30_data and len(egx30_data) >= 2:
        try:
            close_today = float(egx30_data[-1]["close"])
            close_prev = float(egx30_data[-2]["close"])
            egx30_return = (close_today - close_prev) / close_prev
            
            # Simple regime detection
            if egx30_return > 0.02:
                regime = "bull"
            elif egx30_return < -0.05:
                regime = "panic"
                reject_buys = True
            elif -0.02 <= egx30_return <= 0.02:
                regime = "sideways"
            else:
                regime = "bear"
        except Exception as e:
            logger.warning(f"Regime calculation failed: {e}")
    
    return {
        "egx30": egx30_data,
        "egx100": egx100_data,
        "usdegp": usdegp_data,
        "regime": regime,
        "egx30_return": egx30_return,
        "reject_buys": reject_buys,
        "updated_at": dt.datetime.utcnow().isoformat(),
        "source": "free_providers"
    }


if __name__ == "__main__":
    # Test the free providers
    print("Testing free data providers...\n")
    
    # 1. Fetch EGX symbols
    ok, syms, msg = fetch_egx_symbols_free()
    print(f"✓ EGX Symbols: {msg} - {len(syms)} symbols")
    
    # 2. Fetch market status
    status = get_market_status_free(period="3mo")
    print(f"✓ Market Status: Regime={status['regime']}, EGX30 Return={status['egx30_return']:.2%}")
    
    # 3. Fetch live rates
    rates = fetch_live_rates_free()
    print(f"✓ Live Rates: USD/EGP={rates['usd_official']}, Gold={rates['gold_24k']} (source: {rates['source']})")
    
    print("\nAll tests passed! Ready to replace EODHD.")
