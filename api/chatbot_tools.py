"""
Chatbot Tools for Function Calling
Provides structured data retrieval tools to prevent LLM hallucination.

Architecture:
    User Query → Intent Parser → Tool Executor → Analysis Engine → Validator → Response
"""

from typing import List, Dict, Optional, Literal
from datetime import datetime, timedelta, time
import pytz
from api.stock_ai import _init_supabase, supabase
from api.opportunity_analyzer import OpportunityAnalyzer


def is_market_open(now=None) -> bool:
    """
    Check if the Egyptian stock market (EGX) is currently open.
    Market hours: 10:00 AM - 2:30 PM Cairo time, Sunday-Thursday.
    
    Note: Python weekday() is Monday=0 ... Friday=4, Saturday=5, Sunday=6.
    The EGX trading week is Sunday-Thursday (weekend = Friday & Saturday).
    """
    try:
        cairo_tz = pytz.timezone('Africa/Cairo')
        now = now or datetime.now(cairo_tz)
        if now.tzinfo is None:
            now = cairo_tz.localize(now)
        
        # Weekend in Egypt: Friday (4) and Saturday (5)
        if now.weekday() in (4, 5):
            return False
        
        # Market hours: 10:00 - 14:30
        market_open = time(10, 0)
        market_close = time(14, 30)
        current_time = now.time()
        
        return market_open <= current_time <= market_close
    except Exception:
        # Fallback: assume market is closed if timezone check fails
        return False


def _last_completed_session_date(now) -> Optional[datetime]:
    """
    Date of the most recent COMPLETED EGX session (Sunday-Thursday).
    Python weekday(): Monday=0 ... Friday=4, Saturday=5, Sunday=6.
    - On a trading day after 14:30 Cairo → today
    - Otherwise → the previous non-Friday/Saturday date
    """
    try:
        d = now.date()
        if d.weekday() not in (4, 5) and now.time() > time(14, 30):
            return d
        d = d - timedelta(days=1)
        while d.weekday() in (4, 5):
            d = d - timedelta(days=1)
        return d
    except Exception:
        return None


def should_use_realtime_data(now=None) -> bool:
    """
    Determine whether real-time API data should be preferred over Supabase.
    
    Logic (EGX week = Sunday-Thursday, Python weekday(): Friday=4, Saturday=5):
    - Friday/Saturday: Supabase (no session, no sync will run)
    - During market hours (10:00-14:30 Sun-Thu): real-time
    - Sync window (14:30-18:00): real-time until Supabase sync completes
    - After 18:00: Supabase
    """
    try:
        cairo_tz = pytz.timezone('Africa/Cairo')
        now = now or datetime.now(cairo_tz)
        if now.tzinfo is None:
            now = cairo_tz.localize(now)
        
        # No real-time preference on weekends (Friday/Saturday)
        if now.weekday() in (4, 5):
            return False
        
        current_time = now.time()
        
        # Market hours: 10:00 - 14:30
        market_open = time(10, 0)
        market_close = time(14, 30)
        
        # Gap period: 14:30 - 18:00 (use real-time during sync window)
        sync_window_end = time(18, 0)
        
        if market_open <= current_time <= market_close:
            return True  # Market hours: use real-time
        elif market_close < current_time <= sync_window_end:
            return True  # Sync window: use real-time until Supabase is updated
        else:
            return False  # After sync window: use Supabase
    except Exception:
        # Fallback: use Supabase if check fails
        return False


def check_supabase_data_freshness() -> bool:
    """
    Check if Supabase daily price data covers the last completed EGX session.
    
    The daily sync job (daily_bot_run) upserts rows into `stock_prices` keyed by
    (symbol, exchange, date). Data is considered fresh when the newest stored
    `date` matches (or exceeds) the most recent completed EGX session date.
    """
    try:
        if not supabase:
            return False
        
        response = supabase.table("stock_prices").select(
            "date"
        ).eq("exchange", "EGX").order("date", desc=True).limit(1).execute()
        
        if not (response.data and response.data[0].get("date")):
            return False
        
        latest_date = str(response.data[0]["date"])[:10]
        now_cairo = datetime.now(pytz.timezone('Africa/Cairo'))
        expected = _last_completed_session_date(now_cairo)
        if expected is None:
            return False
        
        return latest_date >= expected.isoformat()
    except Exception as e:
        print(f"Error checking Supabase freshness: {e}")
        return False


