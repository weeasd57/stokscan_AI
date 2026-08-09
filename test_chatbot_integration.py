#!/usr/bin/env python3
"""
Integration Test for Chatbot API
Tests the full API endpoint flow.
"""

import requests
import json

BASE_URL = "http://localhost:8000"


def test_chat_endpoint():
    """Test the main chat endpoint."""
    print("=" * 70)
    print("INTEGRATION TEST: Chatbot API Endpoint")
    print("=" * 70)
    
    # Test 1: Weekly opportunities
    print("\n📝 Test 1: Weekly Opportunities Query")
    response = requests.post(
        f"{BASE_URL}/chatbot/chat",
        json={
            "messages": [
                {"role": "user", "content": "إيه أفضل سهم؟"}
            ]
        }
    )
    
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Response received:")
        print(f"   Length: {len(data.get('response', ''))} chars")
        print(f"   Tool calls: {len(data.get('tool_calls', []))}")
        print(f"\n📄 Response Preview:")
        print(data.get('response', '')[:500])
    else:
        print(f"❌ Error: {response.text}")
    
    # Test 2: Specific stock
    print("\n" + "=" * 70)
    print("📝 Test 2: Single Stock Analysis")
    response = requests.post(
        f"{BASE_URL}/chatbot/chat",
        json={
            "messages": [
                {"role": "user", "content": "حلل سهم CCAP"}
            ]
        }
    )
    
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Response received:")
        print(f"\n📄 Response:")
        print(data.get('response', ''))
    else:
        print(f"❌ Error: {response.text}")
    
    # Test 3: Tools endpoint
    print("\n" + "=" * 70)
    print("📝 Test 3: Available Tools")
    response = requests.get(f"{BASE_URL}/chatbot/tools")
    
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Available tools:")
        for tool in data.get('tools', []):
            print(f"   - {tool['name']}: {tool['description'][:50]}...")
    else:
        print(f"❌ Error: {response.text}")
    
    # Test 4: Query Analysis
    print("\n" + "=" * 70)
    print("📝 Test 4: Query Analysis")
    response = requests.post(
        f"{BASE_URL}/chatbot/analyze",
        params={"query": "إيه أفضل سهم للأسبوع القادم؟"}
    )
    
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Analysis result:")
        print(f"   Query: {data.get('query')}")
        print(f"   Tools to call: {[t['name'] for t in data.get('tools_to_call', [])]}")
    else:
        print(f"❌ Error: {response.text}")
    
    print("\n" + "=" * 70)
    print("✅ INTEGRATION TESTS COMPLETED")
    print("=" * 70)


if __name__ == "__main__":
    print("\n⚠️  Make sure the API server is running: python -m uvicorn api.main:app --reload\n")
    
    try:
        # Quick health check
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            print("✅ Server is running\n")
            test_chat_endpoint()
        else:
            print("❌ Server health check failed")
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to server. Please start it with:")
        print("   python -m uvicorn api.main:app --reload")
    except Exception as e:
        print(f"❌ Error: {e}")
