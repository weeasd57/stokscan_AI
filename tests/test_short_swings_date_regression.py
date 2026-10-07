"""Small offline archive/REST fixtures for the 7 October daily failure."""
import datetime
import json
import sys
import types
import pandas as pd
import pytest
from api import short_swings_engine as engine


@pytest.mark.parametrize('value,expected', [
    (pd.Timestamp('2026-10-07'), '2026-10-07'),
    ('2026-10-07', '2026-10-07'),
    ('2026-10-07T00:00:00+03:00', '2026-10-07'),
    (datetime.date(2026, 10, 7), '2026-10-07'),
    ('broken', None), (None, None), (True, None), (123, None),
])
def test_session_date_types(value, expected):
    assert engine._price_date(value) == expected


def test_archive_timestamps_and_rest_strings_produce_serialisable_session_result(monkeypatch, tmp_path):
    dates = pd.bdate_range(end='2026-10-06', periods=90)
    rows = []
    for i, day in enumerate(dates):
        close = 100 + i * .12 + (i % 5) * .2
        rows.append({'symbol': 'TEST', 'exchange': 'EGX', 'date': day if i % 2 else day.strftime('%Y-%m-%d'),
                     'open': close, 'high': close + 1, 'low': close - 1, 'close': close, 'volume': 100000})
    tail = {'symbol': 'TEST', 'exchange': 'EGX', 'date': '2026-10-07',
            'open': 112, 'high': 114, 'low': 111, 'close': 113, 'volume': 200000}
    queries = []
    class Query:
        def select(self, *_): return self
        def eq(self, *args): queries.append(args); return self
        def gt(self, *args): queries.append(args); return self
        def range(self, *_): return self
        def execute(self): return types.SimpleNamespace(data=[tail])
    client = types.SimpleNamespace(table=lambda _: Query())
    monkeypatch.setitem(sys.modules, 'api.stock_ai', types.SimpleNamespace(_init_supabase=lambda: None, supabase=client))
    monkeypatch.setattr('api.hf_history_cache.load_history_snapshot', lambda _: pd.DataFrame(rows))
    monkeypatch.setattr(engine, 'load_stock_metadata', lambda: {})
    monkeypatch.setattr(engine, 'CACHE_PATHS', [tmp_path / 'cache.json'])
    result = engine.compute_short_swings()
    assert result['as_of'] == '2026-10-07'
    assert ('exchange', 'EGX') in queries and ('date', '2026-10-06') in queries
    assert json.loads((tmp_path / 'cache.json').read_text()) == result
    json.dumps(result)
