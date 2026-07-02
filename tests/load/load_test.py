#!/usr/bin/env python3
"""
EGX Bots load test — estimates concurrent user capacity for API + frontend.

Usage (from repo root):
  python tests/load/load_test.py --target production --scenario smoke
  python tests/load/load_test.py --target local --scenario normal
  python tests/load/load_test.py --target production --scenario stress --backend-only
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import requests

TARGETS = {
    "production": {
        "backend": "https://egxbots.com",
        "frontend": "https://egxbots.com",
    },
    "local": {
        "backend": "http://localhost:3000",
        "frontend": "http://localhost:3000",
    },
}

SCENARIOS = {
    "smoke": {"virtual_users": 5, "duration_sec": 20, "think_sec": 1.0},
    "normal": {"virtual_users": 20, "duration_sec": 45, "think_sec": 1.5},
    "stress": {"virtual_users": 50, "duration_sec": 60, "think_sec": 0.5},
    "spike": {"virtual_users": 100, "duration_sec": 30, "think_sec": 0.2},
}

# Mix approximating real browsing (weights must sum to 100)
WORKLOAD = [
    ("backend", "GET", "/api/symbols/countries?source=supabase", 25),
    ("backend", "GET", "/api/symbols/by-date?exchange=EGX&limit=50", 20),
    ("backend", "GET", "/api/models/list", 15),
    ("backend", "GET", "/api/scan/sectors/heatmap?country=Egypt", 15),
    ("frontend", "GET", "/", 15),
    ("frontend", "GET", "/scanner/technical", 10),
]


@dataclass
class RequestResult:
    ok: bool
    latency_ms: float
    status: int
    label: str
    error: Optional[str] = None


@dataclass
class LoadReport:
    scenario: str
    target: str
    virtual_users: int
    duration_sec: int
    total_requests: int
    success_rate: float
    rps: float
    latency_p50_ms: float
    latency_p95_ms: float
    latency_p99_ms: float
    errors_by_label: Dict[str, int] = field(default_factory=dict)
    estimated_comfortable_users: int = 0
    estimated_max_users: int = 0
    notes: List[str] = field(default_factory=list)


def _pick_workload(backend_only: bool = False) -> Tuple[str, str, str]:
    import random

    workload = [item for item in WORKLOAD if not backend_only or item[0] == "backend"]
    total = sum(w for *_, w in workload)
    r = random.uniform(0, total)
    acc = 0.0
    for layer, method, path, weight in workload:
        acc += weight
        if r <= acc:
            return layer, method, path
    return workload[0][0], workload[0][1], workload[0][2]


def _one_request(
    session: requests.Session,
    bases: Dict[str, str],
    timeout: float,
    backend_only: bool,
) -> RequestResult:
    layer, method, path = _pick_workload(backend_only=backend_only)

    base = bases[layer]
    url = f"{base.rstrip('/')}{path}"
    label = f"{layer}:{path}"
    started = time.perf_counter()
    try:
        resp = session.request(method, url, timeout=timeout)
        latency_ms = (time.perf_counter() - started) * 1000
        ok = 200 <= resp.status_code < 400
        return RequestResult(ok=ok, latency_ms=latency_ms, status=resp.status_code, label=label)
    except Exception as exc:
        latency_ms = (time.perf_counter() - started) * 1000
        return RequestResult(
            ok=False,
            latency_ms=latency_ms,
            status=0,
            label=label,
            error=str(exc)[:120],
        )


def _virtual_user(
    user_id: int,
    bases: Dict[str, str],
    stop_at: float,
    think_sec: float,
    timeout: float,
    backend_only: bool,
) -> List[RequestResult]:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": f"EGXBotsLoadTest/1.0 (vu-{user_id})",
            "Accept": "application/json, text/html",
        }
    )
    results: List[RequestResult] = []
    while time.perf_counter() < stop_at:
        results.append(_one_request(session, bases, timeout, backend_only))
        time.sleep(think_sec)
    return results


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = int(round((pct / 100) * (len(ordered) - 1)))
    return ordered[max(0, min(idx, len(ordered) - 1))]


def _estimate_capacity(
    virtual_users: int,
    success_rate: float,
    p95_ms: float,
) -> Tuple[int, int, List[str]]:
    notes: List[str] = []
    # Comfort: p95 under 2s and errors under 2%
    if success_rate >= 0.98 and p95_ms <= 2000:
        comfortable = int(virtual_users * 1.5)
        maximum = int(virtual_users * 2.5)
        notes.append("Current scenario looks healthy — capacity estimate extrapolated linearly.")
    elif success_rate >= 0.95 and p95_ms <= 4000:
        comfortable = virtual_users
        maximum = int(virtual_users * 1.3)
        notes.append("Near comfort limit — reduce think time or add caching before scaling further.")
    elif success_rate >= 0.90:
        comfortable = max(1, int(virtual_users * 0.7))
        maximum = virtual_users
        notes.append("System under stress — this VU count is close to the practical ceiling.")
    else:
        comfortable = max(1, int(virtual_users * 0.5))
        maximum = max(1, int(virtual_users * 0.8))
        notes.append("High error rate — do not scale beyond this level without infra changes.")

    notes.extend(
        [
            "User traffic is routed through Vercel API routes only.",
            "Supabase table/RPC latency is now the main backend bottleneck.",
            "Heavy endpoints (/api/scan/technical, /api/predict) need dedicated tests.",
        ]
    )
    return comfortable, maximum, notes


def run_load_test(
    target: str,
    scenario: str,
    backend_only: bool = False,
    timeout: float = 30.0,
) -> LoadReport:
    if target not in TARGETS:
        raise ValueError(f"Unknown target: {target}")
    if scenario not in SCENARIOS:
        raise ValueError(f"Unknown scenario: {scenario}")

    cfg = SCENARIOS[scenario]
    bases = TARGETS[target]
    vu = cfg["virtual_users"]
    duration = cfg["duration_sec"]
    think = cfg["think_sec"]

    print(f"\n=== EGX Bots Load Test ===")
    print(f"Target: {target} | Scenario: {scenario}")
    print(f"Backend: {bases['backend']}")
    if not backend_only:
        print(f"Frontend: {bases['frontend']}")
    print(f"Virtual users: {vu} | Duration: {duration}s | Timeout: {timeout}s\n")

    stop_at = time.perf_counter() + duration
    all_results: List[RequestResult] = []
    started = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(max_workers=vu) as pool:
        futures = [
            pool.submit(_virtual_user, i, bases, stop_at, think, timeout, backend_only)
            for i in range(vu)
        ]
        for fut in concurrent.futures.as_completed(futures):
            all_results.extend(fut.result())

    elapsed = max(time.perf_counter() - started, 0.001)
    ok_results = [r for r in all_results if r.ok]
    latencies = [r.latency_ms for r in ok_results]
    success_rate = len(ok_results) / max(len(all_results), 1)

    errors_by_label: Dict[str, int] = {}
    for r in all_results:
        if not r.ok:
            errors_by_label[r.label] = errors_by_label.get(r.label, 0) + 1

    p50 = _percentile(latencies, 50)
    p95 = _percentile(latencies, 95)
    p99 = _percentile(latencies, 99)
    comfortable, maximum, notes = _estimate_capacity(vu, success_rate, p95)

    return LoadReport(
        scenario=scenario,
        target=target,
        virtual_users=vu,
        duration_sec=duration,
        total_requests=len(all_results),
        success_rate=round(success_rate * 100, 2),
        rps=round(len(all_results) / elapsed, 2),
        latency_p50_ms=round(p50, 1),
        latency_p95_ms=round(p95, 1),
        latency_p99_ms=round(p99, 1),
        errors_by_label=errors_by_label,
        estimated_comfortable_users=comfortable,
        estimated_max_users=maximum,
        notes=notes,
    )


def _print_report(report: LoadReport) -> None:
    print("--- Results ---")
    print(f"Total requests : {report.total_requests}")
    print(f"Success rate   : {report.success_rate}%")
    print(f"Throughput     : {report.rps} req/s")
    print(f"Latency p50    : {report.latency_p50_ms} ms")
    print(f"Latency p95    : {report.latency_p95_ms} ms")
    print(f"Latency p99    : {report.latency_p99_ms} ms")
    if report.errors_by_label:
        print(f"Errors by route : {json.dumps(report.errors_by_label, indent=2)}")
    print("\n--- Capacity estimate (approximate) ---")
    print(f"Comfortable concurrent users : ~{report.estimated_comfortable_users}")
    print(f"Approx. upper bound          : ~{report.estimated_max_users}")
    print("\nNotes:")
    for n in report.notes:
        print(f"  - {n}")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="EGX Bots load test")
    parser.add_argument("--target", choices=list(TARGETS.keys()), default="production")
    parser.add_argument("--scenario", choices=list(SCENARIOS.keys()), default="smoke")
    parser.add_argument("--backend-only", action="store_true", help="Skip frontend routes")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--json-out", default="", help="Write JSON report to file")
    args = parser.parse_args()

    try:
        report = run_load_test(
            target=args.target,
            scenario=args.scenario,
            backend_only=args.backend_only,
            timeout=args.timeout,
        )
    except requests.exceptions.RequestException as exc:
        print(f"Load test failed to start: {exc}", file=sys.stderr)
        return 1

    _print_report(report)

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(report.__dict__, f, indent=2)
        print(f"Report saved to {args.json_out}")

    return 0 if report.success_rate >= 90 else 1


if __name__ == "__main__":
    raise SystemExit(main())
