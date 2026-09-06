"""
Chatbot Router with 3-Layer Architecture
Architecture: Intent Parser → Tool Executor → Analysis Engine → Validator → Response
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
import os
import json

from api.chatbot_tools import ChatbotTools, parse_user_intent, execute_tool
from api.chatbot_validator import ResponseValidator, validate_and_fix
from api.opportunity_analyzer import OpportunityAnalyzer

router = APIRouter(prefix="/chatbot", tags=["chatbot"])


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    user_id: Optional[str] = None
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    intent: Optional[Dict] = None
    tool_calls: Optional[List[Dict]] = None
    validation: Optional[Dict] = None


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Main chatbot endpoint with 3-layer architecture.
    
    Flow:
    1. Parse Intent (what does user want?)
    2. Execute Tools (get data from Supabase)
    3. Generate Response (format data directly)
    4. Validate (check accuracy)
    5. Return
    """
    try:
        user_message = request.messages[-1].content if request.messages else ""
        
        if not user_message:
            raise HTTPException(status_code=400, detail="Empty message")
        
        # Extract conversation history (previous messages)
        conversation_history = [
            {"role": msg.role, "content": msg.content}
            for msg in request.messages[:-1]  # All except last (current) message
        ]
        
        # LAYER 1: Parse Intent (with conversation context)
        intent = parse_user_intent(user_message, conversation_history)
        
        # LAYER 2: Execute Tools based on intent
        tool_results = execute_tools_for_intent(intent)
        
        # LAYER 3: Generate Direct Response
        # Always use generate_response_from_intent - it handles empty data gracefully
        direct_response = generate_response_from_intent(intent, tool_results)
        
        # LAYER 4: Validate
        validation = validate_response(user_message, tool_results, direct_response)
        
        return ChatResponse(
            response=direct_response,
            intent=intent,
            tool_calls=tool_results,
            validation=validation
        )
    
    except Exception as e:
        print(f"Error in chatbot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def execute_tools_for_intent(intent: Dict) -> List[Dict]:
    """Execute appropriate tools based on parsed intent."""
    intent_type = intent.get("intent")
    
    if intent_type == "stock_analysis":
        ticker = intent.get("ticker")
        result = execute_tool("get_single_stock_analysis", {"symbol": ticker})
        return [{"tool": "get_single_stock_analysis", "arguments": {"symbol": ticker}, "result": result}]
    
    elif intent_type == "comparison":
        tickers = intent.get("tickers", [])
        results = []
        for ticker in tickers:
            result = execute_tool("get_single_stock_analysis", {"symbol": ticker})
            results.append({"tool": "get_single_stock_analysis", "arguments": {"symbol": ticker}, "result": result})
        return results
    
    elif intent_type == "screening":
        criteria = intent.get("criteria")
        
        if criteria == "weekly_opportunity":
            result = execute_tool("get_weekly_opportunities", {"top_n": 5})
            return [{"tool": "get_weekly_opportunities", "arguments": {"top_n": 5}, "result": result}]
        
        elif criteria == "below_midpoint_accumulation":
            result = execute_tool("get_stocks_below_midpoint_with_accumulation", {"min_accumulation": 70.0})
            return [{"tool": "get_stocks_below_midpoint_with_accumulation", 
                    "arguments": {"min_accumulation": 70.0}, "result": result}]
        
        elif criteria == "distribution":
            result = execute_tool("get_stocks_with_distribution", {"min_distribution": 70.0})
            return [{"tool": "get_stocks_with_distribution", 
                    "arguments": {"min_distribution": 70.0}, "result": result}]
    
    elif intent_type == "market_overview":
        result = execute_tool("get_market_indices", {})
        return [{"tool": "get_market_indices", "arguments": {}, "result": result}]
    
    elif intent_type == "analytics":
        result = execute_tool("get_performance_analytics", {})
        return [{"tool": "get_performance_analytics", "arguments": {}, "result": result}]
    
    return []


def has_valid_data(tool_results: List[Dict]) -> bool:
    """Check if any tool returned valid data or a valid message."""
    for result in tool_results:
        tool_result = result.get("result", {})
        # If no error, consider it valid (even with empty data - we have formatting functions for that)
        if not tool_result.get("error"):
            return True
    return False


def generate_direct_response(user_query: str, tool_results: List[Dict]) -> str:
    """
    Generate response directly from tool data without LLM.
    This completely prevents hallucination.
    """
    analyzer = OpportunityAnalyzer()
    response_parts = []
    
    for tool_call in tool_results:
        tool_name = tool_call["tool"]
        tool_result = tool_call["result"]
        
        if tool_result.get("error"):
            continue
        
        data = tool_result.get("data")
        message = tool_result.get("message", "")
        
        # Format based on tool type - handle empty data with messages
        if tool_name == "get_weekly_opportunities":
            if data and (isinstance(data, list) and len(data) > 0):
                response_parts.append("📊 **أفضل الفرص المتاحة للأسبوع القادم**\n")
                response_parts.append(f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})\n")
                response_parts.append(format_opportunities(data))
            else:
                # Use the formatting function with empty data
                response_parts.append(format_weekly_opportunities(tool_result))
        
        elif tool_name == "get_stocks_below_midpoint_with_accumulation":
            if data and (isinstance(data, list) and len(data) > 0):
                response_parts.append("📊 **أسهم تحت القيمة الوسطية مع تجميع**\n")
                response_parts.append(f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})\n")
                response_parts.append(format_opportunities(data))
        
        elif tool_name == "get_stocks_with_distribution":
            if data and (isinstance(data, list) and len(data) > 0):
                response_parts.append("⚠️ **أسهم عليها تصريف (تجنب الشراء)**\n")
                response_parts.append(f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})\n")
                response_parts.append(format_opportunities(data))
        
        elif tool_name == "get_single_stock_analysis":
            if data:
                response_parts.append(format_single_stock(data))
        
        elif tool_name == "get_market_indices":
            # Always use the formatting function for market indices
            response_parts.append(format_market_indices(tool_result))
    
    if not response_parts:
        return "لا توجد بيانات متاحة حالياً.\n\n📢 [تابعنا على تليجرام](https://t.me/egxbots/153)"
    
    response_text = "\n\n".join(response_parts)
    # Don't add telegram link if already present in formatted responses
    if "📢 [تابعنا على تليجرام]" not in response_text:
        response_text += "\n\n📢 [تابعنا على تليجرام](https://t.me/egxbots/153)"
    return response_text