def _compute_technicals_from_ohlcv(records: List[Dict]) -> Optional[Dict]:
    """
    Compute technical indicators from daily OHLCV records
    (as returned by api.free_data_provider.fetch_eod_data_free).
    
    Returns close/change_pct/RSI-14/MACD/volume_ratio/support/resistance
    plus a volume-weighted accumulation/distribution heuristic, or None
    when the records are insufficient.
    """
    if not records or len(records) < 2:
        return None
    
    try:
        closes = [float(r.get("close") or 0) for r in records]
        lows = [float(r.get("low") or r.get("close") or 0) for r in records]
        highs = [float(r.get("high") or r.get("close") or 0) for r in records]
        vols = [float(r.get("volume") or 0) for r in records]
        
        if any(c <= 0 for c in closes):
            return None
        
        latest = records[-1]
        close = closes[-1]
        prev = closes[-2]
        change_pct = ((close - prev) / prev * 100) if prev > 0 else None
        
        # RSI-14 (Wilder smoothing)
        rsi = None
        if len(closes) >= 15:
            gains, losses = [], []
            for i in range(1, len(closes)):
                ch = closes[i] - closes[i - 1]
                gains.append(max(ch, 0.0))
                losses.append(max(-ch, 0.0))
            avg_gain = sum(gains[:14]) / 14.0
            avg_loss = sum(losses[:14]) / 14.0
            for i in range(14, len(gains)):
                avg_gain = (avg_gain * 13 + gains[i]) / 14.0
                avg_loss = (avg_loss * 13 + losses[i]) / 14.0
            if avg_loss > 0:
                rsi = round(100 - 100 / (1 + avg_gain / avg_loss), 2)
            else:
                rsi = 100.0
        
        # MACD (12/26/9)
        macd = None
        if len(closes) >= 35:
            def _ema(values, period):
                k = 2.0 / (period + 1)
                out = [values[0]]
                for v in values[1:]:
                    out.append(v * k + out[-1] * (1 - k))
                return out
            
            ema12 = _ema(closes, 12)
            ema26 = _ema(closes, 26)
            macd_line = [a - b for a, b in zip(ema12, ema26)]
            signal_line = _ema(macd_line, 9)
            macd = round(macd_line[-1], 6)
        
        # Volume ratio vs 20-session average
        volume_ratio = None
        if len(vols) >= 21:
            base = [v for v in vols[-21:-1] if v > 0]
            if base and sum(base) > 0:
                avg_vol = sum(base) / len(base)
                if avg_vol > 0 and vols[-1] > 0:
                    volume_ratio = round(vols[-1] / avg_vol, 2)
        
        # Support / resistance from the last 20 sessions
        window_lows = [v for v in lows[-20:] if v > 0]
        window_highs = [v for v in highs[-20:] if v > 0]
        support = min(window_lows) if window_lows else None
        resistance = max(window_highs) if window_highs else None
        
        # Volume-weighted accumulation/distribution heuristic (last 10 sessions)
        acc_score = None
        dist_score = None
        recent = records[-10:]
        up_vol = 0.0
        down_vol = 0.0
        for i in range(1, len(recent)):
            v = float(recent[i].get("volume") or 0)
            c_cur = float(recent[i].get("close") or 0)
            c_prev = float(recent[i - 1].get("close") or 0)
            if c_cur <= 0 or c_prev <= 0:
                continue
            if c_cur >= c_prev:
                up_vol += v
            else:
                down_vol += v
        total_vol = up_vol + down_vol
        if total_vol > 0:
            acc_score = round(50 + 50 * (up_vol - down_vol) / total_vol, 1)
            dist_score = round(50 + 50 * (down_vol - up_vol) / total_vol, 1)
        
        return {
            "price": close,
            "close_price": close,
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
            "rsi": rsi,
            "macd": macd,
            "volume_ratio": volume_ratio,
            "support": support,
            "resistance": resistance,
            "accumulation_score": acc_score,
            "distribution_score": dist_score,
            "date": str(latest.get("date") or datetime.now().strftime("%Y-%m-%d"))[:10],
            "exchange": "EGX",
        }
    except Exception as e:
        print(f"Technical computation failed: {e}")
        return None


