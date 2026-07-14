import os
import sys

if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.append(os.path.abspath('.'))

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    if not _supabase:
        print("Supabase not initialized")
        sys.exit(1)

    print("Querying all stock_technical_indicators...")
    res = _supabase.table("stock_technical_indicators").select("symbol,exchange,date,rsi_divergence,macd_divergence,stoch_divergence,divergence_strength,divergence_periods,divergence_summary").execute()
    
    if not res.data:
        print("No records found")
        sys.exit(0)

    # Find the latest date for each symbol
    latest_records = {}
    for row in res.data:
        sym = row.get("symbol")
        exch = row.get("exchange")
        key = f"{sym}-{exch}"
        date = row.get("date")
        
        if key not in latest_records or date > latest_records[key].get("date", ""):
            latest_records[key] = row

    print(f"Total unique symbols: {len(latest_records)}")
    
    active_divs = []
    for key, row in latest_records.items():
        rsi = row.get("rsi_divergence")
        macd = row.get("macd_divergence")
        stoch = row.get("stoch_divergence")
        if (rsi and rsi != "NONE") or (macd and macd != "NONE") or (stoch and stoch != "NONE"):
            active_divs.append(row)
            
    print(f"Symbols with ACTIVE divergence on their LATEST date: {len(active_divs)}")
    for idx, row in enumerate(active_divs):
        print(f"{idx+1}. Symbol: {row.get('symbol')} | Date: {row.get('date')} | RSI: {row.get('rsi_divergence')} | MACD: {row.get('macd_divergence')} | STOCH: {row.get('stoch_divergence')} | Strength: {row.get('divergence_strength')} | Summary: {row.get('divergence_summary')}")

except Exception as e:
    import traceback
    traceback.print_exc()