def format_opportunities(data: List[Dict]) -> str:
    """Format opportunity analysis results."""
    if not data:
        return "لا توجد نتائج."
    
    parts = []
    for idx, stock in enumerate(data, 1):
        symbol = stock.get("symbol", "UNKNOWN")
        score = stock.get("score", 0)
        recommendation = stock.get("recommendation", "")
        raw = stock.get("raw_data", {})
        reasons = stock.get("reasons", [])
        risks = stock.get("risks", [])
        
        part = f"**{idx}. {symbol}** — {recommendation} (نقاط الفرصة: {score})\n"
        
        # Price and basic info
        if raw.get("price"):
            part += f"• السعر: {raw['price']:.2f} جنيه\n"
        
        if raw.get("rsi") is not None:
            part += f"• RSI: {raw['rsi']:.1f}\n"
        
        if raw.get("macd") is not None:
            part += f"• MACD: {raw['macd']:.4f}\n"
        
        if raw.get("volume_ratio"):
            part += f"• حجم التداول: {raw['volume_ratio']:.2f}x من المتوسط\n"
        
        if raw.get("accumulation_score"):
            part += f"• التجميع: {raw['accumulation_score']:.1f}\n"
        
        if raw.get("distribution_score"):
            part += f"• التصريف: {raw['distribution_score']:.1f}\n"
        
        if raw.get("support") and raw.get("resistance"):
            part += f"• الدعم: {raw['support']:.2f} | المقاومة: {raw['resistance']:.2f}\n"
        
        # Reasons
        if reasons:
            part += "\n✅ **الأسباب الإيجابية:**\n"
            for reason in reasons:
                part += f"  - {reason}\n"
        
        # Risks
        if risks:
            part += "\n⚠️ **المخاطر:**\n"
            for risk in risks:
                part += f"  - {risk}\n"
        
        parts.append(part)
    
    return "\n".join(parts)


