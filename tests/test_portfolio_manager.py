#!/usr/bin/env python3
"""
Unit tests for the enhanced Portfolio Manager system.

Tests cover:
- Position sizing logic
- Risk management limits
- Commission calculations
- Portfolio balance tracking
- Concurrent trade management
"""

import unittest
import sys
import os
from datetime import datetime, timedelta
import pandas as pd
import numpy as np

# Add API path
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'api'))

from api.portfolio_manager import PortfolioManager, Position, Trade


class TestPortfolioManager(unittest.TestCase):
    """Test cases for Portfolio Manager"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.initial_capital = 100000.0
        self.portfolio = PortfolioManager(
            initial_capital=self.initial_capital,
            max_position_pct=0.10,
            max_total_exposure=0.50,
            max_concurrent_positions=5,
            reserve_cash_pct=0.20,
            commission_pct=0.001
        )
        self.test_date = datetime(2024, 1, 1)
    
    def test_initial_state(self):
        """Test portfolio initial state"""
        self.assertEqual(self.portfolio.portfolio_value, self.initial_capital)
        self.assertEqual(self.portfolio.cash, self.initial_capital)
        self.assertEqual(self.portfolio.available_cash, self.initial_capital * 0.8)  # 80% after reserve
        self.assertEqual(self.portfolio.current_exposure, 0.0)
        self.assertEqual(len(self.portfolio.positions), 0)
    
    def test_position_sizing_basic(self):
        """Test basic position sizing logic"""
        symbol = "AAPL"
        entry_price = 150.0
        
        can_open, position_size, reason = self.portfolio.can_open_position(
            symbol, entry_price, regime_multiplier=1.0
        )
        
        self.assertTrue(can_open)
        self.assertAlmostEqual(position_size, 10000.0, places=2)  # 10% of 100k
        self.assertEqual(reason, "OK")
    
    def test_position_sizing_with_regime_multiplier(self):
        """Test position sizing with regime multiplier"""
        symbol = "GOOGL"
        entry_price = 2500.0
        
        # Test with 1.5x multiplier
        can_open, position_size, reason = self.portfolio.can_open_position(
            symbol, entry_price, regime_multiplier=1.5
        )
        
        self.assertTrue(can_open)
        self.assertAlmostEqual(position_size, 15000.0, places=2)  # 10% * 1.5
    
    def test_position_sizing_limits(self):
        """Test position sizing limits"""
        symbol = "TSLA"
        entry_price = 200.0
        
        # Test extreme multipliers are capped
        can_open, position_size, reason = self.portfolio.can_open_position(
            symbol, entry_price, regime_multiplier=5.0  # Should be capped at 2.0
        )
        
        self.assertTrue(can_open)
        self.assertAlmostEqual(position_size, 20000.0, places=2)  # 10% * 2.0 (capped)
        
        # Test very small multiplier
        can_open, position_size, reason = self.portfolio.can_open_position(
            "NVDA", entry_price, regime_multiplier=0.05  # Should be raised to 0.1
        )
        
        self.assertTrue(can_open)
        self.assertAlmostEqual(position_size, 1000.0, places=2)  # 10% * 0.1 (minimum)
    
    def test_open_position_success(self):
        """Test successful position opening"""
        symbol = "AAPL"
        entry_price = 150.0
        
        success, message = self.portfolio.open_position(
            symbol=symbol,
            entry_date=self.test_date,
            entry_price=entry_price,
            regime_multiplier=1.0,
            entry_reason="Test signal"
        )
        
        self.assertTrue(success)
        self.assertIn("Position opened", message)
        
        # Check portfolio state
        self.assertEqual(len(self.portfolio.positions), 1)
        self.assertIn(symbol, self.portfolio.positions)
        
        position = self.portfolio.positions[symbol]
        self.assertEqual(position.symbol, symbol)
        self.assertEqual(position.entry_price, entry_price)
        self.assertAlmostEqual(position.position_size, 10000.0, places=2)
        
        # Check cash reduction (position + commission)
        expected_cash = self.initial_capital - 10000.0 - (10000.0 * 0.001)
        self.assertAlmostEqual(self.portfolio.cash, expected_cash, places=2)
    
    def test_duplicate_position_rejection(self):
        """Test rejection of duplicate positions"""
        symbol = "AAPL"
        entry_price = 150.0
        
        # Open first position
        self.portfolio.open_position(
            symbol=symbol,
            entry_date=self.test_date,
            entry_price=entry_price
        )
        
        # Try to open duplicate
        success, message = self.portfolio.open_position(
            symbol=symbol,
            entry_date=self.test_date,
            entry_price=entry_price
        )
        
        self.assertFalse(success)
        self.assertIn("Position already exists", message)
    
    def test_max_concurrent_positions_limit(self):
        """Test maximum concurrent positions limit"""
        symbols = ["AAPL", "GOOGL", "MSFT", "TSLA", "NVDA", "META"]
        entry_price = 100.0
        
        # Open positions up to the limit
        for i, symbol in enumerate(symbols[:5]):  # Limit is 5
            success, _ = self.portfolio.open_position(
                symbol=symbol,
                entry_date=self.test_date + timedelta(days=i),
                entry_price=entry_price
            )
            self.assertTrue(success, f"Should open position {i+1}")
        
        # Try to open 6th position (should fail)
        success, message = self.portfolio.open_position(
            symbol=symbols[5],
            entry_date=self.test_date + timedelta(days=5),
            entry_price=entry_price
        )
        
        self.assertFalse(success)
        self.assertIn("Max concurrent positions reached", message)
    
    def test_exposure_limit(self):
        """Test total exposure limit"""
        self.portfolio.max_concurrent_positions = 10
        # Open positions that approach the exposure limit
        positions = [
            ("AAPL", 100.0, 1.0),   # 10% * 1.0 = 10%
            ("GOOGL", 100.0, 1.0),  # 10% * 1.0 = 10%
            ("MSFT", 100.0, 1.0),   # 10% * 1.0 = 10%
            ("TSLA", 100.0, 1.0),   # 10% * 1.0 = 10%
            ("NVDA", 100.0, 1.0),   # 10% * 1.0 = 10% = 50% total (at limit)
        ]
        
        for symbol, price, mult in positions:
            success, _ = self.portfolio.open_position(
                symbol=symbol,
                entry_date=self.test_date,
                entry_price=price,
                regime_multiplier=mult
            )
            self.assertTrue(success, f"Should open {symbol}")
        
        # Check we're at the exposure limit
        self.assertAlmostEqual(self.portfolio.current_exposure, 0.50, places=2)
        
        # Try to open another position (should fail due to exposure limit)
        success, message = self.portfolio.open_position(
            symbol="META",
            entry_date=self.test_date,
            entry_price=100.0
        )
        
        self.assertFalse(success)
        self.assertIn("Max total exposure reached", message)
    
    def test_close_position_profit(self):
        """Test closing a profitable position"""
        symbol = "AAPL"
        entry_price = 150.0
        exit_price = 165.0  # 10% gain
        
        # Open position
        self.portfolio.open_position(
            symbol=symbol,
            entry_date=self.test_date,
            entry_price=entry_price
        )
        
        initial_cash = self.portfolio.cash
        
        # Close position
        success, message, trade = self.portfolio.close_position(
            symbol=symbol,
            exit_date=self.test_date + timedelta(days=5),
            exit_price=exit_price,
            exit_reason="Take profit"
        )
        
        self.assertTrue(success)
        self.assertIsNotNone(trade)
        self.assertEqual(trade.symbol, symbol)
        self.assertEqual(trade.entry_price, entry_price)
        self.assertEqual(trade.exit_price, exit_price)
        self.assertGreater(trade.pnl, 0)  # Should be profitable
        self.assertGreater(trade.pnl_pct, 0)
        
        # Check position is removed
        self.assertNotIn(symbol, self.portfolio.positions)
        
        # Check cash increased (should be more than initial due to profit)
        self.assertGreater(self.portfolio.cash, initial_cash)
    
    def test_close_position_loss(self):
        """Test closing a losing position"""
        symbol = "TSLA"
        entry_price = 200.0
        exit_price = 180.0  # 10% loss
        
        initial_cash = self.portfolio.cash
        
        # Open position
        self.portfolio.open_position(
            symbol=symbol,
            entry_date=self.test_date,
            entry_price=entry_price
        )
        
        # Close position
        success, message, trade = self.portfolio.close_position(
            symbol=symbol,
            exit_date=self.test_date + timedelta(days=3),
            exit_price=exit_price,
            exit_reason="Stop loss"
        )
        
        self.assertTrue(success)
        self.assertIsNotNone(trade)
        self.assertLess(trade.pnl, 0)  # Should be a loss
        self.assertLess(trade.pnl_pct, 0)
        
        # Check cash is less than initial (due to loss and commission)
        self.assertLess(self.portfolio.cash, initial_cash)
    
    def test_close_nonexistent_position(self):
        """Test closing a position that doesn't exist"""
        success, message, trade = self.portfolio.close_position(
            symbol="NONEXISTENT",
            exit_date=self.test_date,
            exit_price=100.0
        )
        
        self.assertFalse(success)
        self.assertIn("No position found", message)
        self.assertIsNone(trade)
    
    def test_commission_calculation(self):
        """Test commission calculation accuracy"""
        symbol = "AAPL"
        entry_price = 100.0
        exit_price = 110.0
        
        initial_commission = self.portfolio.total_commission_paid
        
        # Open and close position
        self.portfolio.open_position(
            symbol=symbol,
            entry_date=self.test_date,
            entry_price=entry_price
        )
        
        self.portfolio.close_position(
            symbol=symbol,
            exit_date=self.test_date + timedelta(days=1),
            exit_price=exit_price
        )
        
        # Check commission was charged twice (open + close)
        position_size = 10000.0  # 10% of 100k
        gross_proceeds = (position_size / entry_price) * exit_price
        
        expected_total_commission = (position_size * 0.001) + (gross_proceeds * 0.001)
        actual_commission = self.portfolio.total_commission_paid - initial_commission
        
        self.assertAlmostEqual(actual_commission, expected_total_commission, places=2)
    
    def test_statistics_calculation(self):
        """Test portfolio statistics calculation"""
        # Execute several trades
        trades_data = [
            ("AAPL", 100.0, 110.0, "profit"),    # 10% profit
            ("GOOGL", 200.0, 180.0, "loss"),     # 10% loss
            ("MSFT", 150.0, 165.0, "profit"),    # 10% profit
        ]
        
        for symbol, entry_price, exit_price, _ in trades_data:
            self.portfolio.open_position(
                symbol=symbol,
                entry_date=self.test_date,
                entry_price=entry_price
            )
            
            self.portfolio.close_position(
                symbol=symbol,
                exit_date=self.test_date + timedelta(days=1),
                exit_price=exit_price
            )
        
        stats = self.portfolio.get_statistics()
        
        # Check basic stats
        self.assertEqual(stats["total_trades"], 3)
        self.assertAlmostEqual(stats["win_rate"], 2/3, places=2)  # 2 wins out of 3
        self.assertGreater(stats["total_commission"], 0)
        
        # Check return is reasonable (not 7000%!)
        self.assertLess(abs(stats["total_return_pct"]), 1.0)  # Should be less than 100%
        
    def test_unrealized_pnl_calculation(self):
        """Test unrealized P&L calculation for open positions"""
        symbol = "AAPL"
        entry_price = 150.0
        current_price = 165.0
        
        # Create position
        position = Position(
            symbol=symbol,
            entry_date=self.test_date,
            entry_price=entry_price,
            position_size=15000.0  # $15k position
        )
        
        # Test unrealized P&L
        unrealized_pnl = position.unrealized_pnl(current_price)
        unrealized_pnl_pct = position.unrealized_pnl_pct(current_price)
        
        expected_shares = 15000.0 / 150.0  # 100 shares
        expected_pnl = expected_shares * (165.0 - 150.0)  # 100 * 15 = 1500
        expected_pnl_pct = (165.0 - 150.0) / 150.0  # 10%
        
        self.assertAlmostEqual(unrealized_pnl, expected_pnl, places=2)
        self.assertAlmostEqual(unrealized_pnl_pct, expected_pnl_pct, places=4)
    
    def test_force_close_expired_positions(self):
        """Test force closing of expired positions"""
        # Open position with 2-day max hold
        symbol = "AAPL"
        entry_price = 150.0
        
        self.portfolio.open_position(
            symbol=symbol,
            entry_date=self.test_date,
            entry_price=entry_price,
            max_hold_days=2
        )
        
        # Check position exists
        self.assertIn(symbol, self.portfolio.positions)
        
        # Force close after 3 days (expired)
        expired_date = self.test_date + timedelta(days=3)
        current_prices = {symbol: 155.0}
        
        expired_trades = self.portfolio.force_close_expired_positions(
            expired_date, current_prices
        )
        
        # Check position was closed
        self.assertEqual(len(expired_trades), 1)
        self.assertNotIn(symbol, self.portfolio.positions)
        self.assertEqual(expired_trades[0].exit_reason, "TIMEOUT")
    
    def test_insufficient_cash_rejection(self):
        """Test rejection when insufficient cash"""
        # Drain most of the cash by opening large positions
        large_positions = [
            ("AAPL", 50.0, 2.0),    # 20% position (max allowed)
            ("GOOGL", 50.0, 2.0),   # 20% position
            ("MSFT", 50.0, 2.0),    # 20% position
        ]
        
        for symbol, price, mult in large_positions:
            success, _ = self.portfolio.open_position(
                symbol=symbol,
                entry_date=self.test_date,
                entry_price=price,
                regime_multiplier=mult
            )
            if not success:  # Stop if we hit limits
                break
        
        # Try to open another large position (should fail due to cash/exposure limits)
        success, message = self.portfolio.open_position(
            symbol="TSLA",
            entry_date=self.test_date,
            entry_price=50.0,
            regime_multiplier=2.0
        )
        
        # Should fail due to exposure limit or insufficient cash
        self.assertFalse(success)


class TestPortfolioManagerEdgeCases(unittest.TestCase):
    """Test edge cases and error conditions"""
    
    def setUp(self):
        self.portfolio = PortfolioManager(initial_capital=10000.0)  # Smaller capital for edge case testing
    
    def test_minimum_position_size(self):
        """Test minimum position size rejection"""
        # Try to open tiny position
        self.portfolio.max_position_pct = 0.05
        can_open, size, reason = self.portfolio.can_open_position(
            "EXPENSIVE", 50000.0, 0.1  # Very expensive stock, small multiplier
        )
        
        # Should be rejected for being too small (less than 1% of portfolio)
        self.assertFalse(can_open)
        self.assertIn("Position size too small", reason)
    
    def test_zero_price_handling(self):
        """Test handling of zero or negative prices"""
        position = Position(
            symbol="TEST",
            entry_date=datetime.now(),
            entry_price=0.0,  # Invalid price
            position_size=1000.0
        )
        
        # Should handle gracefully
        self.assertEqual(position.shares, 0)
        self.assertEqual(position.unrealized_pnl(100.0), 0.0)
        self.assertEqual(position.unrealized_pnl_pct(100.0), 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)