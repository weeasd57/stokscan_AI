import sys
sys.path.insert(0, "scripts")
import json
from pathlib import Path
from collections import defaultdict
import numpy as np
import pandas as pd
from swing_deep_winrate_search import load_data, fast_simulate

df = load_data()
dates = sorted(df["date"].unique())

print("Computing causal indicators and features per symbol...")
groups = []
for symbol, g in df.groupby("symbol", sort=False):
    g = g.copy().reset_index(drop=True)
    c = g["close"]
    h = g["high"]
    l = g["low"]
    v = g["volume"]
    o = g["open"]

    g["ema10"] = c.ewm(span=10, adjust=False).mean()
    g["ema20"] = c.ewm(span=20, adjust=False).mean()
    g["ema50"] = c.ewm(span=50, adjust=False).mean()

    prev_c = c.shift(1)
    tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    g["atr14"] = tr.rolling(14).mean()
    g["atr_pct"] = g["atr14"] / c

    delta = c.diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = ((-delta.where(delta < 0, 0))).rolling(14).mean()
    rs = gain / (loss + 1e-9)
    g["rsi14"] = 100 - (100 / (1 + rs))

    g["vol_ma20"] = v.rolling(20).mean()
    g["turnover"] = (c * v).rolling(20).mean()
    g["active_days"] = v.gt(0).rolling(20).sum()
    g["prev_close"] = prev_c
    g["prev_high"] = h.shift(1)
    g["prev_low"] = l.shift(1)

    g["liquid"] = (
        (np.arange(len(g)) >= 30)
        & (g["turnover"] >= 1_000_000)
        & (g["active_days"] >= 15)
    )
    g["above_ema50"] = g["liquid"] & (c > g["ema50"])
    groups.append(g)

df = pd.concat(groups, ignore_index=True)

# Market breadth: % of liquid stocks above EMA50 (lagged to avoid lookahead!)
breadth_raw = df[df["liquid"]].groupby("date")["above_ema50"].mean()
# Strict causal breadth: we know yesterday's market breadth at Day T Close
breadth_lagged = breadth_raw.shift(1).rename("breadth")
df = df.merge(breadth_lagged, on="date", how="left")
df["breadth"] = df["breadth"].fillna(0.5)

healthy_market = df["breadth"] >= 0.42
uptrend = df["liquid"] & (df["close"] > df["ema50"]) & (df["ema20"] > df["ema50"] * 0.99)
not_extended = (df["close"] / df["ema50"]) <= 1.22

# 1. Pullback Bounce with Volume Confirmation
sig_pb = (
    uptrend & not_extended & healthy_market
    & (df["low"] <= df["ema10"] * 1.012)
    & (df["close"] > df["ema10"])
    & (df["close"] > df["open"])
    & (df["close"] > df["prev_close"])
    & (df["volume"] >= df["vol_ma20"] * 0.75)
)

# 2. Reversal Bar Breakout in Healthy Market
sig_rev = (
    uptrend & not_extended & healthy_market
    & (df["close"] > df["prev_high"])
    & (df["close"] > df["open"])
    & (df["rsi14"] >= 45)
    & (df["rsi14"] <= 65)
)

# Combined Ensemble Signal: High Probability Swing Setup
df["sig_swing_combo"] = sig_pb | sig_rev

next_date_map = dict(zip(dates, dates[1:]))
market = {}
for row in df[["symbol", "date", "open", "high", "low", "close", "volume", "turnover", "atr_pct"]].itertuples(index=False):
    market[(row.symbol, row.date)] = row

sig_map = defaultdict(list)
active_sub = df[df["sig_swing_combo"]][["symbol", "date", "close", "turnover", "atr_pct"]]
for row in active_sub.itertuples(index=False):
    nxt = next_date_map.get(row.date)
    if nxt:
        sig_map[nxt].append({
            "symbol": row.symbol,
            "signal_date": row.date,
            "date": nxt,
            "close": row.close,
            "turnover": row.turnover,
            "atr_pct": row.atr_pct
        })

tot_sigs = sum(len(s) for s in sig_map.values())
months = len(sorted(df["date"].str[:7].unique()))
print(f"Total Ensemble Signals: {tot_sigs} ({tot_sigs/months:.1f} signals/month across EGX)")

print("\n" + "="*95)
print("GRID TEST FOR COMBO SWING STRATEGY (TARGET ~100 TRADES/MO & ~60% WIN RATE):")
print(f"{'Mode':<5} | {'TP':<5} | {'SL':<5} | {'BE':<5} | {'Hold':<4} | {'Slots':<5} | {'Tr/Mo':<6} | {'WinRate':<8} | {'PF':<5} | {'Return':<7} | {'MaxDD':<6}")
print("-" * 95)