def format_single_stock(data: Dict) -> str:
    """Format single stock analysis."""
    if not data:
        return "لا توجد بيانات لهذا السهم."
    
    symbol = data.get("symbol", "UNKNOWN")
    score = data.get("score", 0)
    recommendation = data.get("recommendation", "")
    raw = data.get("raw_data", {})
    reasons = data.get("reasons", [])
    risks = data.get("risks", [])
    
    response = f"📊 **تحليل فني لسهم {symbol}**\n\n"
    response += f"**التقييم**: {recommendation} (نقاط الفرصة: {score})\n\n"
    
    response += "**البيانات الفنية:**\n"
    if raw.get("price"):
        response += f"• السعر الحالي: {raw['price']:.2f} جنيه\n"
    
    if raw.get("rsi") is not None:
        response += f"• RSI: {raw['rsi']:.1f}\n"
    
    if raw.get("macd") is not None:
        response += f"• MACD: {raw['macd']:.4f}\n"
    
    if raw.get("volume_ratio"):
        response += f"• حجم التداول: {raw['volume_ratio']:.2f}x\n"
    
    if raw.get("accumulation_score"):
        response += f"• التجميع: {raw['accumulation_score']:.1f}\n"
    
    if raw.get("distribution_score"):
        response += f"• التصريف: {raw['distribution_score']:.1f}\n"
    
    if raw.get("support") and raw.get("resistance"):
        response += f"• الدعم: {raw['support']:.2f} | المقاومة: {raw['resistance']:.2f}\n"
    
    if reasons:
        response += "\n✅ **الأسباب الإيجابية:**\n"
        for reason in reasons:
            response += f"  - {reason}\n"
    
    if risks:
        response += "\n⚠️ **المخاطر:**\n"
        for risk in risks:
            response += f"  - {risk}\n"
    
    return response


def format_market_indices(data: Dict) -> str:
    """Format market indices data."""
    if not data:
        return "لا توجد بيانات للمؤشرات حالياً."
    
    response = "📈 **المؤشرات السوقية**\n\n"
    
    if "EGX30" in data:
        egx = data["EGX30"]
        response += f"• **مؤشر EGX30**: {egx.get('value', 'N/A')} نقطة\n"
        response += f"  (تاريخ: {egx.get('date', 'N/A')})\n\n"
    
    if "USD_EGP" in data:
        usd = data["USD_EGP"]
        response += f"• **سعر الدولار**: {usd.get('rate', 'N/A')} جنيه\n"
        response += f"  (تاريخ: {usd.get('date', 'N/A')})\n"
    
    return response


@router.get("/tools")
def get_available_tools():
    """Return list of available tools for documentation."""
    return {
        "tools": get_tool_definitions(),
        "description": "أدوات متاحة للحصول على بيانات الأسهم الحقيقية"
    }


@router.post("/analyze")
def analyze_query(query: str):
    """
    Analyze a query and return which tools would be called.
    Useful for debugging and testing.
    """
    tools = determine_tools_needed(query)
    return {
        "query": query,
        "tools_to_call": tools
    }