def _fetch_supabase_stock_detail(symbol: str) -> Optional[Dict]:
    """
    Build a full stock snapshot from Supabase:
    stock_prices (latest close + support/resistance window) +
    stock_scans_summary (Wyckoff acc/dist scores) + stocks (display name).
    """
    try:
        if not supabase:
            return None
        
        sym = symbol.upper()
        prices = supabase.table("stock_prices").select(
            "symbol, date, close, high, low"
        ).eq("exchange", "EGX").eq("symbol", sym).order(
            "date", desc=True
        ).limit(60).execute()
        rows = prices.data or []
        if not rows:
            return None
        
        latest = rows[0]
        try:
            close = float(latest["close"])
        except (TypeError, ValueError):
            return None
        
        closes = [float(r["close"]) for r in rows if r.get("close")]
        window_lows = [float(r["low"]) for r in rows[:20] if r.get("low")]
        window_highs = [float(r["high"]) for r in rows[:20] if r.get("high")]
        
        prev_close = closes[1] if len(closes) > 1 else None
        change_pct = None
        if prev_close:
            change_pct = round((close - prev_close) / prev_close * 100, 2)
        
        scans = supabase.table("stock_scans_summary").select(
            "scan_date, acc_score, dist_score, vol_ratio, rsi_14, "
            "macd_signal, change_pct, signal, wyckoff_phase"
        ).eq("symbol", sym).order("scan_date", desc=True).limit(1).execute()
        scan = (scans.data or [{}])[0]
        
        stock_info = supabase.table("stocks").select(
            "symbol, name, name_ar, exchange"
        ).eq("symbol", sym).limit(1).execute()
        info = (stock_info.data or [{}])[0]
        
        if change_pct is None and isinstance(scan.get("change_pct"), (int, float)):
            change_pct = round(float(scan["change_pct"]), 2)
        
        return {
            "symbol": sym,
            "name": info.get("name_ar") or info.get("name") or sym,
            "exchange": info.get("exchange") or "EGX",
            "price": close,
            "close_price": close,
            "change_pct": change_pct,
            "rsi": scan.get("rsi_14"),
            "macd": scan.get("macd_signal"),
            "volume_ratio": scan.get("vol_ratio"),
            "accumulation_score": scan.get("acc_score"),
            "distribution_score": scan.get("dist_score"),
            "wyckoff_phase": scan.get("wyckoff_phase"),
            "support": min(window_lows) if window_lows else None,
            "resistance": max(window_highs) if window_highs else None,
            "date": str(latest.get("date"))[:10],
        }
    except Exception as e:
        print(f"Supabase stock detail failed for {symbol}: {e}")
        return None


def _fetch_supabase_market_snapshot(max_symbols: int = 200) -> tuple:
    """
    Latest market-wide snapshot from Supabase:
    stock_scans_summary (Wyckoff scores, newest scan_date) joined with
    stock_prices (newest date closes).
    
    Returns (rows, snapshot_date).
    """
    try:
        if not supabase:
            return [], None
        
        scans = supabase.table("stock_scans_summary").select(
            "symbol, scan_date, acc_score, dist_score, vol_ratio, "
            "rsi_14, macd_signal, change_pct"
        ).order("scan_date", desc=True).limit(max_symbols * 2).execute()
        if not scans.data:
            return [], None
        
        latest_scan_date = scans.data[0].get("scan_date")
        scan_by_symbol = {}
        for row in scans.data:
            if row.get("scan_date") != latest_scan_date:
                continue
            sym = str(row.get("symbol", "")).upper()
            if sym:
                scan_by_symbol[sym] = row
        
        prices = supabase.table("stock_prices").select(
            "symbol, close, date"
        ).eq("exchange", "EGX").order(
            "date", desc=True
        ).limit(max_symbols * 2).execute()
        price_rows = prices.data or []
        latest_price_date = price_rows[0].get("date") if price_rows else None
        price_by_symbol = {}
        for row in price_rows:
            if row.get("date") != latest_price_date:
                continue
            sym = str(row.get("symbol", "")).upper()
            if sym:
                price_by_symbol[sym] = row
        
        rows = []
        for sym, scan in scan_by_symbol.items():
            price_row = price_by_symbol.get(sym, {})
            close = price_row.get("close")
            if close is None:
                continue
            rows.append({
                "symbol": sym,
                "price": close,
                "close_price": close,
                "rsi": scan.get("rsi_14"),
                "macd": scan.get("macd_signal"),
                "volume_ratio": scan.get("vol_ratio"),
                "accumulation_score": scan.get("acc_score"),
                "distribution_score": scan.get("dist_score"),
                "change_pct": scan.get("change_pct"),
                "support": None,
                "resistance": None,
                "date": str(latest_price_date or latest_scan_date)[:10],
                "exchange": "EGX",
            })
        
        return rows, str(latest_price_date or latest_scan_date)[:10]
    except Exception as e:
        print(f"Supabase market snapshot failed: {e}")
        return [], None


def _resolve_data_source_mode() -> str:
    """
    Decide the data source mode for chatbot stock tools.
    
    - 'realtime': during the live EGX session (always real-time, even if a
      manual sync marked the DB fresh), or during the post-close sync window
      while Supabase still lacks the last session's data.
    - 'supabase': outside market hours once Supabase data is complete
      (or on weekends / after the sync window).
    """
    if is_market_open():
        return "realtime"
    if should_use_realtime_data() and not check_supabase_data_freshness():
        return "realtime"
    return "supabase"


