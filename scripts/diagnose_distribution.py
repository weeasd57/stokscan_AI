import sys
sys.path.insert(0, "scripts")
from swing_deep_winrate_search import load_data, build_features, define_candidate_signals, fast_simulate
from collections import defaultdict

df = load_data()
df = build_features(df)
df = define_candidate_signals(df)

dates = sorted(df['date'].unique())
next_date_map = dict(zip(dates, dates[1:]))

market = {}
for row in df[['symbol', 'date', 'open', 'high', 'low', 'close', 'volume', 'turnover', 'atr_pct']].itertuples(index=False):
    market[(row.symbol, row.date)] = row

for sig in ["sig_ema10_wick", "sig_ema20_bounce", "sig_confluence", "sig_either_pb", "sig_reversal_bar", "sig_rsi_turn"]:
    sig_map = defaultdict(list)
    for row in df[df[sig]][['symbol', 'date', 'close', 'turnover', 'atr_pct']].itertuples(index=False):
        nxt = next_date_map.get(row.date)
        if nxt:
            sig_map[nxt].append({'symbol': row.symbol, 'signal_date': row.date, 'date': nxt, 'close': row.close, 'turnover': row.turnover, 'atr_pct': row.atr_pct})

    print(f"\n--- Testing {sig} ---")
    for tp in [0.03, 0.04, 0.05]:
        for sl in [0.03, 0.04]:
            for mode, m_sessions in [('T+1', 1), ('T+2', 2)]:
                res = fast_simulate(dates, market, sig_map, tp_pct=tp, sl_pct=sl, max_hold=4, be_trigger=None, min_hold_sessions=m_sessions, max_positions=20)
                if res:
                    print(f"{mode} | TP {tp*100:.1f}% | SL {sl*100:.1f}% | WR: {res['win_rate']}% | PF: {res['profit_factor']} | Tr/Mo: {res['monthly_trades']} | Ret: {res['total_return']}% | DD: {res['max_dd']}%")