def generate_response_from_intent(intent: Dict, tool_results: List[Dict]) -> str:
    """
    Generate response based on intent type.
    DIRECT formatting - NO LLM guessing.
    """
    intent_type = intent.get("intent")
    
    if intent_type == "stock_analysis":
        return format_single_stock_analysis(tool_results[0]["result"])
    
    elif intent_type == "comparison":
        return format_stock_comparison(tool_results)
    
    elif intent_type == "portfolio_analysis":
        return ("📋 **تحليل المحفظة**\n\n"
                "للحصول على تحليل محفظتك، يجب أن تشارك قائمة الأسهم التي تمتلكها.\n\n"
                "يمكنك القول مثلاً:\n"
                "- 'محفظتي فيها CPME و MOIN و RAYA'\n"
                "- 'حلل الأسهم دي: FERC, BIOC, NILE'\n\n"
                "بعدها سأحلل كل سهم وأعطيك رؤية شاملة عن وضع محفظتك.")
    
    elif intent_type == "sell_decision":
        if tool_results and tool_results[0]["result"].get("data"):
            return format_sell_decision(tool_results, intent)
        else:
            return ("💰 **قرار البيع**\n\n"
                   "لتقييم قرار البيع، أحتاج إلى:\n"
                   "1. السهم المحدد\n"
                   "2. سعر الشراء\n"
                   "3. السعر الحالي\n\n"
                   "مثال: 'اشتريت RAYA ب 8.14 والسعر الآن 7.80, ابيعه؟'\n\n"
                   "سأحلل الوضع الفني وأعطيك رأي بناءً على المؤشرات.")
    
    elif intent_type == "screening":
        criteria = intent.get("criteria")
        if criteria == "weekly_opportunity":
            return format_weekly_opportunities(tool_results[0]["result"])
        elif criteria == "below_midpoint_accumulation":
            return format_below_midpoint_results(tool_results[0]["result"])
        elif criteria == "distribution":
            return format_distribution_results(tool_results[0]["result"])
    
    elif intent_type == "market_overview":
        return format_market_indices(tool_results[0]["result"])
    
    elif intent_type == "telegram_link":
        return format_telegram_link_response()
    
    elif intent_type == "analytics":
        if tool_results and tool_results[0]:
            return format_analytics_response(tool_results[0]["result"])
        else:
            result = execute_tool("get_performance_analytics", {})
            return format_analytics_response(result)
    
    return "لا يمكن معالجة هذا الطلب حالياً."


def format_single_stock_analysis(tool_result: Dict) -> str:
    """Format analysis for single stock - STRICTLY from database."""
    if tool_result.get("error"):
        return f"⚠️ {tool_result['error']}"
    
    data = tool_result.get("data")
    data_source = data.get("data_source", "supabase_db") if data else "supabase_db"
    data_date = (data.get("data_date") if data else None) or tool_result.get("data_date")
    query_date = tool_result.get("query_date", "")
    
    # Determine source label - only show Real-time for user, hide Supabase
    source_label = "بيانات لحظية (Real-time)" if data_source == "realtime_api" else "بيانات من قاعدة البيانات (Supabase)"
    
    if not data:
        return f"لا توجد بيانات لهذا السهم.\n\n📢 [تابعنا على تليجرام](https://t.me/egxbots/153)"
    
    symbol = data.get("symbol", "UNKNOWN")
    stock_name = data.get("name") or ""
    score = data.get("score", 0)
    recommendation = data.get("recommendation", "")
    raw = data.get("raw_data", {})
    reasons = data.get("reasons", [])
    risks = data.get("risks", [])
    
    # Build response from data ONLY
    header = f"📊 **تحليل سهم {symbol}**" + (f" — {stock_name}" if stock_name else "")
    lines = [header]
    
    lines.append(f"({source_label})")
    if data_date:
        lines.append(f"📅 تاريخ البيانات: {data_date}")
    
    lines.extend([
        "",
        f"**التقييم:** {recommendation} (نقاط الفرصة: {score})",
        "",
        "**البيانات الفنية المتاحة:**"
    ])
    
    if raw.get("price"):
        lines.append(f"• السعر: {raw['price']:.2f} جنيه")
    
    if raw.get("rsi") is not None:
        lines.append(f"• RSI: {raw['rsi']:.1f}")
    
    if raw.get("macd") is not None:
        lines.append(f"• MACD: {raw['macd']:.4f}")
    
    if raw.get("volume_ratio"):
        lines.append(f"• نسبة الحجم: {raw['volume_ratio']:.2f}x من المتوسط")
    
    if raw.get("accumulation_score"):
        lines.append(f"• درجة التجميع: {raw['accumulation_score']:.1f}/100")
    
    if raw.get("distribution_score"):
        lines.append(f"• درجة التصريف: {raw['distribution_score']:.1f}/100")
    
    if raw.get("support") and raw.get("resistance"):
        lines.append(f"• الدعم: {raw['support']:.2f} | المقاومة: {raw['resistance']:.2f}")
    
    if reasons:
        lines.append("")
        lines.append("✅ **العوامل الإيجابية:**")
        for reason in reasons:
            lines.append(f"  - {reason}")
    
    if risks:
        lines.append("")
        lines.append("⚠️ **المخاطر:**")
        for risk in risks:
            lines.append(f"  - {risk}")
    
    lines.append("")
    lines.append("ℹ️ *التحليل مبني على البيانات الفنية المتاحة فقط ولا يشكل توصية بالشراء أو البيع.*")
    lines.append("")
    lines.append("📢 [تابعنا على تليجرام](https://t.me/egxbots/153)")
    
    return "\n".join(lines)


