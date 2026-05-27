from fastapi.testclient import TestClient
from api.main import app
import time

client = TestClient(app)
payload = {
    'exchange': 'EGX',
    'model': 'NEW_MODEL.pkl',
    'start_date': '2025-01-01',
    'end_date': '2025-11-01',
    'council_model': None,
    'council_threshold': None,
    'meta_threshold': None,
    'target_pct': 2.0,
    'stop_loss_pct': 1.0,
    'capital': 10000,
    'timeframe': '1d',
    'crypto_quote_filters': None
}
print("=== Posting backtest request ===")
res = client.post('/backtest', json=payload)
print(f'POST status: {res.status_code}')
print("Waiting for background task to complete...")
time.sleep(5)

print("\n=== Getting results ===")
res2 = client.get('/backtests')
bt_list = res2.json()
print(f'GET /backtests: count={len(bt_list)}')
if bt_list:
    print('\n=== Last backtest summary ===')
    last = bt_list[-1]
    print(f"Status: {last.get('status')}")
    print(f"Model: {last.get('model_name')}")
    print(f"Exchange: {last.get('exchange')}")
    print(f"Total Trades: {last.get('total_trades')}")
    print(f"Win Rate: {last.get('win_rate')}%")
    print(f"Net Profit: {last.get('net_profit')}")
    print(f"Avg Return: {last.get('avg_return_per_trade')}%")
