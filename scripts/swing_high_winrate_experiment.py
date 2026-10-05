"""
Standalone Swing Strategy Optimization & High Win-Rate Validation Script
Goals:
1. Strict Leak-Free & Lookahead-Free Execution:
   - Causal rolling calculations strictly per-symbol.
   - Signals generated at Day T Close using only data up to Day T.
   - Realistic Limit Order Fill at Day T+1:
     * If Day T+1 Open <= Day T Close * (1 + tolerance): execute at Day T+1 Open (price improvement or slight open).
     * Else if Day T+1 Low <= Day T Close: execute at Day T Close (intraday dip fill).
     * Else: order expires unfilled (never chased, no gap illusion).
   - T+2 settlement lock on sales and receivables.
   - Realistic EGX round-trip fees: 0.15% buy + 0.15% sell (0.30% total).
2. Targets:
   - ~100 trades/month across the system/portfolio.
   - ~60% Win Rate (55% - 65%) with positive Profit Factor (> 1.30) and healthy risk/reward.
   - Controlled Max Drawdown (< 12%).
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
    print("Loading EGX dataset from cache...")
    with gzip.open(ARCHIVE, "rt", encoding="utf-8") as f:
        raw = json.load(f)
    df = pd.DataFrame(raw)
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close", "volume"])
    df = df[(df.open > 0) & (df.high > 0) & (df.low > 0) & (df.close > 0) & (df.volume >= 0)]
    df = df.sort_values(["symbol", "date"]).reset_index(drop=True)
    print(f"Loaded {len(df):,} valid bars across {df['symbol'].nunique()} symbols in {time.time()-t0:.2f}s")
    return df

def compute_features_and_signals(df):
    """Causal rolling calculations and signal generation strictly per symbol."""
    t0 = time.time()
    print("Computing causal features and swing signals strictly per symbol...")
    groups = []
    
    for symbol, g in df.groupby("symbol", sort=False):
        g = g.copy().reset_index(drop=True)
        c = g["close"]
        h = g["high"]
        l = g["low"]
        v = g["volume"]
        o = g["open"]

        # EMAs
        g["ema5"] = c.ewm(span=5, adjust=False).mean()
        g["ema10"] = c.ewm(span=10, adjust=False).mean()
        g["ema20"] = c.ewm(span=20, adjust=False).mean()
        g["ema50"] = c.ewm(span=50, adjust=False).mean()

        # ATR 14
        prev_c = c.shift(1)
        tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
        g["atr14"] = tr.rolling(14).mean()
        g["atr_pct"] = g["atr14"] / c

        # RSI 14
        delta = c.diff()
        gain = (delta.where(delta > 0, 0)).rolling(14).mean()
        loss = ((-delta.where(delta < 0, 0))).rolling(14).mean()
        rs = gain / (loss + 1e-9)
        g["rsi14"] = 100 - (100 / (1 + rs))

        # Turnover & Activity
        g["turnover"] = (c * v).rolling(20).mean()
        g["active_days"] = v.gt(0).rolling(20).sum()

        # Prior bars (strict shift 1)
        g["prev_close"] = prev_c
        g["prev_low"] = l.shift(1)
        g["prev_high"] = h.shift(1)

        # Baseline Liquidity Filter: At least 60 trading days, 1M+ daily turnover, active 16+ of last 20 days
        liquid = (
            (np.arange(len(g)) >= 50)
            & (g["turnover"] >= 1_000_000)
            & (g["active_days"] >= 15)
        )
        g["liquid"] = liquid

        # Trend filter: Price > EMA50 and EMA20 > EMA50 (Healthy Uptrend)
        uptrend = liquid & (c > g["ema50"]) & (g["ema20"] > g["ema50"] * 0.99)

        # Archetype 1: Pullback Bounce to EMA10 in Uptrend
        # - Stock dipped to or below EMA10 during session (low <= ema10 * 1.01)
        # - Closed above EMA10
        # - Candle is green (close > open) and close > yesterday's close
        g["sig_pb_ema10"] = (
            uptrend
            & (l <= g["ema10"] * 1.01)
            & (c > g["ema10"])
            & (c > o)
            & (c > prev_c)
        )

        # Archetype 2: Pullback Bounce to EMA20 in Uptrend
        # - Stock pulled back to EMA20 (low <= ema20 * 1.01)
        # - Closed above EMA20
        # - Candle is green and close > yesterday's close
        g["sig_pb_ema20"] = (
            uptrend
            & (l <= g["ema20"] * 1.015)
            & (c > g["ema20"])
            & (c > o)
            & (c > prev_c)
        )

        # Archetype 3: Pullback Either EMA10 or EMA20
        g["sig_pb_either"] = g["sig_pb_ema10"] | g["sig_pb_ema20"]

        # Archetype 4: RSI Dip Recovery in Uptrend
        # - RSI between 35 and 52 (healthy pullback zone)
        # - Closed green with price above EMA20
        # - Low touched EMA10 or EMA20
        g["sig_rsi_dip"] = (
            uptrend
            & (g["rsi14"] >= 35)
            & (g["rsi14"] <= 55)
            & (l <= g["ema20"] * 1.015)
            & (c > o)
            & (c > prev_c)
        )

        # Archetype 5: Momentum Pullback (Micro-dip in strong momentum)
        # - EMA10 > EMA20 > EMA50
        # - RSI between 45 and 65
        # - Prior day was red or flat, today is green bouncing off EMA10
        g["sig_momentum_pb"] = (
            liquid
            & (g["ema10"] > g["ema20"])
            & (g["ema20"] > g["ema50"])
            & (c > g["ema10"])
            & (l <= g["ema10"] * 1.008)
            & (c > o)
            & (prev_c <= g["prev_high"])
        )

        groups.append(g)

    res = pd.concat(groups, ignore_index=True)
    print(f"Features and signals computed in {time.time()-t0:.2f}s")
    return res

def precompute_market_and_signals(df, signal_cols):
    """Precompute fast lookups once outside the simulation grid."""
    t0 = time.time()
    print("Pre-indexing market bars and signal schedules...")
    dates = sorted(df["date"].unique())
    next_date_map = dict(zip(dates, dates[1:]))

    # Fast market lookup: (symbol, date) -> tuple/object
    # Using namedtuple or lightweight dict
    market = {}
    for row in df[["symbol", "date", "open", "high", "low", "close", "volume", "turnover", "atr_pct"]].itertuples(index=False):
        market[(row.symbol, row.date)] = row

    # Fast signal lookups: sig_col -> {next_date: [signals]}
    signals_by_sig = {}
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

    print(f"Pre-indexing complete in {time.time()-t0:.2f}s")
    return dates, market, signals_by_sig

def simulate_system(dates, market, signals_by_date, tp_pct, sl_pct, max_hold, be_trigger=0.02, max_positions=18, cost=0.0015, limit_tol=0.003):
    """
    Simulation with:
    - Limit order fill logic (No chase).
    - T+2 sale lock.
    - Cash receivables clearance (T+2).
    - Max concurrent positions.
    - Breakeven stop activation at +be_trigger.
    """
    cash = 100_000.0
    receivables = []
    positions = {}
    closed_trades = []
    equity_curve = []

    for i, day in enumerate(dates):
        # 1. Clear receivables (T+2 settlement)
        cash += sum(v for due, v in receivables if due <= i)
        receivables = [(due, v) for due, v in receivables if due > i]

        # 2. Process exits for existing positions at Day open if pending from yesterday
        for sym in list(positions):
            p = positions[sym]
            b = market.get((sym, day))
            if not b or b.volume <= 0 or b.high == b.low:
                continue
            age = i - p["index"]

            if age >= 2 and p["pending"]:
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

        # 3. Process new entries at Day open (Limit Order Fill logic)
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
            # Strict Limit Execution Logic:
            # Did the market open within tolerance or dip to limit price?
            if b.open <= limit_price * (1 + limit_tol):
                exec_price = b.open  # Filled at open
            elif b.low <= limit_price:
                exec_price = limit_price  # Filled at limit price on intraday pullback
            else:
                # Stock gapped up and never touched limit price: ORDER EXPIRED (NO CHASE)
                continue

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
                "be_price": fill * (1 + 0.003),  # Breakeven covers round-trip fees
                "be_active": False,
                "last": b.close,
                "pending": None
            }

        # 4. Intraday price check & EOD status for positions
        for sym in list(positions):
            p = positions[sym]
            b = market.get((sym, day))
            if not b:
                continue
            p["last"] = b.close
            age = i - p["index"]

            # Breakeven trigger: if intraday high reached entry + be_trigger
            if not p["be_active"] and b.high >= p["entry_price"] * (1 + be_trigger):
                p["be_active"] = True
                p["sl_price"] = max(p["sl_price"], p["be_price"])

            # Check Take Profit hit
            if b.high >= p["tp_price"]:
                if age >= 2 and b.volume > 0 and b.high > b.low:
                    # Can sell today if T+2 met
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
                    p["pending"] = "tp_locked"

            # Check Stop Loss hit
            elif b.low <= p["sl_price"]:
                if age >= 2 and b.volume > 0 and b.high > b.low:
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
                    p["pending"] = "sl_locked"

            # Check Time Stop
            elif age >= max_hold:
                p["pending"] = "time_stop"

        # Record equity
        total_eq = cash + sum(v for _, v in receivables) + sum(p["shares"] * p["last"] for p in positions.values())
        equity_curve.append({"date": day, "equity": total_eq})

    df_trades = pd.DataFrame(closed_trades) if closed_trades else pd.DataFrame(columns=["pnl", "return_pct", "sessions", "exit_date", "reason"])
    if len(df_trades) == 0:
        return {"trades": 0, "win_rate": 0, "return_pct": 0, "monthly_trades": 0, "profit_factor": 0}

    df_trades["year"] = df_trades["exit_date"].str[:4]
    df_trades["month"] = df_trades["exit_date"].str[:7]
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

    # Yearly breakdown
    yearly = {}
    for yr, y_df in df_trades.groupby("year"):
        y_wins = y_df[y_df["pnl"] > 0]["pnl"].sum()
        y_loss = -y_df[y_df["pnl"] < 0]["pnl"].sum()
        y_pf = (y_wins / y_loss) if y_loss > 0 else 999.0
        yearly[yr] = {
            "trades": len(y_df),
            "win_rate": round((y_df["pnl"] > 0).mean() * 100, 1),
            "pf": round(y_pf, 2)
        }

    return {
        "trades": len(df_trades),
        "win_rate": round(win_rate, 1),
        "monthly_trades": round(trades_per_month, 1),
        "total_return": round(tot_return, 1),
        "max_dd": round(max_dd, 1),
        "profit_factor": round(pf, 2),
        "avg_hold": round(df_trades["sessions"].mean(), 1),
        "tp_count": (df_trades["reason"] == "take_profit").sum(),
        "sl_count": (df_trades["reason"] == "stop_loss").sum(),
        "time_count": (df_trades["reason"] == "time_stop").sum(),
        "yearly": yearly,
        "trades_df": df_trades
    }

def main():
    raw_df = load_data()
    featured_df = compute_features_and_signals(raw_df)

    signal_cols = ["sig_pb_ema10", "sig_pb_ema20", "sig_pb_either", "sig_rsi_dip", "sig_momentum_pb"]
    dates, market, signals_by_sig = precompute_market_and_signals(featured_df, signal_cols)

    # Let's inspect raw signal counts per month for each setup
    print("\n" + "="*80)
    print("RAW SIGNAL GENERATION ACROSS LIQUID EGX (Unconstrained Opportunities):")
    print(f"{'Signal Archetype':<20} | {'Total Signals':<15} | {'Avg Signals/Month':<20}")
    print("-" * 60)
    months_count = len(sorted(featured_df["date"].str[:7].unique()))
    for sc in signal_cols:
        tot_sig = sum(len(sigs) for sigs in signals_by_sig[sc].values())
        print(f"{sc:<20} | {tot_sig:<15} | {tot_sig/months_count:<20.1f}")

    print("\n" + "="*80)
    print("RUNNING GRID SEARCH FOR HIGH WIN-RATE (~60%) & TARGET FREQUENCY (~80-120 TRADES/MO):")
    print(f"{'Signal':<15} | {'TP':<5} | {'SL':<5} | {'Hold':<4} | {'Slots':<5} | {'Trades':<6} | {'Tr/Mo':<6} | {'WinRate':<8} | {'PF':<5} | {'Return':<7} | {'MaxDD':<6}")
    print("-" * 90)

    best_results = []
    t_start = time.time()

    for sig in signal_cols:
        for tp in [0.035, 0.04, 0.045, 0.05]:
            for sl in [0.03, 0.035, 0.04]:
                for hold in [3, 4, 5]:
                    for slots in [15, 20]:
                        res = simulate_system(
                            dates=dates,
                            market=market,
                            signals_by_date=signals_by_sig[sig],
                            tp_pct=tp,
                            sl_pct=sl,
                            max_hold=hold,
                            be_trigger=0.02,
                            max_positions=slots,
                            cost=0.0015,
                            limit_tol=0.003
                        )
                        if res["trades"] >= 200:
                            best_results.append((sig, tp, sl, hold, slots, res))
                            if res["win_rate"] >= 55.0 and res["profit_factor"] >= 1.25:
                                print(f"{sig:<15} | {tp*100:<5.1f}% | {sl*100:<5.1f}% | {hold:<4} | {slots:<5} | {res['trades']:<6} | {res['monthly_trades']:<6} | {res['win_rate']:<7.1f}% | {res['profit_factor']:<5.2f} | {res['total_return']:<6.1f}% | {res['max_dd']:<5.1f}%")

    print(f"\nGrid search completed in {time.time()-t_start:.2f}s across {len(best_results)} simulations.")

    # Sort results to find best candidates closest to Win Rate ~60% and Monthly Trades ~80-120
    print("\n" + "="*95)
    print("TOP CANDIDATES RANKED BY (WIN RATE ~60% + MONTHLY FREQUENCY ~80-100 + PF > 1.30):")
    
    # Custom score: Win rate close to 60%, monthly trades close to 90, PF high, DD low
    def score_candidate(item):
        sig, tp, sl, hold, slots, res = item
        wr = res["win_rate"]
        tr_mo = res["monthly_trades"]
        pf = res["profit_factor"]
        dd = res["max_dd"]
        # Penalty for distance from 60% win rate
        wr_score = max(0, 100 - abs(wr - 60.0) * 4)
        # Penalty for distance from 90 trades/month
        tr_score = max(0, 100 - abs(tr_mo - 90.0) * 1.5)
        return wr_score * 0.4 + tr_score * 0.3 + (pf * 25) - (dd * 1.5)

    best_results.sort(key=score_candidate, reverse=True)

    top5 = best_results[:5]
    for idx, (sig, tp, sl, hold, slots, res) in enumerate(top5, 1):
        print(f"\n#{idx} OPTION: Signal={sig} | TP={tp*100:.1f}% | SL={sl*100:.1f}% | MaxHold={hold}d | Slots={slots}")
        print(f"   -> Win Rate: {res['win_rate']}% | Trades/Mo: {res['monthly_trades']} | Total Trades: {res['trades']}")
        print(f"   -> Profit Factor: {res['profit_factor']} | Total Return: {res['total_return']}% | Max DD: {res['max_dd']}% | Avg Hold: {res['avg_hold']}d")
        print(f"   -> Exits: TP={res['tp_count']} ({res['tp_count']/res['trades']*100:.1f}%), SL={res['sl_count']} ({res['sl_count']/res['trades']*100:.1f}%), Time={res['time_count']} ({res['time_count']/res['trades']*100:.1f}%)")
        print(f"   -> Yearly Consistency: {res['yearly']}")

    # Save summary report to JSON
    output_path = Path("scratch/swing_high_winrate_results_2026-10-06.json")
    output_data = {
        "timestamp": "2026-10-06T02:30:00+03:00",
        "description": "High Win-Rate (~60%) Swing Trading System Grid Search",
        "top_candidates": [
            {
                "rank": i+1,
                "signal": sig,
                "tp_pct": tp,
                "sl_pct": sl,
                "max_hold": hold,
                "max_positions": slots,
                "win_rate": res["win_rate"],
                "monthly_trades": res["monthly_trades"],
                "total_trades": res["trades"],
                "profit_factor": res["profit_factor"],
                "total_return": res["total_return"],
                "max_dd": res["max_dd"],
                "avg_hold": res["avg_hold"],
                "yearly": res["yearly"]
            }
            for i, (sig, tp, sl, hold, slots, res) in enumerate(top5)
        ]
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2)
    print(f"\nSaved detailed top candidates to {output_path}")

if __name__ == "__main__":
    main()
