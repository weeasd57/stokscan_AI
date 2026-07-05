"""
TradingView Integration Module

Provides functions to fetch price history and fundamentals from TradingView.
Used by admin panel and stock_ai module for data updates.
"""

import os
import json
import time
import pandas as pd
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
import threading

# Module-level shared HTTP session for Yahoo Finance fallback (thread-safe)
_yahoo_session = None
_yahoo_session_lock = threading.Lock()

def _get_yahoo_session():
    """Get or create a shared requests.Session with connection pooling."""
    global _yahoo_session
    if _yahoo_session is None:
        with _yahoo_session_lock:
            if _yahoo_session is None:
                import requests
                s = requests.Session()
                s.headers.update({
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                })
                # Connection pooling: keep up to 20 connections alive
                adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
                s.mount("https://", adapter)
                s.mount("http://", adapter)
                _yahoo_session = s
    return _yahoo_session


# Professional Exchange Configuration Mapping
# Inspired by stockroom model structures
EXCHANGE_CONFIG = {
    "ADX": {"market": "uae", "tv_id": "ADX", "country": "UAE"},
    "BINANCE": {"market": "crypto", "tv_id": "BINANCE", "country": "Crypto"},
    "OKX": {"market": "crypto", "tv_id": "OKX", "country": "Crypto"},
    "AS": {"market": "netherlands", "tv_id": "EURONEXT", "country": "Netherlands"},
    "AT": {"market": "greece", "tv_id": "ATHEX", "country": "Greece"},
    "AU": {"market": "australia", "tv_id": "ASX", "country": "Australia"},
    "BA": {"market": "argentina", "tv_id": "BCBA", "country": "Argentina"},
    "BC": {"market": "morocco", "tv_id": "CSE", "country": "Morocco"},
    "BE": {"market": "germany", "tv_id": "BER", "country": "Germany"},
    "BK": {"market": "thailand", "tv_id": "SET", "country": "Thailand"},
    "BR": {"market": "belgium", "tv_id": "EURONEXT", "country": "Belgium"},
    "BUD": {"market": "hungary", "tv_id": "BET", "country": "Hungary"},
    "CA": {"market": "egypt", "tv_id": "EGX", "country": "Egypt"},
    "CM": {"market": "sri_lanka", "tv_id": "CM", "country": "Sri Lanka"},
    "CO": {"market": "denmark", "tv_id": "OMXCOP", "country": "Denmark"},
    "DFM": {"market": "uae", "tv_id": "DFM", "country": "UAE"},
    "DSE": {"market": "tanzania", "tv_id": "DSE", "country": "Tanzania"},
    "DU": {"market": "germany", "tv_id": "DUS", "country": "Germany"},
    "EGX": {"market": "egypt", "tv_id": "EGX", "country": "Egypt"},
    "EUBOND": {"market": "belgium", "tv_id": "EUBOND", "country": "Belgium"},
    "F": {"market": "germany", "tv_id": "XETRA", "country": "Germany"},
    "GSE": {"market": "ghana", "tv_id": "GSE", "country": "Ghana"},
    "HA": {"market": "germany", "tv_id": "HA", "country": "Germany"},
    "HE": {"market": "finland", "tv_id": "OMXHEL", "country": "Finland"},
    "HM": {"market": "germany", "tv_id": "HM", "country": "Germany"},
    "IC": {"market": "iceland", "tv_id": "ICEX", "country": "Iceland"},
    "IL": {"market": "uk", "tv_id": "LSE", "country": "UK"},
    "IR": {"market": "ireland", "tv_id": "EURONEXT", "country": "Ireland"},
    "IS": {"market": "turkey", "tv_id": "BIST", "country": "Turkey"},
    "JK": {"market": "indonesia", "tv_id": "IDX", "country": "Indonesia"},
    "JSE": {"market": "south_africa", "tv_id": "JSE", "country": "South Africa"},
    "KAR": {"market": "pakistan", "tv_id": "KAR", "country": "Pakistan"},
    "KLSE": {"market": "malaysia", "tv_id": "MYX", "country": "Malaysia"},
    "KO": {"market": "korea", "tv_id": "KOSPI", "country": "Korea"},
    "KQ": {"market": "korea", "tv_id": "KOSDAQ", "country": "Korea"},
    "LIM": {"market": "peru", "tv_id": "LIM", "country": "Peru"},
    "LS": {"market": "portugal", "tv_id": "EURONEXT", "country": "Portugal"},
    "LSE": {"market": "uk", "tv_id": "LSE", "country": "UK"},
    "LU": {"market": "luxembourg", "tv_id": "LUXSE", "country": "Luxembourg"},
    "LUSE": {"market": "zambia", "tv_id": "LUSE", "country": "Zambia"},
    "MC": {"market": "spain", "tv_id": "BME", "country": "Spain"},
    "MSE": {"market": "malawi", "tv_id": "MSE", "country": "Malawi"},
    "MU": {"market": "germany", "tv_id": "MUN", "country": "Germany"},
    "MX": {"market": "mexico", "tv_id": "BMV", "country": "Mexico"},
    "NASDAQ": {"market": "america", "tv_id": "NASDAQ", "country": "USA"},
    "NEO": {"market": "canada", "tv_id": "NEO", "country": "Canada"},
    "NSE": {"market": "india", "tv_id": "NSE", "country": "India"},
    "NYSE": {"market": "america", "tv_id": "NYSE", "country": "USA"},
    "OL": {"market": "norway", "tv_id": "OSLO", "country": "Norway"},
    "PA": {"market": "france", "tv_id": "EURONEXT", "country": "France"},
    "PR": {"market": "czech", "tv_id": "PRAGUE", "country": "Czech Republic"},
    "PSE": {"market": "philippines", "tv_id": "PSE", "country": "Philippines"},
    "RO": {"market": "romania", "tv_id": "BVB", "country": "Romania"},
    "RSE": {"market": "rwanda", "tv_id": "RSE", "country": "Rwanda"},
    "SA": {"market": "brazil", "tv_id": "BMFBOVESPA", "country": "Brazil"},
    "SEM": {"market": "mauritius", "tv_id": "SEM", "country": "Mauritius"},
    "SHE": {"market": "china", "tv_id": "SZSE", "country": "China"},
    "SHG": {"market": "china", "tv_id": "SSE", "country": "China"},
    "SN": {"market": "chile", "tv_id": "SN", "country": "Chile"},
    "ST": {"market": "sweden", "tv_id": "OMXSTO", "country": "Sweden"},
    "STU": {"market": "germany", "tv_id": "STU", "country": "Germany"},
    "SW": {"market": "switzerland", "tv_id": "SIX", "country": "Switzerland"},
    "TO": {"market": "canada", "tv_id": "TSX", "country": "Canada"},
    "TW": {"market": "taiwan", "tv_id": "TWSE", "country": "Taiwan"},
    "TWO": {"market": "taiwan", "tv_id": "TPEX", "country": "Taiwan"},
    "US": {"market": "america", "tv_id": "NASDAQ", "country": "USA"},
    "USE": {"market": "uganda", "tv_id": "USE", "country": "Uganda"},
    "V": {"market": "canada", "tv_id": "TSXV", "country": "Canada"},
    "VFEX": {"market": "zimbabwe", "tv_id": "VFEX", "country": "Zimbabwe"},
    "VI": {"market": "austria", "tv_id": "VIE", "country": "Austria"},
    "VN": {"market": "vietnam", "tv_id": "HOSE", "country": "Vietnam"},
    "WAR": {"market": "poland", "tv_id": "GPW", "country": "Poland"},
    "XBOT": {"market": "botswana", "tv_id": "XBOT", "country": "Botswana"},
    "XETRA": {"market": "germany", "tv_id": "XETRA", "country": "Germany"},
    "XNAI": {"market": "kenya", "tv_id": "XNAI", "country": "Kenya"},
    "XNSA": {"market": "nigeria", "tv_id": "XNSA", "country": "Nigeria"},
    "XZIM": {"market": "zimbabwe", "tv_id": "XZIM", "country": "Zimbabwe"},
    "ZSE": {"market": "croatia", "tv_id": "ZSE", "country": "Croatia"},
}