def format_weekly_opportunities(tool_result: Dict) -> str:
    """Format weekly opportunities response."""
    data = tool_result.get("data", [])
    data_source = tool_result.get("data_source", "supabase_db")
    data_date = tool_result.get("data_date")
    query_date = tool_result.get("query_date", "")
    
    # Determine source label - only show Real-time for user, hide Supabase
    source_label = "بيانات لحظية (Real-time)" if data_source == "realtime_api" else "بيانات من قاعدة البيانات (Supabase)"
    
    if not data:
        message = tool_result.get("message", "لا توجد فرص متاحة حالياً.")
        return f"{message}\n\n📢 [تابعنا على تليجرام](https://t.me/egxbots/153)"
    
    lines = [
        "📊 **أفضل الفرص المتاحة للأسبوع القادم**",
    ]
    
    lines.append(f"({source_label})")
    if data_date:
        lines.append(f"📅 تاريخ البيانات: {data_date}")
    
    lines.extend([
        f"(تم تحليل {tool_result.get('total_analyzed', 0)} سهم)",
        ""
    ])
    
    for idx, stock in enumerate(data, 1):
        lines.extend(format_stock_item(idx, stock))
        lines.append("")
    
    lines.append("ℹ️ *الترتيب بناءً على نقاط الفرصة المحسوبة من المؤشرات الفنية.*")
    lines.append("")
    lines.append("📢 [تابعنا على تليجرام](https://t.me/egxbots/153)")
    
    return "\n".join(lines)


def format_stock_item(index: int, stock: Dict) -> List[str]:
    """Format single stock item for list display."""
    symbol = stock.get("symbol", "UNKNOWN")
    score = stock.get("score", 0)
    recommendation = stock.get("recommendation", "")
    raw = stock.get("raw_data", {})
    reasons = stock.get("reasons", [])
    risks = stock.get("risks", [])
    
    lines = [
        f"**{index}. {symbol}** — {recommendation} (نقاط: {score})"
    ]
    
    if raw.get("price"):
        lines.append(f"   • السعر: {raw['price']:.2f} جنيه")
    if raw.get("rsi") is not None:
        lines.append(f"   • RSI: {raw['rsi']:.1f}")
    if raw.get("volume_ratio"):
        lines.append(f"   • الحجم: {raw['volume_ratio']:.2f}x")
    if raw.get("accumulation_score"):
        lines.append(f"   • التجميع: {raw['accumulation_score']:.1f}")
    
    if reasons:
        lines.append("   ✅ " + " | ".join(reasons[:2]))  # Top 2 reasons
    
    if risks:
        lines.append("   ⚠️ " + " | ".join(risks[:2]))  # Top 2 risks
    
    return lines


