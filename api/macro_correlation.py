import os
import re
import json
import logging
import datetime
import urllib.request as urllib_req
import pandas as pd
import numpy as np
from bs4 import BeautifulSoup

# Setup logger
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_PATH = os.path.join(BASE_DIR, "symbols_data", "macro_history_cache.json")

def scrape_live_rates() -> dict:
    """
    Fetch live rates using FREE providers (yfinance, exchangerate-api, etc).
    Returns:
        dict: {'usd_parallel': float, 'usd_official': float, 'gold_24k': float, 'gold_21k': float}
    """
    from api.free_data_provider import fetch_live_rates_free
    
    try:
        return fetch_live_rates_free()
    except Exception as e:
        logger.warning(f"Failed to fetch live rates: {e}. Using fallback values.")
        return {
            "usd_parallel": 50.3,
            "usd_official": 49.3,
            "gold_24k": 6540.0,
            "gold_21k": 5720.0,
            "source": "fallback"
        }

def fetch_eod_data(symbol: str, from_date: str) -> list:
    """Fetches end-of-day data using FREE providers (yfinance). No API key required!"""
    from api.free_data_provider import fetch_eod_data_free
    
    try:
        return fetch_eod_data_free(symbol, period="6mo")
    except Exception as e:
        logger.error(f"Error fetching {symbol} from free providers: {e}")
        return []

def get_comi_history_from_db() -> list:
    """Retrieves CIB (COMI) stock price history from Supabase (paginated, recent data)."""
    from api.stock_ai import _init_supabase, supabase
    _init_supabase()
    if not supabase:
        return []
    try:
        all_data = []
        page_size = 1000
        offset = 0
        while True:
            res = supabase.table("stock_prices").select("date,close").eq("symbol", "COMI").gte("date", "2024-06-01").order("date", desc=False).range(offset, offset + page_size - 1).execute()
            if not res.data:
                break
            all_data.extend(res.data)
            if len(res.data) < page_size:
                break
            offset += page_size
        return all_data
    except Exception as e:
        logger.error(f"Error fetching COMI from DB: {e}")
        return []