def get_tradingview_market(symbol: str) -> str:
    """
    Get TradingView market name from symbol exchange suffix.
    
    Args:
        symbol: Stock symbol with exchange suffix (e.g., "AAPL.US", "AIR.PA")
    
    Returns:
        TradingView market name (e.g., "america", "france")
    """
    upper = (symbol or "").strip().upper()
    suffix = upper.split(".")[-1] if "." in upper else ""
    config = EXCHANGE_CONFIG.get(suffix)
    if config:
        return config["market"]
    return os.getenv("TRADINGVIEW_DEFAULT_MARKET", "america")


def get_tradingview_exchange(symbol: str) -> str:
    """
    Get tvDatafeed exchange format from symbol exchange suffix.
    
    Args:
        symbol: Stock symbol with exchange suffix (e.g., "AAPL.US", "AIR.PA")
    
    Returns:
        tvDatafeed exchange name (e.g., "NASDAQ", "EURONEXT")
    """
    upper = (symbol or "").strip().upper()
    suffix = upper.split(".")[-1] if "." in upper else ""
    config = EXCHANGE_CONFIG.get(suffix)
    if config:
        return config["tv_id"]
    return suffix


def _try_yahoo_direct_fallback(
    upper: str,
    base_symbol: str,
    timeframe: str,
    max_days: int,
    start_date: Any,
    end_date: Any
) -> Tuple[bool, str]:
    """
    Direct Yahoo Finance API fallback. Fetches the raw JSON from Yahoo Finance
    query API to bypass yfinance JSONDecodeErrors and timezone issues.
    """
    if timeframe.lower() not in ["1d", "1day", "daily"]:
        return False, "Yahoo fallback only supports daily data"
    
    yf_ticker = upper
    if upper.endswith(".US"):
        yf_ticker = upper.replace(".US", "")
    elif upper.endswith(".EGX"):
        yf_ticker = f"{base_symbol}.CA"
        
    try:
        import pandas as pd
        from api.stock_ai import sync_df_to_supabase
        
        print(f"TRYING YAHOO FINANCE DIRECT API FALLBACK FOR {upper} ({yf_ticker})...")
        
        # Choose range based on max_days
        if max_days <= 30:
            r_range = "1mo"
        elif max_days <= 90:
            r_range = "3mo"
        elif max_days <= 180:
            r_range = "6mo"
        elif max_days <= 365:
            r_range = "1y"
        elif max_days <= 730:
            r_range = "2y"
        else:
            r_range = "5y"
            
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_ticker}?range={r_range}&interval=1d"
        
        cf_proxy = os.getenv("CF_PROXY_URL")
        if cf_proxy:
            import urllib.parse
            url = f"{cf_proxy}?url={urllib.parse.quote(url)}"
            print(f"Routing Yahoo request through Cloudflare proxy: {cf_proxy}")
        
        session = _get_yahoo_session()
        r = session.get(url, timeout=15)
        if r.status_code != 200:
            return False, f"Yahoo API returned HTTP {r.status_code}"
            
        chart_res = r.json().get("chart", {}).get("result")
        if not chart_res:
            return False, "Yahoo API returned empty result"
            
        data = chart_res[0]
        timestamps = data.get("timestamp")
        if not timestamps:
            return False, "No timestamp data in Yahoo response"
            
        indicators = data.get("indicators", {})
        quote_list = indicators.get("quote", [])
        if not quote_list or not quote_list[0]:
            return False, "No quote data in Yahoo response"
            
        quote = quote_list[0]
        opens = quote.get("open", [])
        highs = quote.get("high", [])
        lows = quote.get("low", [])
        closes = quote.get("close", [])
        volumes = quote.get("volume", [])
        
        # Check for adjclose
        adjclose_list = indicators.get("adjclose", [])
        if adjclose_list and adjclose_list[0] and "adjclose" in adjclose_list[0]:
            closes = adjclose_list[0]["adjclose"]
            
        df_new = pd.DataFrame({
            "ts": pd.to_datetime(timestamps, unit="s"),
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes
        })
        
        # Drop rows where critical price fields are None before forward-filling,
        # to avoid propagating previous day's prices into today's empty/placeholder candles.
        df_new = df_new.dropna(subset=["close", "open", "high", "low"], how="any")
        df_new = df_new.ffill().bfill()
        
        if start_date or end_date:
            df_new['ts'] = pd.to_datetime(df_new['ts'])
            if start_date:
                df_new = df_new[df_new['ts'].dt.date >= start_date]
            if end_date:
                df_new = df_new[df_new['ts'].dt.date <= end_date]
                
        if df_new.empty:
            return True, f"No new data on Yahoo within the filtered range ({start_date} to {end_date})"
            
        ok_sync, sync_msg = sync_df_to_supabase(upper, df_new, timeframe=timeframe)
        return ok_sync, f"OK (yahoo fallback) - {sync_msg}"
        
    except Exception as err:
        return False, f"Yahoo fallback failed: {err}"


