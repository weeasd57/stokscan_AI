from types import SimpleNamespace

import pandas as pd

from api import hf_history_cache, stock_ai


def test_single_symbol_loader_uses_hf_history_and_live_tail(monkeypatch):
    snapshot = pd.DataFrame([
        {"symbol": "COMI", "exchange": "EGX", "date": "2026-01-01",
         "open": 10, "high": 10, "low": 10, "close": 10, "volume": 100},
        {"symbol": "COMI", "exchange": "EGX", "date": "2026-01-02",
         "open": 11, "high": 11, "low": 11, "close": 11, "volume": 100},
    ])

    class Query:
        def select(self, *args, **kwargs): return self
        def eq(self, *args, **kwargs): return self
        def gte(self, *args, **kwargs): return self
        def order(self, *args, **kwargs): return self
        def range(self, *args, **kwargs): return self
        def execute(self):
            return SimpleNamespace(data=[
                {"date": "2026-01-02", "open": 12, "high": 12,
                 "low": 12, "close": 12, "volume": 200},
            ])

    class Supabase:
        def table(self, name): return Query()

    monkeypatch.setattr(stock_ai, "_get_exchange_bulk_data", lambda *args, **kwargs: {})
    monkeypatch.setattr(stock_ai, "_init_supabase", lambda: None)
    monkeypatch.setattr(stock_ai, "supabase", Supabase())
    monkeypatch.setattr(
        hf_history_cache, "load_symbol_history_snapshot",
        lambda exchange, symbol: snapshot[snapshot["symbol"] == symbol].copy(),
    )

    result = stock_ai.get_stock_data_eodhd(None, "COMI.EGX", "2026-01-01", exchange="EGX")

    assert list(result["close"]) == [10, 12]
    assert list(result.index.strftime("%Y-%m-%d")) == ["2026-01-01", "2026-01-02"]
