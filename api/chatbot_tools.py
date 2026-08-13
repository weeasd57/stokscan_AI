"""
Chatbot Tools for Function Calling
Provides structured data retrieval tools to prevent LLM hallucination.

Architecture:
    User Query → Intent Parser → Tool Executor → Analysis Engine → Validator → Response
"""

from typing import List, Dict, Optional, Literal
from datetime import datetime, timedelta
from api.stock_ai import _init_supabase, supabase
from api.opportunity_analyzer import OpportunityAnalyzer


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
    
    # 1. Check for portfolio/advice queries (highest priority for these keywords)
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
            "كويس", "حلو", "هل", "ايه", "إيه", "شايف", "نظرتك"
        ]
        if any(word in query_lower for word in analysis_keywords):
            return {
                "intent": "stock_analysis",
                "ticker": tickers[0],
                "required_data": ["price", "rsi", "macd", "volume_ratio", "support", "resistance", 
                                 "accumulation_score", "distribution_score"]
            }
    
    # 6. Check for screening intents
    # Weekly opportunities
    opportunity_keywords = ["أفضل", "احسن", "فرص", "متوقع", "يرتفع", "forecast", "سهم", "اسهم"]
    if any(word in query_lower for word in opportunity_keywords):
        return {
            "intent": "screening",
            "criteria": "weekly_opportunity",
            "required_data": ["all"]
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
    
    # 7. Default to general for unclear intents
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
            # Get latest stock data from last trading session
            # Using stock_bars_intraday as the data source
            query = supabase.table("stock_bars_intraday").select(
                "symbol, price as close_price, rsi, macd, volume_ratio, "
                "accumulation_score, distribution_score, support, resistance, "
                "date, exchange"
            ).order("date", desc=True).limit(200)
            
            if min_accumulation:
                query = query.gte("accumulation_score", min_accumulation)
            
            response = query.execute()
            stocks_data = response.data if response.data else []
            
            if not stocks_data:
                return {
                    "error": None,
                    "data": [],
                    "message": "لا توجد بيانات متاحة حالياً",
                    "query_date": datetime.now().isoformat()
                }
            
            # Filter to get most recent data per symbol
            latest_by_symbol = {}
            for stock in stocks_data:
                sym = stock.get("symbol")
                date = stock.get("date")
                
                if sym not in latest_by_symbol:
                    latest_by_symbol[sym] = stock
                else:
                    if date > latest_by_symbol[sym].get("date"):
                        latest_by_symbol[sym] = stock
            
            stocks_list = list(latest_by_symbol.values())
            
            # Run opportunity analysis
            opportunities = self.analyzer.rank_opportunities(stocks_list, top_n=top_n)
            
            return {
                "error": None,
                "data": opportunities,
                "query_date": datetime.now().isoformat(),
                "total_analyzed": len(stocks_list),
                "top_count": len(opportunities)
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
            # Get stocks with accumulation
            response = supabase.table("stock_bars_intraday").select(
                "symbol, price as close_price, rsi, macd, volume_ratio, "
                "accumulation_score, distribution_score, support, resistance, "
                "date, exchange"
            ).gte("accumulation_score", min_accumulation).order("date", desc=True).limit(200).execute()
            
            stocks_data = response.data if response.data else []
            
            if not stocks_data:
                return {
                    "error": None,
                    "data": [],
                    "message": "لا توجد أسهم تحقق هذه الشروط حالياً",
                    "query_date": datetime.now().isoformat()
                }
            
            # Filter latest per symbol
            latest_by_symbol = {}
            for stock in stocks_data:
                sym = stock.get("symbol")
                date = stock.get("date")
                
                if sym not in latest_by_symbol:
                    latest_by_symbol[sym] = stock
                else:
                    if date > latest_by_symbol[sym].get("date"):
                        latest_by_symbol[sym] = stock
            
            # Filter below midpoint
            filtered = self.analyzer.filter_by_criteria(
                list(latest_by_symbol.values()),
                min_accumulation=min_accumulation,
                below_midpoint=True
            )
            
            # Analyze
            opportunities = self.analyzer.rank_opportunities(filtered, top_n=20)
            
            return {
                "error": None,
                "data": opportunities,
                "query_date": datetime.now().isoformat(),
                "criteria": {
                    "min_accumulation": min_accumulation,
                    "below_midpoint": True
                },
                "results_count": len(opportunities)
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
            response = supabase.table("stock_bars_intraday").select(
                "symbol, price as close_price, rsi, macd, volume_ratio, "
                "accumulation_score, distribution_score, support, resistance, "
                "date, exchange"
            ).gte("distribution_score", min_distribution).order("date", desc=True).limit(200).execute()
            
            stocks_data = response.data if response.data else []
            
            if not stocks_data:
                return {
                    "error": None,
                    "data": [],
                    "message": "لا توجد أسهم تحقق شرط التصريف المطلوب",
                    "query_date": datetime.now().isoformat()
                }
            
            # Get latest per symbol
            latest_by_symbol = {}
            for stock in stocks_data:
                sym = stock.get("symbol")
                date = stock.get("date")
                
                if sym not in latest_by_symbol:
                    latest_by_symbol[sym] = stock
                else:
                    if date > latest_by_symbol[sym].get("date"):
                        latest_by_symbol[sym] = stock
            
            # Analyze (scores will be lower due to distribution)
            analysis = self.analyzer.rank_opportunities(
                list(latest_by_symbol.values()), 
                top_n=20
            )
            
            return {
                "error": None,
                "data": analysis,
                "query_date": datetime.now().isoformat(),
                "criteria": {
                    "min_distribution": min_distribution
                },
                "results_count": len(analysis),
                "warning": "هذه أسهم عليها تصريف — تجنب الشراء"
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
            # Get latest data for this symbol
            response = supabase.table("stock_bars_intraday").select(
                "symbol, price as close_price, rsi, macd, volume_ratio, "
                "accumulation_score, distribution_score, support, resistance, "
                "date, exchange, name"
            ).eq("symbol", symbol.upper()).order("date", desc=True).limit(1).execute()
            
            if not response.data:
                return {
                    "error": f"No data found for symbol: {symbol}",
                    "data": None,
                    "query_date": datetime.now().isoformat()
                }
            
            stock_data = response.data[0]
            
            # Run analysis
            analysis = self.analyzer.calculate_weekly_opportunity_score(stock_data)
            
            return {
                "error": None,
                "data": analysis,
                "query_date": datetime.now().isoformat(),
                "symbol": symbol.upper()
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
        
        Get current market indices (EGX30, USD rate, etc.)
        
        Returns:
        - Dictionary with market indices data
        """
        if not supabase:
            return {"error": "Database not available", "data": {}}
        
        try:
            indices = {}
            
            # Get EGX30
            egx_response = supabase.table("market_indices").select(
                "symbol, close, date"
            ).eq("symbol", "EGX30").order("date", desc=True).limit(1).execute()
            
            if egx_response.data:
                egx_data = egx_response.data[0]
                indices["EGX30"] = {
                    "value": egx_data.get("close"),
                    "date": egx_data.get("date")
                }
            
            # Get USD rate
            usd_response = supabase.table("currency_rates").select(
                "currency, rate, date"
            ).eq("currency", "USD").order("date", desc=True).limit(1).execute()
            
            if usd_response.data:
                usd_data = usd_response.data[0]
                indices["USD_EGP"] = {
                    "rate": usd_data.get("rate"),
                    "date": usd_data.get("date")
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
    
    else:
        return {
            "error": f"Unknown tool: {tool_name}",
            "data": None
        }
