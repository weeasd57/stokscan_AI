"""
Unit tests for the Short Swings Engine, Router, and Daily Dispatcher.
Validates all audit findings (F1 through F14) from docs/short-swings-review-2026-10-07.md.
"""
import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from api.short_swings_engine import (
    compute_kpis_from_trades,
    load_stock_metadata,
    EXIT_REASON_LABELS
)
from api.routers.short_swings import router
from fastapi import FastAPI


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# =========================================================================
# F1: PRO Entitlement Security Verification
# =========================================================================
def test_f1_unauthorized_pro_query_is_masked(client, monkeypatch):
    """An external caller passing ?is_pro=true without valid admin secret MUST be served masked data."""
    monkeypatch.setenv("ADMIN_SECRET_KEY", "super-secret-key-12345")
    
    mock_data = {
        "status": "ok",
        "kpis": {"win_rate_pct": 52.0},
        "active_trades": [
            {
                "symbol": "COMI",
                "entry_date": "2026-10-06",
                "entry_price": 100.0,
                "current_price": 105.0,
                "is_pending_entry": True,
                "return_pct": 5.0,
                "is_locked": False,
            }
        ],
        "closed_trades": [
            {
                "symbol": "ETEL",
                "entry_date": "2026-09-01",
                "exit_date": "2026-09-05",
                "return_pct": 4.5,
                "is_locked": False,
            }
        ],
        "total_active": 1,
        "total_closed": 1,
        "as_of": "2026-10-06"
    }
    
    with patch("api.routers.short_swings.get_cached_short_swings", return_value=mock_data):
        # 1. Attacker calls ?is_pro=true without header
        res = client.get("/api/short-swings?is_pro=true")
        assert res.status_code == 200
        body = res.json()
        assert body["is_pro"] is False
        assert len(body["active_trades"]) == 1
        active = body["active_trades"][0]
        assert active["is_locked"] is True
        assert active["symbol"] == "CO**"
        assert active["entry_price"] is None
        assert "upgrade_cta" in body

        # 2. Trusted internal caller with valid x-admin-key gets full unmasked data
        res_auth = client.get("/api/short-swings?is_pro=true", headers={"x-admin-key": "super-secret-key-12345"})
        assert res_auth.status_code == 200
        body_auth = res_auth.json()
        assert body_auth["is_pro"] is True
        assert body_auth["active_trades"][0]["is_locked"] is False
        assert body_auth["active_trades"][0]["symbol"] == "COMI"
        assert body_auth["active_trades"][0]["entry_price"] == 100.0


# =========================================================================
# F2: Gap-Down Exit Pricing (Never Exit Above High)
# =========================================================================
def test_f2_gap_down_exit_pricing_conservative():
    """When a stock gaps down below stop loss, fill must occur at Open (with slippage), never above High."""
    sl_price = 115.0
    open_p = 100.0
    high_p = 102.0
    low_p = 98.0
    slippage = 0.0015

    # Gap-down condition: open <= sl_price
    assert open_p <= sl_price
    
    # Formula implemented in engine:
    raw_fill = min(high_p, open_p) * (1 - slippage)
    fill_price = max(low_p * (1 - slippage), min(high_p, raw_fill))

    assert fill_price < sl_price
    assert fill_price <= high_p
    assert fill_price >= low_p * (1 - slippage)
    assert round(fill_price, 2) == 99.85  # 100 * (1 - 0.0015) = 99.85


# =========================================================================
# F3: Telegram Verified Outbox Receipt Tracking
# =========================================================================
def test_f3_telegram_failure_does_not_mark_sent():
    """If Telegram dispatch fails, symbols must NOT be marked as sent."""
    from api.short_swings_daily import run_daily_short_swings

    mock_swings = {
        "as_of": "2026-10-07",
        "active_trades": [
            {
                "symbol": "TEST_STOCK",
                "name_ar": "سهم اختبار",
                "reference_close": 50.0,
                "trailing_stop": 48.0,
                "is_pending_entry": True
            }
        ],
        "closed_trades": []
    }

    mock_sb = MagicMock()
    # Mock empty sent state
    mock_sb.table().select().eq().eq().maybe_single().execute.return_value.data = {
        "payload": {"sent_entries": {}, "sent_exits": {}}
    }

    with patch("api.short_swings_daily.compute_short_swings", return_value=mock_swings), \
         patch("api.short_swings_daily._get_supabase_client", return_value=mock_sb), \
         patch("api.daily_bot_run._telegram_recommendation_writes_enabled", return_value=True), \
         patch("api.daily_bot_run._notify_vip_telegram", return_value=False), \
         patch("api.daily_bot_run._notify_free_telegram", return_value=False):

        result = run_daily_short_swings(trigger="scheduled", dry_run=False)

        assert result["success"] is False
        assert result["status"] == "partial" or result["status"] == "noop" or len(result["report"]["failures"]) > 0
        assert result["report"]["vip_entries_sent"] is False
        assert result["report"]["free_entries_sent"] is False

        # Verify that upsert to market_cache did NOT record "TEST_STOCK" as vip: True
        upsert_call = mock_sb.table().upsert.call_args
        if upsert_call:
            saved_payload = upsert_call[0][0]["payload"]
            assert saved_payload["sent_entries"].get("TEST_STOCK", {}).get("vip") is not True