def parse_user_intent(user_query: str, conversation_history: list = None) -> Dict:
    """
    Parse user intent WITHOUT analyzing the stock.
    Returns structured intent only.
    
    Examples:
    - "تحليل GDWA" → {"intent": "stock_analysis", "ticker": "GDWA"}
    - "أفضل سهم؟" → {"intent": "screening", "criteria": "weekly_opportunity"}
    - "مقارنة COMI و EAST" → {"intent": "comparison", "tickers": ["COMI", "EAST"]}
    - "المطاحن و الاسكندريه" → {"intent": "comparison", "tickers": ["SAOG", "ALEX"]}
    - "هل النيل كويس؟" → {"intent": "stock_analysis", "ticker": "NILE"}
    - "عندي CPME من 10 جنيه" → {"intent": "sell_decision", "tickers": ["CPME"], "entry_prices": [10]}
    """
    query_lower = user_query.lower()
    
    # Map Arabic company names to symbols (expanded with partial matches)
    arabic_name_map = {
        "المطاحن": "SAOG",
        "الاسكندريه": "ALEX",
        "النيل": "NILE",
        "النيل للادوية": "NILE",
        "راية": "RAYA",
        "جلاسكو": "GLCO",
        "الكا": "ELKA",
        "بيوك": "BIOC",
        "فارم كير": "FERC",
        "فيرك": "FERC",
        "فيركيم": "FERC",
        "فركيم": "FERC",
        "فرك": "FERC",
        "فركم": "FERC",
        "سي اى بى": "CIB",
        "سيب": "CIB",
        "المصرية": "COMI",
        "كومي": "COMI",
        "شرق": "EAST",
        "ايست": "EAST",
    }
    
    # Extract ticker symbols (English)
    import re
    tickers = re.findall(r'\b[A-Z]{2,6}\b', user_query.upper())
    tickers = [t for t in tickers if t not in ["EGX", "USD", "RSI", "MACD", "EGP"]]
    
    # Look for Arabic company names
    for arabic_name, symbol in arabic_name_map.items():
        if arabic_name in query_lower:
            if symbol not in tickers:
                tickers.append(symbol)
    
    # Remove duplicates and sort
    tickers = list(set(tickers))
    
    # Determine intent with improved pattern matching
    
    # 0. Check for Telegram channel link request (highest priority — must run
    # before ticker extraction so words like "LINK" are not treated as symbols)
    telegram_keywords = ["تليجرام", "قناة", "channel", "telegram", "رابط", "تابعنا"]
    if any(word in query_lower for word in telegram_keywords):
        return {
            "intent": "telegram_link",
            "query": user_query
        }
    
    # 1. Check for analytics/performance queries (high priority)
    analytics_keywords = ["أداء", "نجاح", "فشل", "إحصائيات", "win rate", "success rate", "performance", "stats", "winrate"]
    if any(word in query_lower for word in analytics_keywords):
        return {
            "intent": "analytics",
            "query": user_query
        }
    
    # 2. Check for portfolio/advice queries (highest priority for these keywords)
    if any(word in query_lower for word in ["محفظ", "portfolio", "نصائح", "advice", "جميع اسهم"]):
        return {
            "intent": "portfolio_analysis",
            "query": user_query
        }
    
    # 1.5. Check for "buy which one" - needs context from previous screening
    buy_which_keywords = ["اشتري مين", "اشترى مين", "buy which", "which one", "أيهم", "ايهم", "مين أحسن", "مين الافضل"]
    if any(word in query_lower for word in buy_which_keywords):
        # Try to extract tickers from conversation history
        context_tickers = []
        if conversation_history:
            # Look for tickers in last 2 messages
            for msg in conversation_history[-2:]:
                content = msg.get("content", "") if isinstance(msg, dict) else str(msg)
                found_tickers = re.findall(r'\b[A-Z]{2,6}\b', content.upper())
                context_tickers.extend([t for t in found_tickers if t not in ["EGX", "USD", "RSI", "MACD", "EGP"]])
        
        # Remove duplicates, keep order
        seen = set()
        context_tickers = [x for x in context_tickers if not (x in seen or seen.add(x))]
        
        if len(context_tickers) >= 2:
            return {
                "intent": "comparison",
                "tickers": context_tickers[:6],  # Max 6 stocks
                "required_data": ["price", "rsi", "macd", "volume_ratio", "accumulation_score"],
                "context_aware": True
            }
        else:
            # Fallback to screening if no context
            return {
                "intent": "screening",
                "criteria": "weekly_opportunity",
                "required_data": ["all"]
            }
    
    # 2. Check for sell/exit decision (expanded patterns)
    sell_keywords = ["بيع", "ابيع", "ينزل", "sell", "exit", "خروج", "اخرج", "عندي", "شاري", "اطلع"]
    if any(word in query_lower for word in sell_keywords):
        # Try to extract entry price with improved pattern
        price_pattern = r'(\d+\.?\d*)\s*(?:جنيه|ج\.م|LE|EGP)?'
        prices = re.findall(price_pattern, user_query)
        
        return {
            "intent": "sell_decision",
            "tickers": tickers if tickers else [],
            "entry_prices": [float(p) for p in prices] if prices else [],
            "query": user_query
        }
    
    # 3. Check for market overview (expanded keywords)
    market_keywords = ["egx", "مؤشر", "دولار", "usd", "كام الدولار", "توقعات", "توقعاتك", "السوق"]
    if any(word in query_lower for word in market_keywords):
        return {
            "intent": "market_overview",
            "required_data": ["indices"]
        }
    
    # 4. Check for multiple comparisons
    if len(tickers) > 1:
        return {
            "intent": "comparison",
            "tickers": tickers,
            "required_data": ["price", "rsi", "macd", "volume_ratio", "accumulation_score"]
        }
    
    # 5. Check for single stock analysis (expanded patterns)
    if tickers and len(tickers) == 1:
        # More colloquial patterns
        analysis_keywords = [
            "تحليل", "وضع", "رأي", "رائيك", "سيولة", "analysis",
            "كويس", "حلو", "هل", "ايه", "إيه", "شايف", "نظرتك", "سهم"
        ]
        if any(word in query_lower for word in analysis_keywords):
            return {
                "intent": "stock_analysis",
                "ticker": tickers[0],
                "required_data": ["price", "rsi", "macd", "volume_ratio", "support", "resistance",
                                 "accumulation_score", "distribution_score"]
            }
    
    # 6. Check for screening intents
    # Weekly opportunities - but NOT if there's a specific ticker
    opportunity_keywords = ["أفضل", "احسن", "فرص", "متوقع", "يرتفع", "forecast"]
    if any(word in query_lower for word in opportunity_keywords) and not tickers:
        return {
            "intent": "screening",
            "criteria": "weekly_opportunity",
            "required_data": ["all"]
        }
    
    # If there's a ticker but no clear intent, default to stock analysis
    if tickers and len(tickers) == 1:
        return {
            "intent": "stock_analysis",
            "ticker": tickers[0],
            "required_data": ["price", "rsi", "macd", "volume_ratio", "support", "resistance",
                             "accumulation_score", "distribution_score"]
        }
    
    # Below midpoint with accumulation
    accumulation_keywords = ["تحت", "القيمة", "رخيص", "تجميع", "accumulation", "نصحني", "نصح"]
    if any(word in query_lower for word in accumulation_keywords):
        return {
            "intent": "screening",
            "criteria": "below_midpoint_accumulation",
            "required_data": ["all"]
        }
    
    # Distribution/selling pressure
    distribution_keywords = ["تصريف", "ضغط", "distribution"]
    if any(word in query_lower for word in distribution_keywords):
        return {
            "intent": "screening",
            "criteria": "distribution",
            "required_data": ["all"]
        }
    
    # Sector/category screening
    sector_keywords = ["قطاع", "sector", "مجال"]
    if any(word in query_lower for word in sector_keywords):
        return {
            "intent": "screening",
            "criteria": "sector_analysis",
            "required_data": ["all"]
        }
    
    # 8. Default to general for unclear intents
    return {
        "intent": "general",
        "query": user_query
    }


