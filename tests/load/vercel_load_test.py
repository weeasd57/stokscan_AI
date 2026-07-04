#!/usr/bin/env python3
"""Vercel+Supabase focused load test. Tests only Next.js API routes on Vercel.
Usage:
  python tests/load/vercel_load_test.py --scenario smoke
  python tests/load/vercel_load_test.py --scenario normal
"""
from __future__ import annotations
import argparse, concurrent.futures, json, sys, time, random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import requests

BASE = "https://egxbots.com"
SCENARIOS = {
    "smoke":  {"virtual_users": 5,  "duration_sec": 20, "think_sec": 1.0},
    "normal": {"virtual_users": 30, "duration_sec": 45, "think_sec": 1.0},
    "stress": {"virtual_users": 80, "duration_sec": 60, "think_sec": 0.5},
}
WORKLOAD = [
    ("/", 20),
    ("/scanner/market", 10),
    ("/scanner/technical", 10),
    ("/api/scan/sectors/heatmap?country=Egypt", 10),
    ("/api/scan/sectors/timeline?country=Egypt", 8),
    ("/api/market/macro-correlation/scan", 5),
    ("/api/market/macro-correlation/data?symbol=FWRY", 5),
    ("/api/adaptive/recommendation?exchange=EGX", 5),
    ("/api/symbols/inventory", 5),
    ("/api/health", 7),
    ("/api/market/status", 5),
    ("/api/scan/similarity/published", 5),
]

@dataclass
class R:
    ok: bool; ms: float; status: int; label: str; error: Optional[str] = None

@dataclass
class Report:
    scenario: str; vu: int; total: int
    success_rate: float; rps: float; p50: float; p95: float; p99: float
    errors_by_label: Dict[str, int] = field(default_factory=dict)
    p95_by_label: Dict[str, float] = field(default_factory=dict)
    comfortable: int = 0; maximum: int = 0; verdict: str = ""
    notes: List[str] = field(default_factory=list)

def pick():
    total = sum(w for _, w in WORKLOAD)
    r = random.uniform(0, total); acc = 0.0
    for path, w in WORKLOAD:
        acc += w
        if r <= acc: return path
    return WORKLOAD[0][0]

def one_req(sess, timeout):
    path = pick(); url = BASE + path; label = path.split("?")[0]
    t0 = time.perf_counter()
    try:
        resp = sess.get(url, timeout=timeout)
        ms = (time.perf_counter() - t0) * 1000
        return R(ok=200 <= resp.status_code < 400, ms=ms, status=resp.status_code, label=label)
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        return R(ok=False, ms=ms, status=0, label=label, error=str(e)[:100])

def vu_worker(uid, stop_at, think, timeout):
    sess = requests.Session(); sess.headers["User-Agent"] = f"StokscanTest/2.0 (vu-{uid})"
    results = []
    while time.perf_counter() < stop_at:
        results.append(one_req(sess, timeout)); time.sleep(think)
    return results

def pct(vals, p):
    if not vals: return 0.0
    s = sorted(vals); i = int(round((p/100)*(len(s)-1)))
    return s[max(0, min(i, len(s)-1))]

def estimate(vu, sr, p95):
    if sr >= 0.99 and p95 <= 800:
        c, m, v = int(vu*3), int(vu*5), "EXCELLENT - Supabase reads fast, scales well"
    elif sr >= 0.98 and p95 <= 2000:
        c, m, v = int(vu*1.5), int(vu*2.5), "GOOD - System healthy"
    elif sr >= 0.95 and p95 <= 4000:
        c, m, v = vu, int(vu*1.3), "FAIR - Near limit, add edge caching"
    else:
        c, m, v = int(vu*0.5), int(vu*0.8), "STRESSED - Optimize before scaling"
    notes = [
        "Vercel free: 100GB bandwidth/month, unlimited serverless (hobby)",
        "Supabase free: 500MB DB, ~500K API calls/month",
        "Static pages (/, /scanner/*) cached by Vercel CDN -- near infinite scale",
        "Dynamic /api/* routes each = 1 Supabase call per user request",
    ]
    return c, m, v, notes

def run(scenario, timeout=20.0):
    cfg = SCENARIOS[scenario]; vu, dur, think = cfg["virtual_users"], cfg["duration_sec"], cfg["think_sec"]
    print(f"\nVercel+Supabase Load Test | {scenario.upper()} | VUs={vu} | {dur}s")
    print(f"Target: {BASE}")
    stop_at = time.perf_counter() + dur; all_r = []; t0 = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=vu) as pool:
        futs = [pool.submit(vu_worker, i, stop_at, think, timeout) for i in range(vu)]
        for f in concurrent.futures.as_completed(futs): all_r.extend(f.result())
    elapsed = max(time.perf_counter() - t0, 0.001)
    ok_r = [r for r in all_r if r.ok]; lats = [r.ms for r in ok_r]
    sr = len(ok_r) / max(len(all_r), 1)
    errs = {}; lats_by = {}
    for r in all_r:
        lats_by.setdefault(r.label, [])
        if r.ok: lats_by[r.label].append(r.ms)
        else: errs[r.label] = errs.get(r.label, 0) + 1
    p50_v, p95_v, p99_v = pct(lats, 50), pct(lats, 95), pct(lats, 99)
    c, m, v, notes = estimate(vu, sr, p95_v)
    return Report(scenario=scenario, vu=vu, total=len(all_r),
        success_rate=round(sr*100,2), rps=round(len(all_r)/elapsed,2),
        p50=round(p50_v,1), p95=round(p95_v,1), p99=round(p99_v,1),
        errors_by_label=errs,
        p95_by_label={k: round(pct(v2,95),1) for k,v2 in lats_by.items() if v2},
        comfortable=c, maximum=m, verdict=v, notes=notes)

def print_report(r):
    print(f"\n{'='*55}")
    print(f"  Total requests : {r.total}")
    print(f"  Success rate   : {r.success_rate}%")
    print(f"  Throughput     : {r.rps} req/s")
    print(f"  Latency p50    : {r.p50} ms")
    print(f"  Latency p95    : {r.p95} ms")
    print(f"  Latency p99    : {r.p99} ms")
    if r.errors_by_label:
        print("  Errors by route:")
        for k, v in sorted(r.errors_by_label.items(), key=lambda x: -x[1]): print(f"    {k}: {v}")
    print("\n  Slowest routes (p95 ms):")
    for k, v in sorted(r.p95_by_label.items(), key=lambda x: -x[1])[:6]:
        bar = "#" * min(int(v/80), 35)
        print(f"    {k:<42} {v:>7.0f}ms  {bar}")
    print(f"\n  Comfortable concurrent users : ~{r.comfortable}")
    print(f"  Approx. upper bound          : ~{r.maximum}")
    print(f"  Verdict: {r.verdict}")
    for n in r.notes: print(f"    * {n}")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", choices=list(SCENARIOS), default="smoke")
    p.add_argument("--timeout", type=float, default=20.0)
    p.add_argument("--json-out", default="")
    args = p.parse_args()
    report = run(args.scenario, args.timeout)
    print_report(report)
    if args.json_out:
        with open(args.json_out, "w") as f: json.dump(report.__dict__, f, indent=2)
        print(f"Saved -> {args.json_out}")
    return 0 if report.success_rate >= 95 else 1

if __name__ == "__main__":
    raise SystemExit(main())
