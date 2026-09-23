import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from api.historical_similarity import run_historical_similarity


class HistoricalSimilarityHorizonTests(unittest.TestCase):
    def test_historical_target_never_reads_later_bars_or_matches(self):
        dates = pd.date_range("2026-01-01", periods=130, freq="D")
        close = 100 + np.arange(130) * 0.03 + np.sin(np.arange(130) / 5)
        prices = pd.DataFrame(
            {"close": close, "high": close + 0.5, "low": close - 0.5, "volume": np.full(130, 1000)},
            index=dates,
        )

        def indicators(frame):
            result = frame.copy()
            result["Close"] = result["close"]
            result["Volume"] = result["volume"]
            result["RSI"] = 50.0
            result["SMA_50"] = result["close"]
            result["SMA_200"] = result["close"]
            return result

        def features(frame, _selected):
            values = np.arange(len(frame), dtype=float)
            return pd.DataFrame({"shape": np.sin(values / 7), "trend": values / 100}, index=frame.index), ["shape", "trend"]

        as_of = dates[95]
        with patch("api.historical_similarity.load_symbol_prices_direct", return_value=prices), patch(
            "api.historical_similarity.add_technical_indicators", side_effect=indicators
        ), patch("api.historical_similarity.compute_similarity_features", side_effect=features):
            result = run_historical_similarity("TEST.EGX", target_date=as_of.strftime("%Y-%m-%d"), k=4, forward_days=20)

        self.assertEqual(result["target_date"], as_of.strftime("%Y-%m-%d"))
        self.assertTrue(result["matches"])
        self.assertEqual(set(result["stats"]["horizon_stats"]), {"5", "10", "20"})
        for match in result["matches"]:
            self.assertLess(match["date"], result["target_date"])
            self.assertTrue(all(point["date"] <= result["target_date"] for point in match["forward_path"]))
        self.assertEqual(result["stats"]["wins"] + result["stats"]["losses"], result["stats"]["total_matches"])
        for horizon in (5, 10, 20):
            expected = sum(len(match["forward_path"]) >= horizon for match in result["matches"])
            self.assertEqual(result["stats"]["horizon_stats"][str(horizon)]["sample_size"], expected)


if __name__ == "__main__":
    unittest.main()
