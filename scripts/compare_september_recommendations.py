import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import pandas as pd
import numpy as np

load_dotenv()
sys.path.insert(0, "scripts")
from swing_deep_winrate_search import load_data
from test_high_conviction_runners import build_sig_map, simulate_trend_riding

# 1. Fetch Supabase recommendations for September 2026
from supabase import create_client
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
sb = create_client(url, key)

print("Fetching Supabase scan_results and positions...")
res = sb.table("scan_results").select("*").gte("created_at", "2026-09-01T00:00:00").lte("created_at", "2026-09-30T23:59:59").execute()
sb_recs = res.data or []

pos_res = sb.table("positions").select("*").execute()
pos_map = {p.get("symbol", "").upper().split(".")[0]: p for p in (pos_res.data or [])}

print(f"Loaded {len(sb_recs)} recommendations from Supabase for September 2026.")

# Process Supabase recommendations
sb_records = []
for r in sb_recs:
    sym = r.get("symbol", "")
    base_sym = sym.upper().split(".")[0]
    p = pos_map.get(base_sym)
    
    status = p.get("status") if p else r.get("status") or "open"
    pl_pct = p.get("price_change_pct") if p else r.get("profit_loss_pct")
    if pl_pct is not None:
        try:
            pl_pct = float(pl_pct)
        except:
            pl_pct = 0.0
    else:
        pl_pct = 0.0

    sb_records.append({
        "symbol": sym,
        "created_at": r.get("created_at", "")[:10],
        "status": status,
        "entry_price": r.get("entry_price"),
        "target_price": r.get("target_price"),
        "stop_loss": r.get("stop_loss"),
        "pl_pct": pl_pct,
        "precision": r.get("precision")
    })

df_sb = pd.DataFrame(sb_records)

# Also check all scan_results if September has few or many
if len(df_sb) == 0:
    print("Checking all scan_results by month...")
    all_res = sb.table("scan_results").select("created_at, symbol, status, profit_loss_pct").limit(1000).execute()
    df_all = pd.DataFrame(all_res.data or [])
    if len(df_all) > 0:
        df_all["month"] = df_all["created_at"].str[:7]
        print("Scan results counts by month:")
        print(df_all["month"].value_counts())

# Evaluate Supabase September performance
sb_trades_count = len(df_sb)
if sb_trades_count > 0:
    sb_wins = df_sb[df_sb["pl_pct"] > 0]
    sb_losses = df_sb[df_sb["pl_pct"] < 0]
    sb_win_rate = (len(sb_wins) / sb_trades_count) * 100
    sb_avg_win = sb_wins["pl_pct"].mean() if len(sb_wins) > 0 else 0.0
    sb_avg_loss = sb_losses["pl_pct"].mean() if len(sb_losses) > 0 else 0.0
    sb_total_return = df_sb["pl_pct"].sum()
    sb_win_sum = sb_wins["pl_pct"].sum()
    sb_loss_sum = abs(sb_losses["pl_pct"].sum())
    sb_pf = (sb_win_sum / sb_loss_sum) if sb_loss_sum > 0 else 999.0
else:
    sb_win_rate = 0.0
    sb_avg_win = 0.0
    sb_avg_loss = 0.0
    sb_total_return = 0.0
    sb_pf = 0.0

print("\n" + "="*80)
print("1. CURRENT SUPABASE LIVE RECOMMENDATIONS (SEPTEMBER 2026):")
print(f"Total Recommendations: {sb_trades_count}")
if sb_trades_count > 0:
    print(f"Win Rate:              {sb_win_rate:.1f}% ({len(sb_wins)} wins / {len(sb_losses)} losses)")
    print(f"Profit Factor:         {sb_pf:.2f}")
    print(f"Sum of Returns:        {sb_total_return:+.1f}%")
    print(f"Average Win:           {sb_avg_win:+.1f}%")
    print(f"Average Loss:          {sb_avg_loss:+.1f}%")
    print(f"Best Trade:            {df_sb['pl_pct'].max():+.1f}%")
    print(f"Worst Trade:           {df_sb['pl_pct'].min():+.1f}%")
    print("\nSample Supabase Trades in September 2026:")
    print(df_sb[["symbol", "created_at", "status", "pl_pct"]].head(15).to_string())

