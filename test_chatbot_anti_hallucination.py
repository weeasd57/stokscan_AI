#!/usr/bin/env python3
"""
Test Chatbot Anti-Hallucination Solution
Tests the complete flow without LLM to ensure data accuracy.
"""

import sys
from pathlib import Path

# Add api to path
sys.path.insert(0, str(Path(__file__).parent / "api"))

from api.opportunity_analyzer import OpportunityAnalyzer
from api.chatbot_tools import ChatbotTools, execute_tool
from api.routers.chatbot import determine_tools_needed, generate_direct_response


def test_opportunity_analyzer():
    """Test the Analysis Engine."""
    print("=" * 70)
    print("TEST 1: Opportunity Analyzer")
    print("=" * 70)
    
    analyzer = OpportunityAnalyzer()
    
    # Mock stock data
    stock_data = {
        "symbol": "CPME",
        "close_price": 12.50,
        "rsi": 45.2,
        "macd": 0.0821,
        "volume_ratio": 2.52,
        "accumulation_score": 80.3,
        "distribution_score": 0,
        "support": 10.50,
        "resistance": 14.00
    }
    
    result = analyzer.calculate_weekly_opportunity_score(stock_data)
    
    print(f"\n✅ Analysis Result for {result['symbol']}:")
    print(f"   Score: {result['score']}")
    print(f"   Recommendation: {result['recommendation']}")
    print(f"   Reasons: {result['reasons']}")
    print(f"   Risks: {result['risks']}")
    
    assert result['symbol'] == "CPME", "Symbol mismatch"
    assert result['score'] > 0, "Score should be positive"
    assert len(result['reasons']) > 0, "Should have reasons"
    
    print("\n✅ TEST 1 PASSED: Analyzer works correctly\n")


def test_overbought_detection():
    """Test that overbought stocks get lower scores."""
    print("=" * 70)
    print("TEST 2: Overbought Detection (UTOP case)")
    print("=" * 70)
    
    analyzer = OpportunityAnalyzer()
    
    # UTOP with overbought RSI
    utop_data = {
        "symbol": "UTOP",
        "close_price": 130.71,
        "rsi": 93.5,  # Overbought!
        "macd": 0.05,
        "volume_ratio": 5.61,
        "accumulation_score": 50,
        "distribution_score": 0,
        "support": 100.0,
        "resistance": 135.0
    }
    
    result = analyzer.calculate_weekly_opportunity_score(utop_data)
    
    print(f"\n📊 Analysis Result for {result['symbol']}:")
    print(f"   Score: {result['score']}")
    print(f"   Recommendation: {result['recommendation']}")
    print(f"   Risks: {result['risks']}")
    
    # Check that RSI overbought is detected as risk
    has_rsi_risk = any("RSI" in risk and "تشبع شرائي" in risk for risk in result['risks'])
    
    assert has_rsi_risk, "❌ FAIL: RSI overbought not detected as risk!"
    assert result['score'] < 70, f"❌ FAIL: Overbought stock should have lower score, got {result['score']}"
    
    print("\n✅ TEST 2 PASSED: Overbought stocks correctly identified as risky\n")


def test_tool_determination():
    """Test query analysis."""
    print("=" * 70)
    print("TEST 3: Tool Determination")
    print("=" * 70)
    
    test_cases = [
        ("إيه أفضل سهم؟", "get_weekly_opportunities"),
        ("أسهم تحت القيمة الفنية", "get_stocks_below_midpoint_with_accumulation"),
        ("أسهم فيها تصريف", "get_stocks_with_distribution"),
        ("حلل سهم CCAP", "get_single_stock_analysis"),
        ("إيه وضع EGX30", "get_market_indices"),
    ]
    
    for query, expected_tool in test_cases:
        tools = determine_tools_needed(query)
        tool_names = [t["name"] for t in tools]
        
        print(f"\n📝 Query: '{query}'")
        print(f"   Expected: {expected_tool}")
        print(f"   Got: {tool_names}")
        
        assert expected_tool in tool_names, f"❌ FAIL: Expected {expected_tool} in {tool_names}"
        print("   ✅ PASS")
    
    print("\n✅ TEST 3 PASSED: Query analysis works correctly\n")


