"""Read-only EGX intraday availability probe for the 15-minute migration gate.

Run from the repository root during an EGX session:
    python -m scripts.probe_eodhd_egx_intraday --require-session

The probe never writes to Supabase or HF. Its JSON report contains no API token.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, time, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


CAIRO = ZoneInfo("Africa/Cairo")
SESSION_START = time(10, 0)
SESSION_END = time(14, 15)
ROOT = Path(__file__).resolve().parents[1]


def session_is_open(now_cairo: datetime) -> bool:
    """Time window only; the exchange holiday calendar is checked separately."""
    return now_cairo.weekday() in (6, 0, 1, 2, 3) and SESSION_START <= now_cairo.time() < SESSION_END


def normalize_bars(payload: object, session_date: str) -> list[dict]:
    if not isinstance(payload, list):
        return []
    bars = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        try:
            stamp = datetime.fromtimestamp(int(row["timestamp"]), timezone.utc)
            local = stamp.astimezone(CAIRO)
            if local.date().isoformat() != session_date:
                continue
            bar = {
                "ts_utc": stamp.isoformat(),
                "ts_cairo": local.isoformat(),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
            }
            if bar["low"] <= min(bar["open"], bar["close"]) and bar["high"] >= max(bar["open"], bar["close"]) and bar["volume"] >= 0:
                bars.append(bar)
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    return sorted(bars, key=lambda bar: bar["ts_utc"])


def fetch_intraday(ticker: str, token: str, start_ts: int, end_ts: int) -> tuple[int | None, object, str | None]:
    query = urlencode({"api_token": token, "interval": "5m", "fmt": "json", "from": start_ts, "to": end_ts})
    request = Request(f"https://eodhd.com/api/intraday/{ticker}?{query}", headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=25) as response:
            return response.status, json.load(response), None
    except HTTPError as error:
        # Do not include the URL or response body: either may contain the token.
        body = error.read(512).decode("utf-8", errors="replace").lower()
        reason = "eod_only_plan" if "only eod data allowed" in body else "http_error"
        return error.code, None, reason
    except (URLError, TimeoutError, ValueError):
        return None, None, "network_or_payload_error"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", action="append", default=[], help="Bare EGX symbol; repeat for more symbols")
    parser.add_argument("--compare-legacy-suffix", action="store_true", help="Also try .EG (known to fail for COMI EOD)")
    parser.add_argument("--require-session", action="store_true", help="Exit 2 if the exchange time window is closed")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "probe_runs")
    args = parser.parse_args()

    try:
        from dotenv import load_dotenv

        load_dotenv(ROOT / ".env")
    except ImportError:
        pass
    token = os.getenv("EODHD_API_KEY") or os.getenv("EODHD_API_TOKEN")
    if not token:
        print("EODHD_API_KEY is missing", file=sys.stderr)
        return 3

    now_utc = datetime.now(timezone.utc)
    now_cairo = now_utc.astimezone(CAIRO)
    open_window = session_is_open(now_cairo)
    if args.require_session and not open_window:
        print("EGX session time window is closed; no live-session claim can be made.", file=sys.stderr)
        return 2

    start = datetime.combine(now_cairo.date(), time.min, CAIRO)
    start_ts = int(start.timestamp())
    end_ts = int(now_utc.timestamp())
    results = []
    for symbol in args.symbol or ["COMI"]:
        bare = symbol.strip().upper().split(".", 1)[0]
        if not bare.isascii() or not bare.isalnum() or len(bare) > 16:
            parser.error(f"Invalid symbol: {symbol!r}")
        for suffix in (("EGX", "EG") if args.compare_legacy_suffix else ("EGX",)):
            ticker = f"{bare}.{suffix}"
            status, payload, error_kind = fetch_intraday(ticker, token, start_ts, end_ts)
            bars = normalize_bars(payload, now_cairo.date().isoformat())
            latest = bars[-1] if bars else None
            results.append({
                "ticker": ticker,
                "http_status": status,
                "error_kind": error_kind,
                "response_is_bars": isinstance(payload, list),
                "today_5m_count": len(bars),
                "latest_5m": latest,
                "latest_age_minutes": round((now_utc - datetime.fromisoformat(latest["ts_utc"])).total_seconds() / 60, 1)
                if latest else None,
            })

    if results and all(r["error_kind"] == "eod_only_plan" for r in results):
        verdict = "blocked_by_intraday_entitlement"
    elif open_window:
        verdict = "today_bars_seen_during_session" if any(r["today_5m_count"] for r in results) else "no_today_bars_seen_during_session"
    else:
        verdict = "outside_session_inconclusive_for_live_availability"
    report = {
        "schema_version": 1,
        "checked_at_utc": now_utc.isoformat(),
        "checked_at_cairo": now_cairo.isoformat(),
        "session_time_window_open": open_window,
        "holiday_calendar_checked": False,
        "interval": "5m",
        "read_only": True,
        "verdict": verdict,
        "results": results,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    path = args.output_dir / f"egx-5m-{now_utc:%Y%m%dT%H%M%SZ}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(path), **report}, ensure_ascii=False, indent=2))
    return 0 if any(r["response_is_bars"] for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