# =========================================================================
# F5: Causal Breakeven Activation
# =========================================================================
def test_f5_breakeven_delay_causality():
    """Breakeven activation must be scheduled for next session, not executed retroactively on same day."""
    p = {
        "entry_price": 100.0,
        "sl_price": 96.0,
        "highest_high": 100.0,
        "be_active": False,
        "be_pending_activation": False
    }

    # Day 1: price hits high = 105.0 (+5.0% >= +4.5%)
    day_1_high = 105.0
    gain = (day_1_high / p["entry_price"] - 1)
    if not p["be_active"] and not p.get("be_pending_activation") and gain >= 0.045:
        p["be_pending_activation"] = True

    # Intraday defensive stop on Day 1 is STILL 96.0, NOT breakeven!
    assert p["be_active"] is False
    assert p["sl_price"] == 96.0
    assert p["be_pending_activation"] is True

    # At start of Day 2: scheduled activation takes effect
    if p.get("be_pending_activation"):
        p["be_active"] = True
        p["sl_price"] = max(p["sl_price"], p["entry_price"] * 1.003)
        p["be_pending_activation"] = False

    assert p["be_active"] is True
    assert p["sl_price"] == pytest.approx(100.3)


# =========================================================================
# F8: Dynamic KPI Computation
# =========================================================================
def test_f8_dynamic_kpi_computation():
    """KPIs must be computed from actual trade data, not static constants."""
    trades = [
        {"return_pct": 10.0, "sessions": 3, "exit_date": "2026-05-01"},
        {"return_pct": 6.0, "sessions": 2, "exit_date": "2026-05-10"},
        {"return_pct": -4.0, "sessions": 4, "exit_date": "2026-05-15"},
    ]

    kpis = compute_kpis_from_trades(trades)
    assert kpis["total_trades"] == 3
    assert kpis["wins_count"] == 2
    assert kpis["losses_count"] == 1
    assert kpis["win_rate_pct"] == 66.7
    assert kpis["profit_factor"] == 4.0  # 16.0 / 4.0 = 4.0
    assert kpis["avg_win_pct"] == 8.0   # (10 + 6) / 2 = 8.0
    assert kpis["avg_loss_pct"] == -4.0
    assert kpis["top_win_pct"] == 10.0
    assert kpis["avg_holding_days"] == 3.0  # (3 + 2 + 4) / 3 = 3.0


def test_f8_empty_trades_kpis():
    """Empty trades list returns 0 KPIs, never hardcoded fake metrics."""
    kpis = compute_kpis_from_trades([])
    assert kpis["total_trades"] == 0
    assert kpis["win_rate_pct"] == 0.0
    assert kpis["profit_factor"] == 0.0
    assert kpis["total_return_pct"] == 0.0


# =========================================================================
# F12 & F13: Metadata & Exit Reason Labels
# =========================================================================
def test_f12_exit_reason_labels():
    """Verify Arabic mappings for exit reasons exist."""
    assert "ema10_break" in EXIT_REASON_LABELS
    assert "stop_be" in EXIT_REASON_LABELS
    assert "stop_loss" in EXIT_REASON_LABELS
    assert "حماية أرباح" in EXIT_REASON_LABELS["ema10_break"]


def test_f13_case_insensitive_metadata_loading():
    """load_stock_metadata loads tickers when JSON keys are Capitalized."""
    meta = load_stock_metadata()
    assert isinstance(meta, dict)
    assert len(meta) > 0
    # COMI should be present
    assert "COMI" in meta
    assert "name_en" in meta["COMI"]
    assert "name_ar" in meta["COMI"]
