"""
Comprehensive test suite for chatbot enhancements:
1. Telegram channel link integration
2. Analytics/performance metrics integration
3. Real-time vs Supabase fallback logic
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytz
from datetime import datetime

from api.chatbot_tools import (
    parse_user_intent, execute_tool, should_use_realtime_data, check_supabase_data_freshness,
    is_market_open, _last_completed_session_date, _compute_technicals_from_ohlcv,
)
from api.routers.chatbot import generate_response_from_intent, execute_tools_for_intent

CAIRO_TZ = pytz.timezone("Africa/Cairo")


def _cairo(year, month, day, hour, minute=0):
    """Timezone-aware Cairo datetime for deterministic tests."""
    return CAIRO_TZ.localize(datetime(year, month, day, hour, minute))

def test_telegram_link_intent():
    """Test intent detection for Telegram channel link requests."""
    print("🧪 Testing Telegram link intent detection...")
    
    test_queries = [
        "رابط القناة",
        "تليجرام",
        "قناة تليجرام",
        "تابعنا",
        "telegram link",
        "channel link",
        "رابط التليجرام"
    ]
    
    for query in test_queries:
        intent = parse_user_intent(query)
        print(f"  Query: '{query}' → Intent: {intent.get('intent')}")
        assert intent.get('intent') == 'telegram_link', f"Expected telegram_link intent for '{query}'"
    
    print("✅ Telegram link intent detection tests passed\n")

def test_analytics_intent():
    """Test intent detection for analytics/performance queries."""
    print("🧪 Testing analytics intent detection...")
    
    test_queries = [
        "أداء النظام",
        "نسبة النجاح",
        "إحصائيات",
        "win rate",
        "performance stats",
        "success rate"
    ]
    
    for query in test_queries:
        intent = parse_user_intent(query)
        print(f"  Query: '{query}' → Intent: {intent.get('intent')}")
        assert intent.get('intent') == 'analytics', f"Expected analytics intent for '{query}'"
    
    print("✅ Analytics intent detection tests passed\n")

def test_telegram_link_response():
    """Test Telegram link response formatting."""
    print("🧪 Testing Telegram link response formatting...")
    
    intent = {"intent": "telegram_link", "query": "رابط القناة"}
    response = generate_response_from_intent(intent, [])
    
    print(f"  Response preview: {response[:100]}...")
    assert "تليجرام" in response or "Telegram" in response, "Response should mention Telegram"
    assert "https://t.me/egxbots/153" in response, "Response should contain Telegram link"
    
    print("✅ Telegram link response formatting tests passed\n")

def test_analytics_response():
    """Test analytics response formatting."""
    print("🧪 Testing analytics response formatting...")
    
    intent = {"intent": "analytics", "query": "أداء النظام"}
    tool_result = execute_tool("get_performance_analytics", {})
    response = generate_response_from_intent(intent, [{"tool": "get_performance_analytics", "result": tool_result}])
    
    print(f"  Response preview: {response[:100]}...")
    # Check if response contains analytics-related content
    if tool_result.get("data"):
        assert "إحصائيات" in response or "أداء" in response or "performance" in response, "Response should mention analytics"
    
    print("✅ Analytics response formatting tests passed\n")

def test_market_hours_logic():
    """Test market hours and data source selection logic."""
    print("🧪 Testing market hours and data source logic...")
    
    # Test the functions exist and return boolean values
    is_open = should_use_realtime_data()
    print(f"  should_use_realtime_data: {is_open}")
    assert isinstance(is_open, bool), "should_use_realtime_data should return boolean"
    
    is_fresh = check_supabase_data_freshness()
    print(f"  check_supabase_data_freshness: {is_fresh}")
    assert isinstance(is_fresh, bool), "check_supabase_data_freshness should return boolean"
    
    print("✅ Market hours logic tests passed\n")


def test_should_use_realtime_data_deterministic():
    """Deterministic tests for the realtime-vs-Supabase schedule."""
    print("🧪 Testing should_use_realtime_data with fixed times...")

    # 2026-09-06 is a Sunday
    # Market hours (Sun 10:00-14:30) → real-time
    assert should_use_realtime_data(_cairo(2026, 9, 6, 11, 0)) is True, "Sunday 11:00 (market hours) should be real-time"
    assert should_use_realtime_data(_cairo(2026, 9, 6, 10, 0)) is True, "Sunday 10:00 (open) should be real-time"
    assert should_use_realtime_data(_cairo(2026, 9, 6, 14, 30)) is True, "Sunday 14:30 (close) should be real-time"

    # Sync window (Sun 14:30-18:00) → real-time until Supabase is synced
    assert should_use_realtime_data(_cairo(2026, 9, 6, 15, 0)) is True, "Sunday 15:00 (sync window) should be real-time"
    assert should_use_realtime_data(_cairo(2026, 9, 6, 18, 0)) is True, "Sunday 18:00 (window end) should be real-time"

    # After sync window → Supabase
    assert should_use_realtime_data(_cairo(2026, 9, 6, 18, 1)) is False, "Sunday 18:01 should use Supabase"
    assert should_use_realtime_data(_cairo(2026, 9, 6, 22, 0)) is False, "Sunday 22:00 should use Supabase"
    assert should_use_realtime_data(_cairo(2026, 9, 7, 8, 0)) is False, "Monday 08:00 (pre-market) should use Supabase"

    # Weekend (Fri=5, Sat=6) → Supabase even inside market hours / sync window
    assert should_use_realtime_data(_cairo(2026, 9, 4, 12, 0)) is False, "Friday 12:00 should use Supabase (weekend)"
    assert should_use_realtime_data(_cairo(2026, 9, 5, 16, 0)) is False, "Saturday 16:00 should use Supabase (weekend)"

    print("✅ Deterministic schedule tests passed\n")


def test_is_market_open_deterministic():
    """Deterministic tests for market open detection."""
    print("🧪 Testing is_market_open with fixed times...")

    assert is_market_open(_cairo(2026, 9, 6, 11, 0)) is True, "Sunday 11:00 market should be open"
    assert is_market_open(_cairo(2026, 9, 6, 9, 59)) is False, "Sunday 09:59 market should be closed"
    assert is_market_open(_cairo(2026, 9, 6, 14, 31)) is False, "Sunday 14:31 market should be closed"
    assert is_market_open(_cairo(2026, 9, 4, 11, 0)) is False, "Friday 11:00 market should be closed"

    print("✅ Market open tests passed\n")


def test_last_completed_session_date():
    """Tests for the last completed EGX session date helper."""
    print("🧪 Testing _last_completed_session_date...")

    # Sunday after close → today (Sunday)
    assert _last_completed_session_date(_cairo(2026, 9, 6, 15, 0)).isoformat() == "2026-09-06"
    # Sunday before/during session → previous Thursday
    assert _last_completed_session_date(_cairo(2026, 9, 6, 11, 0)).isoformat() == "2026-09-03"
    # Friday → Thursday
    assert _last_completed_session_date(_cairo(2026, 9, 4, 12, 0)).isoformat() == "2026-09-03"
    # Saturday → Thursday
    assert _last_completed_session_date(_cairo(2026, 9, 5, 12, 0)).isoformat() == "2026-09-03"
    # Monday early morning → previous Sunday
    assert _last_completed_session_date(_cairo(2026, 9, 7, 8, 0)).isoformat() == "2026-09-06"

    print("✅ Last completed session date tests passed\n")


def test_compute_technicals_from_ohlcv():
    """Tests for real-time indicator computation from OHLCV records."""
    print("🧪 Testing _compute_technicals_from_ohlcv...")

    # Insufficient data
    assert _compute_technicals_from_ohlcv([]) is None
    assert _compute_technicals_from_ohlcv([{"close": 10, "volume": 1}]) is None

    # 40 sessions of rising prices with steady volume
    records = []
    price = 10.0
    for i in range(40):
        price *= 1.01
        records.append({
            "date": f"2026-07-{(i % 28) + 1:02d}",
            "open": price * 0.995,
            "high": price * 1.01,
            "low": price * 0.99,
            "close": round(price, 4),
            "volume": 100000,
        })
    tech = _compute_technicals_from_ohlcv(records)
    assert tech is not None, "Should compute technicals from 40 records"
    assert tech["price"] == round(price, 4), "Latest close should be the price"
    assert tech["close_price"] == tech["price"], "close_price alias should match"
    assert tech["change_pct"] is not None and tech["change_pct"] > 0, "Rising series should have positive change"
    assert tech["rsi"] is not None and tech["rsi"] > 70, f"Monotonically rising series should have high RSI, got {tech['rsi']}"
    assert tech["macd"] is not None and tech["macd"] > 0, "Rising series should have positive MACD"
    assert tech["support"] is not None and tech["support"] < tech["price"], "Support should be below price"
    assert tech["resistance"] is not None and tech["resistance"] >= tech["price"], "Resistance should be at/above price"
    assert tech["accumulation_score"] is not None and tech["accumulation_score"] > 50, "Up-volume dominance → accumulation"
    assert tech["distribution_score"] is not None and tech["distribution_score"] < 50, "Up-volume dominance → low distribution"
    assert tech["date"] == records[-1]["date"], "Data date should be the latest record date"

    # Falling series → low RSI, distribution dominance
    records_down = []
    price = 100.0
    for i in range(40):
        price *= 0.99
        records_down.append({
            "date": f"2026-07-{(i % 28) + 1:02d}",
            "open": price * 1.005,
            "high": price * 1.01,
            "low": price * 0.99,
            "close": round(price, 4),
            "volume": 100000,
        })
    tech_down = _compute_technicals_from_ohlcv(records_down)
    assert tech_down["rsi"] < 30, f"Monotonically falling series should have low RSI, got {tech_down['rsi']}"
    assert tech_down["macd"] < 0, "Falling series should have negative MACD"
    assert tech_down["distribution_score"] > 50, "Down-volume dominance → distribution"

    print("✅ Technical computation tests passed\n")

def test_stock_analysis_with_fallback():
    """Test single stock analysis with fallback logic."""
    print("🧪 Testing stock analysis with fallback logic...")
    
    # Test with a known symbol
    symbol = "COMI"
    result = execute_tool("get_single_stock_analysis", {"symbol": symbol})
    
    print(f"  Symbol: {symbol}")
    print(f"  Error: {result.get('error')}")
    print(f"  Data source: {result.get('data', {}).get('data_source', 'unknown') if result.get('data') else 'N/A'}")
    
    if result.get("data"):
        print(f"  Has data: Yes")
        assert result.get("data").get("symbol") == symbol.upper(), "Symbol should match"
    else:
        print(f"  Has data: No (expected if no data available)")
    
    print("✅ Stock analysis with fallback tests passed\n")

def test_telegram_link_in_responses():
    """Test that Telegram link appears in all stock query responses."""
    print("🧪 Testing Telegram link in stock responses...")
    
    # Test single stock response
    intent = {"intent": "stock_analysis", "ticker": "COMI"}
    tool_result = execute_tool("get_single_stock_analysis", {"symbol": "COMI"})
    
    if tool_result.get("data"):
        from api.routers.chatbot import format_single_stock_analysis
        response = format_single_stock_analysis(tool_result)
        assert "https://t.me/egxbots/153" in response, "Single stock response should contain Telegram link"
        print("  ✅ Single stock response contains Telegram link")
    
    # Test weekly opportunities response
    tool_result = execute_tool("get_weekly_opportunities", {"top_n": 3})
    if tool_result.get("data"):
        from api.routers.chatbot import format_weekly_opportunities
        response = format_weekly_opportunities(tool_result)
        assert "https://t.me/egxbots/153" in response, "Weekly opportunities response should contain Telegram link"
        print("  ✅ Weekly opportunities response contains Telegram link")
    
    print("✅ Telegram link in responses tests passed\n")

def run_all_tests():
    """Run all comprehensive tests."""
    print("=" * 60)
    print("🚀 Starting Comprehensive Chatbot Enhancement Tests")
    print("=" * 60 + "\n")
    
    try:
        test_telegram_link_intent()
        test_analytics_intent()
        test_telegram_link_response()
        test_analytics_response()
        test_market_hours_logic()
        test_should_use_realtime_data_deterministic()
        test_is_market_open_deterministic()
        test_last_completed_session_date()
        test_compute_technicals_from_ohlcv()
        test_stock_analysis_with_fallback()
        test_telegram_link_in_responses()
        
        print("=" * 60)
        print("✅ ALL TESTS PASSED SUCCESSFULLY")
        print("=" * 60)
        return True
        
    except AssertionError as e:
        print("=" * 60)
        print(f"❌ TEST FAILED: {e}")
        print("=" * 60)
        return False
    except Exception as e:
        print("=" * 60)
        print(f"❌ UNEXPECTED ERROR: {e}")
        print("=" * 60)
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
