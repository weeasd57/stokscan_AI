"""Compatibility helpers for callers that still request one archived symbol.

The historical EGX series now lives in the private HF Dataset. The Supabase
client argument is retained to avoid breaking older callers.
"""

from typing import Optional

import pandas as pd

from api.hf_history_cache import load_symbol_history_snapshot


def fetch_archived_stock_prices(supabase, symbol: str) -> Optional[pd.DataFrame]:
    snapshot = load_symbol_history_snapshot("EGX", symbol)
    if snapshot.empty:
        return None
    return snapshot.drop(columns=["symbol", "exchange"]).reset_index(drop=True)


def merge_with_archive(supabase, symbol: str, db_df: pd.DataFrame) -> pd.DataFrame:
    archived = fetch_archived_stock_prices(supabase, symbol)
    if archived is None or archived.empty:
        return db_df
    if db_df is None or db_df.empty:
        return archived
    combined = pd.concat([archived, db_df], ignore_index=True)
    combined["date"] = pd.to_datetime(combined["date"], errors="coerce")
    return (combined.dropna(subset=["date"])
            .drop_duplicates(subset=["date"], keep="last")
            .sort_values("date").reset_index(drop=True))
