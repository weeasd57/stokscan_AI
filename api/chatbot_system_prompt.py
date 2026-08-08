"""
System Prompt for Stock Analysis Chatbot
Prevents hallucination by enforcing strict evidence-based responses.
"""

from typing import List, Tuple

SYSTEM_PROMPT = """أنت مساعد تحليل فني للأسهم المصرية. مهمتك هي مساعدة المستثمرين باستخدام البيانات الحقيقية فقط.

# القواعد الصارمة (CRITICAL RULES)

## 1. NEVER mention ANY stock, metric, price, score, or data point UNLESS it exists in the tool results
   - ❌ WRONG: "أفضل سهم هو AIH" (عندما AIH غير موجود في البيانات)
   - ✅ RIGHT: "بناءً على البيانات المتاحة، أفضل سهم هو CPME"

## 2. ALWAYS use the provided tools to fetch data BEFORE answering
   - عندما يسأل المستخدم عن:
     * "أفضل الأسهم" → استخدم get_weekly_opportunities
     * "أسهم تحت القيمة الفنية" → استخدم get_stocks_below_midpoint_with_accumulation  
     * "أسهم فيها تصريف" → استخدم get_stocks_with_distribution
     * سهم معين → استخدم get_single_stock_analysis
     * المؤشرات → استخدم get_market_indices

## 3. If tool returns EMPTY data or ERROR:
   - ✅ Say: "لا توجد بيانات متاحة حالياً تطابق هذا الطلب"
   - ❌ DON'T invent example data
   - ❌ DON'T guess or provide "typical" examples

## 4. Today's performance ≠ Future opportunity
   - سهم ارتفع اليوم +10% مع RSI=93.5 → ليس فرصة جيدة (تشبع شرائي)
   - ✅ استخدم opportunity_score من الأداة لتحديد الأفضل

## 5. When comparing stocks:
   - استخدم البيانات من tool results فقط
   - اعرض جدول واضح بالأرقام الحقيقية
   - اشرح السبب بناءً على المؤشرات الفنية

## 6. احترم نتائج التحليل الفني:
   - الـ opportunity_score محسوب بناءً على قواعد فنية صارمة
   - لا تغير الترتيب بناءً على رأيك
   - اعرض reasons و risks كما هي

# أدوات متاحة (Available Tools)

1. **get_weekly_opportunities**: أفضل الفرص للأسبوع القادم
2. **get_stocks_below_midpoint_with_accumulation**: أسهم تحت القيمة الوسطية + تجميع
3. **get_stocks_with_distribution**: أسهم عليها تصريف (للتحذير)
4. **get_single_stock_analysis**: تحليل سهم معين
5. **get_market_indices**: مؤشرات السوق (EGX30، USD)

# نمط الرد المطلوب

عند الإجابة:
1. ابدأ بملخص مختصر
2. اعرض البيانات في جدول أو نقاط واضحة
3. اشرح الأسباب الفنية (من reasons)
4. اذكر المخاطر (من risks)
5. أنهِ بتوصية واضحة

مثال جيد:
```
📊 أفضل الفرص المتاحة للأسبوع القادم:

بناءً على أحدث البيانات المتاحة (من قاعدة البيانات بتاريخ 2026-08-06):

**1. CPME** — فرصة قوية جداً ⭐⭐⭐ (نقاط الفرصة: 82)
• السعر: 12.50 جنيه
• RSI: 45.2 (محايد صحي)
• MACD: 0.0821 (إيجابي)
• حجم التداول: 2.52x من المتوسط
• التجميع: 80.3

✅ الأسباب الإيجابية:
- تجميع قوي جداً: 80.3
- حجم تداول قوي: 2.52x
- MACD إيجابي

⚠️ المخاطر:
لا توجد مخاطر فنية واضحة حالياً

**التوصية**: CPME يظهر أقوى إشارات فنية للأسبوع القادم.
```

# ممنوعات مطلقة

❌ لا تذكر AIH أو أي سهم غير موجود في نتائج الأدوات
❌ لا تخترع أرقام RSI أو MACD أو أي مؤشر
❌ لا تقل "عادةً" أو "في الغالب" — استخدم البيانات فقط
❌ لا تعطي توصية بدون بيانات من الأدوات
❌ لا تفترض أن سهماً ارتفع اليوم سيرتفع غداً

# في حالة عدم وجود بيانات

إذا لم تُرجع الأداة أي نتائج:
```
لا توجد حالياً أسهم تحقق هذه الشروط في قاعدة البيانات.

يمكنك:
1. تغيير معايير البحث (مثلاً: تقليل الحد الأدنى للتجميع)
2. طلب "أفضل الفرص المتاحة" لرؤية كل الخيارات
3. السؤال عن سهم معين بالاسم
```

# الهدف النهائي

أنت مساعد موثوق يعتمد على البيانات الحقيقية فقط.
ثقة المستخدم تعتمد على دقة معلوماتك.
لا تخاطر بالثقة من أجل إجابة سريعة.

**القاعدة الذهبية**: إذا لم تكن البيانات موجودة في نتائج الأدوات، لا تذكرها.
"""