def format_stock_comparison(tool_results: List[Dict]) -> str:
    """Format comparison between multiple stocks with clear ranking."""
    stocks_data = []
    data_sources = set()
    data_dates = []
    
    for tr in tool_results:
        if not tr["result"].get("error") and tr["result"].get("data"):
            stocks_data.append(tr["result"]["data"])
            data_sources.add(tr["result"]["data"].get("data_source", "supabase_db"))
            d = tr["result"].get("data_date") or tr["result"]["data"].get("data_date")
            if d:
                data_dates.append(str(d))
    
    if not stocks_data:
        return "لا توجد بيانات متاحة للمقارنة."
    
    # Determine source label - only show Real-time for user, hide Supabase
    has_realtime = "realtime_api" in data_sources
    source_label = "بيانات لحظية (Real-time)" if has_realtime else "بيانات من قاعدة البيانات (Supabase)"
    latest_data_date = max(data_dates) if data_dates else None
    
    # Sort by score (highest first)
    stocks_data.sort(key=lambda x: x.get("score", 0), reverse=True)
    
    lines = [
        "📊 **مقارنة الأسهم**",
    ]
    
    lines.append(f"({source_label})")
    if latest_data_date:
        lines.append(f"📅 تاريخ البيانات: {latest_data_date}")
    
    lines.extend([
        f"(تم تحليل {len(stocks_data)} سهم وترتيبهم حسب قوة الفرصة)",
        ""
    ])
    
    # Show ranked comparison
    for idx, stock in enumerate(stocks_data, 1):
        medal = "🥇" if idx == 1 else "🥈" if idx == 2 else "🥉" if idx == 3 else f"{idx}."
        lines.extend(format_stock_item_comparison(medal, stock))
        lines.append("")
    
    # Add recommendation
    if len(stocks_data) >= 1:
        best = stocks_data[0]
        lines.append(f"💡 **التوصية الفنية:**")
        lines.append(f"   {best['symbol']} هو الأفضل بين المجموعة (نقاط: {best['score']})")
        
        # Explain why
        if best.get("reasons"):
            lines.append(f"   الأسباب: {' | '.join(best['reasons'][:2])}")
    
    lines.append("")
    lines.append("ℹ️ *الترتيب بناءً على التحليل الفني فقط - ليس توصية استثمارية*")
    lines.append("")
    lines.append("📢 [تابعنا على تليجرام](https://t.me/egxbots/153)")
    
    return "\n".join(lines)


def format_stock_item_comparison(prefix: str, stock: Dict) -> List[str]:
    """Format single stock for comparison view."""
    symbol = stock.get("symbol", "UNKNOWN")
    score = stock.get("score", 0)
    recommendation = stock.get("recommendation", "")
    raw = stock.get("raw_data", {})
    
    lines = [f"{prefix} **{symbol}** — {recommendation} ({score} نقاط)"]
    
    # Key metrics only
    if raw.get("price"):
        lines.append(f"      💰 السعر: {raw['price']:.2f} جنيه")
    if raw.get("rsi") is not None:
        rsi_status = "⚠️ مرتفع" if raw["rsi"] > 70 else "✅ صحي" if raw["rsi"] > 30 else "⚠️ منخفض"
        lines.append(f"      📊 RSI: {raw['rsi']:.1f} ({rsi_status})")
    if raw.get("volume_ratio"):
        vol_status = "🔥 قوي" if raw["volume_ratio"] > 1.5 else "⚠️ ضعيف" if raw["volume_ratio"] < 0.8 else "محايد"
        lines.append(f"      📈 الحجم: {raw['volume_ratio']:.2f}x ({vol_status})")
    if raw.get("accumulation_score"):
        lines.append(f"      ✅ التجميع: {raw['accumulation_score']:.1f}/100")
    
    return lines


def format_below_midpoint_results(tool_result: Dict) -> str:
    """Format stocks below midpoint with accumulation."""
    lines = [
        "📊 **أسهم تحت القيمة الوسطية مع تجميع**",
        ""
    ]
    
    data = tool_result.get("data", [])
    if not data:
        return "لا توجد أسهم تحقق هذه الشروط حالياً."
    
    for idx, stock in enumerate(data, 1):
        lines.extend(format_stock_item(idx, stock))
        lines.append("")
    
    lines.append("📢 [تابعنا على تليجرام](https://t.me/egxbots/153)")
    
    return "\n".join(lines)


