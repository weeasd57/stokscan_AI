"""Offline, chronological EXIT-policy replay of saved EGX backtest entries.

No Supabase writes, model inference, provider calls or production changes.
Saved candidates are conditional on the old strategy, NOT independent signals.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Policy:
    name: str
    stop_pct: float = .04
    trail_pct: float = .04
    extend_gain: float = .02
    review_sessions: int = 5
    max_sessions: int = 15
    extend: bool = True


def extend_allowed(bar, entry: float, gain: float) -> bool:
    return bool(bar.close >= entry * (1 + gain)
                and bar.close > bar.ema10 and bar.ema5 > bar.ema10
                and bar.ema10 > bar.previous_ema10)


def stop_fill(open_price: float, low: float, stop: float):
    if open_price <= stop:
        return open_price
    return stop if low <= stop else None


def next_exit(bar, entry: float, age: int, policy: Policy):
    if age >= policy.max_sessions:
        return "max_time"
    if age >= policy.review_sessions:
        if not policy.extend or not extend_allowed(bar, entry, policy.extend_gain):
            return "five_session_review" if age == policy.review_sessions else "trend_break"
    return None


def prepare_prices(path: Path, symbols, start="2024-09-01", end="2026-06-13", tail_rows=None):
    with gzip.open(path, "rt", encoding="utf-8") as source:
        raw = pd.DataFrame(json.load(source))
    if tail_rows:
        raw = pd.concat([raw, pd.DataFrame(tail_rows)], ignore_index=True)
    raw = raw.loc[raw.symbol.isin(symbols) & (raw.date >= start)
                  & (raw.date <= end)].copy()
    raw.date = pd.to_datetime(raw.date).dt.strftime("%Y-%m-%d")
    columns = ["open", "high", "low", "close", "volume"]
    raw[columns] = raw[columns].apply(pd.to_numeric, errors="coerce")
    valid = (raw[columns[:4]].gt(0).all(axis=1)
             & raw.high.ge(raw[["open", "low", "close"]].max(axis=1))
             & raw.low.le(raw[["open", "high", "close"]].min(axis=1))
             & raw.volume.ge(0))
    invalid = int((~valid).sum())
    raw = raw.loc[valid].sort_values(["symbol", "date"])
    duplicates = int(raw.duplicated(["symbol", "date"]).sum())
    raw = raw.drop_duplicates(["symbol", "date"], keep="last")
    frames = {}
    for symbol, group in raw.groupby("symbol"):
        group = group.copy().reset_index(drop=True)
        group["ema5"] = group.close.ewm(span=5, adjust=False).mean()
        group["ema10"] = group.close.ewm(span=10, adjust=False).mean()
        group["previous_ema10"] = group.ema10.shift(1)
        group["previous_turnover"] = (group.close * group.volume).rolling(20).mean().shift(1)
        group["previous_close"] = group.close.shift(1)
        group["bar_index"] = np.arange(len(group))
        frames[symbol] = {bar.date: bar for bar in group.itertuples(index=False)}
    return frames, dict(rows=len(raw), symbols=len(frames), invalid_rows=invalid,
                        duplicate_rows=duplicates, first_date=raw.date.min(), last_date=raw.date.max())


def prepare_entries(sources, frames):
    eligible = {}
    audit = {}
    for source in sources:
        entries, excluded = [], Counter()
        seen = set()
        for row in source["entries"]:
            symbol, day = row["symbol"], row["entry_date"]
            bar = frames.get(symbol, {}).get(day)
            if bar is None or bar.bar_index < 20:
                excluded["missing_entry_or_warmup"] += 1
                continue
            recorded = float(row["recorded_entry"])
            if abs(recorded / bar.open - 1) > .02:
                excluded["recorded_entry_not_next_open_basis"] += 1
                continue
            if bar.previous_turnover < 1_000_000:
                excluded["prior_average_turnover_below_1m"] += 1
                continue
            if abs(bar.open / bar.previous_close - 1) > .15:
                excluded["large_entry_gap"] += 1
                continue
            if (symbol, day) in seen:
                excluded["duplicate_entry"] += 1
                continue
            seen.add((symbol, day))
            entries.append(dict(symbol=symbol, date=day))
        name = source["model_name"]
        eligible[name] = entries
        audit[name] = dict(source_id=source["id"], threshold=source["threshold"],
                           saved_entries=len(source["entries"]), eligible=len(entries),
                           exclusions=dict(excluded))
    return eligible, audit


def simulate(frames, entries, policy, start, end, commission=.001, slippage=.001, maturity_buffer=16):
    """One cash ledger across symbols. No future realized P&L funds earlier entries.

    Decisions based on a session's close execute at the next observed open.
    Trailing stop uses completed closes and is active only on later bars.
    """
    dates = sorted({date for bars in frames.values() for date in bars if start <= date <= end})
    # Same mature cohort for every policy; leave 16 sessions before phase end.
    cutoff = dates[-(maturity_buffer + 1)] if len(dates) > maturity_buffer else ""
    signals = {}
    for row in entries:
        if start <= row["date"] <= cutoff:
            signals.setdefault(row["date"], []).append(row)
    cash, positions, trades, equity = 100_000., {}, [], []
    skips, data_warnings = Counter(), Counter()
    max_exposure = 0.

    def close_position(symbol, day, price, reason, age):
        nonlocal cash
        position = positions.pop(symbol)
        net_proceeds = position["shares"] * price * (1 - slippage) * (1 - commission)
        cash += net_proceeds
        pnl = net_proceeds - position["cost"]
        trades.append(dict(symbol=symbol, entry_date=position["day"], exit_date=day,
                           sessions=age, pnl_cash=pnl, net_pct=100 * pnl / position["cost"],
                           reason=reason, extended=policy.extend and age > policy.review_sessions))

    for session_index, day in enumerate(dates):
        # Open exits first; only money actually released at this open is reusable.
        for symbol in list(positions):
            bar = frames[symbol].get(day)
            if bar is None or bar.volume <= 0:
                continue
            position = positions[symbol]
            age = session_index - position["index"]
            # Huge discontinuities cannot be interpreted as ordinary price P&L.
            if abs(bar.open / bar.previous_close - 1) > .25:
                data_warnings["potential_corporate_action"] += 1
            if bar.open <= position["stop"]:
                close_position(symbol, day, bar.open, "gap_stop", age)
            elif position.get("target") and bar.open >= position["target"]:
                close_position(symbol, day, bar.open, "gap_target", age)
            elif position["pending"]:
                close_position(symbol, day, bar.open, position["pending"], age)

        open_equity = cash + sum(p["shares"] * (
            frames[symbol][day].open if day in frames[symbol] else p["last_close"])
            for symbol, p in positions.items())
        # Prior-session liquidity ranks simultaneous entries; no use of today's volume.
        candidates = sorted(signals.get(day, []), key=lambda r: (-frames[r["symbol"]][day].previous_turnover, r["symbol"]))
        for signal in candidates:
            symbol = signal["symbol"]
            bar = frames[symbol][day]
            if symbol in positions or len(positions) >= 5:
                skips["position_capacity"] += 1
                continue
            if bar.volume <= 0:
                skips["no_trade_volume"] += 1
                continue
            gross_exposure = sum(p["shares"] * (
                frames[s][day].open if day in frames[s] else p["last_close"])
                for s, p in positions.items())
            allocation = min(open_equity * .10, open_equity * .50 - gross_exposure,
                             max(0, cash - open_equity * .20), bar.previous_turnover * .01)
            fill = bar.open * (1 + slippage)
            shares = int(allocation / (fill * (1 + commission)))
            if shares < 1:
                skips["insufficient_cash_or_liquidity"] += 1
                continue
            cost = shares * fill * (1 + commission)
            cash -= cost
            fixed_levels = policy.name == "published_levels20"
            positions[symbol] = dict(shares=shares, cost=cost, entry=fill, day=day,
                                      index=session_index,
                                      stop=signal["stop_price"] if fixed_levels else fill * (1 - policy.stop_pct),
                                      target=signal.get("target_price") if fixed_levels else None,
                                      peak_close=fill, pending=None, last_close=bar.close)

        # Intraday stops, then close-derived decisions for the NEXT bar only.
        for symbol in list(positions):
            bar = frames[symbol].get(day)
            if bar is None or bar.volume <= 0:
                continue
            position = positions[symbol]
            age = session_index - position["index"]
            fill = stop_fill(bar.open, bar.low, position["stop"])
            if fill is not None:
                close_position(symbol, day, fill, "stop", age)
                continue
            if position.get("target") and bar.high >= position["target"]:
                close_position(symbol, day, max(bar.open, position["target"]), "target", age)
                continue
            position["last_close"] = bar.close
            position["pending"] = next_exit(bar, position["entry"], age + 1, policy)
            position["peak_close"] = max(position["peak_close"], bar.close)
            if policy.extend and bar.close >= position["entry"] * (1 + policy.extend_gain):
                position["stop"] = max(position["stop"], position["peak_close"] * (1 - policy.trail_pct))

        mark = cash + sum(p["shares"] * p["last_close"] for p in positions.values())
        equity.append(dict(date=day, equity=mark))
        max_exposure = max(max_exposure, (mark - cash) / mark if mark else 0.)

    # No fictitious tradable close on the boundary: retain marked open holdings.
    curve = np.array([100_000.] + [e["equity"] for e in equity])
    drawdown = (np.maximum.accumulate(curve) - curve) / np.maximum.accumulate(curve)
    wins = [t["pnl_cash"] for t in trades if t["pnl_cash"] > 0]
    losses = [-t["pnl_cash"] for t in trades if t["pnl_cash"] < 0]
    avg_hold = float(np.mean([t["sessions"] for t in trades])) if trades else 0.
    metrics = dict(return_pct=round((curve[-1] / 100_000 - 1) * 100, 3),
                   max_drawdown_pct=round(float(drawdown.max() * 100), 3),
                   trades=len(trades), win_rate_pct=round(100 * len(wins) / len(trades), 2) if trades else 0,
                   profit_factor=round(sum(wins) / sum(losses), 3) if losses else None,
                   mean_net_trade_pct=round(float(np.mean([t["net_pct"] for t in trades])), 3) if trades else 0,
                   average_holding_sessions=round(avg_hold, 2),
                   median_holding_sessions=float(np.median([t["sessions"] for t in trades])) if trades else 0,
                   extended_trades=sum(t["extended"] for t in trades), open_at_end=len(positions),
                   cash_at_end=round(cash, 2), final_equity=round(curve[-1], 2),
                   max_observed_exposure_pct=round(max_exposure * 100, 2),
                   exit_reasons=dict(Counter(t["reason"] for t in trades)),
                   skipped=dict(skips), data_warnings=dict(data_warnings))
    return dict(metrics=metrics, trades=trades, equity=equity,
                open_positions=[dict(symbol=s, entry_date=p["day"], entry_price=p["entry"],
                                     last_close=p["last_close"], stop=p["stop"],
                                     unrealized_cash=p["shares"] * p["last_close"] - p["cost"])
                                for s,p in positions.items()])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prices", type=Path, required=True)
    parser.add_argument("--entries", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sources = json.loads(args.entries.read_text(encoding="utf-8"))["sources"]
    frames, quality = prepare_prices(args.prices, {r["symbol"] for s in sources for r in s["entries"]})
    cohorts, entry_audit = prepare_entries(sources, frames)
    policies = [Policy(f"trend_s{int(stop*100)}_t{int(trail*100)}_g{int(gain*100)}",
                       stop, trail, gain)
                for stop in (.03, .04, .05) for trail in (.03, .04, .05) for gain in (.02, .04)]
    policies += [Policy("fixed5", extend=False, max_sessions=5),
                 Policy("fixed10", extend=False, review_sessions=10, max_sessions=10)]
    periods = {"development": ("2025-01-01", "2025-06-30"),
               "validation": ("2025-07-01", "2025-12-31"),
               "holdout": ("2026-01-01", "2026-06-13")}
    results = []
    for model, entries in cohorts.items():
        for policy in policies:
            phases = {name: simulate(frames, entries, policy, *period)["metrics"]
                      for name, period in periods.items() if name != "holdout"}
            results.append(dict(model=model, policy=asdict(policy), **phases))
    # Pick development shortlist without inspecting holdout, then validation.
    def risk_score(metrics):
        return metrics["return_pct"] - metrics["max_drawdown_pct"]
    qualifying = [r for r in results if r["policy"]["extend"]
                  and r["development"]["trades"] >= 15
                  and 3 <= r["development"]["average_holding_sessions"] <= 7
                  and not r["development"]["open_at_end"]]
    shortlist = sorted(qualifying, key=lambda r: risk_score(r["development"]), reverse=True)[:5]
    validated = [r for r in shortlist if r["validation"]["trades"] >= 15
                 and 3 <= r["validation"]["average_holding_sessions"] <= 7
                 and not r["validation"]["open_at_end"]]
    selected = max(validated, key=lambda r: risk_score(r["validation"])) if validated else None
    # Freeze selection above. Only then evaluate holdout and predefined baselines.
    evaluation = []
    if selected:
        selected_policy = Policy(**selected["policy"])
        matched = [Policy("fixed5_matched_stop", stop_pct=selected_policy.stop_pct,
                          extend=False, max_sessions=5),
                   Policy("fixed10_matched_stop", stop_pct=selected_policy.stop_pct,
                          extend=False, review_sessions=10, max_sessions=10)]
        for model, policy in [(selected["model"], selected_policy)] + [
                (selected["model"], p) for p in matched] + [
                (model, p) for model in cohorts for p in policies if not p.extend]:
            run = simulate(frames, cohorts[model], policy, *periods["holdout"])
            stress = simulate(frames, cohorts[model], policy, *periods["holdout"], commission=.002, slippage=.002)
            evaluation.append(dict(model=model, policy=asdict(policy), holdout=run["metrics"],
                                   stress_80bps=stress["metrics"], trades=run["trades"], equity=run["equity"]))
    robustness = {}
    if evaluation:
        winner = evaluation[0]
        pnl_by_symbol = Counter()
        for trade in winner["trades"]:
            pnl_by_symbol[trade["symbol"]] += trade["pnl_cash"]
        top_symbols = [symbol for symbol, pnl in pnl_by_symbol.most_common(2)]
        without = [row for row in cohorts[selected["model"]] if row["symbol"] not in top_symbols]
        diagnostic = simulate(frames, without, selected_policy, *periods["holdout"])
        robustness = dict(top_two_pnl_symbols=top_symbols,
                          pnl_by_symbol={k:round(v, 2) for k,v in pnl_by_symbol.items()},
                          without_top_two_symbols=diagnostic["metrics"],
                          note="Post-selection concentration diagnostic only; exclusions were identified from holdout and cannot be used to choose a strategy.")
    output = dict(price_sha256=hashlib.sha256(args.prices.read_bytes()).hexdigest(),
                  entries_sha256=hashlib.sha256(args.entries.read_bytes()).hexdigest(),
                  archive_revision=args.prices.parts[-4], price_quality=quality,
                  entry_audit=entry_audit, periods=periods, grid_size=len(results),
                  selection_metric="portfolio return minus maximum drawdown; average hold 3..7 sessions; >=15 closed trades each selection phase",
                  selected=selected, shortlist=shortlist, development_validation=results,
                  evaluation=evaluation, robustness=robustness,
                  limitations=["Conditional replay of saved accepted entries, not complete point-in-time model candidates.",
                               "Original model training cutoff is unverified; temporal exit holdout is not an ML out-of-sample claim.",
                               "No authenticated corporate-action/dividend adjustment audit; large discontinuities are flagged, not repaired.",
                               "Missing/suspended sessions and stale marks can distort execution and drawdown.",
                               "Current archived universe may exclude delisted stocks (survivorship bias).",
                               "40/80 basis-point round-trip scenarios approximate fees/slippage, not a verified broker tariff.",
                               "Saved entry dates use recorded next-open compatibility, not reconstructed original signal timestamps.",
                               "No extra opportunities generated after an earlier exit; no comparison with original headline returns."])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(dict(quality=quality, audit=entry_audit, selected=selected,
                         evaluation=[{k:v for k,v in r.items() if k not in ("trades", "equity")} for r in evaluation]), ensure_ascii=False))


if __name__ == "__main__":
    main()
