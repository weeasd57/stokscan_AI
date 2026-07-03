import os
import sys

# Add project root to python path
sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    if not _supabase:
        print("Supabase not initialized")
        sys.exit(1)

    print("Fetching scan_results...")
    res = _supabase.table("scan_results").select("*").order("created_at", desc=True).limit(200).execute()
    
    if not res.data:
        print("No scan results")
        sys.exit(0)

    print(f"Loaded {len(res.data)} recommendations from scan_results")

    # Fetch open positions (simulate openPositionMap)
    position_data = _supabase.table("positions").select("*").eq("status", "open").execute()
    open_position_map = {}
    if position_data.data:
        for pos in position_data.data:
            open_position_map[pos.get("symbol", "").upper().split(".")[0]] = pos

    # Map recommendations like React context does
    mapped = []
    for row in res.data:
        sym = row.get("symbol", "")
        base_sym = sym.upper().split(".")[0]
        open_pos = open_position_map.get(base_sym)
        
        status = open_pos.get("status") if open_pos else row.get("status") or "open"
        pl_pct = open_pos.get("price_change_pct") if open_pos else row.get("profit_loss_pct")
        if pl_pct is not None:
            pl_pct = float(pl_pct)

        mapped.append({
            "symbol": sym,
            "status": status,
            "pl_pct": pl_pct,
            "precision": float(row.get("precision") or 0.5),
            "created_at": row.get("created_at")
        })

    # Sort mapped items by precision desc
    mapped.sort(key=lambda x: x["precision"], reverse=True)

    print("\nMAPPED ITEMS:")
    for idx, item in enumerate(mapped):
        print(f"Index {idx} | Symbol: {item['symbol']} | Status: {item['status']} | PL: {item['pl_pct']}% | Precision: {item['precision']}")

    # Tab Counts
    active_count = len([r for r in mapped if (r["status"] or "").lower() not in ["win", "loss"]])
    closed_count = len([r for r in mapped if (r["status"] or "").lower() in ["win", "loss"]])
    print(f"\nTab Counts: Active={active_count}, Closed={closed_count}, Total={len(mapped)}")

    # Active Trades tab simulation
    active_items = [r for r in mapped if (r["status"] or "").lower() not in ["win", "loss"]]
    # Deduplicate by symbol keeping latest (first one since sorted by precision desc, wait - in React it preserves order of items)
    seen = set()
    deduped_active = []
    for r in active_items:
        sym = r["symbol"].upper()
        if sym not in seen:
            seen.add(sym)
            deduped_active.append(r)

    print("\nACTIVE TRADES TAB (DEDUPED):")
    for idx, item in enumerate(deduped_active):
        print(f"Rank {idx+1} | Symbol: {item['symbol']} | Status: {item['status']} | PL: {item['pl_pct']}%")

    # Closed Archive tab simulation
    closed_items = [r for r in mapped if (r["status"] or "").lower() in ["win", "loss"]]
    print("\nCLOSED ARCHIVE TAB:")
    for idx, item in enumerate(closed_items):
        print(f"Rank {idx+1} | Symbol: {item['symbol']} | Status: {item['status']} | PL: {item['pl_pct']}%")

except Exception as e:
    import traceback
    traceback.print_exc()
