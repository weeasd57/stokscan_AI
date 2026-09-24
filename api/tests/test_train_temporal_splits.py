import pandas as pd

from api.train_exchange_model import ModelTrainer


def test_walk_forward_splits_keep_entire_market_sessions_together():
    trainer = object.__new__(ModelTrainer)
    trainer.params = type("Params", (), {"look_forward_days": 1})()
    trainer._progress = lambda *_args, **_kwargs: None

    sessions = pd.date_range("2026-01-01", periods=12, freq="B")
    frame = pd.DataFrame(
        {
            "Date": [date for date in sessions for _ in ("COMI", "TMGH")],
            "symbol": [symbol for _ in sessions for symbol in ("COMI", "TMGH")],
        }
    )

    splits = trainer.get_walk_forward_splits(frame, n_splits=3)

    assert splits
    for train_indexes, test_indexes in splits:
        train_dates = set(frame.iloc[train_indexes]["Date"])
        test_dates = set(frame.iloc[test_indexes]["Date"])
        assert train_dates.isdisjoint(test_dates)
        # Both symbols from every validation session must be evaluated together.
        assert frame.iloc[test_indexes].groupby("Date").size().eq(2).all()