class ChatbotTools:
    """
    Function calling tools for the chatbot.
    Each tool returns structured data that the LLM MUST use without modification.
    """
    
    def __init__(self):
        _init_supabase()
        self.analyzer = OpportunityAnalyzer()
    
    def get_weekly_opportunities(
        self, 
        top_n: int = 5,
        min_accumulation: Optional[float] = None
    ) -> Dict:
        """
        Tool: weekly_opportunity
        
        Retrieves stocks with highest opportunity scores for the upcoming week.
        
        Parameters:
        - top_n: Number of top opportunities to return (default: 5)
        - min_accumulation: Minimum accumulation score filter (optional)
        
        Returns:
        - Dictionary with analysis results and metadata
        """
        if not supabase:
            return {"error": "Database not available", "data": []}
        
        try:
            # Resolve the data source mode (realtime vs Supabase)
            mode = _resolve_data_source_mode()
            
            data_source = "supabase_db"
            data_date = None
            stocks_data = []
            
            if mode == "realtime":
                try:
                    from api.intraday_downloader import _fetch_egx_symbols
                    
                    symbols = _fetch_egx_symbols()
                    if not symbols:
                        symbols = ["COMI", "EAST", "HRHO", "ISPH", "ESRS"]  # Fallback symbols
                    
                    from api.free_data_provider import fetch_eod_data_free
                    for symbol in symbols[:50]:  # Limit to 50 symbols for performance
                        try:
                            records = fetch_eod_data_free(symbol, period="3mo")
                            tech = _compute_technicals_from_ohlcv(records)
                            if tech and tech.get("price"):
                                tech["symbol"] = symbol
                                stocks_data.append(tech)
                        except Exception:
                            continue
                    
                    if stocks_data:
                        data_source = "realtime_api"
                        data_date = max(r.get("date") or "" for r in stocks_data)
                except Exception as rt_error:
                    print(f"Real-time fetch failed, falling back to Supabase: {rt_error}")
                    stocks_data = []
            
            if not stocks_data:
                stocks_data, snapshot_date = _fetch_supabase_market_snapshot()
                data_source = "supabase_db"
                data_date = snapshot_date
            
            if not stocks_data:
                return {
                    "error": None,
                    "data": [],
                    "message": "لا توجد بيانات متاحة حالياً",
                    "query_date": datetime.now().isoformat(),
                    "data_source": data_source,
                    "data_date": data_date
                }
            
            opportunities = self.analyzer.rank_opportunities(stocks_data, top_n=top_n)
            for opp in opportunities:
                opp["data_source"] = data_source
            
            return {
                "error": None,
                "data": opportunities,
                "query_date": datetime.now().isoformat(),
                "total_analyzed": len(stocks_data),
                "top_count": len(opportunities),
                "data_source": data_source,
                "data_date": data_date
            }
        
        except Exception as e:
            print(f"Error in get_weekly_opportunities: {e}")
            return {
                "error": str(e),
                "data": [],
                "query_date": datetime.now().isoformat()
            }
    
    def get_stocks_below_midpoint_with_accumulation(
        self,
        min_accumulation: float = 70.0
    ) -> Dict:
        """
        Tool: stocks_below_midpoint_accumulation
        
        Find stocks trading below technical midpoint with accumulation.
        
        Parameters:
        - min_accumulation: Minimum accumulation score (default: 70)
        
        Returns:
        - Dictionary with filtered stocks and analysis
        """
        if not supabase:
            return {"error": "Database not available", "data": []}
        
        try:
            # Latest Wyckoff scan data from Supabase (stock_scans_summary)
            stocks_data, snapshot_date = _fetch_supabase_market_snapshot()
            
            # Filter by minimum accumulation score
            stocks_data = [
                s for s in stocks_data
                if isinstance(s.get("accumulation_score"), (int, float))
                and s["accumulation_score"] >= min_accumulation
            ]
            
            if not stocks_data:
                return {
                    "error": None,
                    "data": [],
                    "message": "لا توجد أسهم تحقق هذه الشروط حالياً",
                    "query_date": datetime.now().isoformat(),
                    "data_source": "supabase_db",
                    "data_date": snapshot_date
                }
            
            # Analyze
            opportunities = self.analyzer.rank_opportunities(stocks_data, top_n=20)
            for opp in opportunities:
                opp["data_source"] = "supabase_db"
                opp["data_date"] = snapshot_date
            
            return {
                "error": None,
                "data": opportunities,
                "query_date": datetime.now().isoformat(),
                "criteria": {
                    "min_accumulation": min_accumulation,
                    "below_midpoint": True
                },
                "results_count": len(opportunities),
                "data_source": "supabase_db",
                "data_date": snapshot_date
            }
        
        except Exception as e:
            print(f"Error in get_stocks_below_midpoint_with_accumulation: {e}")
            return {
                "error": str(e),
                "data": [],
                "query_date": datetime.now().isoformat()
            }
    
    def get_stocks_with_distribution(
        self,
        min_distribution: float = 70.0
    ) -> Dict:
        """
        Tool: stocks_with_distribution
        
        Find stocks with high distribution (selling pressure).
        
        Parameters:
        - min_distribution: Minimum distribution score (default: 70)
        
        Returns:
        - Dictionary with stocks showing distribution
        """
        if not supabase:
            return {"error": "Database not available", "data": []}
        
        try:
            # Latest Wyckoff scan data from Supabase (stock_scans_summary)
            stocks_data, snapshot_date = _fetch_supabase_market_snapshot()
            
            # Filter by minimum distribution score (selling pressure)
            stocks_data = [
                s for s in stocks_data
                if isinstance(s.get("distribution_score"), (int, float))
                and s["distribution_score"] >= min_distribution
            ]
            
            if not stocks_data:
                return {
                    "error": None,
                    "data": [],
                    "message": "لا توجد أسهم تحقق شرط التصريف المطلوب",
                    "query_date": datetime.now().isoformat(),
                    "data_source": "supabase_db",
                    "data_date": snapshot_date
                }
            
            # Analyze (scores will be lower due to distribution)
            analysis = self.analyzer.rank_opportunities(stocks_data, top_n=20)
            for item in analysis:
                item["data_source"] = "supabase_db"
                item["data_date"] = snapshot_date
            
            return {
                "error": None,
                "data": analysis,
                "query_date": datetime.now().isoformat(),
                "criteria": {
                    "min_distribution": min_distribution
                },
                "results_count": len(analysis),
                "warning": "هذه أسهم عليها تصريف — تجنب الشراء",
                "data_source": "supabase_db",
                "data_date": snapshot_date
            }
        
        except Exception as e:
            print(f"Error in get_stocks_with_distribution: {e}")
            return {
                "error": str(e),
                "data": [],
                "query_date": datetime.now().isoformat()
            }
    
    def get_single_stock_analysis(self, symbol: str) -> Dict:
        """
        Tool: single_stock_analysis
        
        Get detailed analysis for a specific stock.
        
        Parameters:
        - symbol: Stock symbol (e.g., "CCAP")
        
        Returns:
        - Dictionary with detailed stock analysis
        """
        if not supabase:
            return {"error": "Database not available", "data": None}
        
        try:
            sym = symbol.upper()
            
            # Resolve the data source mode (realtime vs Supabase)
            mode = _resolve_data_source_mode()
            
            data_source = "supabase_db"
            stock_data = None
            
            if mode == "realtime":
                # Try to fetch real-time data and compute indicators from OHLCV
                try:
                    from api.free_data_provider import fetch_eod_data_free
                    records = fetch_eod_data_free(sym, period="3mo")
                    tech = _compute_technicals_from_ohlcv(records)
                    if tech and tech.get("price"):
                        stock_data = tech
                        data_source = "realtime_api"
                except Exception as rt_error:
                    print(f"Real-time fetch failed, falling back to Supabase: {rt_error}")
            
            if stock_data is None:
                # Default to Supabase: real snapshot from stock_prices +
                # stock_scans_summary + stocks
                stock_data = _fetch_supabase_stock_detail(sym)
                data_source = "supabase_db"
            
            if not stock_data:
                return {
                    "error": f"No data found for symbol: {symbol}",
                    "data": None,
                    "query_date": datetime.now().isoformat()
                }
            
            stock_data.setdefault("name", sym)
            stock_data["symbol"] = sym
            
            analysis = self.analyzer.calculate_weekly_opportunity_score(stock_data)
            analysis["name"] = stock_data.get("name")
            analysis["change_pct"] = stock_data.get("change_pct")
            analysis["data_source"] = data_source
            analysis["data_date"] = stock_data.get("date")
            
            return {
                "error": None,
                "data": analysis,
                "query_date": datetime.now().isoformat(),
                "symbol": sym,
                "data_source": data_source,
                "data_date": stock_data.get("date")
            }
        
        except Exception as e:
            print(f"Error in get_single_stock_analysis: {e}")
            return {
                "error": str(e),
                "data": None,
                "query_date": datetime.now().isoformat()
            }
    
    def get_market_indices(self) -> Dict:
        """
        Tool: market_indices
        
        Get current market indices (EGX30, USD rate, etc.).
        
        Returns:
        - Dictionary with market indices data
        """
        if not supabase:
            return {"error": "Database not available", "data": {}}
        
        try:
            indices = {}
            
            # Try market_cache table first
            try:
                egx_response = supabase.table("market_cache").select(
                    "symbol, value, date"
                ).eq("symbol", "EGX30").order("date", desc=True).limit(1).execute()
                
                if egx_response.data:
                    egx_data = egx_response.data[0]
                    indices["EGX30"] = {
                        "value": egx_data.get("value"),
                        "date": egx_data.get("date")
                    }
            except Exception as e:
                print(f"market_cache query failed: {e}")
            
            # Try currency_rates table
            try:
                usd_response = supabase.table("currency_rates").select(
                    "currency, rate, date"
                ).eq("currency", "USD").order("date", desc=True).limit(1).execute()
                
                if usd_response.data:
                    usd_data = usd_response.data[0]
                    indices["USD_EGP"] = {
                        "rate": usd_data.get("rate"),
                        "date": usd_data.get("date")
                    }
            except Exception as e:
                print(f"currency_rates query failed: {e}")
            
            # If no data available, return empty with message
            if not indices:
                return {
                    "error": None,
                    "data": {},
                    "message": "لا توجد بيانات للمؤشرات حالياً",
                    "query_date": datetime.now().isoformat()
                }
            
            return {
                "error": None,
                "data": indices,
                "query_date": datetime.now().isoformat()
            }
        
        except Exception as e:
            print(f"Error in get_market_indices: {e}")
            return {
                "error": str(e),
                "data": {},
                "query_date": datetime.now().isoformat()
            }
    
    def get_performance_analytics(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict:
        """
        Tool: performance_analytics
        
        Get performance metrics and analytics from backtests and bot states.
        
        Parameters:
        - start_date: Optional start date for filtering (ISO format)
        - end_date: Optional end date for filtering (ISO format)
        
        Returns:
        - Dictionary with performance metrics
        """
        if not supabase:
            return {"error": "Database not available", "data": {}}
        
        try:
            analytics = {}
            
            # Get backtest performance data - use only available columns
            try:
                backtest_query = supabase.table("backtests").select(
                    "id, model_name, exchange, start_date, end_date, total_trades, win_rate, "
                    "net_profit, avg_return_per_trade, created_at"
                )
                
                if start_date:
                    backtest_query = backtest_query.gte("created_at", start_date)
                if end_date:
                    backtest_query = backtest_query.lte("created_at", end_date)
                
                backtest_response = backtest_query.order("created_at", desc=True).limit(50).execute()
                
                if backtest_response.data:
                    backtests = backtest_response.data
                    
                    # Calculate aggregate metrics
                    total_trades = sum(bt.get("total_trades", 0) for bt in backtests if bt.get("total_trades"))
                    avg_win_rate = sum(bt.get("win_rate", 0) for bt in backtests if bt.get("win_rate") is not None) / len(backtests) if backtests else 0
                    total_profit = sum(bt.get("net_profit", 0) for bt in backtests if bt.get("net_profit") is not None)
                    
                    analytics["backtests"] = {
                        "count": len(backtests),
                        "total_trades": total_trades,
                        "avg_win_rate": round(avg_win_rate, 2),
                        "total_profit": round(total_profit, 2),
                        "recent": backtests[:5]  # Top 5 recent
                    }
            except Exception as e:
                analytics["backtests_error"] = str(e)
            
            # Get bot states for live performance - use only available columns
            try:
                bot_response = supabase.table("bot_states").select(
                    "bot_id, state, updated_at"
                ).order("updated_at", desc=True).limit(10).execute()
                
                if bot_response.data:
                    live_stats = []
                    for bot in bot_response.data:
                        state = bot.get("state", {})
                        if isinstance(state, dict):
                            live_stats.append({
                                "bot_id": bot.get("bot_id"),
                                "win_rate": state.get("win_rate", 0),
                                "trades_count": state.get("trades_count", 0),
                                "total_pnl": state.get("total_pnl", 0),
                                "open_positions": state.get("total_open_positions", 0)
                            })
                    
                    if live_stats:
                        avg_live_win_rate = sum(s["win_rate"] for s in live_stats) / len(live_stats)
                        total_live_trades = sum(s["trades_count"] for s in live_stats)
                        
                        analytics["live_performance"] = {
                            "active_bots": len(live_stats),
                            "avg_win_rate": round(avg_live_win_rate, 2),
                            "total_trades": total_live_trades,
                            "bots": live_stats
                        }
            except Exception as e:
                analytics["live_performance_error"] = str(e)
            
            return {
                "error": None,
                "data": analytics,
                "query_date": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "error": str(e),
                "data": {},
                "query_date": datetime.now().isoformat()
            }


# Tool registry for function calling
def get_tool_definitions() -> List[Dict]:
    """
    Returns provider-compatible function definitions for the chatbot.
    """
    return [
        {
            "name": "get_weekly_opportunities",
            "description": "استرجاع أفضل الأسهم المرشحة للارتفاع خلال الأسبوع القادم بناءً على التحليل الفني",
            "parameters": {
                "type": "object",
                "properties": {
                    "top_n": {
                        "type": "integer",
                        "description": "عدد الأسهم المطلوبة (افتراضي: 5)",
                        "default": 5
                    },
                    "min_accumulation": {
                        "type": "number",
                        "description": "الحد الأدنى لنقاط التجميع (اختياري)",
                        "minimum": 0,
                        "maximum": 100
                    }
                },
                "required": []
            }
        },
        {
            "name": "get_stocks_below_midpoint_with_accumulation",
            "description": "البحث عن الأسهم المتداولة تحت القيمة الوسطية الفنية مع وجود تجميع",
            "parameters": {
                "type": "object",
                "properties": {
                    "min_accumulation": {
                        "type": "number",
                        "description": "الحد الأدنى لنقاط التجميع (افتراضي: 70)",
                        "default": 70,
                        "minimum": 0,
                        "maximum": 100
                    }
                },
                "required": []
            }
        },
        {
            "name": "get_stocks_with_distribution",
            "description": "البحث عن الأسهم التي عليها تصريف (ضغط بيعي)",
            "parameters": {
                "type": "object",
                "properties": {
                    "min_distribution": {
                        "type": "number",
                        "description": "الحد الأدنى لنقاط التصريف (افتراضي: 70)",
                        "default": 70,
                        "minimum": 0,
                        "maximum": 100
                    }
                },
                "required": []
            }
        },
        {
            "name": "get_single_stock_analysis",
            "description": "الحصول على تحليل فني تفصيلي لسهم معين",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "رمز السهم (مثال: CCAP, COMI, EAST)"
                    }
                },
                "required": ["symbol"]
            }
        },
        {
            "name": "get_market_indices",
            "description": "الحصول على بيانات المؤشرات السوقية (EGX30، سعر الدولار، إلخ)",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    ]


def execute_tool(tool_name: str, arguments: Dict) -> Dict:
    """
    Execute a tool by name with given arguments.
    
    Returns:
    - Tool execution result
    """
    tools = ChatbotTools()
    
    if tool_name == "get_weekly_opportunities":
        return tools.get_weekly_opportunities(**arguments)
    
    elif tool_name == "get_stocks_below_midpoint_with_accumulation":
        return tools.get_stocks_below_midpoint_with_accumulation(**arguments)
    
    elif tool_name == "get_stocks_with_distribution":
        return tools.get_stocks_with_distribution(**arguments)
    
    elif tool_name == "get_single_stock_analysis":
        return tools.get_single_stock_analysis(**arguments)
    
    elif tool_name == "get_market_indices":
        return tools.get_market_indices(**arguments)
    
    elif tool_name == "get_performance_analytics":
        return tools.get_performance_analytics(**arguments)
    
    else:
        return {
            "error": f"Unknown tool: {tool_name}",
            "data": None
        }
