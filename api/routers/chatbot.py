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
        
        # LAYER 1: Parse Intent
        intent = parse_user_intent(user_message)
        
        # LAYER 2: Execute Tools based on intent
        tool_results = execute_tools_for_intent(intent)
        
        # LAYER 3: Generate Direct Response
        if has_valid_data(tool_results):
            direct_response = generate_response_from_intent(intent, tool_results)
            
            # LAYER 4: Validate
            validation = validate_response(user_message, tool_results, direct_response)
            
            return ChatResponse(
                response=direct_response,
                intent=intent,
                tool_calls=tool_results,
                validation=validation
            )
        
        else:
            return ChatResponse(
                response="لا توجد بيانات متاحة حالياً تطابق طلبك.",
                intent=intent,
                tool_calls=tool_results,
                validation={"valid": True, "violations": []}
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
    
    return []
    """
    Analyze user query and determine which tools to call.
    Simple keyword-based approach (can be enhanced with LLM).
    """
    query_lower = user_query.lower()
    tools = []
    
    # Keywords mapping
    weekly_keywords = ["أسبوع", "قادم", "متوقع", "يرتفع", "فرص", "أفضل"]
    below_midpoint_keywords = ["تحت", "القيمة", "الوسطية", "رخيص", "منخفض", "تجميع"]
    distribution_keywords = ["تصريف", "بيع", "هبوط", "نزول"]
    single_stock_keywords = []  # Will extract symbol if present
    market_keywords = ["egx", "egx30", "مؤشر", "دولار", "usd"]
    
    # Check for specific stock symbol (e.g., CCAP, COMI)
    import re
    stock_pattern = r'\b[A-Z]{2,6}\b'
    potential_symbols = re.findall(stock_pattern, user_query.upper())
    
    # Filter out common words
    excluded = ["EGX", "USD", "RSI", "MACD", "EGP"]
    stock_symbols = [s for s in potential_symbols if s not in excluded]
    
    # Prioritize single stock if mentioned
    if stock_symbols:
        for symbol in stock_symbols:
            tools.append({
                "name": "get_single_stock_analysis",
                "arguments": {"symbol": symbol}
            })
        return tools  # Return early for single stock queries
    
    # Check for market indices
    if any(keyword in query_lower for keyword in market_keywords):
        tools.append({
            "name": "get_market_indices",
            "arguments": {}
        })
    
    # Check for distribution query
    if any(keyword in query_lower for keyword in distribution_keywords):
        tools.append({
            "name": "get_stocks_with_distribution",
            "arguments": {"min_distribution": 70.0}
        })
    
    # Check for below midpoint + accumulation
    elif any(keyword in query_lower for keyword in below_midpoint_keywords):
        tools.append({
            "name": "get_stocks_below_midpoint_with_accumulation",
            "arguments": {"min_accumulation": 70.0}
        })
    
    # Default: weekly opportunities
    elif any(keyword in query_lower for keyword in weekly_keywords) or not tools:
        tools.append({
            "name": "get_weekly_opportunities",
            "arguments": {"top_n": 5}
        })
    
    return tools


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
        if not data:
            continue
        
        # Format based on tool type
        if tool_name == "get_weekly_opportunities":
            response_parts.append("📊 **أفضل الفرص المتاحة للأسبوع القادم**\n")
            response_parts.append(f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})\n")
            response_parts.append(format_opportunities(data))
        
        elif tool_name == "get_stocks_below_midpoint_with_accumulation":
            response_parts.append("📊 **أسهم تحت القيمة الوسطية مع تجميع**\n")
            response_parts.append(f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})\n")
            response_parts.append(format_opportunities(data))
        
        elif tool_name == "get_stocks_with_distribution":
            response_parts.append("⚠️ **أسهم عليها تصريف (تجنب الشراء)**\n")
            response_parts.append(f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})\n")
            response_parts.append(format_opportunities(data))
        
        elif tool_name == "get_single_stock_analysis":
            response_parts.append(format_single_stock(data))
        
        elif tool_name == "get_market_indices":
            response_parts.append(format_market_indices(data))
    
    if not response_parts:
        return "لا توجد بيانات متاحة حالياً."
    
    return "\n\n".join(response_parts)


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
    
    return "لا يمكن معالجة هذا الطلب حالياً."


