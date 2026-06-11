"""
Circuit Breaker Detector for EGX (Egyptian Exchange) Trading System

This module detects circuit breaker events in stocks, where trading halts occur
due to significant price movements exceeding exchange-imposed thresholds.

Detection Logic:
- Zero range: high == low (complete price stagnation)
- Low volatility: (high - low) / close < 0.001 (0.1% range threshold)

Requirements:
- Requirement 9.1: Detect circuit breaker events by identifying days where high equals low
- Requirement 9.2: Mark bars as circuit_breaker_active when price range < 0.1% of close
- Requirement 9.3: Training_Pipeline excludes circuit_breaker_active bars from labeling
- Requirement 9.4: Live_Bot rejects buy signals when circuit_breaker_active is True
- Requirement 9.5: Maintain circuit_breaker_history log for analysis
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import pandas as pd
import numpy as np

# Configure module logger
logger = logging.getLogger(__name__)

# Circuit breaker detection threshold: 0.1% of close price
CIRCUIT_BREAKER_RANGE_THRESHOLD = 0.001


class CircuitBreakerDetector:
    """
    Detects circuit breaker events in OHLCV data for EGX stocks.
    
    The Egyptian Exchange implements circuit breakers to prevent extreme volatility.
    When price movements exceed thresholds, trading halts temporarily. This detector
    identifies such events to exclude them from trading signals.
    
    Attributes:
        threshold: Price range threshold as fraction (default 0.001 = 0.1%)
        circuit_breaker_history: List of recorded circuit breaker events
    """
    
    def __init__(self, threshold: float = CIRCUIT_BREAKER_RANGE_THRESHOLD):
        """
        Initialize CircuitBreakerDetector.
        
        Args:
            threshold: Price range threshold as fraction (default 0.001 = 0.1%)
        """
        self.threshold = threshold
        self.circuit_breaker_history: List[Dict] = []
        logger.info(f"CircuitBreakerDetector initialized with threshold={threshold:.4f}")
    
    def detect_from_ohlcv(self, df: pd.DataFrame) -> pd.Series:
        """
        Detect circuit breaker events from OHLCV data.
        
        Returns boolean series marking circuit breaker bars where:
        - high == low (zero range - complete price stagnation)
        - OR (high - low) / close < threshold (0.1% range)
        
        Args:
            df: DataFrame with columns ['open', 'high', 'low', 'close', 'volume']
        
        Returns:
            pd.Series: Boolean series where True indicates circuit breaker active
        
        Raises:
            ValueError: If required columns are missing
        """
        required_cols = ['high', 'low', 'close']
        missing = [col for col in required_cols if col not in df.columns]
        if missing:
            raise ValueError(f"Missing required columns: {missing}")
        
        # Create a copy to avoid modifying original data
        result = pd.Series(False, index=df.index, dtype=bool)
        
        # Detection logic:
        # 1. Zero range: high equals low (complete stagnation)
        zero_range = (df['high'] == df['low'])
        
        # 2. Low volatility: range < 0.1% of close price
        price_range = df['high'] - df['low']
        range_ratio = price_range / df['close'].replace(0, np.nan)
        low_volatility = range_ratio < self.threshold
        
        # Combine conditions: circuit breaker active if either condition is true
        result = zero_range | low_volatility.fillna(False)
        
        # Count detected events for logging
        cb_count = result.sum()
        total_bars = len(result)
        if cb_count > 0:
            logger.info(
                f"Circuit breaker detected: {cb_count}/{total_bars} bars "
                f"({100*cb_count/total_bars:.2f}%)"
            )
            # Log detailed events for analysis
            self._log_detected_events(df, result)
        
        return result
    
    def _log_detected_events(self, df: pd.DataFrame, cb_flags: pd.Series) -> None:
        """
        Log detailed information about detected circuit breaker events.
        
        Args:
            df: Original OHLCV DataFrame
            cb_flags: Boolean series indicating circuit breaker active
        """
        cb_bars = df[cb_flags]
        for idx, row in cb_bars.iterrows():
            price_range = row['high'] - row['low']
            range_pct = (price_range / row['close'] * 100) if row['close'] > 0 else 0
            
            event = {
                'index': str(idx),
                'close': row.get('close', None),
                'high': row.get('high', None),
                'low': row.get('low', None),
                'range_pct': range_pct,
                'is_zero_range': row['high'] == row['low']
            }
            logger.debug(f"Circuit breaker event: {event}")
    
    def is_active(self, symbol: str, date: datetime) -> bool:
        """
        Check if circuit breaker is active for symbol on specific date.
        
        Args:
            symbol: Stock symbol (e.g., 'COMI.CA')
            date: Date to check
        
        Returns:
            bool: True if circuit breaker is active on that date
        """
        # Check history for matching symbol and date
        for event in self.circuit_breaker_history:
            if event.get('symbol') == symbol:
                event_date = event.get('date')
                if event_date and event_date.date() == date.date():
                    return True
        return False
    
    def log_event(
        self,
        symbol: str,
        date: datetime,
        price: float,
        close: Optional[float] = None,
        high: Optional[float] = None,
        low: Optional[float] = None
    ) -> None:
        """
        Record a circuit breaker event for analysis and debugging.
        
        Args:
            symbol: Stock symbol
            date: Date of circuit breaker event
            close: Closing price on that date
            high: High price on that date
            low: Low price on that date
        """
        range_pct = 0.0
        if close and close > 0 and high and low:
            price_range = high - low
            range_pct = (price_range / close) * 100
        
        event = {
            'symbol': symbol,
            'date': date,
            'close': close,
            'high': high,
            'low': low,
            'range_pct': range_pct,
            'is_active': True,
            'timestamp': datetime.now()
        }
        
        self.circuit_breaker_history.append(event)
        logger.info(
            f"Circuit breaker event logged: symbol={symbol}, date={date.date()}, "
            f"close={close}, range_pct={range_pct:.4f}%"
        )
    
    def get_history(self, symbol: Optional[str] = None) -> List[Dict]:
        """
        Get circuit breaker history, optionally filtered by symbol.
        
        Args:
            symbol: Optional symbol to filter by
        
        Returns:
            List of circuit breaker event dictionaries
        """
        if symbol:
            return [e for e in self.circuit_breaker_history if e.get('symbol') == symbol]
        return self.circuit_breaker_history.copy()
    
    def clear_history(self) -> None:
        """Clear circuit breaker history."""
        self.circuit_breaker_history.clear()
        logger.info("Circuit breaker history cleared")
    
    def get_circuit_breaker_flags(self, df: pd.DataFrame, symbol: str) -> pd.Series:
        """
        Convenience method to detect circuit breakers and store in history.
        
        This combines detection with automatic event logging for the given symbol.
        
        Args:
            df: OHLCV DataFrame
            symbol: Stock symbol for logging purposes
        
        Returns:
            pd.Series: Boolean series marking circuit breaker bars
        """
        flags = self.detect_from_ohlcv(df)
        
        # Log events for flagged bars
        cb_bars = df[flags]
        for idx, row in cb_bars.iterrows():
            # Try to extract date from index or use index as date
            date = idx if isinstance(idx, datetime) else datetime.now()
            self.log_event(
                symbol=symbol,
                date=date,
                close=row.get('close'),
                high=row.get('high'),
                low=row.get('low')
            )
        
        return flags


def detect_circuit_breakers(
    df: pd.DataFrame,
    threshold: float = CIRCUIT_BREAKER_RANGE_THRESHOLD
) -> pd.Series:
    """
    Convenience function to detect circuit breakers in a single call.
    
    Args:
        df: OHLCV DataFrame with columns ['high', 'low', 'close']
        threshold: Range threshold as fraction (default 0.001 = 0.1%)
    
    Returns:
        pd.Series: Boolean series marking circuit breaker bars
    """
    detector = CircuitBreakerDetector(threshold=threshold)
    return detector.detect_from_ohlcv(df)


if __name__ == "__main__":
    # Simple test/demo
    logging.basicConfig(level=logging.INFO)
    
    # Create sample data with some circuit breaker scenarios
    sample_data = pd.DataFrame({
        'open': [100, 101, 102, 103, 104, 105, 106, 107, 108, 109],
        'high': [105, 106, 107, 108, 108, 109, 110, 111, 112, 113],
        'low': [95, 96, 97, 98, 108, 99, 100, 101, 102, 103],  # Row 4: high == low (zero range)
        'close': [104, 105, 106, 107, 108, 108.5, 109, 110, 111, 112],
        'volume': [1000, 1100, 1200, 1300, 500, 1400, 1500, 1600, 1700, 1800]
    })
    
    # Test detection
    detector = CircuitBreakerDetector()
    cb_flags = detector.detect_from_ohlcv(sample_data)
    
    print("\n=== Circuit Breaker Detection Test ===")
    print(f"Input data shape: {sample_data.shape}")
    print(f"Circuit breaker bars detected: {cb_flags.sum()}")
    print(f"\nSample data with CB flags:")
    result = sample_data.copy()
    result['circuit_breaker_active'] = cb_flags
    print(result)
    
    print(f"\nCircuit breaker history: {len(detector.circuit_breaker_history)} events")