def format_distribution_results(tool_result: Dict) -> str:
    """Format stocks with distribution."""
    lines = [
        "⚠️ **أسهم عليها تصريف (ضغط بيعي)**",
        "",
        "🚫 **تحذير:** هذه الأسهم تظهر إشارات تصريف — تجنب الشراء",
        ""
    ]
    
    data = tool_result.get("data", [])
    if not data:
        return "لا توجد أسهم بتصريف واضح حالياً."
    
    for idx, stock in enumerate(data, 1):
        lines.extend(format_stock_item(idx, stock))
        lines.append("")
    
    lines.append("📢 [تابعنا على تليجرام](https://t.me/egxbots/153)")
    
    return "\n".join(lines)


def format_market_indices(tool_result: Dict) -> str:
    """Format market indices."""
    data = tool_result.get("data", {})
    message = tool_result.get("message", "")
    query_date = tool_result.get("query_date", "")
    
    if not data:
        return f"{message or 'لا توجد بيانات للمؤشرات حالياً.'}\n\n(تاريخ البيانات: {query_date})\n\n📢 [تابعنا على تليجرام](https://t.me/egxbots/153)"
    
    lines = [
        "📈 **المؤشرات السوقية**",
        f"(تاريخ البيانات: {query_date})",
        ""
    ]
    
    if "EGX30" in data:
        egx = data["EGX30"]
        lines.append(f"• **مؤشر EGX30:** {egx.get('value', 'N/A')} نقطة")
        lines.append(f"  (آخر تحديث: {egx.get('date', 'N/A')})")
        lines.append("")
    
    if "USD_EGP" in data:
        usd = data["USD_EGP"]
        lines.append(f"• **سعر الدولار:** {usd.get('rate', 'N/A')} جنيه")
        lines.append(f"  (آخر تحديث: {usd.get('date', 'N/A')})")
    
    lines.append("")
    lines.append("📢 [تابعنا على تليجرام](https://t.me/egxbots/153)")
    
    return "\n".join(lines)


def format_telegram_link_response() -> str:
    """Format Telegram channel link response."""
    lines = [
        "📢 **قناة تليجرام الرسمية**",
        "",
        "يمكنك الانضمام إلى قناتنا الرسمية على تليجرام لتلقي:",
        "• التوصيات اليومية للأسهم",
        "• التقارير الفنية والتحليلات",
        "• تنبيهات السوق المباشرة",
        "• الأخبار العاجلة",
        "",
        "🔗 [اضغط هنا للانضمام إلى القناة](https://t.me/egxbots/153)",
        "",
        "أو قم بزيارة الرابط مباشرة:",
        "https://t.me/egxbots/153"
    ]
    return "\n".join(lines)


def format_analytics_response(tool_result: Dict) -> str:
    """Format performance analytics response."""
    if tool_result.get("error"):
        return f"⚠️ {tool_result['error']}"
    
    data = tool_result.get("data", {})
    if not data:
        return "لا توجد بيانات إحصائية متاحة حالياً."
    
    lines = ["📊 **إحصائيات الأداء**", ""]
    
    # Backtest analytics
    if "backtests" in data:
        bt = data["backtests"]
        lines.append("📈 **أداء الاختبارات الخلفية (Backtests):**")
        lines.append(f"• عدد الاختبارات: {bt.get('count', 0)}")
        lines.append(f"• إجمالي الصفقات: {bt.get('total_trades', 0)}")
        lines.append(f"• متوسط نسبة النجاح: {bt.get('avg_win_rate', 0):.2f}%")
        lines.append(f"• إجمالي الربح: {bt.get('total_profit', 0):.2f}")
        
        if bt.get('council_improvement_pct', 0) > 0:
            lines.append(f"• تحسين المجلس (Council): +{bt.get('council_improvement_pct', 0):.2f}%")
        lines.append("")
    
    # Live performance
    if "live_performance" in data:
        live = data["live_performance"]
        lines.append("🤖 **الأداء المباشر (Live Bots):**")
        lines.append(f"• البوتات النشطة: {live.get('active_bots', 0)}")
        lines.append(f"• متوسط نسبة النجاح: {live.get('avg_win_rate', 0):.2f}%")
        lines.append(f"• إجمالي الصفقات: {live.get('total_trades', 0)}")
        lines.append("")
    
    lines.append("ℹ️ *البيانات مستندة إلى الاختبارات الخلفية والأداء المباشر الفعلي.*")
    lines.append("")
    lines.append("📢 [تابعنا على تليجرام](https://t.me/egxbots/153)")
    
    return "\n".join(lines)


