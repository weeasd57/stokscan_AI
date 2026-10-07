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
        def gte(self, *args): queries.append(args); return self
        def range(self, *_): return self
        def execute(self): return types.SimpleNamespace(data=[tail])
    client = types.SimpleNamespace(table=lambda _: Query())
    monkeypatch.setitem(sys.modules, 'api.stock_ai', types.SimpleNamespace(_init_supabase=lambda: None, supabase=client))
    monkeypatch.setattr('api.hf_history_cache.load_history_snapshot', lambda _: pd.DataFrame(rows))
    monkeypatch.setattr(engine, 'load_stock_metadata', lambda: {})
    monkeypatch.setattr(engine, '_load_published_signals', lambda _: [])
    monkeypatch.setattr(engine, 'CACHE_PATHS', [tmp_path / 'cache.json'])
    result = engine.compute_short_swings()
    assert result['as_of'] == '2026-10-07'
    assert ('exchange', 'EGX') in queries and ('date', '2026-10-06') in queries
    assert json.loads((tmp_path / 'cache.json').read_text()) == result
    json.dumps(result)


def test_ajwa_pending_signal_enters_next_session_without_reusing_old_price(monkeypatch, tmp_path):
    dates = pd.bdate_range(end='2026-10-05', periods=90)
    rows = [{'symbol': 'AJWA', 'exchange': 'EGX', 'date': day,
             'open': 100+i, 'close': 100+i, 'high': 100.5+i,
             'low': 99.5+i, 'volume': 100000} for i, day in enumerate(dates)]
    rows += [
        {'symbol':'AJWA','exchange':'EGX','date':'2026-10-06','open':190.23,
         'high':197.5,'low':187,'close':197.44,'volume':227633},
        {'symbol':'AJWA','exchange':'EGX','date':'2026-10-07','open':197.44,
         'high':201,'low':194.26,'close':196.16,'volume':228709},
    ]
    monkeypatch.setitem(sys.modules, 'api.stock_ai', types.SimpleNamespace(_init_supabase=lambda: None, supabase=None))
    monkeypatch.setattr('api.hf_history_cache.load_history_snapshot', lambda _: pd.DataFrame(rows))
    monkeypatch.setattr(engine, 'load_stock_metadata', lambda: {})
    monkeypatch.setattr(engine, '_load_published_signals', lambda _: [])
    monkeypatch.setattr(engine, 'CACHE_PATHS', [tmp_path/'cache.json'])
    result = engine.compute_short_swings(phase='close')
    trade = next(t for t in result['active_trades'] if t['symbol'] == 'AJWA')
    assert trade['signal_date'] == '2026-10-06'
    assert trade['entry_date'] == '2026-10-07'
    assert not trade['is_pending_entry']
    assert trade['current_price'] == 196.16
    assert trade['price_date'] == '2026-10-07'
    assert trade['entry_price'] == pytest.approx(197.736)


def test_hf_rebuild_restores_durable_snapshot_once_without_recomputing(monkeypatch, tmp_path):
    path = tmp_path/'cache.json'
    path.write_text(json.dumps({'as_of':'2026-09-24','kpis':{},'active_trades':[]}), encoding='utf-8')
    saved = {'status':'ok','as_of':'2026-10-07','computed_at':'2026-10-07T15:00:00Z',
             'kpis':{},'active_trades':[{'symbol':'AJWA'}],'closed_trades':[]}
    reads = []
    def restore():
        reads.append(True)
        return saved
    monkeypatch.setattr(engine, '_SNAPSHOT_BOOTSTRAPPED', False)
    monkeypatch.setattr(engine, 'CACHE_PATHS', [path])
    monkeypatch.setattr(engine, '_restore_saved_snapshot', restore)
    monkeypatch.setattr(engine, 'compute_short_swings', lambda: pytest.fail('Visitor must not recompute history'))
    assert engine.get_cached_short_swings() == saved
    assert engine.get_cached_short_swings() == saved
    assert len(reads) == 1


def test_published_ajwa_enters_even_when_recalculated_market_gate_rejects(monkeypatch, tmp_path):
    dates = pd.bdate_range(end='2026-10-07', periods=90)
    rows = []
    for symbol in ['AJWA','DOWN1','DOWN2']:
        for i, day in enumerate(dates):
            close = 100+i if symbol == 'AJWA' else 250-i
            rows.append({'symbol':symbol,'exchange':'EGX','date':day,'open':close,
                         'high':close+1,'low':close-1,'close':close,'volume':100000})
    for row in rows:
        if row['symbol']=='AJWA' and row['date']==pd.Timestamp('2026-10-06'):
            row.update(open=190.23,high=197.5,low=187,close=197.44,volume=227633)
        if row['symbol']=='AJWA' and row['date']==pd.Timestamp('2026-10-07'):
            row.update(open=197.44,high=201,low=194.26,close=196.16,volume=228709)
    class Query:
        def select(self,*_): return self
        def eq(self,*_): return self
        def gte(self,*_): return self
        def range(self,*_): return self
        def execute(self): return types.SimpleNamespace(data=[])
    client=types.SimpleNamespace(table=lambda _:Query())
    monkeypatch.setitem(sys.modules,'api.stock_ai',types.SimpleNamespace(_init_supabase=lambda:None,supabase=client))
    monkeypatch.setattr('api.hf_history_cache.load_history_snapshot',lambda _:pd.DataFrame(rows))
    monkeypatch.setattr(engine,'load_stock_metadata',lambda:{})
    monkeypatch.setattr(engine,'CACHE_PATHS',[tmp_path/'cache.json'])
    monkeypatch.setattr(engine,'_persist_saved_snapshot',lambda *_:True)
    published=[{'symbol':'AJWA','signal_date':'2026-10-06','reference_close':197.44}]
    monkeypatch.setattr(engine,'_load_published_signals',lambda _:published)
    result=engine.compute_short_swings(phase='close')
    trade=next(t for t in result['active_trades'] if t['symbol']=='AJWA')
    assert trade['published'] is True
    assert trade['entry_date']=='2026-10-07'
    assert trade['current_price']==196.16
    evidence=next(x for x in result['signal_audit'] if x['symbol']=='AJWA' and x['date']=='2026-10-06')
    assert evidence['signal'] is False
    assert evidence['breadth'] < .45


def test_published_reference_cannot_change_on_retry(monkeypatch):
    from api import short_swing_published as ledger
    state = {}
    monkeypatch.setattr(ledger, 'read_checkpoint', lambda _client, key: state.get(key))
    def save(_client, key, payload, old):
        state[key] = {'payload': payload}
        return state[key]
    monkeypatch.setattr(ledger, 'replace_checkpoint', save)
    initial = {'symbol':'AJWA','signal_date':'2026-10-06','reference_close':197.44}
    ledger.record_published_signal(object(), initial, {'source':'original_delivery'})
    result = ledger.record_published_signal(object(), {**initial,'reference_close':200}, {'source':'recalculation'})
    assert result['reference_close'] == 197.44
    assert result['publication_evidence']['source'] == 'original_delivery'
