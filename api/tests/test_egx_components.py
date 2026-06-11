"""
Unit Tests for EGX Components (EGX30 and Circuit Breaker)

These tests cover:
- EGX30 regime classification (panic, trending_up, trending_down, sideways)
- Circuit breaker detection for zero-range and normal-range scenarios
- Fallback behavior when data sources unavailable

Requirements covered:
- Requirement 5.3: Log market regime classification
- Requirement 9.1: Detect circuit breaker events by identifying days where high equals low
- Requirement 9.2: Mark bars as circuit_breaker_active when price range < 0.1%
"""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.egx30_fetcher import EGX30Fetcher, get_market_regime
from api.circuit_breaker_detector import CircuitBreakerDetector, detect_circuit_breakers


class TestEGX30RegimeClassification:
    """Tests for EGX30 market regime classification (Requirement 5.3)"""
    
    def test_panic_regime(self):
        """EGX30 return < -2% should classify as panic"""
        fetcher = EGX30Fetcher()
        
        # Test various panic-level returns
        assert fetcher.classify_market_regime(-0.03) == "panic"
        assert fetcher.classify_market_regime(-0.025) == "panic"
        assert fetcher.classify_market_regime(-0.021) == "panic"
        assert fetcher.classify_market_regime(-0.0201) == "panic"
    
    def test_panic_boundary(self):
        """Test boundary at exactly -2%"""
        fetcher = EGX30Fetcher()
        
        # Exactly -2% should be panic
        assert fetcher.classify_market_regime(-0.02) == "panic"
    
    def test_trending_up_regime(self):
        """EGX30 return > 1% should classify as trending_up"""
        fetcher = EGX30Fetcher()
        
        # Test various trending_up returns
        assert fetcher.classify_market_regime(0.015) == "trending_up"
        assert fetcher.classify_market_regime(0.025) == "trending_up"
        assert fetcher.classify_market_regime(0.05) == "trending_up"
        assert fetcher.classify_market_regime(0.0101) == "trending_up"
    
    def test_trending_up_boundary(self):
        """Test boundary at exactly +1%"""
        fetcher = EGX30Fetcher()
        
        # Exactly 1% should be trending_up
        assert fetcher.classify_market_regime(0.01) == "trending_up"
    
    def test_trending_down_regime(self):
        """EGX30 return between -2% and -0.5% should classify as trending_down"""
        fetcher = EGX30Fetcher()
        
        # Test trending_down range
        assert fetcher.classify_market_regime(-0.015) == "trending_down"
        assert fetcher.classify_market_regime(-0.01) == "trending_down"
        assert fetcher.classify_market_regime(-0.0051) == "trending_down"
    
    def test_trending_down_boundary(self):
        """Test boundary at exactly -0.5%"""
        fetcher = EGX30Fetcher()
        
        # Exactly -0.5% should be trending_down
        assert fetcher.classify_market_regime(-0.005) == "trending_down"
    
    def test_sideways_regime(self):
        """EGX30 return between -0.5% and 1% should classify as sideways"""
        fetcher = EGX30Fetcher()
        
        # Test sideways range
        assert fetcher.classify_market_regime(0.0) == "sideways"
        assert fetcher.classify_market_regime(0.005) == "sideways"
        assert fetcher.classify_market_regime(-0.004) == "sideways"
        assert fetcher.classify_market_regime(0.009) == "sideways"
    
    def test_convenience_function(self):
        """Test the convenience function get_market_regime"""
        assert get_market_regime(-0.03) == "panic"
        assert get_market_regime(0.015) == "trending_up"
        assert get_market_regime(0.005) == "sideways"


class TestEGX30Cache:
    """Tests for EGX30 caching behavior"""
    
    def test_default_regime(self):
        """Default regime should be sideways when no cache"""
        fetcher = EGX30Fetcher()
        assert fetcher.get_latest_regime() == "sideways"
    
    def test_update_cache(self):
        """Cache should be updatable"""
        fetcher = EGX30Fetcher()
        
        fetcher.update_regime_cache("panic")
        assert fetcher.get_latest_regime() == "panic"
        
        fetcher.update_regime_cache("trending_up")
        assert fetcher.get_latest_regime() == "trending_up"


