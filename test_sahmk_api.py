#!/usr/bin/env python3
"""
Test script for SAHMK API using the provided test API key.
Tests getting list of companies/stocks from the API.
"""
import os
import requests
import json

API_KEY = os.environ.get("SAHMK_API_KEY", "").strip()
BASE_URL = "https://api.sahmk.sa/api/v1"

def test_companies_list():
    """Test GET /companies/ endpoint to get list of stocks"""
    url = f"{BASE_URL}/companies/"
    headers = {"X-API-Key": API_KEY}
    params = {"market": "TASI", "limit": 20, "offset": 0}
    
    print(f"Testing: GET {url}")
    print("Headers: X-API-Key: [redacted]")
    print(f"Params: {params}")
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        print(f"\nStatus Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            if "results" in data:
                print(f"\n--- Found {len(data['results'])} companies (total: {data.get('total', 'unknown')}) ---")
                for company in data["results"][:15]:
                    name_ar = company['name_ar'].encode('ascii', 'replace').decode('ascii')
                    name_en = company['name_en']
                    print(f"  {company['symbol']}: {name_ar} ({name_en}) - {company['market']} [{company['security_type']}]")
                
                # Save full response to file for inspection
                with open("sahmk_companies_response.json", "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                print("\n[Full response saved to sahmk_companies_response.json]")
            return True
        else:
            print(f"\nError Response:")
            print(response.text)
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"\nRequest failed: {e}")
        return False

def test_single_quote():
    """Test GET /quote/{symbol}/ endpoint for a single stock"""
    url = f"{BASE_URL}/quote/2222/"
    headers = {"X-API-Key": API_KEY}
    
    print(f"\n\nTesting: GET {url}")
    
    try:
        response = requests.get(url, headers=headers, timeout=30)
        print(f"\nStatus Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"\nSuccess! Quote for 2222:")
            name = data.get('name', '')
            safe_name = name.encode('ascii', 'replace').decode('ascii') if name else 'N/A'
            print(f"  Symbol: {data.get('symbol')}")
            print(f"  Name: {safe_name}")
            print(f"  Name EN: {data.get('name_en', 'N/A')}")
            print(f"  Price: {data.get('price')}")
            print(f"  Change: {data.get('change')} ({data.get('change_percent')}%)")
            print(f"  Volume: {data.get('volume')}")
            print(f"  Updated: {data.get('updated_at')}")
            print(f"  Is Delayed: {data.get('is_delayed')}")
            
            with open("sahmk_quote_response.json", "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print("[Full response saved to sahmk_quote_response.json]")
            return True
        else:
            print(f"\nError Response:")
            print(response.text)
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"\nRequest failed: {e}")
        return False

def test_market_summary():
    """Test GET /market/summary/ endpoint"""
    url = f"{BASE_URL}/market/summary/"
    headers = {"X-API-Key": API_KEY}
    params = {"index": "TASI"}
    
    print(f"\n\nTesting: GET {url}")
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        print(f"\nStatus Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"\nSuccess! Market Summary:")
            print(f"  Index: {data.get('index')}")
            print(f"  Value: {data.get('index_value')}")
            print(f"  Change: {data.get('index_change')} ({data.get('index_change_percent')}%)")
            print(f"  Total Volume: {data.get('total_volume')}")
            print(f"  Advancing: {data.get('advancing')}")
            print(f"  Declining: {data.get('declining')}")
            print(f"  Unchanged: {data.get('unchanged')}")
            print(f"  Market Mood: {data.get('market_mood')}")
            print(f"  Timestamp: {data.get('timestamp')}")
            print(f"  Is Delayed: {data.get('is_delayed')}")
            
            with open("sahmk_market_summary_response.json", "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print("[Full response saved to sahmk_market_summary_response.json]")
            return True
        else:
            print(f"\nError Response:")
            print(response.text)
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"\nRequest failed: {e}")
        return False

if __name__ == "__main__":
    if not API_KEY:
        raise SystemExit("Set SAHMK_API_KEY in the environment before running this script.")
    print("=" * 60)
    print("SAHMK API connectivity check")
    print("=" * 60)
    
    results = []
    results.append(("Companies List", test_companies_list()))
    results.append(("Single Quote (2222)", test_single_quote()))
    results.append(("Market Summary (TASI)", test_market_summary()))
    
    print("\n" + "=" * 60)
    print("SUMMARY:")
    for name, success in results:
        status = "PASS" if success else "FAIL"
        print(f"  [{status}] - {name}")
    print("=" * 60)
