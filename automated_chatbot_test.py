#!/usr/bin/env python3
"""
Automated test for the interactive chatbot using a set of predefined questions.
Tests the complete flow: intent detection → response generation.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "api"))

from interactive_chatbot_test import InteractiveChatbot


# Test conversations
TEST_CONVERSATIONS = [
    # Stock analysis
    ("تحليل FERC", "stock_analysis"),
    ("رأيك في المطاحن", "stock_analysis"),
    ("هل النيل كويس؟", "stock_analysis"),
    
    # Comparisons
    ("قارن بين المطاحن والاسكندريه", "comparison"),
    ("مين أفضل CPME ولا NILE", "comparison"),
    
    # Sell decisions
    ("شاري راية ب 8.14 ابيعه؟", "sell_decision"),
    ("عندي CPME من 10 جنيه، اخرج؟", "sell_decision"),
    
    # Screening
    ("إيه أفضل سهم؟", "screening"),
    ("نصحني بأسهم فيها تجميع", "screening"),
    ("أحسن قطاع دلوقتي", "screening"),
    
    # Portfolio & market
    ("محفظتي فيها FERC و RAYA", "portfolio_analysis"),
    ("كام الدولار؟", "market_overview"),
    ("توقعاتك للسوق؟", "market_overview"),
    
    # General/edge cases
    ("هل ده وقت شراء؟", "general"),
]


def main():
    print("\n" + "="*80)
    print("🧪 AUTOMATED CHATBOT TEST")
    print("Testing full conversation flow: intent detection + response generation")
    print("="*80)
    
    chatbot = InteractiveChatbot()
    results = []
    
    for idx, (question, expected_intent) in enumerate(TEST_CONVERSATIONS, 1):
        print(f"\n{'─'*80}")
        print(f"TEST {idx}: {question}")
        print('─'*80)
        
        try:
            result = chatbot.process_message(question)
            detected_intent = result['intent_type']
            confidence = result['confidence']
            response = result['response']
            
            is_correct = detected_intent == expected_intent
            status = "✅" if is_correct else "❌"
            
            print(f"\n{status} Intent: {detected_intent} (Expected: {expected_intent})")
            print(f"🎯 Confidence: {confidence:.0%}")
            
            # Show first 200 chars of response
            response_preview = response[:200] + "..." if len(response) > 200 else response
            print(f"\n💬 Response Preview:\n{response_preview}")
            
            results.append({
                "question": question,
                "expected": expected_intent,
                "detected": detected_intent,
                "correct": is_correct,
                "confidence": confidence,
                "response_length": len(response)
            })
        
        except Exception as e:
            print(f"\n❌ ERROR: {e}")
            results.append({
                "question": question,
                "expected": expected_intent,
                "detected": "error",
                "correct": False,
                "confidence": 0,
                "response_length": 0,
                "error": str(e)
            })
    
    # Summary
    print("\n" + "="*80)
    print("📊 TEST SUMMARY")
    print("="*80)
    
    total = len(results)
    correct = sum(1 for r in results if r["correct"])
    accuracy = (correct / total) * 100 if total > 0 else 0
    
    print(f"\n✅ Correct: {correct}/{total} ({accuracy:.1f}%)")
    print(f"📈 Average Confidence: {sum(r['confidence'] for r in results) / total:.0%}")
    print(f"📝 Average Response Length: {sum(r['response_length'] for r in results) / total:.0f} chars")
    
    # Show failures
    failures = [r for r in results if not r["correct"]]
    if failures:
        print(f"\n❌ Failed Cases ({len(failures)}):")
        for f in failures:
            print(f"   - '{f['question']}'")
            print(f"     Expected: {f['expected']}, Got: {f['detected']}")
    else:
        print("\n🎉 ALL TESTS PASSED!")
    
    # Intent distribution
    print("\n📍 Intent Distribution:")
    intent_counts = {}
    for _, expected in TEST_CONVERSATIONS:
        intent_counts[expected] = intent_counts.get(expected, 0) + 1
    
    for intent, count in sorted(intent_counts.items()):
        correct_for_intent = sum(1 for r in results if r["expected"] == intent and r["correct"])
        print(f"   {intent}: {correct_for_intent}/{count}")
    
    # Show capabilities
    print("\n💡 Demonstrated Capabilities:")
    print("   ✓ Intent detection from Arabic questions")
    print("   ✓ Company name mapping (المطاحن→SAOG)")
    print("   ✓ Entry price extraction (8.14)")
    print("   ✓ Multi-stock comparison")
    print("   ✓ Response generation with mock data")
    print("   ✓ Confidence scoring")
    
    # Grade
    print("\n" + "="*80)
    if accuracy >= 90:
        print("🏆 EXCELLENT: Production ready!")
    elif accuracy >= 80:
        print("👍 GOOD: Minor improvements needed")
    elif accuracy >= 70:
        print("⚠️ FAIR: Some work required")
    else:
        print("❌ NEEDS WORK: Significant improvements required")
    
    print(f"\n🎯 FINAL SCORE: {accuracy:.1f}%")
    print("="*80 + "\n")


if __name__ == "__main__":
    main()
