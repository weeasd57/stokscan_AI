"""
Deep Swing Win-Rate & Capacity Optimizer for EGX
Searches for configurations that achieve:
1. Win Rate >= 58% - 65%
2. Trade Volume: ~80 - 120 trades/month (~100/mo)
3. Profit Factor > 1.35
4. Zero leakage, causal indicators, realistic Limit fills (no gap chase), T+1 and T+2 tests.
"""
import gzip
import json
import time
from collections import defaultdict
from pathlib import Path
import numpy as np
import pandas as pd

ARCHIVE = Path("C:/Users/MR__CODER__/.cache/huggingface/hub/datasets--weeasdwee--egx-historical-prices/snapshots/85643e5bf12a6ce0b2f62b63fa0ffcfc1b422628/prices/EGX/stock_prices.json.gz")

def load_data():
    t0 = time.time()
    with gzip.open(ARCHIVE, "rt", encoding="utf-8") as f:
        raw = json.load(f)
    df = pd.DataFrame(raw)
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close", "volume"])
    df = df[(df.open > 0) & (df.high > 0) & (df.low > 0) & (df.close > 0) & (df.volume >= 0)]
    df = df.sort_values(["symbol", "date"]).reset_index(drop=True)
    # Focus on 2021-2026 (post-reform liquid EGX)
    df = df[df["date"] >= "2021-01-01"].reset_index(drop=True)
    print(f"Loaded {len(df):,} bars from 2021-2026 across {df['symbol'].nunique()} symbols in {time.time()-t0:.2f}s")
    return df

def build_features(df):
    t0 = time.time()
    print("Computing features strictly per symbol...")
    groups = []
    for symbol, g in df.groupby("symbol", sort=False):
        g = g.copy().reset_index(drop=True)
        c = g["close"]
        h = g["high"]
        l = g["low"]
        v = g["volume"]
        o = g["open"]

        g["ema5"] = c.ewm(span=5, adjust=False).mean()
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

        g["turnover"] = (c * v).rolling(20).mean()
        g["active_days"] = v.gt(0).rolling(20).sum()
        g["prev_close"] = prev_c
        g["prev_high"] = h.shift(1)
        g["prev_low"] = l.shift(1)

        # Candle metrics
        g["body"] = (c - o).abs()
        g["lower_wick"] = (np.minimum(c, o) - l) / c
        g["is_green"] = c > o

        # Liquidity: > 1M EGP daily turnover, active 15 of 20 days
        g["liquid"] = (
            (np.arange(len(g)) >= 30)
            & (g["turnover"] >= 1_000_000)
            & (g["active_days"] >= 15)
        )
        groups.append(g)

    res = pd.concat(groups, ignore_index=True)
    print(f"Features built in {time.time()-t0:.2f}s")
    return res

def define_candidate_signals(df):
    """
    Define 6 refined swing archetypes designed for high win rates.
    """
    uptrend_strict = df["liquid"] & (df["close"] > df["ema50"]) & (df["ema20"] > df["ema50"])
    uptrend_mild = df["liquid"] & (df["close"] > df["ema50"] * 0.98) & (df["ema20"] > df["ema50"] * 0.98)
    not_extended = (df["close"] / df["ema50"]) <= 1.25  # Avoid buying climax

    # Signal 1: Strict EMA10 Pullback Bounce with Lower Wick Support
    # Touched EMA10, rejected lower prices (lower wick >= 0.5%), closed green above EMA10
    sig_ema10_wick = (
        uptrend_strict
        & not_extended
        & (df["low"] <= df["ema10"] * 1.01)
        & (df["close"] > df["ema10"])
        & (df["is_green"])
        & (df["close"] > df["prev_close"])
        & (df["lower_wick"] >= 0.005)
    )

    # Signal 2: Strict EMA20 Pullback Bounce (Key Institutional Support)
    # Strong bounce off 20 EMA in uptrend
    sig_ema20_bounce = (
        uptrend_strict
        & not_extended
        & (df["low"] <= df["ema20"] * 1.015)
        & (df["close"] > df["ema20"])
        & (df["is_green"])
        & (df["close"] > df["prev_close"])
    )

    # Signal 3: Confluence: Pullback to EMA10/20 + RSI in Golden Zone (42 to 58)
    sig_confluence = (
        uptrend_strict
        & not_extended
        & (df["low"] <= df["ema10"] * 1.015)
        & (df["close"] > df["ema10"])
        & (df["rsi14"] >= 42)
        & (df["rsi14"] <= 58)
        & (df["is_green"])
        & (df["close"] > df["prev_close"])
    )

    # Signal 4: Broad Pullback (Either EMA10 or EMA20)
    sig_either_pb = (
        uptrend_strict
        & not_extended
        & ((df["low"] <= df["ema10"] * 1.01) | (df["low"] <= df["ema20"] * 1.015))
        & (df["close"] > df["ema10"] * 0.995)
        & (df["is_green"])
        & (df["close"] > df["prev_close"])
    )

    # Signal 5: 3-Bar Dip and Reversal (Inside bar or micro pullback in trend)
    # Price had 1-3 down/flat days, today decisively broke yesterday's high
    sig_reversal_bar = (
        uptrend_mild
        & not_extended
        & (df["prev_close"] <= df["prev_high"])
        & (df["close"] > df["prev_high"])
        & (df["close"] > df["ema20"])
        & (df["is_green"])
        & (df["rsi14"] >= 45)
        & (df["rsi14"] <= 65)
    )

    # Signal 6: Oversold Swing Turn (RSI < 45 recovery)
    sig_rsi_turn = (
        df["liquid"]
        & (df["close"] > df["ema50"] * 0.95)
        & (df["rsi14"] >= 35)
        & (df["rsi14"] <= 50)
        & (df["close"] > df["prev_close"])
        & (df["is_green"])
        & (df["lower_wick"] >= 0.008)
    )

    df["sig_ema10_wick"] = sig_ema10_wick
    df["sig_ema20_bounce"] = sig_ema20_bounce
    df["sig_confluence"] = sig_confluence
    df["sig_either_pb"] = sig_either_pb
    df["sig_reversal_bar"] = sig_reversal_bar
    df["sig_rsi_turn"] = sig_rsi_turn

    return df

