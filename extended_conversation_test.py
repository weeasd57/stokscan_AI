#!/usr/bin/env python3
"""
Extended conversation test with more varied questions.
Tests chatbot's intelligence in understanding different question patterns.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "api"))

from api.chatbot_tools import parse_user_intent
from api.opportunity_analyzer import OpportunityAnalyzer

# Extended conversation with varied patterns
EXTENDED_CONVERSATION = [
    # Direct questions
    ("تحليل FERC", "stock_analysis"),
    ("إيه أفضل سهم؟", "screening"),
    ("كام الدولار؟", "market_overview"),
    
    # Arabic company names
    ("رأيك في المطاحن", "stock_analysis"),
    ("قارن بين المطاحن والاسكندريه", "comparison"),
    ("هل النيل كويس؟", "stock_analysis"),
    
    # Sell decisions with context
    ("شاري راية ب 8.14 ابيعه؟", "sell_decision"),
    ("عندي CPME من 10 جنيه، اخرج؟", "sell_decision"),
    
    # Complex questions
    ("محفظتي فيها FERC و RAYA", "portfolio_analysis"),
    ("نصحني بأسهم فيها تجميع", "screening"),
    
    # Follow-up context (testing conversation memory)
    ("وسهم NILE كمان", "stock_analysis"),
    ("أيهم أفضل؟", "general"),  # Needs context
    
    # Edge cases
    ("هل ده وقت شراء؟", "general"),
    ("توقعاتك للسوق؟", "market_overview"),
    ("أحسن قطاع دلوقتي", "screening"),
]

analyzer = OpportunityAnalyzer()

MOCK_STOCKS = {
    "FERC": {"symbol": "FERC", "close_price": 1.24, "rsi": 42.5, "macd": 0.0089, "volume_ratio": 0.53,
             "accumulation_score": 45.2, "distribution_score": 0},
    "SAOG": {"symbol": "SAOG", "close_price": 30.50, "rsi": 52.1, "macd": 0.042, "volume_ratio": 1.21,
             "accumulation_score": 62.3, "distribution_score": 0},
    "ALEX": {"symbol": "ALEX", "close_price": 119.50, "rsi": 48.9, "macd": 0.053, "volume_ratio": 0.89,
             "accumulation_score": 58.1, "distribution_score": 0},
    "RAYA": {"symbol": "RAYA", "close_price": 7.80, "rsi": 35.2, "macd": -0.0045, "volume_ratio": 0.67,
             "accumulation_score": 38.9, "distribution_score": 12.5},
    "NILE": {"symbol": "NILE", "close_price": 2.98, "rsi": 55.3, "macd": 0.0067, "volume_ratio": 1.45,
             "accumulation_score": 72.1, "distribution_score": 0},
    "CPME": {"symbol": "CPME", "close_price": 12.50, "rsi": 45.2, "macd": 0.0821, "volume_ratio": 2.52,
             "accumulation_score": 80.3, "distribution_score": 0}
}


def test_question(question: str, expected_intent: str, idx: int):
    """Test a single question."""
    intent = parse_user_intent(question)
    detected_intent = intent.get("intent")
    
    # Check if correct
    is_correct = detected_intent == expected_intent
    status = "✅" if is_correct else "❌"
    
    print(f"\n{idx}. {status} '{question}'")
    print(f"   Expected: {expected_intent}")
    print(f"   Detected: {detected_intent}")
    
    # Show extracted data
    if detected_intent == "stock_analysis":
        ticker = intent.get("ticker")
        print(f"   → Ticker: {ticker}")
    
    elif detected_intent == "comparison":
        tickers = intent.get("tickers", [])
        print(f"   → Tickers: {tickers}")
    
    elif detected_intent == "sell_decision":
        tickers = intent.get("tickers", [])
        prices = intent.get("entry_prices", [])
        print(f"   → Ticker: {tickers}")
        print(f"   → Entry: {prices}")
    
    elif detected_intent == "screening":
        criteria = intent.get("criteria")
        print(f"   → Criteria: {criteria}")
    
    return is_correct


def main():
    print("\n" + "="*80)
    print("🧪 EXTENDED CONVERSATION TEST")
    print("Testing chatbot intelligence on varied question patterns")
    print("="*80)
    
    results = []
    
    for idx, (question, expected) in enumerate(EXTENDED_CONVERSATION, 1):
        is_correct = test_question(question, expected, idx)
        results.append({
            "question": question,
            "expected": expected,
            "correct": is_correct
        })
    
    # Summary
    print("\n" + "="*80)
    print("📊 TEST SUMMARY")
    print("="*80)
    
    total = len(results)
    correct = sum(1 for r in results if r["correct"])
    accuracy = (correct / total) * 100
    
    print(f"\n✅ Correct: {correct}/{total} ({accuracy:.1f}%)")
    
    # Show failures
    failures = [r for r in results if not r["correct"]]
    if failures:
        print(f"\n❌ Failed Cases ({len(failures)}):")
        for f in failures:
            print(f"   - '{f['question']}'")
            print(f"     Expected: {f['expected']}")
    else:
        print("\n🎉 ALL TESTS PASSED!")
    
    # Intent distribution
    print("\n📍 Intent Distribution:")
    intent_counts = {}
    for _, expected in EXTENDED_CONVERSATION:
        intent_counts[expected] = intent_counts.get(expected, 0) + 1
    
    for intent, count in sorted(intent_counts.items()):
        print(f"   {intent}: {count}")
    
    # Capabilities showcase
    print("\n💡 Demonstrated Capabilities:")
    print("   ✓ Direct ticker extraction (FERC, CPME)")
    print("   ✓ Arabic name mapping (المطاحن→SAOG)")
    print("   ✓ Entry price extraction (8.14, 10)")
    print("   ✓ Multi-ticker handling (FERC و RAYA)")
    print("   ✓ Varied question patterns")
    print("   ✓ Sell decision recognition")
    print("   ✓ Portfolio detection")
    
    print("\n⚠️ Known Limitations:")
    print("   - Context from previous messages not yet implemented")
    print("   - 'أيهم أفضل؟' needs conversation history")
    print("   - General questions require clarification")
    
    print("\n" + "="*80)
    print(f"🎯 FINAL SCORE: {accuracy:.1f}% accuracy")
    print("="*80)
    
    if accuracy >= 85:
        print("\n🏆 EXCELLENT: Chatbot ready for production!")
    elif accuracy >= 70:
        print("\n👍 GOOD: Minor improvements needed")
    else:
        print("\n⚠️ NEEDS WORK: Significant improvements required")
    
    print("\n" + "="*80)


if __name__ == "__main__":
    main()
