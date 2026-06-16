"""
Refresh similarity data:
1. Delete old rows from similarity_reports
2. Run a new full market similarity scan
3. Publish the results
"""
import os
import sys
import json
import time

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import api.stock_ai as stock_ai
from api.historical_similarity import (
    run_market_wide_similarity_scan,
    publish_similarity_report,
)

def main():
    stock_ai._init_supabase()
    if not stock_ai.supabase:
        print("❌ Supabase not initialized")
        return

    # ── Step 1: Delete old similarity reports ──
    print("=" * 60)
    print("🗑️  Step 1: Deleting old similarity_reports data...")
    print("=" * 60)
    
    # First check how many rows exist
    count_res = stock_ai.supabase.table("similarity_reports").select("id", count="exact").execute()
    old_count = count_res.count if hasattr(count_res, 'count') else len(count_res.data or [])
    print(f"   Found {old_count} existing report(s)")
    
    # Delete all rows
    del_res = stock_ai.supabase.table("similarity_reports").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    if del_res.data is not None:
        print(f"   ✅ Deleted old similarity reports successfully")
    else:
        print(f"   ⚠️  Delete may have failed: {del_res}")
    
    # Verify deletion
    verify_res = stock_ai.supabase.table("similarity_reports").select("id", count="exact").execute()
    remaining = verify_res.count if hasattr(verify_res, 'count') else len(verify_res.data or [])
    print(f"   📊 Remaining reports: {remaining}")
    
    # ── Step 2: Run full market similarity scan ──
    print()
    print("=" * 60)
    print("🔍 Step 2: Running full market similarity scan...")
    print("   This will scan ALL EGX symbols and filter out inactive/delisted stocks")
    print("=" * 60)
    
    results = run_market_wide_similarity_scan(
        k=10,
        forward_days=10,
        target_return=0.05,
        stop_loss=-0.03,
        search_scope="same_symbol",
        max_workers=15,
    )
    
    print(f"\n📊 Scan complete: {len(results)} symbols with valid matches")
    
    # ── Step 3: Publish report ──
    print()
    print("=" * 60)
    print("📤 Step 3: Publishing new similarity report...")
    print("=" * 60)
    
    report_data = {
        "name": f"Daily Similarity Scan - {time.strftime('%Y-%m-%d %H:%M')}",
        "scans": results,
        "k": 10,
        "forward_days": 10,
        "target_return": 0.05,
        "stop_loss": -0.03,
    }
    
    published = publish_similarity_report(report_data)
    print(f"   ✅ Report published!")
    print(f"   📄 Report ID: {published.get('id')}")
    print(f"   📄 Report Name: {published.get('name')}")
    print(f"   📊 Total symbols in report: {len(published.get('scans', []))}")
    
    print()
    print("=" * 60)
    print("🎉 Done! Similarity data refreshed successfully.")
    print("=" * 60)

if __name__ == "__main__":
    main()