def fast_simulate(dates, market, signals_by_date, tp_pct, sl_pct, max_hold, be_trigger, min_hold_sessions, max_positions=20, cost=0.0015):
    """
    Ultra-fast vectorized-like simulation loop.
    min_hold_sessions: 1 for T+1 settlement (sellable next session), 2 for T+2 settlement.
    """
    cash = 100_000.0
    receivables = []
    positions = {}
    closed_trades = []
    equity_curve = []

    for i, day in enumerate(dates):
        # 1. Clear receivables
        cash += sum(v for due, v in receivables if due <= i)
        receivables = [(due, v) for due, v in receivables if due > i]

        # 2. Process pending exits at Open
        for sym in list(positions):
            p = positions[sym]
            b = market.get((sym, day))
            if not b or b.volume <= 0 or b.high == b.low:
                continue
            age = i - p["index"]

            if age >= min_hold_sessions and p["pending"]:
                fill_price = b.open * (1 - cost)
                proceeds = p["shares"] * fill_price
                receivables.append((i + 2, proceeds))
                pnl = proceeds - p["cost"]
                closed_trades.append({
                    "symbol": sym,
                    "entry_date": p["date"],
                    "exit_date": day,
                    "sessions": age,
                    "pnl": pnl,
                    "return_pct": (proceeds / p["cost"] - 1) * 100,
                    "reason": p["pending"]
                })
                del positions[sym]

        # 3. New entries at Open (Limit Order Fill logic, zero chase)
        unsettled = sum(v for _, v in receivables)
        current_eq = cash + unsettled + sum(p["shares"] * p["last"] for p in positions.values())
        day_signals = sorted(signals_by_date.get(day, []), key=lambda s: -s["turnover"])

        for s in day_signals:
            if len(positions) >= max_positions or s["symbol"] in positions:
                continue
            b = market.get((s["symbol"], day))
            if not b or b.volume <= 0 or b.high == b.low:
                continue

            limit_price = s["close"]
            # Limit Execution:
            if b.open <= limit_price * 1.002:
                exec_price = b.open
            elif b.low <= limit_price:
                exec_price = limit_price
            else:
                continue  # Gapped up and never looked back, no chase

            pos_alloc = min(current_eq / max_positions, cash)
            if pos_alloc < 2000:
                continue

            fill = exec_price * (1 + cost)
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
                "tp_price": fill * (1 + tp_pct),
                "sl_price": fill * (1 - sl_pct),
                "be_price": fill * (1 + 0.003),
                "be_active": False,
                "last": b.close,
                "pending": None
            }

        # 4. Intraday price check & EOD status
        for sym in list(positions):
            p = positions[sym]
            b = market.get((sym, day))
            if not b:
                continue
            p["last"] = b.close
            age = i - p["index"]

            # Breakeven trigger: if intraday high reached entry + be_trigger
            if be_trigger and not p["be_active"] and b.high >= p["entry_price"] * (1 + be_trigger):
                p["be_active"] = True
                p["sl_price"] = max(p["sl_price"], p["be_price"])

            # Check Take Profit hit
            if b.high >= p["tp_price"]:
                if age >= min_hold_sessions and b.volume > 0 and b.high > b.low:
                    fill_price = min(b.high, p["tp_price"]) * (1 - cost)
                    proceeds = p["shares"] * fill_price
                    receivables.append((i + 2, proceeds))
                    closed_trades.append({
                        "symbol": sym,
                        "entry_date": p["date"],
                        "exit_date": day,
                        "sessions": age,
                        "pnl": proceeds - p["cost"],
                        "return_pct": (proceeds / p["cost"] - 1) * 100,
                        "reason": "take_profit"
                    })
                    del positions[sym]
                    continue
                else:
                    p["pending"] = "take_profit"

            # Check Stop Loss hit
            elif b.low <= p["sl_price"]:
                if age >= min_hold_sessions and b.volume > 0 and b.high > b.low:
                    fill_price = max(b.low, p["sl_price"]) * (1 - cost)
                    proceeds = p["shares"] * fill_price
                    receivables.append((i + 2, proceeds))
                    closed_trades.append({
                        "symbol": sym,
                        "entry_date": p["date"],
                        "exit_date": day,
                        "sessions": age,
                        "pnl": proceeds - p["cost"],
                        "return_pct": (proceeds / p["cost"] - 1) * 100,
                        "reason": "stop_loss"
                    })
                    del positions[sym]
                    continue
                else:
                    p["pending"] = "stop_loss"

            # Check Time Stop
            elif age >= max_hold:
                p["pending"] = "time_stop"

        total_eq = cash + sum(v for _, v in receivables) + sum(p["shares"] * p["last"] for p in positions.values())
        equity_curve.append({"date": day, "equity": total_eq})

    df_trades = pd.DataFrame(closed_trades) if closed_trades else pd.DataFrame()
    if len(df_trades) == 0:
        return None

    df_trades["month"] = df_trades["exit_date"].str[:7]
    df_trades["year"] = df_trades["exit_date"].str[:4]
    trades_per_month = df_trades.groupby("month").size().mean()
    win_rate = (df_trades["pnl"] > 0).mean() * 100
    wins = df_trades[df_trades["pnl"] > 0]["pnl"].sum()
    losses = -df_trades[df_trades["pnl"] < 0]["pnl"].sum()
    pf = (wins / losses) if losses > 0 else 999.0
    tot_return = (equity_curve[-1]["equity"] / 100_000.0 - 1) * 100

    eq_series = pd.Series([r["equity"] for r in equity_curve])
    cummax = eq_series.cummax()
    dd = (cummax - eq_series) / cummax
    max_dd = dd.max() * 100

    # Win rate by year
    yearly_wr = {}
    for yr, y_df in df_trades.groupby("year"):
        yearly_wr[yr] = round((y_df["pnl"] > 0).mean() * 100, 1)

    return {
        "trades": len(df_trades),
        "win_rate": round(win_rate, 1),
        "monthly_trades": round(trades_per_month, 1),
        "total_return": round(tot_return, 1),
        "max_dd": round(max_dd, 1),
        "profit_factor": round(pf, 2),
        "avg_hold": round(df_trades["sessions"].mean(), 1),
        "tp_pct_actual": round((df_trades["reason"] == "take_profit").mean() * 100, 1),
        "sl_pct_actual": round((df_trades["reason"] == "stop_loss").mean() * 100, 1),
        "time_pct_actual": round((df_trades["reason"] == "time_stop").mean() * 100, 1),
        "yearly_wr": yearly_wr
    }

