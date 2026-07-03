import yfinance as yf

symbols = ["USDEGP=X", "EGP=X", "EGX30.INDX", "^CCSI", "GC=F"]

for s in symbols:
    print(f"Testing {s}...")
    try:
        t = yf.Ticker(s)
        h = t.history(period="1mo")
        print(f"  Empty: {h.empty}, Columns: {list(h.columns)}, Rows: {len(h)}")
        if not h.empty:
            print(f"  Last close: {h['Close'].iloc[-1]}")
    except Exception as e:
        print(f"  Error: {e}")