class TestEGX30Fallback:
    """Tests for EGX30 fallback behavior when data sources unavailable (Requirement 5.4)"""
    
    @patch('api.egx30_fetcher.EGX30Fetcher._fetch_from_yahoo')
    @patch('api.egx30_fetcher.EGX30Fetcher._fetch_from_supabase')
    @patch('api.egx30_fetcher.EGX30Fetcher._fetch_from_local')
    def test_fallback_when_all_sources_fail(self, mock_local, mock_supabase, mock_yahoo):
        """Should raise RuntimeError when all data sources fail"""
        mock_yahoo.return_value = None
        mock_supabase.return_value = None
        mock_local.return_value = None
        
        fetcher = EGX30Fetcher()
        
        with pytest.raises(RuntimeError, match="Failed to fetch EGX30 data"):
            fetcher.fetch_daily_ohlcv("2024-01-01", "2024-01-31")
    
    @patch('api.egx30_fetcher.EGX30Fetcher._fetch_from_yahoo')
    def test_fallback_context_with_no_data(self, mock_yahoo):
        """Should return fallback context when date not found"""
        mock_yahoo.return_value = pd.DataFrame({
            'date': ['2024-01-02', '2024-01-03'],
            'open': [100, 101],
            'high': [102, 103],
            'low': [99, 100],
            'close': [101, 102],
            'volume': [1000, 1100]
        })
        
        fetcher = EGX30Fetcher()
        
        # Try to get context for a date that doesn't exist
        context = fetcher.get_egx30_context("2024-01-15")
        
        assert 'fallback' in context
        assert context['fallback'] is True
        assert context['regime'] in ['panic', 'trending_up', 'trending_down', 'sideways']


class TestCircuitBreakerDetection:
    """Tests for circuit breaker detection (Requirements 9.1, 9.2)"""
    
    def test_detect_zero_range(self):
        """Days where high == low should be detected as circuit breaker"""
        detector = CircuitBreakerDetector()
        
        # Create data with zero range (high == low)
        df = pd.DataFrame({
            'open': [100, 101, 102, 103],
            'high': [105, 106, 107, 108],
            'low': [95, 96, 107, 98],  # Row 2: high == low (zero range)
            'close': [104, 105, 107, 106],
            'volume': [1000, 1100, 1200, 1300]
        })
        
        cb_flags = detector.detect_from_ohlcv(df)
        
        # Should detect row 2 (index 2) as circuit breaker
        assert cb_flags[2] == True
        assert cb_flags.sum() == 1
    
    def test_detect_low_volatility(self):
        """Range < 0.1% of close should be detected as circuit breaker"""
        detector = CircuitBreakerDetector()
        
        # Create data with low volatility (range < 0.1% of close)
        # For close=100, 0.1% = 0.1, so range should be < 0.1
        df = pd.DataFrame({
            'open': [100, 101, 102, 103],
            'high': [100.05, 101.05, 102.05, 103.05],
            'low': [100.00, 101.00, 102.00, 103.00],  # Very small range
            'close': [100.02, 101.02, 102.02, 103.02],
            'volume': [1000, 1100, 1200, 1300]
        })
        
        cb_flags = detector.detect_from_ohlcv(df)
        
        # All rows have very low range - should detect as circuit breaker
        assert cb_flags.sum() >= 3  # At least 3 bars should be flagged
    
    def test_no_circuit_breaker(self):
        """Normal price ranges should not trigger circuit breaker detection"""
        detector = CircuitBreakerDetector()
        
        # Create data with normal ranges (>0.1% of close)
        df = pd.DataFrame({
            'open': [100, 101, 102, 103],
            'high': [105, 106, 107, 108],
            'low': [95, 96, 97, 98],  # Normal range ~5%
            'close': [104, 105, 106, 107],
            'volume': [1000, 1100, 1200, 1300]
        })
        
        cb_flags = detector.detect_from_ohlcv(df)
        
        # Should not detect any circuit breakers
        assert cb_flags.sum() == 0
    
    def test_circuit_breaker_with_zero_close(self):
        """Should handle zero close price gracefully"""
        detector = CircuitBreakerDetector()
        
        df = pd.DataFrame({
            'open': [100, 0, 102],
            'high': [105, 5, 107],
            'low': [95, 5, 97],
            'close': [104, 0, 106],  # Zero close in middle
            'volume': [1000, 1100, 1200]
        })
        
        # Should not raise error
        cb_flags = detector.detect_from_ohlcv(df)
        
        # Zero close row should be handled (not crash)
        assert len(cb_flags) == 3
    
    def test_custom_threshold(self):
        """Should respect custom threshold parameter"""
        detector = CircuitBreakerDetector(threshold=0.005)  # 0.5%
        
        # Create data with range at 0.3% (between 0.1% and 0.5%)
        df = pd.DataFrame({
            'open': [100, 101, 102],
            'high': [100.3, 101.3, 102.3],
            'low': [100.0, 101.0, 102.0],  # 0.3% range
            'close': [100.15, 101.15, 102.15],
            'volume': [1000, 1100, 1200]
        })
        
        cb_flags = detector.detect_from_ohlcv(df)
        
        # With 0.5% threshold, 0.3% range should be detected as circuit breaker
        assert cb_flags.sum() >= 2