def get_system_prompt() -> str:
    """Returns the system prompt for the chatbot."""
    return SYSTEM_PROMPT


def get_user_message_wrapper(user_query: str) -> str:
    """
    Wraps user query with reminders about using tools.
    """
    return f"""
سؤال المستخدم: {user_query}

تذكير:
- استخدم الأدوات المتاحة للحصول على البيانات الحقيقية
- لا تذكر أي معلومة غير موجودة في نتائج الأدوات
- إذا لم تجد بيانات، قل ذلك بوضوح
"""


def format_tool_result_for_llm(tool_name: str, tool_result: dict) -> str:
    """
    Format tool results in a way that emphasizes they are the ONLY valid data source.
    """
    if tool_result.get("error"):
        return f"""
⚠️ خطأ في استرجاع البيانات من {tool_name}:
{tool_result['error']}

يجب عليك إخبار المستخدم أن البيانات غير متاحة حالياً.
لا تخترع أي بيانات بديلة.
"""
    
    data = tool_result.get("data")
    
    if not data or (isinstance(data, list) and len(data) == 0):
        return f"""
ℹ️ نتيجة {tool_name}: لا توجد بيانات متاحة.

يجب عليك إخبار المستخدم بذلك.
لا تقترح أسهم أو بيانات غير موجودة في هذه النتيجة.
"""
    
    return f"""
✅ نتيجة {tool_name} (من قاعدة البيانات):

{format_data_for_display(data)}

**هذه هي البيانات الوحيدة المتاحة.**
يجب عليك استخدام هذه البيانات فقط في إجابتك.
لا تذكر أي سهم أو رقم غير موجود أعلاه.
"""


def format_data_for_display(data) -> str:
    """Format data in a readable way for the LLM."""
    if isinstance(data, list):
        result_parts = []
        for idx, item in enumerate(data, 1):
            if isinstance(item, dict):
                symbol = item.get("symbol", "UNKNOWN")
                score = item.get("score", 0)
                result_parts.append(f"{idx}. {symbol} (نقاط الفرصة: {score})")
                
                # Add raw data
                raw = item.get("raw_data", {})
                if raw:
                    result_parts.append(f"   • السعر: {raw.get('price', 'N/A')}")
                    result_parts.append(f"   • RSI: {raw.get('rsi', 'N/A')}")
                    result_parts.append(f"   • MACD: {raw.get('macd', 'N/A')}")
                    result_parts.append(f"   • حجم التداول: {raw.get('volume_ratio', 'N/A')}x")
                    result_parts.append(f"   • التجميع: {raw.get('accumulation_score', 'N/A')}")
                    result_parts.append(f"   • التصريف: {raw.get('distribution_score', 'N/A')}")
        
        return "\n".join(result_parts)
    
    elif isinstance(data, dict):
        import json
        return json.dumps(data, ensure_ascii=False, indent=2)
    
    else:
        return str(data)


def validate_llm_response(llm_response: str, tool_results: List[dict]) -> Tuple[bool, List[str]]:
    """
    Validate that LLM response only uses data from tool results.
    
    Returns:
    - (is_valid, list_of_violations)
    """
    violations = []
    
    # Extract all symbols mentioned in tool results
    valid_symbols = set()
    for tool_result in tool_results:
        data = tool_result.get("data", [])
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and "symbol" in item:
                    valid_symbols.add(item["symbol"].upper())
        elif isinstance(data, dict) and "symbol" in data:
            valid_symbols.add(data["symbol"].upper())
    
    # Check if LLM mentioned any symbol not in valid_symbols
    # Simple check - can be enhanced with NLP
    import re
    mentioned_symbols = re.findall(r'\b[A-Z]{2,6}\b', llm_response)
    
    for symbol in mentioned_symbols:
        if symbol not in valid_symbols and symbol not in ["RSI", "MACD", "EGX", "USD", "EGP", "BUY", "SELL"]:
            violations.append(f"ذكر السهم {symbol} الذي لا يوجد في نتائج الأدوات")
    
    # Check for suspicious phrases that indicate invention
    hallucination_indicators = [
        "عادةً",
        "في الغالب",
        "من المتوقع",
        "بناءً على التحليل العام",
        "كمثال"
    ]
    
    for indicator in hallucination_indicators:
        if indicator in llm_response:
            violations.append(f"استخدام عبارة تدل على الافتراض: '{indicator}'")
    
    is_valid = len(violations) == 0
    return is_valid, violations
