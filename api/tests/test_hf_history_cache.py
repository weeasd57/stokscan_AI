import gzip
import json

import pandas as pd

from api import hf_history_cache as history


def test_live_rows_override_snapshot_and_keep_full_history():
    snapshot = pd.DataFrame([
        {"symbol": "COMI", "exchange": "EGX", "date": "2026-08-01", "close": 100},
        {"symbol": "COMI", "exchange": "EGX", "date": "2026-08-02", "close": 101},
    ])
    merged = history.merge_snapshot_with_live(snapshot, [
        {"symbol": "COMI", "exchange": "EGX", "date": "2026-08-02", "close": 102},
        {"symbol": "COMI", "exchange": "EGX", "date": "2026-08-03", "close": 103},
    ])

    assert list(merged["date"].dt.strftime("%Y-%m-%d")) == ["2026-08-01", "2026-08-02", "2026-08-03"]
    assert merged.iloc[1]["close"] == 102


def test_tail_window_and_serialisation_handle_missing_numbers():
    frame = pd.DataFrame([
        {"symbol": "COMI", "exchange": "EGX", "date": "2026-09-17", "close": 100, "volume": None},
    ])
    assert history.tail_start_date(frame, days=45) == "2026-08-03"

    payload = history._serialise_records(frame)
    records = json.loads(gzip.decompress(payload).decode("utf-8"))
    assert records[0]["date"] == "2026-09-17"
    assert records[0]["volume"] is None


def test_frame_from_symbol_map_preserves_price_columns():
    dates = pd.to_datetime(["2026-09-16", "2026-09-17"])
    frame = pd.DataFrame(
        {"Open": [10, 11], "High": [11, 12], "Low": [9, 10], "Close": [10.5, 11.5], "Volume": [100, 200]},
        index=dates,
    )
    archive = history.frame_from_symbol_map("EGX", {"COMI": frame})
    assert list(archive["symbol"]) == ["COMI", "COMI"]
    assert list(archive["close"]) == [10.5, 11.5]