# 2. Run the NEW High-Conviction Trend-Riding System on September 2026
print("\n" + "="*80)
print("2. RUNNING NEW HIGH-CONVICTION TREND-RIDING SYSTEM ON SEPTEMBER 2026:")

# Load data and run simulation isolating September 2026
from test_high_conviction_runners import load_data, sig_maps, simulate_trend_riding

# Run Base Breakout simulation with full trade extraction
df_raw = load_data()
dates = sorted(df_raw["date"].unique())
dates_sep = [d for d in dates if d.startswith("2026-09")]
print(f"September 2026 trading sessions in dataset: {len(dates_sep)} sessions ({dates_sep[0]} to {dates_sep[-1]})")

# We can run the simulation across the full dataset and extract September 2026 trades
# to get realistic portfolio state entering September
import test_high_conviction_runners as thcr

# Run simulation
res_model = thcr.simulate_trend_riding(
    sig_col_map=thcr.sig_maps["Base Breakout"],
    trail_mode="ema10_close",
    initial_sl=0.04,
    be_trigger=0.045,
    max_hold=20,
    max_positions=15,
    cost=0.0015
)

# To isolate exact September closed trades and entries:
# Let's inspect trades from September 2026
# We will do a targeted run saving closed trades
s_map = thcr.sig_maps["Base Breakout"]
# Filter dates up to end of September 2026
dates_up_to_sep = [d for d in dates if d <= "2026-09-30"]

def get_september_trades():
    # Run simulation and extract September trades
    cash = 100_000.0
    receivables = []
    positions = {}
    closed_trades = []
    equity_curve = []

    for i, day in enumerate(dates_up_to_sep):
        cash += sum(v for due, v in receivables if due <= i)
        receivables = [(due, v) for due, v in receivables if due > i]

        for sym in list(positions):
            p = positions[sym]
            b = thcr.market.get((sym, day))
            if not b or b.volume <= 0 or b.high == b.low:
                continue
            age = i - p["index"]

            if age >= 1 and p["pending"]:
                fill_price = b.open * (1 - 0.0015)
                proceeds = p["shares"] * fill_price
                receivables.append((i + 2, proceeds))
                pnl = proceeds - p["cost"]
                ret_pct = (proceeds / p["cost"] - 1) * 100
                closed_trades.append({
                    "symbol": sym,
                    "entry_date": p["date"],
                    "exit_date": day,
                    "sessions": age,
                    "pnl": pnl,
                    "return_pct": ret_pct,
                    "max_gain": p["max_gain"],
                    "reason": p["pending"]
                })
                del positions[sym]

        unsettled = sum(v for _, v in receivables)
        current_eq = cash + unsettled + sum(p["shares"] * p["last"] for p in positions.values())
        day_signals = sorted(s_map.get(day, []), key=lambda s: -s["turnover"])

        for s in day_signals:
            if len(positions) >= 15 or s["symbol"] in positions:
                continue
            b = thcr.market.get((s["symbol"], day))
            if not b or b.volume <= 0 or b.high == b.low:
                continue

            limit_price = s["close"]
            if b.open <= limit_price * 1.002:
                exec_price = b.open
            elif b.low <= limit_price:
                exec_price = limit_price
            else:
                continue

            pos_alloc = min(current_eq / 15, cash)
            if pos_alloc < 2500:
                continue

            fill = exec_price * (1 + 0.0015)
            shares = int(pos_alloc / fill)
            if shares <= 0:
                continue

            cost_paid = shares * fill
            cash -= cost_paid

            positions[s["symbol"]] = {
                "symbol": s["symbol"],
                "date": day,
                "index": i,
                "shares": shares,
                "cost": cost_paid,
                "entry_price": fill,
                "sl_price": fill * (1 - 0.04),
                "highest_close": fill,
                "highest_high": fill,
                "max_gain": 0.0,
                "be_active": False,
                "last": b.close,
                "pending": None
            }

        for sym in list(positions):
            p = positions[sym]
            b = thcr.market.get((sym, day))
            if not b:
                continue
            p["last"] = b.close
            age = i - p["index"]

            if b.high > p["highest_high"]:
                p["highest_high"] = b.high
                p["max_gain"] = max(p["max_gain"], (b.high / p["entry_price"] - 1) * 100)

            if b.close > p["highest_close"]:
                p["highest_close"] = b.close

            gain_from_entry = (b.high / p["entry_price"] - 1)

            if not p["be_active"] and gain_from_entry >= 0.045:
                p["be_active"] = True
                p["sl_price"] = max(p["sl_price"], p["entry_price"] * 1.003)

            if p["be_active"] and b.close < b.ema10:
                p["pending"] = "ema10_break"

            if b.low <= p["sl_price"]:
                if age >= 1 and b.volume > 0 and b.high > b.low:
                    fill_price = max(b.low, p["sl_price"]) * (1 - 0.0015)
                    proceeds = p["shares"] * fill_price
                    receivables.append((i + 2, proceeds))
                    pnl = proceeds - p["cost"]
                    ret_pct = (proceeds / p["cost"] - 1) * 100
                    closed_trades.append({
                        "symbol": sym,
                        "entry_date": p["date"],
                        "exit_date": day,
                        "sessions": age,
                        "pnl": pnl,
                        "return_pct": ret_pct,
                        "max_gain": p["max_gain"],
                        "reason": "stop_be" if p["be_active"] else "stop_loss"
                    })
                    del positions[sym]
                    continue
                else:
                    p["pending"] = "stop_be" if p["be_active"] else "stop_loss"
            elif age >= 20:
                p["pending"] = "max_time"

    return pd.DataFrame(closed_trades)