def fetch_tradingview_prices(
    symbol: str,
    max_days: int = 365,
    timeframe: str = "1d",
    start_date: Any = None,
    end_date: Any = None
) -> Tuple[bool, str]:
    """
    Fetch historical price data from TradingView and sync to Supabase.
    Incremental: If cloud data exists, fetch only new bars.
    
    Args:
        symbol: Stock symbol with exchange suffix (e.g., "AAPL.US", "AIR.PA")
        max_days: Max historical bars to fetch if no cloud data exists
        timeframe: Data interval (e.g., "1d", "1h", "15m", "1m")
        start_date: Optional start date filter (datetime.date)
        end_date: Optional end date filter (datetime.date)
    
    Returns:
        Tuple of (success: bool, message: str)
    """
    try:
        from tvDatafeed import TvDatafeed, Interval
    except ImportError:
        return False, "tvDatafeed library not installed. Run: pip install tvDatafeed"
    
    import datetime as dt
    from api.stock_ai import _last_trading_day, sync_df_to_supabase, _get_supabase_info

    # Map string timeframe to tvDatafeed Interval
    tf_map = {
        "1m": Interval.in_1_minute,
        "1min": Interval.in_1_minute,
        "5m": Interval.in_5_minute,
        "5min": Interval.in_5_minute,
        "15m": Interval.in_15_minute,
        "15min": Interval.in_15_minute,
        "30m": Interval.in_30_minute,
        "1h": Interval.in_1_hour,
        "1hour": Interval.in_1_hour,
        "4h": Interval.in_4_hour,
        "1d": Interval.in_daily,
        "1day": Interval.in_daily,
    }
    
    tv_interval = tf_map.get(timeframe.lower(), Interval.in_daily)
    
    # Parse symbol
    upper = symbol.strip().upper()
    parts = upper.split(".")
    if len(parts) < 2:
        return False, f"Invalid symbol format: {symbol}. Expected format: SYMBOL.EXCHANGE"
    
    base_symbol = parts[0]
    exchange_suffix = parts[1]
    
    # Get tvDatafeed exchange format
    tv_exchange = get_tradingview_exchange(symbol)
    
    today = dt.date.today()
    info = _get_supabase_info(upper)
    last_date = info["last_date"]
    current_count = info["count"]
    
    # Intraday check is different, but for now we skip strict up-to-date check for intraday
    # to always allow fetching new bars.
    is_daily = timeframe.lower() in ["1d", "1day", "daily"]
    is_up_to_date = last_date and last_date >= _last_trading_day(today) if is_daily else False
    has_enough_history = current_count >= max_days
    
    if is_daily and is_up_to_date and has_enough_history:
        return True, "Already up to date and sufficient history in Cloud"
    
    # Define EODHD fallback function
    def try_eodhd_fallback() -> Tuple[bool, str]:
        api_key = os.getenv("EODHD_API_KEY")
        if not api_key:
            return False, "EODHD API key not set"
        try:
            from eodhd import APIClient
            is_daily_tf = timeframe.lower() in ["1d", "1day", "daily"]
            if is_daily_tf:
                from api.stock_ai import update_stock_data
                api_client = APIClient(api_key)
                ok_eodhd, msg_eodhd = update_stock_data(api_client, upper, source="eodhd", max_days=max_days)
                return ok_eodhd, msg_eodhd
            else:
                from api.intraday_provider import fetch_eodhd_intraday_prices
                ok_eodhd, msg_eodhd = fetch_eodhd_intraday_prices(
                    symbol=upper,
                    timeframe=timeframe,
                    start_date=start_date,
                    end_date=end_date
                )
                return ok_eodhd, msg_eodhd
        except Exception as e_err:
            return False, f"EODHD error: {e_err}"

    # Throttle slightly
    try:
        delay = float(os.getenv("TRADINGVIEW_REQUEST_DELAY", "0.3"))
        if delay > 0:
            time.sleep(delay)
    except Exception:
        pass

    try:
        # Initialize TvDatafeed
        tv = TvDatafeed()
        
        # Calculate how many bars we need
        if is_daily:
            needed_for_history = max_days + 100 if not has_enough_history else 0
            needed_for_update = (today - last_date).days + 10 if last_date else max_days + 30
            n_bars = max(needed_for_history, needed_for_update)
        else:
            if start_date:
                days_to_fetch = (today - start_date).days
                n_bars_calc = int(days_to_fetch * 20)
                n_bars = max(n_bars_calc, max_days, 500)
            else:
                # For intraday, use max_days as the bar count directly if it's high enough,
                # otherwise use a reasonable default.
                n_bars = max(max_days, 500)

        n_bars = min(5000, n_bars)

        # Normalize symbol for TradingView (remove slashes for crypto pairs)
        tv_symbol = base_symbol.replace("/", "")

        print(f"TV FETCH: {upper} | interval={timeframe} | n_bars={n_bars}")

        # Fetch historical data
        # Define Yahoo Finance fallback function inside the fetch function
        def try_yahoo_fallback() -> Tuple[bool, str]:
            return _try_yahoo_direct_fallback(upper, base_symbol, timeframe, max_days, start_date, end_date)

        # Fetch historical data
        df = None
        try:
            df = tv.get_hist(
                symbol=tv_symbol,
                exchange=tv_exchange,
                interval=tv_interval,
                n_bars=n_bars
            )
        except Exception as tv_fetch_err:
            print(f"tvDatafeed get_hist raised exception for {upper}: {tv_fetch_err}")
        
        if df is None or df.empty:
            ok_fall, msg_fall = try_yahoo_fallback()
            if ok_fall:
                return ok_fall, msg_fall
            
            # Fallback to EODHD
            ok_eod, msg_eod = try_eodhd_fallback()
            if ok_eod:
                return ok_eod, msg_eod
            
            return False, f"No data found for {symbol} on {tv_exchange} at {timeframe} (Yahoo fallback: {msg_fall} | EODHD fallback: {msg_eod})"
        
        # Prepare data
        df_new = df.reset_index()
        # TV returns 'datetime' column
        df_new = df_new.rename(columns={'datetime': 'ts', 'open': 'open', 'high': 'high', 'low': 'low', 'close': 'close', 'volume': 'volume'})
        
        # Filter by start_date and end_date if provided
        if start_date or end_date:
            df_new['ts'] = pd.to_datetime(df_new['ts'])
            if start_date:
                df_new = df_new[df_new['ts'].dt.date >= start_date]
            if end_date:
                df_new = df_new[df_new['ts'].dt.date <= end_date]
                
        if df_new.empty:
            return True, f"No new data within the filtered range ({start_date} to {end_date})"

        # Sync Directly
        ok, sync_msg = sync_df_to_supabase(upper, df_new, timeframe=timeframe)
        return ok, f"OK (tradingview) - {sync_msg}"
        
    except Exception as e:
        error_msg = str(e)
        # Fallback helper function is defined inside try, but if initialization fails:
        # we can define/call a simple fallback here too.
        try:
            ok_fall, msg_fall = _try_yahoo_direct_fallback(upper, base_symbol, timeframe, max_days, start_date, end_date)
            if ok_fall:
                return ok_fall, msg_fall
            error_msg += f" (Yahoo fallback: {msg_fall})"
        except Exception:
            pass

        # Try EODHD fallback
        try:
            ok_eod, msg_eod = try_eodhd_fallback()
            if ok_eod:
                return ok_eod, msg_eod
            error_msg += f" (EODHD fallback: {msg_eod})"
        except Exception as eod_err:
            error_msg += f" (EODHD exception: {eod_err})"

        if "symbol not found" in error_msg.lower():
            return False, f"Symbol {base_symbol} not found on {tv_exchange} ({error_msg})"
        elif "invalid exchange" in error_msg.lower():
            return False, f"Invalid exchange: {tv_exchange} ({error_msg})"
        else:
            return False, f"TradingView error: {error_msg}"



