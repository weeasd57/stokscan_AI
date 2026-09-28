import unittest

from api.market_strategy import market_context, sector_snapshot


def index_rows(start, changes):
    value = float(start)
    rows = []
    for day, change in enumerate(changes, 1):
        value *= 1 + change / 100
        rows.append({"date": f"2026-09-{day:02d}", "close": value})
    return rows


class MarketStrategyTests(unittest.TestCase):
    def test_multi_session_selloff_blocks_new_buys(self):
        egx30 = index_rows(100, [0] * 15 + [-0.7] * 5)
        egx100 = index_rows(100, [0] * 15 + [-1.0] * 5)
        result = market_context(egx30, egx100, {"advancing_pct": 20})
        self.assertTrue(result["reject_buys"])
        self.assertTrue(result["market_stress"])
        self.assertIn("broad_five_day_selloff", result["reasons"])

    def test_missing_second_index_pauses_buys_without_forcing_exits(self):
        result = market_context(index_rows(100, [0.1] * 20), [], {})
        self.assertTrue(result["reject_buys"])
        self.assertFalse(result["market_stress"])
        self.assertIn("incomplete_or_misaligned_index_data", result["reasons"])

    def test_sector_exit_marks_only_weak_stocks(self):
        rows = [
            {"captured_at": "2026-09-27T14:00:00Z", "symbol": "A", "sector": "Banks", "cap": 100, "change_pct": 0},
            {"captured_at": "2026-09-27T14:00:00Z", "symbol": "B", "sector": "Banks", "cap": 100, "change_pct": 0},
            {"captured_at": "2026-09-28T14:00:00Z", "symbol": "A", "sector": "Banks", "cap": 60, "change_pct": -3},
            {"captured_at": "2026-09-28T14:00:00Z", "symbol": "B", "sector": "Banks", "cap": 60, "change_pct": -0.5},
        ]
        result = sector_snapshot(rows, market_stress=True)
        self.assertTrue(result["sectors"]["banks"]["defensive_exit"])
        self.assertEqual(result["weak_symbols"], ["A"])


if __name__ == "__main__":
    unittest.main()