def test_direct_response_generation():
    """Test that response is generated without hallucination."""
    print("=" * 70)
    print("TEST 4: Direct Response Generation (Anti-Hallucination)")
    print("=" * 70)
    
    # Mock tool results
    tool_results = [
        {
            "tool": "get_weekly_opportunities",
            "result": {
                "error": None,
                "data": [
                    {
                        "symbol": "CPME",
                        "score": 82,
                        "recommendation": "فرصة قوية جداً ⭐⭐⭐",
                        "reasons": ["تجميع قوي جداً: 80.3", "حجم تداول قوي: 2.52x"],
                        "risks": [],
                        "raw_data": {
                            "price": 12.50,
                            "rsi": 45.2,
                            "macd": 0.0821,
                            "volume_ratio": 2.52,
                            "accumulation_score": 80.3,
                            "distribution_score": 0
                        }
                    }
                ],
                "query_date": "2026-08-08T10:00:00"
            }
        }
    ]
    
    response = generate_direct_response("إيه أفضل سهم؟", tool_results)
    
    print(f"\n📝 Generated Response:\n")
    print(response)
    print("\n" + "=" * 70)
    
    # Validation checks
    assert "CPME" in response, "❌ FAIL: CPME not mentioned"
    assert "12.50" in response, "❌ FAIL: Price not mentioned"
    assert "45.2" in response, "❌ FAIL: RSI not mentioned"
    assert "2.52" in response, "❌ FAIL: Volume ratio not mentioned"
    assert "80.3" in response, "❌ FAIL: Accumulation score not mentioned"
    
    # Check that AIH is NOT mentioned
    assert "AIH" not in response, "❌ FAIL: Hallucinated symbol AIH found in response!"
    
    # Check that fake values are NOT mentioned
    assert "15.25" not in response, "❌ FAIL: Fake USD value found!"
    assert "12,456" not in response, "❌ FAIL: Fake EGX30 value found!"
    
    print("\n✅ TEST 4 PASSED: Response contains only real data, no hallucination\n")


def test_empty_data_handling():
    """Test handling of empty results."""
    print("=" * 70)
    print("TEST 5: Empty Data Handling")
    print("=" * 70)
    
    # Mock empty tool results
    tool_results = [
        {
            "tool": "get_weekly_opportunities",
            "result": {
                "error": None,
                "data": [],
                "message": "لا توجد بيانات متاحة حالياً"
            }
        }
    ]
    
    response = generate_direct_response("إيه أفضل سهم؟", tool_results)
    
    print(f"\n📝 Response for Empty Data:\n")
    print(response)
    print("\n" + "=" * 70)
    
    # Should NOT mention any specific stock
    assert "CPME" not in response, "❌ FAIL: Mentioned stock when no data available"
    assert "AIH" not in response, "❌ FAIL: Hallucinated stock with no data"
    
    # Should clearly state no data
    assert "لا توجد" in response or "غير متاح" in response, "❌ FAIL: Didn't clearly state no data"
    
    print("\n✅ TEST 5 PASSED: Handles empty data correctly without hallucination\n")


def test_comparison_logic():
    """Test that comparisons are evidence-based."""
    print("=" * 70)
    print("TEST 6: Comparison Logic (CPME vs UTOP)")
    print("=" * 70)
    
    analyzer = OpportunityAnalyzer()
    
    stocks = [
        {
            "symbol": "CPME",
            "close_price": 12.50,
            "rsi": 45.2,
            "macd": 0.0821,
            "volume_ratio": 2.52,
            "accumulation_score": 80.3,
            "distribution_score": 0,
            "support": 10.50,
            "resistance": 14.00
        },
        {
            "symbol": "UTOP",
            "close_price": 130.71,
            "rsi": 93.5,  # Overbought
            "macd": 0.05,
            "volume_ratio": 5.61,
            "accumulation_score": 50,
            "distribution_score": 0,
            "support": 100.0,
            "resistance": 135.0
        }
    ]
    
    ranked = analyzer.rank_opportunities(stocks, top_n=2)
    
    print(f"\n📊 Ranking Results:")
    for idx, stock in enumerate(ranked, 1):
        print(f"   {idx}. {stock['symbol']} (Score: {stock['score']})")
    
    # CPME should rank higher than UTOP
    assert ranked[0]['symbol'] == "CPME", f"❌ FAIL: CPME should rank first, got {ranked[0]['symbol']}"
    assert ranked[0]['score'] > ranked[1]['score'], "❌ FAIL: Higher ranked should have higher score"
    
    print(f"\n✅ Correct ranking:")
    print(f"   1st: {ranked[0]['symbol']} (Score: {ranked[0]['score']}) - تجميع قوي")
    print(f"   2nd: {ranked[1]['symbol']} (Score: {ranked[1]['score']}) - تشبع شرائي")
    
    print("\n✅ TEST 6 PASSED: Comparison based on technical analysis, not today's gain\n")


def run_all_tests():
    """Run all tests."""
    print("\n" + "=" * 70)
    print("RUNNING ALL CHATBOT ANTI-HALLUCINATION TESTS")
    print("=" * 70 + "\n")
    
    try:
        test_opportunity_analyzer()
        test_overbought_detection()
        test_tool_determination()
        test_direct_response_generation()
        test_empty_data_handling()
        test_comparison_logic()
        
        print("\n" + "=" * 70)
        print("✅ ALL TESTS PASSED!")
        print("=" * 70)
        print("\n🎯 Summary:")
        print("   1. ✅ Opportunity Analyzer works correctly")
        print("   2. ✅ Overbought detection prevents bad recommendations")
        print("   3. ✅ Query analysis determines correct tools")
        print("   4. ✅ Direct response contains only real data")
        print("   5. ✅ Empty data handled without hallucination")
        print("   6. ✅ Comparisons based on technical analysis")
        print("\n🚀 The chatbot is ready and hallucination-free!")
        print("=" * 70 + "\n")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}\n")
        raise
    except Exception as e:
        print(f"\n❌ ERROR: {e}\n")
        raise


if __name__ == "__main__":
    run_all_tests()