def format_single_stock_analysis(tool_result: Dict) -> str:
    """Format analysis for single stock - STRICTLY from database."""
    if tool_result.get("error"):
        return f"⚠️ {tool_result['error']}"
    
    data = tool_result.get("data")
    if not data:
        return "لا توجد بيانات لهذا السهم."
    
    symbol = data.get("symbol", "UNKNOWN")
    score = data.get("score", 0)
    recommendation = data.get("recommendation", "")
    raw = data.get("raw_data", {})
    reasons = data.get("reasons", [])
    risks = data.get("risks", [])
    
    # Build response from data ONLY
    lines = [
        f"📊 **تحليل سهم {symbol}**",
        f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})",
        "",
        f"**التقييم:** {recommendation} (نقاط الفرصة: {score})",
        "",
        "**البيانات الفنية المتاحة:**"
    ]
    
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
    
    return "\n".join(lines)


def format_weekly_opportunities(tool_result: Dict) -> str:
    """Format weekly opportunities screening."""
    if tool_result.get("error"):
        return f"⚠️ {tool_result['error']}"
    
    data = tool_result.get("data", [])
    if not data:
        return "لا توجد فرص متاحة حالياً."
    
    lines = [
        "📊 **أفضل الفرص المتاحة للأسبوع القادم**",
        f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})",
        f"(تم تحليل {tool_result.get('total_analyzed', 0)} سهم)",
        ""
    ]
    
    for idx, stock in enumerate(data, 1):
        lines.extend(format_stock_item(idx, stock))
        lines.append("")
    
    lines.append("ℹ️ *الترتيب بناءً على نقاط الفرصة المحسوبة من المؤشرات الفنية.*")
    
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
    """Format comparison between multiple stocks."""
    lines = ["📊 **مقارنة الأسهم**", ""]
    
    stocks_data = []
    for tr in tool_results:
        if not tr["result"].get("error") and tr["result"].get("data"):
            stocks_data.append(tr["result"]["data"])
    
    if not stocks_data:
        return "لا توجد بيانات متاحة للمقارنة."
    
    # Sort by score
    stocks_data.sort(key=lambda x: x.get("score", 0), reverse=True)
    
    for idx, stock in enumerate(stocks_data, 1):
        lines.extend(format_stock_item(idx, stock))
        lines.append("")
    
    return "\n".join(lines)


def format_below_midpoint_results(tool_result: Dict) -> str:
    """Format stocks below midpoint with accumulation."""
    lines = [
        "📊 **أسهم تحت القيمة الوسطية مع تجميع**",
        f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})",
        ""
    ]
    
    data = tool_result.get("data", [])
    if not data:
        return "لا توجد أسهم تحقق هذه الشروط حالياً."
    
    for idx, stock in enumerate(data, 1):
        lines.extend(format_stock_item(idx, stock))
        lines.append("")
    
    return "\n".join(lines)


def format_distribution_results(tool_result: Dict) -> str:
    """Format stocks with distribution."""
    lines = [
        "⚠️ **أسهم عليها تصريف (ضغط بيعي)**",
        f"(بيانات من قاعدة البيانات - {tool_result.get('query_date', '')})",
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
    
    return "\n".join(lines)


def format_market_indices(tool_result: Dict) -> str:
    """Format market indices."""
    data = tool_result.get("data", {})
    if not data:
        return "لا توجد بيانات للمؤشرات حالياً."
    
    lines = ["📈 **المؤشرات السوقية**", ""]
    
    if "EGX30" in data:
        egx = data["EGX30"]
        lines.append(f"• **مؤشر EGX30:** {egx.get('value', 'N/A')} نقطة")
        lines.append(f"  (آخر تحديث: {egx.get('date', 'N/A')})")
        lines.append("")
    
    if "USD_EGP" in data:
        usd = data["USD_EGP"]
        lines.append(f"• **سعر الدولار:** {usd.get('rate', 'N/A')} جنيه")
        lines.append(f"  (آخر تحديث: {usd.get('date', 'N/A')})")
    
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