def format_sell_decision(tool_results: List[Dict], intent: Dict) -> str:
    """Format sell decision analysis."""
    lines = ["💰 **تحليل قرار البيع**", ""]
    
    entry_prices = intent.get("entry_prices", [])
    
    for idx, tr in enumerate(tool_results):
        if tr["result"].get("error"):
            continue
        
        data = tr["result"].get("data")
        if not data:
            continue
        
        symbol = data.get("symbol", "UNKNOWN")
        raw = data.get("raw_data", {})
        current_price = raw.get("price", 0)
        entry_price = entry_prices[idx] if idx < len(entry_prices) else None
        
        lines.append(f"**{symbol}**")
        
        if entry_price and current_price:
            change = ((current_price - entry_price) / entry_price) * 100
            profit = current_price - entry_price
            
            lines.append(f"• السعر عند الشراء: {entry_price:.2f} جنيه")
            lines.append(f"• السعر الحالي: {current_price:.2f} جنيه")
            lines.append(f"• التغير: {change:+.2f}% ({profit:+.2f} جنيه)")
            
            # Sell recommendation based on technical analysis
            score = data.get("score", 0)
            risks = data.get("risks", [])
            
            if change < -5 and score < 50:
                lines.append("⚠️ **التوصية:** قد تكون فرصة للخروج (خسائر محدودة + ضعف فني)")
            elif change > 10 and score > 70:
                lines.append("✅ **التوصية:** احتفظ (ارتفاع قوي + مؤشرات إيجابية)")
            elif any("تشبع" in risk for risk in risks):
                lines.append("⚠️ **التحذير:** تشبع شرائي - انتظر تصحيح")
            else:
                lines.append("ℹ️ **التقييم:** منطقة محايدة - انتظر تأكيد إضافي")
        
        lines.append("")
    
    lines.append("ℹ️ *هذا التحليل بناءً على المؤشرات الفنية فقط - لا يعتبر توصية استثمارية.*")
    
    return "\n".join(lines)


def validate_response(user_question: str, tool_results: List[Dict], response: str) -> Dict:
    """Validate response against database data."""
    validator = ResponseValidator()
    
    # Combine all tool results
    combined_data = {"data": []}
    for tr in tool_results:
        result = tr.get("result", {})
        if result.get("data"):
            if isinstance(result["data"], list):
                combined_data["data"].extend(result["data"])
            else:
                combined_data["data"].append(result["data"])
    
    validation = validator.validate_response(user_question, combined_data, response)
    return validation


def has_valid_data(tool_results: List[Dict]) -> bool:
    """Check if any tool returned valid data."""
    for result in tool_results:
        tool_result = result.get("result", {})
        if not tool_result.get("error"):
            data = tool_result.get("data")
            if data and (
                (isinstance(data, list) and len(data) > 0) or
                (isinstance(data, dict) and len(data) > 0)
            ):
                return True
    return False


@router.get("/intent")
def analyze_intent(query: str):
    """Analyze user intent for debugging."""
    from api.chatbot_tools import parse_user_intent
    intent = parse_user_intent(query)
    return {"query": query, "intent": intent}
    intent = parse_user_intent(query)
    return {"query": query, "intent": intent}
