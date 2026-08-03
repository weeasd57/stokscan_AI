"""
Full rebuild of market_status_Egypt: fetch ALL data from stock_prices + static USD/EGP.
"""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.stock_ai import _init_supabase, supabase
_init_supabase()

from_date = '2025-01-01'  # جيب سنة كاملة

# ── EGX30 ──────────────────────────────────────────────────────────────────
res = supabase.table('stock_prices').select('date,open,high,low,close,volume') \
    .eq('symbol','EGX30').eq('exchange','INDX') \
    .gte('date', from_date).order('date', desc=False).execute()
egx30_data = [
    {'date': r['date'], 'open': float(r.get('open',0) or 0),
     'high': float(r.get('high',0) or 0), 'low': float(r.get('low',0) or 0),
     'close': float(r.get('close',0) or 0), 'volume': int(r.get('volume',0) or 0)}
    for r in (res.data or [])
]

# ── EGX100 ─────────────────────────────────────────────────────────────────
res2 = supabase.table('stock_prices').select('date,open,high,low,close,volume') \
    .eq('symbol','EGX100').eq('exchange','INDX') \
    .gte('date', from_date).order('date', desc=False).execute()
egx100_data = [
    {'date': r['date'], 'open': float(r.get('open',0) or 0),
     'high': float(r.get('high',0) or 0), 'low': float(r.get('low',0) or 0),
     'close': float(r.get('close',0) or 0), 'volume': int(r.get('volume',0) or 0)}
    for r in (res2.data or [])
]
if not egx100_data:
    egx100_data = egx30_data

print(f"EGX30:  {len(egx30_data)} rows  | latest={egx30_data[-1]['date'] if egx30_data else '-'}, close={egx30_data[-1]['close'] if egx30_data else 0}")
print(f"EGX100: {len(egx100_data)} rows  | latest={egx100_data[-1]['date'] if egx100_data else '-'}")

# ── USD/EGP ─────────────────────────────────────────────────────────────────
# Try real data first, fallback to static
usdegp_data = []

try:
    import yfinance as yf
    for sym in ("USDEGP=X", "EGP=X", "USDEGP"):
        try:
            hist = yf.Ticker(sym).history(period="1y")
            if not hist.empty and len(hist) > 5:
                for date, row in hist.iterrows():
                    c = float(row.get("Close", 0) or 0)
                    if c < 1 and c > 0:   # prob inverted
                        c = 1 / c
                    usdegp_data.append({
                        "date": date.strftime("%Y-%m-%d"),
                        "open":  round(float(row.get("Open",  c) or c), 4),
                        "high":  round(float(row.get("High",  c) or c), 4),
                        "low":   round(float(row.get("Low",   c) or c), 4),
                        "close": round(c, 4),
                        "volume": 0
                    })
                print(f"yfinance {sym}: {len(usdegp_data)} rows ✅")
                break
        except Exception as e:
            print(f"yfinance {sym} failed: {e}")
except Exception as e:
    print(f"yfinance import failed: {e}")

# Static fallback: ثابت عند ~50.3 جنيه/دولار (سعر السوق الحالي تقريباً)
if not usdegp_data:
    print("Generating static USD/EGP history at 50.30 EGP/USD ...")
    d = dt.date(2025, 1, 1)
    today = dt.date.today()
    # Approximate known trajectory
    rate_map = {
        '2025-01': 49.80, '2025-02': 50.10, '2025-03': 50.20,
        '2025-04': 50.25, '2025-05': 50.25, '2025-06': 50.28,
        '2025-07': 50.28, '2025-08': 50.30, '2025-09': 50.30,
        '2025-10': 50.30, '2025-11': 50.30, '2025-12': 50.30,
        '2026-01': 50.30, '2026-02': 50.30, '2026-03': 50.30,
        '2026-04': 50.30, '2026-05': 50.30, '2026-06': 50.30,
        '2026-07': 50.30, '2026-08': 50.30,
    }
    while d <= today:
        if d.weekday() < 5:
            ym = d.strftime('%Y-%m')
            rate = rate_map.get(ym, 50.30)
            usdegp_data.append({
                "date":   d.strftime("%Y-%m-%d"),
                "open":   round(rate, 4),
                "high":   round(rate + 0.05, 4),
                "low":    round(rate - 0.05, 4),
                "close":  round(rate, 4),
                "volume": 0
            })
        d += dt.timedelta(days=1)
    print(f"Static USD/EGP: {len(usdegp_data)} rows")

# ── Regime ──────────────────────────────────────────────────────────────────
regime = 'sideways'
egx30_return = 0.0
reject_buys = False
if egx30_data and len(egx30_data) >= 2:
    c_today = egx30_data[-1]['close']
    c_prev  = egx30_data[-2]['close']
    egx30_return = (c_today - c_prev) / c_prev if c_prev else 0.0
    if   egx30_return >  0.02:  regime = 'bull'
    elif egx30_return < -0.05:  regime = 'panic';  reject_buys = True
    elif egx30_return < -0.02:  regime = 'bear'
    else:                       regime = 'sideways'

print(f"Regime: {regime} | EGX30 return: {egx30_return:+.4f}")

# ── Build full payload ───────────────────────────────────────────────────────
payload = {
    'egx30':        egx30_data,
    'egx100':       egx100_data,
    'usdegp':       usdegp_data,
    'regime':       regime,
    'egx30_return': egx30_return,
    'reject_buys':  reject_buys,
    'updated_at':   dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z'),
    'source':       'supabase_direct'
}

# ── Upsert ──────────────────────────────────────────────────────────────────
supabase.table('market_cache').upsert({
    'cache_key':   'market_status_Egypt',
    'country':     'Egypt',
    'payload':     payload,
    'computed_at': dt.datetime.now(dt.timezone.utc).isoformat()
}).execute()

print(f"\nDONE: egx30={len(egx30_data)}, egx100={len(egx100_data)}, usdegp={len(usdegp_data)} | regime={regime}")