df_model_all = get_september_trades()
# Filter for trades active or closed in September 2026
df_model_sep = df_model_all[df_model_all["exit_date"].str.startswith("2026-09")].copy()

m_wins = df_model_sep[df_model_sep["return_pct"] > 0]
m_losses = df_model_sep[df_model_sep["return_pct"] < 0]
m_wr = (len(m_wins) / len(df_model_sep) * 100) if len(df_model_sep) > 0 else 0
m_avg_win = m_wins["return_pct"].mean() if len(m_wins) > 0 else 0
m_avg_loss = m_losses["return_pct"].mean() if len(m_losses) > 0 else 0
m_win_sum = m_wins["return_pct"].sum()
m_loss_sum = abs(m_losses["return_pct"].sum())
m_pf = (m_win_sum / m_loss_sum) if m_loss_sum > 0 else 999.0

print(f"Total Closed Trades in Sept 2026: {len(df_model_sep)}")
print(f"Win Rate:                         {m_wr:.1f}% ({len(m_wins)} wins / {len(m_losses)} losses)")
print(f"Profit Factor:                    {m_pf:.2f}")
print(f"Sum of Returns:                   {df_model_sep['return_pct'].sum():+.1f}%")
print(f"Average Win:                      {m_avg_win:+.1f}%")
print(f"Average Loss:                     {m_avg_loss:+.1f}%")
print(f"Best Trade:                       {df_model_sep['return_pct'].max():+.1f}%")
print(f"Worst Trade:                      {df_model_sep['return_pct'].min():+.1f}%")
print(f"Trades with Return >= 10%:        {(df_model_sep['return_pct'] >= 10.0).sum()} trades")
print(f"Trades with Return >= 15%:        {(df_model_sep['return_pct'] >= 15.0).sum()} trades")

print("\nModel Trades in September 2026:")
print(df_model_sep[["symbol", "entry_date", "exit_date", "sessions", "return_pct", "reason"]].to_string())
