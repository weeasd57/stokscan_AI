from types import SimpleNamespace

import pandas as pd
from fastapi import HTTPException

from api import hf_history_cache
from api.routers import bot as bot_router


def test_egx_candles_without_bot_use_hf_history_and_live_correction(monkeypatch):
    snapshot = pd.DataFrame([
        {"symbol": "COMI", "exchange": "EGX", "date": day,
         "open": close, "high": close, "low": close, "close": close, "volume": 100}
        for day, close in (("2026-01-01", 10), ("2026-01-02", 11))
    ])

    class Query:
        def __init__(self, table):
            self.name = table

        def select(self, *args, **kwargs): return self
        def eq(self, *args, **kwargs): return self
        def gte(self, *args, **kwargs): return self
        def order(self, *args, **kwargs): return self
        def limit(self, *args, **kwargs): return self

        def execute(self):
            if self.name == "stock_prices":
                return SimpleNamespace(data=[
                    {"date": "2026-01-02", "open": 12, "high": 12,
                     "low": 12, "close": 12, "volume": 200},
                ])
            return SimpleNamespace(data=[])

    class Supabase:
        def table(self, name): return Query(name)

    fake_sb = Supabase()
    monkeypatch.setattr(bot_router, "_init_supabase", lambda: None)
    monkeypatch.setattr(bot_router.stock_ai, "supabase", fake_sb)
    monkeypatch.setattr(bot_router, "_supabase_read_with_retry", lambda callback, **kwargs: callback(fake_sb))
    monkeypatch.setattr(bot_router, "get_bot_or_404", lambda bot_id: (_ for _ in ()).throw(HTTPException(404)))
    monkeypatch.setattr(
        hf_history_cache, "load_symbol_history_snapshot",
        lambda exchange, symbol: snapshot[snapshot["symbol"] == symbol].copy(),
    )
    bot_router.candle_cache.clear()

    result = bot_router.get_candles("COMI", exchange="EGX", limit=5)

    assert result["count"] == 2
    assert [c["close"] for c in result["candles"]] == [10.0, 12.0]
    assert [c["time"] for c in result["candles"]] == sorted(c["time"] for c in result["candles"])

    bot_router.candle_cache.clear()
    monkeypatch.setattr(bot_router.stock_ai, "supabase", None)
    hf_only = bot_router.get_candles("COMI", exchange="EGX", limit=5)
    assert [c["close"] for c in hf_only["candles"]] == [10.0, 11.0]
