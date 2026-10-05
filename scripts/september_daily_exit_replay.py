"""Read-only offline replay of September PUBLISHED signals, not missing rejects."""
import argparse
import json
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfo
from datetime import datetime

from scripts.swing_exit_experiment import Policy, prepare_prices, simulate


def original_levels(row):
    changes = row.get("adjustments") or []
    if isinstance(changes, str):
        changes = json.loads(changes)
    changes = sorted(changes, key=lambda x:x.get("timestamp", ""))
    stop = next((a["old_stop"] for a in changes if a.get("old_stop")), row["stop_loss"])
    target = next((a["old_target"] for a in changes if a.get("old_target")), row["target_price"])
    return float(stop), float(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("prices", "source", "tail", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.source.read_text(encoding="utf-8"))
    tail = json.loads(args.tail.read_text(encoding="utf-8"))
    frames, quality = prepare_prices(args.prices, {r["symbol"] for r in data["recommendations"]},
                                     start="2026-06-01", end="2026-10-05", tail_rows=tail)
    entries, exclusions = [], Counter()
    market_dates = sorted({d for bars in frames.values() for d in bars})
    for row in data["recommendations"]:
        day = datetime.fromisoformat(row["created_at"]).astimezone(ZoneInfo("Africa/Cairo")).date().isoformat()
        bars = frames.get(row["symbol"], {})
        earlier = [d for d in bars if d <= day]
        if not earlier:
            exclusions["missing_signal_bar"] += 1
            continue
        signal_date = row.get("signal_date") or max(earlier)
        reference = bars.get(signal_date)
        if reference is None or abs(float(row["entry_price"]) / reference.close - 1) > .02:
            exclusions["incompatible_signal_close"] += 1
            continue
        following = [d for d in market_dates if d > signal_date and d > day]
        if not following:
            exclusions["no_following_tradable_bar"] += 1
            continue
        entry_day = following[0]
        bar = bars.get(entry_day)
        if bar is None:
            exclusions["missing_next_market_session_bar"] += 1
            continue
        if bar.volume <= 0:
            exclusions["no_trade_volume_at_entry"] += 1
            continue
        if bar.previous_turnover < 1_000_000:
            exclusions["previous_turnover_below_1m"] += 1
            continue
        if abs(bar.open / reference.close - 1) > .05:
            exclusions["entry_gap_above_5pct"] += 1
            continue
        stop, target = original_levels(row)
        if not stop < bar.open < target:
            exclusions["unrecoverable_original_geometry"] += 1
            continue
        entries.append(dict(symbol=row["symbol"], date=entry_day,
                            stop_price=stop, target_price=target, model=row["model_name"]))
    policies = [Policy("trend_s5_t4_g2", stop_pct=.05, trail_pct=.04, extend_gain=.02),
                Policy("fixed5_matched_stop", stop_pct=.05, max_sessions=5, extend=False),
                Policy("published_levels20", review_sessions=20, max_sessions=20, extend=False)]
    runs = []
    for policy in policies:
        for end in ("2026-09-30", "2026-10-05"):
            run = simulate(frames, entries, policy, "2026-09-01", end, maturity_buffer=0)
            stress = simulate(frames, entries, policy, "2026-09-01", end,
                              commission=.002, slippage=.002, maturity_buffer=0)
            runs.append(dict(policy=policy.name, through=end, **run,
                             stress_80bps=stress["metrics"]))
    thresholds = []
    for threshold in (55, 50, 40, 35, 30):
        candidates = data["audit"]["candidates"]
        council_pass = [c for c in candidates if c["council_score"] >= threshold]
        thresholds.append(dict(threshold=threshold, council_pass=len(council_pass),
                               also_rr15=sum(c["risk_reward"] >= 1.5 for c in council_pass)))
    output = dict(source_count=len(data["recommendations"]), source_models=dict(Counter(
                  r["model_name"] for r in data["recommendations"])), eligible=len(entries),
                  exclusions=dict(exclusions), entries=entries, price_quality=quality,
                  latest_audit=data["audit"], threshold_sensitivity=thresholds, runs=runs,
                  limitations=["No historical rejected candidates or dated council scores: cannot replay relaxed entry filters.",
                               "Inferred signal price dates from publication, not immutable entry snapshots.",
                               "Original levels reconstructed from first recorded adjustment; not guaranteed original after overwrites.",
                               "published_levels20 is fixed-original-barrier reference, NOT exact legacy adaptive live exits.",
                               "All scenarios use one common eligible published cohort; open positions marked, not fabricated closed.",
                               "September is retrospective exploratory evaluation; policy has already inspected other samples.",
                               "Potential corporate actions, missing sessions, survivors and costs have not been fully audited.",
                               "Tail uses prices through completed October 5 session, not October 6 intraday prices."])
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k:v for k,v in output.items() if k not in ("runs","entries")}, ensure_ascii=True))
    print(json.dumps([dict(policy=r["policy"], through=r["through"], metrics=r["metrics"],
                           stress_return=r["stress_80bps"]["return_pct"]) for r in runs]))


if __name__ == "__main__":
    main()
