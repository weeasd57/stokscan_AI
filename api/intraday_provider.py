"""
Unified intraday data provider — TradingView or EODHD.
"""

import os
import time
import datetime as dt
from typing import Any, Optional, Tuple

import pandas as pd

VALID_PROVIDERS = ("tradingview", "eodhd")


def normalize_provider(provider: Optional[str]) -> str:
    p = (provider or "tradingview").strip().lower()
    return p if p in VALID_PROVIDERS else "tradingview"


def _to_eodhd_ticker(symbol: str) -> str:
    """Convert bare EGX symbol or SYM.CA / SYM.EGX to EODHD format SYM.EG."""
    from api.stock_ai import _normalize_eodhd_ticker

    sym = symbol.strip().upper()
    if "." in sym:
        base, suffix = sym.split(".", 1)
        if suffix in ("CA", "EGX", "EG"):
            return _normalize_eodhd_ticker(f"{base}.EG")
        return _normalize_eodhd_ticker(sym)
    return _normalize_eodhd_ticker(f"{sym}.EG")


def _to_tv_ticker(symbol: str) -> str:
    sym = symbol.strip().upper()
    if "." in sym:
        return sym
    return f"{sym}.CA"


def _resample_ohlcv(df: pd.DataFrame, target_tf: str) -> pd.DataFrame:
    if df.empty or target_tf != "15m":
        return df

    df = df.copy()
    df["ts"] = pd.to_datetime(df["ts"])
    df = df.set_index("ts").sort_index()
    agg = {
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }
    out = df.resample("15min").agg(agg).dropna(subset=["open", "close"])
    return out.reset_index()


def fetch_eodhd_intraday_prices(
    symbol: str,
    timeframe: str = "15m",
    start_date: Optional[dt.date] = None,
    end_date: Optional[dt.date] = None,
) -> Tuple[bool, str]:
    try:
        from eodhd import APIClient
    except ImportError:
        return False, "eodhd library not installed"

    from api.stock_ai import sync_df_to_supabase

    api_key = os.getenv("EODHD_API_KEY") or os.getenv("EODHD_API_TOKEN")
    if not api_key:
        return False, "EODHD API key not configured (EODHD_API_KEY)"

    eodhd_symbol = _to_eodhd_ticker(symbol)
    tv_ticker = _to_tv_ticker(symbol)

    tf = timeframe.lower()
    interval_map = {"1m": "1m", "5m": "5m", "15m": "5m", "1h": "1h"}
    eodhd_interval = interval_map.get(tf, "5m")

    today = dt.date.today()
    end_d = end_date or today
    start_d = start_date or (end_d - dt.timedelta(days=180))

    start_dt = dt.datetime.combine(start_d, dt.time.min)
    end_dt = dt.datetime.combine(end_d, dt.time(23, 59, 59))
    from_ts = int(start_dt.timestamp())
    to_ts = int(end_dt.timestamp())

    try:
        delay = float(os.getenv("EODHD_REQUEST_DELAY", "0.5"))
        if delay > 0:
            time.sleep(delay)
    except Exception:
        pass

    try:
        api = APIClient(api_key)
        raw = api.get_intraday_historical_data(
            symbol=eodhd_symbol,
            interval=eodhd_interval,
            from_timestamp=from_ts,
            to_timestamp=to_ts,
        )
    except Exception as e:
        return False, f"EODHD fetch error for {eodhd_symbol}: {e}"

    if raw is None:
        return False, f"No EODHD data for {eodhd_symbol} ({eodhd_interval})"

    if isinstance(raw, list):
        if not raw:
            return False, f"No EODHD data for {eodhd_symbol} ({eodhd_interval})"
        df = pd.DataFrame(raw)
    elif isinstance(raw, pd.DataFrame):
        df = raw.copy()
    else:
        return False, f"Unexpected EODHD response type for {eodhd_symbol}"

    col_map = {
        "datetime": "ts",
        "timestamp": "ts",
        "date": "ts",
        "open": "open",
        "high": "high",
        "low": "low",
        "close": "close",
        "volume": "volume",
    }
    df.columns = [str(c).lower() for c in df.columns]
    rename = {k: v for k, v in col_map.items() if k in df.columns}
    df = df.rename(columns=rename)

    if "ts" not in df.columns:
        return False, f"EODHD response missing timestamp for {eodhd_symbol}"

    df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
    df = df.dropna(subset=["ts"])
    if df.empty:
        return False, f"No valid EODHD bars for {eodhd_symbol}"

    if start_date:
        df = df[df["ts"].dt.date >= start_date]
    if end_date:
        df = df[df["ts"].dt.date <= end_date]

    if tf == "15m" and eodhd_interval == "5m":
        df = _resample_ohlcv(df, "15m")

    if df.empty:
        return True, f"No new EODHD data in range ({start_d} to {end_d})"

    ok, sync_msg = sync_df_to_supabase(tv_ticker, df, timeframe=timeframe)
    return ok, f"OK (eodhd) - {sync_msg}"


def fetch_intraday_prices(
    symbol: str,
    timeframe: str = "15m",
    start_date: Optional[dt.date] = None,
    end_date: Optional[dt.date] = None,
    provider: str = "tradingview",
    max_days: int = 365,
) -> Tuple[bool, str]:
    """Fetch intraday bars using the selected provider."""
    prov = normalize_provider(provider)

    if prov == "eodhd":
        return fetch_eodhd_intraday_prices(
            symbol,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date,
        )

    from api.tradingview_integration import fetch_tradingview_prices

    tv_symbol = _to_tv_ticker(symbol)
    return fetch_tradingview_prices(
        tv_symbol,
        max_days=max_days,
        timeframe=timeframe,
        start_date=start_date,
        end_date=end_date,
    )