def build_or_update_macro_history() -> list:
    """
    Builds the macro indicators historical daily dataset:
    USD Official, USD Parallel (implied CIB), Gold EGP (implied spot * CIB parallel rate).
    """
    # Try loading cache first
    cached_data = []
    # Try loading from Supabase market_cache first
    try:
        from api.stock_ai import _init_supabase, supabase
        _init_supabase()
        if supabase:
            res = supabase.table("market_cache").select("payload,computed_at").eq("cache_key", "macro_history_cache").eq("country", "Egypt").maybe_single().execute()
            if res.data and res.data.get("payload"):
                cached_data = res.data["payload"]
                computed_at = res.data.get("computed_at")
                if computed_at:
                    parsed = datetime.datetime.fromisoformat(computed_at.replace("Z", "+00:00"))
                    if parsed.tzinfo is not None:
                        parsed = parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
                    if datetime.datetime.utcnow() - parsed < datetime.timedelta(hours=3):
                        return cached_data
    except Exception as e_sb:
        logger.debug(f"Supabase macro_history_cache load failed: {e_sb}")

    if not cached_data and os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
        except Exception:
            pass
            
    # Check if local file cache is fresh (less than 3 hours old)
    is_fresh = False
    if cached_data and os.path.exists(CACHE_PATH):
        mtime = datetime.datetime.fromtimestamp(os.path.getmtime(CACHE_PATH))
        if datetime.datetime.now() - mtime < datetime.timedelta(hours=3):
            is_fresh = True
            
    if is_fresh and cached_data:
        return cached_data

    logger.info("Rebuilding macro history cache...")
    api_key = os.getenv("EODHD_API_KEY")
    from_date = "2025-01-01"
    
    # 1. USD Official History
    usdegp_path = os.path.join(BASE_DIR, "symbols_data", "usdegp_history.json")
    usd_off_data = []
    if os.path.exists(usdegp_path):
        try:
            with open(usdegp_path, "r", encoding="utf-8") as f:
                usd_off_data = json.load(f)
        except Exception:
            pass
            
    if not usd_off_data:
        usd_off_data = fetch_eod_data("USDEGP.FOREX", from_date)
        
    df_usd_off = pd.DataFrame(usd_off_data)
    if not df_usd_off.empty:
        df_usd_off["date"] = pd.to_datetime(df_usd_off["date"])
        df_usd_off.set_index("date", inplace=True)
        
    # 2. Implied USD Parallel Rate (COMI EGX / CBKD LSE GDR)
    comi_db = get_comi_history_from_db()
    df_comi = pd.DataFrame(comi_db)
    if not df_comi.empty:
        df_comi["date"] = pd.to_datetime(df_comi["date"])
        df_comi.set_index("date", inplace=True)
        
    cbkd_eod = fetch_eod_data("CBKD.LSE", from_date)
    df_cbkd = pd.DataFrame(cbkd_eod)
    if not df_cbkd.empty:
        df_cbkd["date"] = pd.to_datetime(df_cbkd["date"])
        df_cbkd.set_index("date", inplace=True)
        
    # 3. Gold Spot (XAUUSD)
    gold_eod = fetch_eod_data("XAUUSD.FOREX", from_date)
    df_gold = pd.DataFrame(gold_eod)
    if not df_gold.empty:
        df_gold["date"] = pd.to_datetime(df_gold["date"])
        df_gold.set_index("date", inplace=True)

    # Scrape live rates to append latest values
    live = scrape_live_rates()

    # Align dates and calculate parallel rate and gold EGP
    all_dates = pd.date_range(start="2025-01-01", end=datetime.date.today(), freq="D")
    df_macro = pd.DataFrame(index=all_dates)
    
    # Merge official USD
    if not df_usd_off.empty:
        df_macro = df_macro.join(df_usd_off["close"].rename("usd_official"), how="left")
    else:
        df_macro["usd_official"] = 49.3 # Default fallback
        
    # Calculate Parallel
    if not df_comi.empty and not df_cbkd.empty:
        df_joined = df_comi["close"].rename("comi").to_frame().join(df_cbkd["close"].rename("cbkd"), how="outer")
        # Forward fill to handle exchange holiday mismatch
        df_joined.ffill(inplace=True)
        df_joined["usd_parallel"] = df_joined["comi"] / df_joined["cbkd"]
        df_macro = df_macro.join(df_joined["usd_parallel"], how="left")
    else:
        df_macro["usd_parallel"] = np.nan
        
    # Forward fill parallel and official rates
    df_macro["usd_official"] = df_macro["usd_official"].ffill().bfill()
    df_macro["usd_parallel"] = df_macro["usd_parallel"].ffill()
    
    # Fallback parallel to official * 1.05 if missing
    df_macro["usd_parallel"] = df_macro["usd_parallel"].fillna(df_macro["usd_official"] * 1.05)
    
    # Gold EGP calculation (USD price of gold per gram = xau_spot / 31.1035)
    if not df_gold.empty:
        df_macro = df_macro.join(df_gold["close"].rename("gold_spot"), how="left")
        df_macro["gold_spot"] = df_macro["gold_spot"].ffill()
        df_macro["gold_24k"] = (df_macro["gold_spot"] / 31.1035) * df_macro["usd_parallel"]
    else:
        df_macro["gold_24k"] = 6500.0 # Default fallback
        
    df_macro["gold_24k"] = df_macro["gold_24k"].ffill().bfill()
    
    # Append/Overwrite today with scraped live rates to ensure real-time accuracy
    today_dt = pd.to_datetime(datetime.date.today().strftime("%Y-%m-%d"))
    df_macro.loc[today_dt, "usd_parallel"] = live["usd_parallel"]
    df_macro.loc[today_dt, "usd_official"] = live["usd_official"]
    df_macro.loc[today_dt, "gold_24k"] = live["gold_24k"]
    
    # Interpolate intermediate gaps
    df_macro = df_macro.interpolate(method="linear").ffill().bfill()
    
    # Convert to output structure
    df_macro.reset_index(inplace=True)
    df_macro.rename(columns={"index": "date"}, inplace=True)
    df_macro["date"] = df_macro["date"].dt.strftime("%Y-%m-%d")
    
    records = df_macro[["date", "usd_official", "usd_parallel", "gold_24k"]].to_dict(orient="records")
    
    # Save cache
    try:
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        # Validate records before saving
        for record in records:
            if not all(k in record for k in ["date", "usd_official", "usd_parallel", "gold_24k"]):
                logger.warning(f"Skipping invalid record: {record}")
                continue
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(records, f, indent=2)
        logger.info(f"Saved {len(records)} macro daily records to cache.")

        # Save to market_cache table in Supabase
        try:
            from api.stock_ai import _init_supabase, supabase
            _init_supabase()
            if supabase:
                data = {
                    "cache_key": "macro_history_cache",
                    "country": "Egypt",
                    "payload": records,
                    "computed_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                }
                supabase.table("market_cache").upsert(data).execute()
                logger.info("Successfully upserted macro_history_cache to Supabase.")
        except Exception as se_cache:
            logger.error(f"Failed to upsert macro_history_cache to Supabase: {se_cache}")

    except Exception as e:
        logger.error(f"Error saving macro history cache: {e}")
        
    return records

def get_stock_history_from_db(symbol: str) -> list:
    """Fetches historical prices of a stock from Supabase (paginated, recent data)."""
    from api.stock_ai import _init_supabase, supabase
    _init_supabase()
    if not supabase:
        return []
    try:
        all_data = []
        page_size = 1000
        offset = 0
        while True:
            res = supabase.table("stock_prices").select("date,close").eq("symbol", symbol).gte("date", "2024-06-01").order("date", desc=False).range(offset, offset + page_size - 1).execute()
            if not res.data:
                break
            all_data.extend(res.data)
            if len(res.data) < page_size:
                break
            offset += page_size
        return all_data
    except Exception as e:
        logger.error(f"Error fetching stock {symbol} history: {e}")
        return []

def calculate_macro_correlation(symbol: str) -> dict:
    """
    Computes Pearson correlation for a stock symbol vs USD and Gold
    over the last 30 trading days of overlap.
    """
    # 1. Load macro indicators
    macro_data = build_or_update_macro_history()
    df_macro = pd.DataFrame(macro_data)
    if df_macro.empty:
        return {}
    df_macro["date"] = pd.to_datetime(df_macro["date"])
    df_macro.set_index("date", inplace=True)
    
    # 2. Load stock prices
    stock_data = get_stock_history_from_db(symbol)
    df_stock = pd.DataFrame(stock_data)
    if df_stock.empty or len(df_stock) < 10:
        return {
            "symbol": symbol,
            "corr_usd_official": 0.0,
            "corr_usd_parallel": 0.0,
            "corr_gold": 0.0,
            "rating": "Low Protection",
            "chart_data": [],
            "insights": "No sufficient historical data to compute macro correlation."
        }
        
    df_stock["date"] = pd.to_datetime(df_stock["date"])
    df_stock.set_index("date", inplace=True)
    
    # 3. Join datasets
    df_joined = df_stock["close"].rename("stock").to_frame().join(df_macro, how="inner")
    
    # Forward fill any gaps and then backward fill remaining NaNs
    for col in ["usd_official", "usd_parallel", "gold_24k"]:
        if col in df_joined.columns:
            df_joined[col] = df_joined[col].ffill().bfill()
    
    # Get last 30 trading days
    df_subset = df_joined.tail(30).copy()
    
    # Final validation: if any column still has NaN, fill with forward fill one more time
    df_subset = df_subset.ffill().bfill()
    
    # Ensure all values are numeric and finite
    for col in ["stock", "usd_official", "usd_parallel", "gold_24k"]:
        if col in df_subset.columns:
            df_subset[col] = pd.to_numeric(df_subset[col], errors="coerce")
            # Replace infinite values with NaN and fill
            df_subset[col] = df_subset[col].replace([np.inf, -np.inf], np.nan)
            df_subset[col] = df_subset[col].ffill().bfill()
    
    if len(df_subset) < 5:
        return {
            "symbol": symbol,
            "corr_usd_official": 0.0,
            "corr_usd_parallel": 0.0,
            "corr_gold": 0.0,
            "rating": "Low Protection",
            "chart_data": [],
            "insights": "Insufficient overlap dates between stock and macro indicators."
        }
        
    # Calculate price correlations with NaN handling
    try:
        corr_usd_off = float(df_subset["stock"].corr(df_subset["usd_official"]))
        corr_usd_par = float(df_subset["stock"].corr(df_subset["usd_parallel"]))
        corr_gold = float(df_subset["stock"].corr(df_subset["gold_24k"]))
    except (ValueError, TypeError):
        corr_usd_off = corr_usd_par = corr_gold = 0.0
    
    # Clean NaNs and infinite values
    corr_usd_off = 0.0 if (np.isnan(corr_usd_off) or np.isinf(corr_usd_off)) else corr_usd_off
    corr_usd_par = 0.0 if (np.isnan(corr_usd_par) or np.isinf(corr_usd_par)) else corr_usd_par
    corr_gold = 0.0 if (np.isnan(corr_gold) or np.isinf(corr_gold)) else corr_gold
    
    # Clamp correlations to -1 to 1 range (in case of numerical errors)
    corr_usd_off = np.clip(corr_usd_off, -1.0, 1.0)
    corr_usd_par = np.clip(corr_usd_par, -1.0, 1.0)
    corr_gold = np.clip(corr_gold, -1.0, 1.0)
    
    # Normalize/Scale prices for overlay charting (0 to 100 normalization)
    # Using percentage change from first value to handle different price ranges better
    def normalize_series(s):
        if len(s) == 0 or s.isna().all():
            return s * 0.0 + 50.0
        first_val = s.iloc[0]
        if pd.isna(first_val) or first_val == 0:
            # Fallback to min-max if first value is invalid
            s_min = s.min()
            s_max = s.max()
            if s_max == s_min:
                return s * 0.0 + 50.0
            return ((s - s_min) / (s_max - s_min)) * 100.0
        # Percentage change normalization: base at 50, up/down from there
        pct_change = ((s - first_val) / first_val) * 100.0
        # Clip to -50 to +50 range and shift to 0-100 scale
        return np.clip(pct_change, -50, 50) + 50.0
        
    df_subset["stock_norm"] = normalize_series(df_subset["stock"].astype(float))
    df_subset["usd_parallel_norm"] = normalize_series(df_subset["usd_parallel"].astype(float))
    df_subset["gold_norm"] = normalize_series(df_subset["gold_24k"].astype(float))
    
    # Prepare chart rows
    df_subset.reset_index(inplace=True)
    df_subset["date"] = df_subset["date"].dt.strftime("%Y-%m-%d")
    
    # Ensure all numeric columns are properly formatted
    for col in ["stock", "usd_parallel", "gold_24k", "stock_norm", "usd_parallel_norm", "gold_norm"]:
        if col in df_subset.columns:
            df_subset[col] = pd.to_numeric(df_subset[col], errors="coerce")
            # Replace any infinite or missing values
            df_subset[col] = df_subset[col].replace([np.inf, -np.inf], np.nan).fillna(0)
    
    chart_data = df_subset[["date", "stock", "usd_parallel", "gold_24k", "stock_norm", "usd_parallel_norm", "gold_norm"]].to_dict(orient="records")
    
    # Determine Rating
    max_corr = max(corr_usd_off, corr_usd_par, corr_gold)
    if max_corr >= 0.65:
        rating = "High Protection"
    elif max_corr >= 0.30:
        rating = "Moderate Protection"
    else:
        rating = "Low Protection"
        
    # Qualitative insights generation
    insight_templates = {
        "High Protection": (
            f"السهم {symbol} يظهر ارتباطاً طردياً قوياً جداً (أكثر من 65%) مع حركة الدولار والذهب في السوق الموازية. "
            "يعني ذلك أن هذا السهم يعتبر ملاذاً آمناً وأداة تحوط ممتازة لحماية رأس المال من التضخم وتآكل العملة المحلية، "
            "حيث يتم تسعير أصول الشركة أو أرباحها بشكل مباشر تماشياً مع سعر الصرف الموازي."
        ),
        "Moderate Protection": (
            f"سهم {symbol} يتحرك بشكل إيجابي معتدل تزامناً مع ارتفاع العملة والذهب. "
            "يوفر السهم حماية جزئية لرأس المال ضد مخاطر انخفاض الجنيه، لكن تحركاته تخضع أيضاً لعوامل فنية وأرباح تشغيلية خاصة بالشركة."
        ),
        "Low Protection": (
            f"سهم {symbol} لديه ارتباط ضعيف أو غير ملموس مع حركة الدولار أو الذهب. "
            "لا يُنصح بالاعتماد على هذا السهم كأداة تحوط أساسية ضد التضخم؛ حركته تعتمد بشكل كلي على التحليل الفني والسيولة الداخلية للسهم."
        )
    }
    
    insights = insight_templates[rating]
    
    return {
        "symbol": symbol,
        "corr_usd_official": round(corr_usd_off, 2),
        "corr_usd_parallel": round(corr_usd_par, 2),
        "corr_gold": round(corr_gold, 2),
        "rating": rating,
        "chart_data": chart_data,
        "insights": insights
    }


SCAN_CACHE_PATH = os.path.join(BASE_DIR, "symbols_data", "hedge_scan_cache.json")
SCAN_CACHE_TTL = 6 * 3600  # 6 hours


def scan_macro_correlation(force_refresh: bool = False) -> dict:
    """
    Batch-computes the macro hedge rating for all EGX symbols.
    Results are cached to SCAN_CACHE_PATH with a SCAN_CACHE_TTL lifetime.
    Returns: {"updated_at": str, "symbols": [{symbol, corr_usd_official, corr_usd_parallel, corr_gold, rating}, ...]}
    """
    # Serve from Supabase cache when fresh
    if not force_refresh:
        try:
            from api.stock_ai import _init_supabase, supabase
            _init_supabase()
            if supabase:
                res = supabase.table("market_cache").select("payload,computed_at").eq("cache_key", "hedge_scan_cache").eq("country", "Egypt").maybe_single().execute()
                if res.data and res.data.get("payload"):
                    cached = res.data["payload"]
                    computed_at = res.data.get("computed_at")
                    if computed_at:
                        parsed = datetime.datetime.fromisoformat(computed_at.replace("Z", "+00:00"))
                        if parsed.tzinfo is not None:
                            parsed = parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
                        if datetime.datetime.utcnow() - parsed < datetime.timedelta(seconds=SCAN_CACHE_TTL) and cached.get("symbols"):
                            return cached
        except Exception as e_sb:
            logger.debug(f"Supabase hedge_scan_cache load failed: {e_sb}")

    # Fallback to local file cache
    if not force_refresh and os.path.exists(SCAN_CACHE_PATH):
        try:
            with open(SCAN_CACHE_PATH, "r", encoding="utf-8") as f:
                cached = json.load(f)
            ts = cached.get("updated_at_ts", 0)
            if (datetime.datetime.now().timestamp() - ts) < SCAN_CACHE_TTL and cached.get("symbols"):
                return cached
        except Exception:
            pass

    # Load all EGX symbols
    try:
        from api.symbols_local import load_symbols_for_country
        symbols_data = load_symbols_for_country("Egypt")
    except Exception:
        symbols_data = []

    syms = sorted(set(
        str(row.get("Symbol", row.get("symbol", row.get("Code", "")))).strip()
        for row in symbols_data
        if str(row.get("Symbol", row.get("symbol", row.get("Code", "")))).strip()
    ))
    syms = [s for s in syms if s and s != "COMI"]

    results = []
    for sym in syms:
        try:
            r = calculate_macro_correlation(sym)
            if not r or not r.get("symbol"):
                continue
            results.append({
                "symbol": r["symbol"],
                "corr_usd_official": r.get("corr_usd_official", 0.0),
                "corr_usd_parallel": r.get("corr_usd_parallel", 0.0),
                "corr_gold": r.get("corr_gold", 0.0),
                "rating": r.get("rating", "Low Protection"),
            })
        except Exception as e:
            logger.error(f"scan_macro_correlation error for {sym}: {e}")
            continue

    # Sort by strongest hedge (max correlation) descending
    results.sort(key=lambda x: max(x["corr_usd_official"], x["corr_usd_parallel"], x["corr_gold"]), reverse=True)

    payload = {
        "updated_at": datetime.datetime.now().isoformat(),
        "updated_at_ts": datetime.datetime.now().timestamp(),
        "symbols": results,
    }

    try:
        os.makedirs(os.path.dirname(SCAN_CACHE_PATH), exist_ok=True)
        with open(SCAN_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)

        # Save to market_cache table in Supabase
        try:
            from api.stock_ai import _init_supabase, supabase
            _init_supabase()
            if supabase:
                data = {
                    "cache_key": "hedge_scan_cache",
                    "country": "Egypt",
                    "payload": payload,
                    "computed_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                }
                supabase.table("market_cache").upsert(data).execute()
                logger.info("Successfully upserted hedge_scan_cache to Supabase.")
        except Exception as se_cache:
            logger.error(f"Failed to upsert hedge_scan_cache to Supabase: {se_cache}")

    except Exception as e:
        logger.error(f"Failed to write hedge scan cache: {e}")

    return payload