results = []
for tp in [0.03, 0.035, 0.04]:
    for sl in [0.04, 0.045, 0.05]:
        for be in [0.018, 0.02]:
            for hold in [4, 5]:
                for slots in [25, 28, 30]:
                    res = fast_simulate(
                        dates=dates,
                        market=market,
                        signals_by_date=sig_map,
                        tp_pct=tp,
                        sl_pct=sl,
                        max_hold=hold,
                        be_trigger=be,
                        min_hold_sessions=1,  # T+1
                        max_positions=slots,
                        cost=0.0015
                    )
                    if res:
                        results.append((tp, sl, be, hold, slots, res))
                        be_str = f"{be*100:.1f}%"
                        if res["win_rate"] >= 58.0:
                            print(f"{'T+1':<5} | {tp*100:<5.1f}% | {sl*100:<5.1f}% | {be_str:<5} | {hold:<4} | {slots:<5} | {res['monthly_trades']:<6.1f} | {res['win_rate']:<7.1f}% | {res['profit_factor']:<5.2f} | {res['total_return']:<6.1f}% | {res['max_dd']:<5.1f}%")

# Select the champion configuration closest to 100 trades/month and 60% win rate
def score(item):
    tp, sl, be, hold, slots, res = item
    tr_dist = abs(res["monthly_trades"] - 100.0)
    wr_dist = abs(res["win_rate"] - 60.0)
    return - (tr_dist * 1.0 + wr_dist * 2.0) + (res["profit_factor"] * 10) - (res["max_dd"] * 0.5)

results.sort(key=score, reverse=True)
champ = results[0]
tp, sl, be, hold, slots, res = champ

print("\n" + "="*95)
print("CHAMPION CONFIGURATION DETAILS:")
print(f"Take Profit: {tp*100:.1f}%")
print(f"Stop Loss:   {sl*100:.1f}%")
print(f"Breakeven:   {be*100:.1f}% (locks in entry + 0.3% once +{be*100:.1f}% reached)")
print(f"Max Hold:    {hold} sessions")
print(f"Max Slots:   {slots} concurrent positions (~{100/slots:.1f}% equity per slot)")
print(f"Trades/Mo:   {res['monthly_trades']}")
print(f"Total Trades:{res['trades']}")
print(f"Win Rate:    {res['win_rate']}%")
print(f"Profit Factor:{res['profit_factor']}")
print(f"Total Return:{res['total_return']}%")
print(f"Max Drawdown:{res['max_dd']}%")
print(f"Avg Hold:    {res['avg_hold']} days")
print(f"Yearly Win Rates: {res['yearly_wr']}")

# Run Stress Test: Double Costs (0.30% each way = 0.60% round-trip)
res_double_cost = fast_simulate(
    dates=dates,
    market=market,
    signals_by_date=sig_map,
    tp_pct=tp,
    sl_pct=sl,
    max_hold=hold,
    be_trigger=be,
    min_hold_sessions=1,
    max_positions=slots,
    cost=0.0030  # Double cost!
)
print("\n--- STRESS TEST: DOUBLE TRANSACTION COSTS (0.60% ROUND-TRIP) ---")
print(f"Win Rate: {res_double_cost['win_rate']}% | Profit Factor: {res_double_cost['profit_factor']} | Return: {res_double_cost['total_return']}% | Max DD: {res_double_cost['max_dd']}%")

# Save Champion Report to scratch
champ_data = {
    "champion": {
        "signal_name": "Combo Swing (Pullback to EMA10 + Reversal Bar Breakout in Healthy Market)",
        "tp_pct": tp,
        "sl_pct": sl,
        "be_trigger": be,
        "max_hold_days": hold,
        "portfolio_slots": slots,
        "trades_per_month": res["monthly_trades"],
        "total_trades": res["trades"],
        "win_rate": res["win_rate"],
        "profit_factor": res["profit_factor"],
        "total_return_pct": res["total_return"],
        "max_drawdown_pct": res["max_dd"],
        "avg_holding_days": res["avg_hold"],
        "yearly_win_rates": res["yearly_wr"],
        "stress_test_double_cost": {
            "win_rate": res_double_cost["win_rate"],
            "profit_factor": res_double_cost["profit_factor"],
            "total_return_pct": res_double_cost["total_return"],
            "max_drawdown_pct": res_double_cost["max_dd"]
        }
    }
}
with open("scratch/champion_swing_system_2026-10-06.json", "w", encoding="utf-8") as f:
    json.dump(champ_data, f, indent=2)
print("Saved champion report to scratch/champion_swing_system_2026-10-06.json")
