import os
from unittest.mock import patch

import yfinance

from api import free_data_provider


def test_usd_egp_does_not_fall_through_to_noisy_yfinance_call():
    with patch.dict(os.environ, {}, clear=False), \
         patch.object(yfinance, "Ticker") as ticker:
        os.environ.pop("CF_PROXY_URL", None)
        result = free_data_provider.fetch_eod_data_free("USDEGP.FOREX", period="1y")

    assert result == []
    ticker.assert_not_called()


def test_market_status_requests_usd_egp_only_once():
    with patch("api.stock_ai._init_supabase"), \
         patch("api.stock_ai.supabase", None), \
         patch.object(free_data_provider, "fetch_eod_data_free", return_value=[]) as fetch:
        free_data_provider.get_market_status_free(period="1y")

    requested_symbols = [call.args[0] for call in fetch.call_args_list]
    assert requested_symbols.count("USDEGP.FOREX") == 1
    assert "EGP=X" not in requested_symbols
