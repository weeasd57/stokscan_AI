#!/usr/bin/env python3
"""
Test the last 5 questions from test_session_flow.mjs
"""

import sys
from pathlib import Path
from typing import Dict
sys.path.insert(0, str(Path(__file__).parent / "api"))

from api.chatbot_tools import parse_user_intent
from api.routers.chatbot import execute_tools_for_intent, generate_response_from_intent

# Last 5 questions from test_session_flow.mjs
questions = [
    "ما رأيك في محفظتي",
    "تحليل السيولة لـ FERC",
    "اى رائيك فى سهم المطاحن و الاسكندريه",
    "انا شاري سهم راية ب 8.14 وهو قعد ينزل ابيعه بكام ؟",
    "نصائح بخصوص جميع اسهمي ... وهل تنصح بسهم النيل للادوية ؟"
]


def test_question(question: str, index: int):
    """Test a single question through the new architecture."""
    print("\n" + "=" * 80)
    print(f"QUESTION {index + 1}: {question}")
    print("=" * 80)
    
    # Step 1: Parse Intent
    print("\n📍 STEP 1: Parse Intent")
    intent = parse_user_intent(question)
    print(f"Intent Type: {intent.get('intent')}")
    print(f"Intent Details: {intent}")
    
    # Step 2: Determine what tools to call
    print("\n📍 STEP 2: Execute Tools")
    try:
        tool_results = execute_tools_for_intent(intent)
        
        if tool_results:
            print(f"✅ Executed {len(tool_results)} tool(s)")
            for tr in tool_results:
                tool_name = tr.get("tool")
                has_data = tr.get("result", {}).get("data") is not None
                has_error = tr.get("result", {}).get("error") is not None
                print(f"   - {tool_name}: {'✅ Has Data' if has_data else '❌ Error' if has_error else '⚠️ No Data'}")
        else:
            print("⚠️ No tools executed")
    except Exception as e:
        print(f"❌ Tool execution error: {e}")
        tool_results = []
    
    # Step 3: Generate Response
    print("\n📍 STEP 3: Generate Response")
    try:
        if tool_results:
            response = generate_response_from_intent(intent, tool_results)
            print("✅ Response generated")
            print("\n" + "-" * 80)
            print("RESPONSE:")
            print("-" * 80)
            print(response[:500])  # First 500 chars
            if len(response) > 500:
                print(f"\n... (truncated, total {len(response)} chars)")
        else:
            print("⚠️ No response generated (no tool results)")
    except Exception as e:
        print(f"❌ Response generation error: {e}")
    
    # Analysis
    print("\n📍 ANALYSIS:")
    analyze_intent_handling(intent, question)


def analyze_intent_handling(intent: Dict, question: str):
    """Analyze how well the intent was parsed."""
    intent_type = intent.get("intent")
    
    if intent_type == "general":
        print("⚠️ Intent marked as 'general' - might need better parsing")
        print("   Question is likely one of:")
        
        if "محفظ" in question.lower() or "portfolio" in question.lower():
            print("   → Portfolio analysis (not yet supported)")
        
        elif "نصائح" in question.lower() or "advice" in question.lower():
            print("   → General advice (not yet supported)")
        
        elif "بيع" in question.lower() or "sell" in question.lower() or "ابيع" in question.lower():
            print("   → Sell decision (requires price prediction - not yet supported)")
    
    elif intent_type == "stock_analysis":
        ticker = intent.get("ticker")
        if ticker:
            print(f"✅ Intent correctly identified: Single stock analysis for {ticker}")
        else:
            print("⚠️ Intent is stock_analysis but no ticker extracted")
    
    elif intent_type == "comparison":
        tickers = intent.get("tickers", [])
        print(f"✅ Intent correctly identified: Comparison of {len(tickers)} stocks: {tickers}")
    
    elif intent_type == "screening":
        criteria = intent.get("criteria")
        print(f"✅ Intent correctly identified: Screening with criteria '{criteria}'")
    
    else:
        print(f"ℹ️ Intent type: {intent_type}")


def main():
    print("\n" + "=" * 80)
    print("TESTING LAST 5 QUESTIONS FROM test_session_flow.mjs")
    print("=" * 80)
    print("\nUsing 3-Layer Architecture:")
    print("1. Intent Parser → 2. Tool Executor → 3. Response Generator")
    print("=" * 80)
    
    for i, question in enumerate(questions):
        test_question(question, i)
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    print("\n✅ Questions that work with current architecture:")
    print("   - 'تحليل السيولة لـ FERC' (single stock analysis)")
    print("   - 'اى رائيك فى سهم المطاحن و الاسكندريه' (comparison)")
    
    print("\n⚠️ Questions that need additional support:")
    print("   - 'ما رأيك في محفظتي' (portfolio analysis)")
    print("   - 'انا شاري سهم راية ب 8.14...' (sell decision with context)")
    print("   - 'نصائح بخصوص جميع اسهمي' (portfolio advice)")
    
    print("\n📝 Recommendations:")
    print("   1. Add 'portfolio_analysis' intent type")
    print("   2. Add 'sell_decision' intent type with entry price context")
    print("   3. Add 'general_advice' handler with disclaimer")
    print("   4. These would still use Analysis Engine (no LLM guessing)")
    
    print("\n" + "=" * 80)


if __name__ == "__main__":
    main()
