import os
import sys

if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

def debug_route():
    _init_supabase()
    
    country = "Egypt"
    divergence_type = "BEARISH"
    divergence_indicator = "MACD"
    divergence_min_strength = 0.3
    
    # 1. Get symbols matching country from stocks
    print("1. Fetching Egypt stocks...")
    res_stocks = _supabase.table("stocks").select("symbol").eq("country", country).execute()
    country_symbols = [s.get("symbol") for s in res_stocks.data or []]
    print(f"   Found {len(country_symbols)} symbols in stocks table.")
    print(f"   Is AJWA in stocks? {'AJWA' in country_symbols}")
    print(f"   Is ACGC in stocks? {'ACGC' in country_symbols}")
    
    # 2. Fetch technical indicators
    print("2. Fetching technical indicators...")
    query = _supabase.table("stock_technical_indicators").select("*")
    if country_symbols:
        query = query.in_("symbol", country_symbols)
        
    res_indicators = query.order("date", desc=True).limit(1000).execute()
    indicators = res_indicators.data or []
    print(f"   Fetched {len(indicators)} indicator rows from DB.")
    
    # Check if AJWA or ACGC indicators were fetched
    ajwa_rows = [r for r in indicators if r.get("symbol") == "AJWA"]
    acgc_rows = [r for r in indicators if r.get("symbol") == "ACGC"]
    print(f"   AJWA indicator rows fetched: {len(ajwa_rows)}")
    print(f"   ACGC indicator rows fetched: {len(acgc_rows)}")
    
    if ajwa_rows:
        row = ajwa_rows[0]
        print(f"   AJWA latest row - Date: {row.get('date')} | RSI: {row.get('rsi_divergence')} | MACD: {row.get('macd_divergence')} | STOCH: {row.get('stoch_divergence')} | Strength: {row.get('divergence_strength')}")
    if acgc_rows:
        row = acgc_rows[0]
        print(f"   ACGC latest row - Date: {row.get('date')} | RSI: {row.get('rsi_divergence')} | MACD: {row.get('macd_divergence')} | STOCH: {row.get('stoch_divergence')} | Strength: {row.get('divergence_strength')}")
        
    # Deduplicate like route.ts does
    unique_indicators_map = {}
    for ind in indicators:
        key = f"{ind.get('symbol')}-{ind.get('exchange')}"
        if key not in unique_indicators_map:
            unique_indicators_map[key] = ind
            
    deduped = list(unique_indicators_map.values())
    print(f"   Deduplicated count: {len(deduped)}")
    
    # Let's run the route's divergence filter logic
    results = []
    for tech in deduped:
        if divergence_type and divergence_type != "NONE":
            has_div = False
            ind_filter = (divergence_indicator or "ANY").upper()
            indicators_to_check = ["rsi", "macd", "stoch"] if ind_filter in ("ANY", "") else [ind_filter.lower()]
            
            for ind_name in indicators_to_check:
                div_val = tech.get(f"{ind_name}_divergence") or "NONE"
                if divergence_type == "ANY" and div_val != "NONE":
                    has_div = True
                elif div_val == divergence_type:
                    has_div = True
                    
            if not has_div:
                continue
                
            if divergence_min_strength is not None:
                strength = float(tech.get("divergence_strength") or 0.0)
                if strength < divergence_min_strength:
                    continue
            
            results.append(tech)
            
    print(f"3. Filtered results count: {len(results)}")
    for r in results:
        print(f"   Matching Symbol: {r.get('symbol')} | Date: {r.get('date')} | RSI: {r.get('rsi_divergence')} | MACD: {r.get('macd_divergence')} | Strength: {r.get('divergence_strength')}")

if __name__ == "__main__":
    debug_route()
