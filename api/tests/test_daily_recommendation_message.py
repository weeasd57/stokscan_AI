from api.daily_bot_run import _build_daily_recommendations_message


def test_daily_message_uses_canonical_entry_target_and_stop():
    message = _build_daily_recommendations_message(
        [
            {
                "id": "crst-new",
                "symbol": "CRST",
                "name": "Creast Mark",
                "entry_price": 3.76,
                "last_close": 3.92,
                "target_price": 5.08,
                "stop_loss": 3.31,
                "precision": 0.7,
                "top_reasons": {"target_2": 5.59},
            }
        ],
        "2026-09-17",
        "https://egxbots.com",
    )

    assert "الدخول: `3.76`" in message
    assert "هدف 1: `5.08`" in message
    assert "الوقف: `3.31`" in message
    assert "هدف 2: `5.59`" in message
    assert "3.92" not in message
    assert "5.27" not in message
    assert "إجمالي التوصيات الجديدة:* `1`" in message


def test_daily_message_counts_only_rows_given_to_the_new_batch():
    rows = [
        {
            "id": str(index),
            "symbol": symbol,
            "name": symbol,
            "entry_price": 10.0,
            "target_price": 11.0,
            "stop_loss": 9.0,
            "precision": 0.6,
        }
        for index, symbol in enumerate(["GTHE", "CERA", "PRMH", "EITP", "EPPK"])
    ]

    message = _build_daily_recommendations_message(
        rows,
        "2026-09-17",
        "https://egxbots.com",
    )

    assert "إجمالي التوصيات الجديدة:* `5`" in message
    assert "CRST" not in message
    assert "APPC" not in message
    assert "LUTS" not in message
    assert "TRTO" not in message