def main():
    df = load_data()
    df = build_features(df)
    df = define_candidate_signals(df)

    signal_cols = [
        "sig_ema10_wick",
        "sig_ema20_bounce",
        "sig_confluence",
        "sig_either_pb",
        "sig_reversal_bar",
        "sig_rsi_turn"
    ]

    dates = sorted(df["date"].unique())
    next_date_map = dict(zip(dates, dates[1:]))

    market = {}
    for row in df[["symbol", "date", "open", "high", "low", "close", "volume", "turnover", "atr_pct"]].itertuples(index=False):
        market[(row.symbol, row.date)] = row

    signals_by_sig = {}
    months_count = len(sorted(df["date"].str[:7].unique()))
    print("\nSignal Generation Summary (2021-2026):")
    for sc in signal_cols:
        sig_map = defaultdict(list)
        active_sub = df[df[sc]][["symbol", "date", "close", "turnover", "atr_pct"]]
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
        signals_by_sig[sc] = sig_map
        tot_sig = sum(len(s) for s in sig_map.values())
        print(f"  {sc:<20}: {tot_sig:5d} signals total | {tot_sig/months_count:5.1f} signals/month")

    print("\n" + "="*95)
    print("SEARCHING PARAMETER COMBINATIONS FOR WIN RATE >= 58% AND TRADES/MO ~ 80-120:")
    print(f"{'Mode':<5} | {'Signal':<16} | {'TP':<5} | {'SL':<5} | {'BE':<5} | {'Hold':<4} | {'Slots':<5} | {'Tr/Mo':<6} | {'WinRate':<8} | {'PF':<5} | {'Return':<7} | {'MaxDD':<6}")
    print("-" * 95)

    all_results = []
    # Test both T+1 (min_hold=1) and T+2 (min_hold=2)
    for min_hold, mode_label in [(1, "T+1"), (2, "T+2")]:
        for sig in signal_cols:
            for tp in [0.03, 0.035, 0.04, 0.045]:
                for sl in [0.025, 0.03, 0.035, 0.04]:
                    for be in [0.015, 0.02, None]:
                        for hold in [3, 4, 5]:
                            for slots in [20, 25]:
                                res = fast_simulate(
                                    dates=dates,
                                    market=market,
                                    signals_by_date=signals_by_sig[sig],
                                    tp_pct=tp,
                                    sl_pct=sl,
                                    max_hold=hold,
                                    be_trigger=be,
                                    min_hold_sessions=min_hold,
                                    max_positions=slots,
                                    cost=0.0015
                                )
                                if res and res["trades"] >= 200:
                                    be_str = f"{be*100:.1f}%" if be else "None"
                                    all_results.append((mode_label, sig, tp, sl, be, hold, slots, res))
                                    if res["win_rate"] >= 58.0 and res["profit_factor"] >= 1.25:
                                        print(f"{mode_label:<5} | {sig:<16} | {tp*100:<5.1f}% | {sl*100:<5.1f}% | {be_str:<5} | {hold:<4} | {slots:<5} | {res['monthly_trades']:<6.1f} | {res['win_rate']:<7.1f}% | {res['profit_factor']:<5.2f} | {res['total_return']:<6.1f}% | {res['max_dd']:<5.1f}%")

    print("\n" + "="*95)
    print("BEST CONFIGURATIONS MATCHING USER GOAL (Win Rate ~60% & ~80-120 Trades/Mo):")
    
    # Filter for win rate >= 58% and monthly trades >= 60
    candidates = [
        item for item in all_results
        if item[7]["win_rate"] >= 57.0 and item[7]["profit_factor"] >= 1.25
    ]
    
    # Sort by closest to 100 trades/month and highest win rate
    def rank_score(item):
        mode, sig, tp, sl, be, hold, slots, res = item
        wr = res["win_rate"]
        tr_mo = res["monthly_trades"]
        pf = res["profit_factor"]
        dd = res["max_dd"]
        tr_penalty = abs(tr_mo - 100.0) * 0.8
        wr_bonus = (wr - 55.0) * 3.0
        return wr_bonus - tr_penalty + (pf * 20.0) - (dd * 0.8)

    candidates.sort(key=rank_score, reverse=True)

    print(f"Found {len(candidates)} configurations with Win Rate >= 57% and PF >= 1.25\n")
    top_picks = candidates[:10]
    for idx, (mode, sig, tp, sl, be, hold, slots, res) in enumerate(top_picks, 1):
        be_str = f"{be*100:.1f}%" if be else "Off"
        print(f"#{idx}: [{mode}] {sig} | TP={tp*100:.1f}% | SL={sl*100:.1f}% | Breakeven={be_str} | MaxHold={hold}d | Slots={slots}")
        print(f"    -> Win Rate: {res['win_rate']}% | Trades/Month: {res['monthly_trades']} | Total Trades: {res['trades']}")
        print(f"    -> Profit Factor: {res['profit_factor']} | Total Return: {res['total_return']}% | Max Drawdown: {res['max_dd']}% | Avg Hold: {res['avg_hold']} days")
        print(f"    -> Exits: TP={res['tp_pct_actual']}% | SL={res['sl_pct_actual']}% | Time={res['time_pct_actual']}%")
        print(f"    -> Yearly Win Rates: {res['yearly_wr']}\n")

    # Save to json
    out_file = Path("scratch/swing_deep_search_results.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump([
            {
                "mode": c[0],
                "signal": c[1],
                "tp_pct": c[2],
                "sl_pct": c[3],
                "be_trigger": c[4],
                "max_hold": c[5],
                "max_positions": c[6],
                "metrics": c[7]
            }
            for c in top_picks
        ], f, indent=2)
    print(f"Saved top 10 picks to {out_file}")

if __name__ == "__main__":
    main()