class TestCircuitBreakerHistory:
    """Tests for circuit breaker event logging"""
    
    def test_log_event(self):
        """Should record circuit breaker events in history"""
        detector = CircuitBreakerDetector()
        
        detector.log_event(
            symbol="COMI.CA",
            date=datetime(2024, 1, 15),
            price=10.50,
            close=10.50,
            high=10.50,
            low=10.50
        )
        
        history = detector.get_history()
        assert len(history) == 1
        assert history[0]['symbol'] == "COMI.CA"
        assert history[0]['range_pct'] == 0.0
    
    def test_get_history_filtered(self):
        """Should filter history by symbol"""
        detector = CircuitBreakerDetector()
        
        detector.log_event("COMI.CA", datetime(2024, 1, 15), 10.50)
        detector.log_event("ETBL.CA", datetime(2024, 1, 16), 15.00)
        detector.log_event("COMI.CA", datetime(2024, 1, 17), 10.75)
        
        comi_history = detector.get_history("COMI.CA")
        assert len(comi_history) == 2
        assert all(e['symbol'] == "COMI.CA" for e in comi_history)
    
    def test_clear_history(self):
        """Should clear all history"""
        detector = CircuitBreakerDetector()
        
        detector.log_event("COMI.CA", datetime(2024, 1, 15), 10.50)
        detector.clear_history()
        
        assert len(detector.get_history()) == 0
    
    def test_is_active(self):
        """Should check if circuit breaker is active for symbol/date"""
        detector = CircuitBreakerDetector()
        
        date = datetime(2024, 1, 15)
        detector.log_event("COMI.CA", date, 10.50, close=10.50, high=10.50, low=10.50)
        
        assert detector.is_active("COMI.CA", date) == True
        assert detector.is_active("COMI.CA", datetime(2024, 1, 20)) == False
        assert detector.is_active("OTHER.CA", date) == False


class TestConvenienceFunction:
    """Tests for the detect_circuit_breakers convenience function"""
    
    def test_detect_circuit_breakers_function(self):
        """Test the convenience function"""
        df = pd.DataFrame({
            'open': [100, 101, 102],
            'high': [105, 101, 107],
            'low': [95, 101, 97],
            'close': [104, 101, 106],
            'volume': [1000, 1100, 1200]
        })
        
        cb_flags = detect_circuit_breakers(df)
        
        # Row 1 has high == low (zero range)
        assert cb_flags[1] == True


class TestIntegration:
    """Integration tests for EGX30 and Circuit Breaker together"""
    
    def test_egx30_and_circuit_breaker_workflow(self):
        """Test complete workflow: fetch EGX30, classify regime, check circuit breaker"""
        # 1. Get market regime
        fetcher = EGX30Fetcher()
        fetcher.update_regime_cache("trending_up")
        
        # 2. Check if we should reject buys based on regime
        current_regime = fetcher.get_latest_regime()
        should_reject_buys = current_regime == "panic"
        
        assert should_reject_buys == False  # trending_up doesn't reject buys
        
        # 3. Check circuit breaker for a symbol
        detector = CircuitBreakerDetector()
        stock_df = pd.DataFrame({
            'open': [100, 101, 102],
            'high': [105, 105, 107],  # Zero range at index 1
            'low': [95, 105, 97],
            'close': [104, 105, 106],
            'volume': [1000, 1100, 1200]
        })
        
        cb_active = detector.detect_from_ohlcv(stock_df)
        
        # 4. Final decision
        if should_reject_buys:
            decision = "REJECT - Market panic"
        elif cb_active.any():
            decision = "REJECT - Circuit breaker active"
        else:
            decision = "PROCEED"
        
        assert decision == "REJECT - Circuit breaker active"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])