def fetch_tradingview_fundamentals_bulk(
    tickers: List[str]
) -> Dict[str, Tuple[Dict[str, Any], Dict[str, Any]]]:
    """
    Bulk fetch fundamentals from TradingView screener.
    
    Args:
        tickers: List of stock symbols with exchange suffix
    
    Returns:
        Dict mapping ticker -> (data_dict, meta_dict)
    """
    if not tickers:
        return {}
    
    try:
        from tradingview_screener import Query
        try:
            from tradingview_screener import Column
        except ImportError:
            Column = None
        try:
            from tradingview_screener import col
        except ImportError:
            col = None
    except ImportError:
        return {}
    
    # Import helper functions
    from api.stock_ai import _finite_float, sync_data_to_supabase
    
    bulk_chunk_size = int(os.getenv("TRADINGVIEW_BULK_CHUNK_SIZE", "500"))
    bulk_chunk_size = max(50, min(2000, bulk_chunk_size))
    now_ts = int(time.time())
    
    # Group by TradingView market
    market_groups: Dict[str, List[str]] = defaultdict(list)
    base_to_tickers_by_market: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    
    # Aliases for known mismatches (Local -> TradingView)
    TV_SYMBOL_ALIASES = {
        "AIND": "ADPC",  # Arab Dairy
        "AIND.EGX": "ADPC",
        "EKHOA": "EKHO", # Egyptian Kuwaiti Holding (USD/EGP variant)
        "EKHOA.EGX": "EKHO",
        "AIVCB": "AIFI", # Atlas Investment
        "AIVCB.EGX": "AIFI",
        "ODHN": "ODIN",  # Odin Investments
        "ODHN.EGX": "ODIN",
        # Add more as discovered
    }

    for sym in tickers:
        up = (sym or "").strip().upper()
        if not up:
            continue
        
        # We try TradingView for EGX symbols as fallback if Mubasher is failing
        # (TradingView has many EGX stocks now)
        
        # Check alias first
        alias_target = TV_SYMBOL_ALIASES.get(up)
        if not alias_target:
             # Try without suffix
             base_only = up.split(".")[0]
             if base_only in TV_SYMBOL_ALIASES:
                 alias_target = TV_SYMBOL_ALIASES[base_only]

        if alias_target:
             base = alias_target
             market = get_tradingview_market(up) 
        else:
             base = up.split(".")[0]
             market = get_tradingview_market(up)
             if market == "crypto":
                 base = base.replace("/", "")
        
        market_groups[market].append(base)
        
        # KEY: Map the TRADINGVIEW BASE back to the ORIGINAL FULL SYMBOL
        # So when we get result for "ACXUSDT", we store it under "ACX/USDT.BINANCE"
        base_to_tickers_by_market[market][base].append(sym)
    
    out: Dict[str, Tuple[Dict[str, Any], Dict[str, Any]]] = {}
    
    def _chunks(items: List[str], size: int) -> List[List[str]]:
        if size <= 0:
            return [items]
        return [items[i : i + size] for i in range(0, len(items), size)]
    
    def _has_core_fund_metrics(d: dict) -> bool:
        if not isinstance(d, dict):
            return False
        core = ["marketCap", "peRatio", "eps", "dividendYield", "beta", "high52", "low52"]
        for k in core:
            if d.get(k) is not None:
                return True
        return False
    
    # Fetch data for each market
    for market, bases in market_groups.items():
        uniq_bases = list(dict.fromkeys(bases))
        
        for chunk in _chunks(uniq_bases, bulk_chunk_size):
            try:
                if market == "crypto":
                    # Crypto screener has different fields
                    q = (
                        Query()
                        .set_markets(market)
                        .select(
                            "name",
                            "description",
                            "market_cap_calc", # Crypto often uses calc
                            "logoid",
                        )
                    )
                else:
                    q = (
                        Query()
                        .set_markets(market)
                        .select(
                            "name",
                            "description",
                            "market_cap_basic",
                            "price_earnings_ttm",
                            "earnings_per_share_basic_ttm",
                            "dividend_yield_recent",
                            "sector",
                            "industry",
                            "logoid",
                        )
                    )
                
                # Apply filter based on available import
                if Column is not None:
                    q = q.where(Column("name").isin(chunk))
                elif col is not None:
                    q = q.where(col("name").isin(chunk))
                else:
                    continue
                
                _, df = q.limit(len(chunk)).get_scanner_data()
                if df is None or df.empty:
                    continue
                
                # Process each row
                for _, row in df.iterrows():
                    base = str(row.get("name") or "").strip().upper()
                    if not base:
                        continue
                    
                    if market == "crypto":
                        mcap = _finite_float(row.get("market_cap_calc"))
                    else:
                        mcap = _finite_float(row.get("market_cap_basic"))
                    
                    if mcap is None:
                        mcap = _finite_float(row.get("fund_total_assets"))
                    
                    data = {
                        "marketCap": mcap,
                        "peRatio": _finite_float(row.get("price_earnings_ttm")),
                        "eps": _finite_float(row.get("earnings_per_share_basic_ttm")),
                        "dividendYield": _finite_float(row.get("dividend_yield_recent")),
                        "sector": row.get("sector"),
                        "industry": row.get("industry"),
                        "name": row.get("description") or row.get("name"),
                        "logoUrl": f"https://s3-symbol-logo.tradingview.com/{row['logoid']}.svg" if row.get("logoid") else None
                    }
                    
                    # Skip if no core metrics
                    if not _has_core_fund_metrics(data):
                        continue
                    
                    # Sync Directly for all matching symbols
                    for full_sym in base_to_tickers_by_market[market].get(base, []):
                        sync_data_to_supabase(full_sym, data)
                        out[full_sym] = (
                            data,
                            {
                                "fetchedAt": now_ts,
                                "source": "tradingview",
                                "servedFrom": "live_tradingview_bulk",
                                "market": market,
                            },
                        )
            
            except Exception as e:
                # Log error but continue with other chunks
                print(f"Error fetching TradingView fundamentals for market {market}: {e}")
                continue
    
    return out
