import sys
import os
from datetime import datetime, timedelta

base_dir = os.path.dirname(os.path.abspath(__file__))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from api.stock_ai import _init_supabase, supabase

def main():
    _init_supabase()
    
    if not supabase:
        print("Error: Supabase not initialized.")
        return
        
    print("Querying Supabase...")
    
    # Query latest indicators for EG
    res = supabase.table("stock_technical_indicators") \
        .select("symbol, date, close, volume, vol_sma20, mm_accumulation, mm_distribution, rsi_14") \
        .eq("exchange", "EG") \
        .order("date", desc=True) \
        .limit(2000) \
        .execute()
        
    if not res.data:
        print("No data found.")
        return
        
    # Group by symbol to find latest row and previous rows
    history = {}
    for row in res.data:
        sym = row["symbol"]
        if sym not in history:
            history[sym] = []
        history[sym].append(row)
        
    matches = []
    
    for sym, rows in history.items():
        if len(rows) < 2:
            continue
            
        # Sort by date descending
        rows.sort(key=lambda x: x["date"], reverse=True)
        latest = rows[0]
        prev = rows[1]
        
        try:
            vol = float(latest.get("volume") or 0)
            vol_sma20 = float(latest.get("vol_sma20") or 0)
            r_vol = (vol / vol_sma20) if vol_sma20 > 0 else 0
            
            dist = float(latest.get("mm_distribution") or 0)
            accum_latest = float(latest.get("mm_accumulation") or 0)
            accum_prev = float(prev.get("mm_accumulation") or 0)
            
            rsi = float(latest.get("rsi_14") or 0)
            
            # Check conditions (relaxed accumulation score since we don't have it out of 100)
            if r_vol > 1.5 and dist == 0 and accum_latest > 0 and accum_prev > 0:
                matches.append({
                    "symbol": sym,
                    "r_vol": round(r_vol, 2),
                    "rsi": round(rsi, 2),
                    "close": latest.get("close")
                })
        except Exception as e:
            pass
            
    print(f"\nFound {len(matches)} perfect matches:")
    for m in matches:
        print(f"{m['symbol']} - R_VOL: {m['r_vol']}, RSI: {m['rsi']}, Close: {m['close']}")

if __name__ == "__main__":
    main()
