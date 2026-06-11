"""
EGX30 Data Fetcher for Market Context

This module provides EGX30 index data fetching and market regime classification
for the Egyptian Exchange trading system.

Requirements:
- Requirement 5.1: Fetch daily EGX30 index data and store in time-series dataset
- Requirement 5.2: Calculate daily EGX30 return as (close - prev_close) / prev_close
- Requirement 5.3: Classify market regime (panic, trending_up, trending_down, sideways)
- Requirement 5.4: Log market regime classification for each trading day
- Requirement 8.1-8.5: EGX30 data fetcher with multiple source support
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import pandas as pd
import numpy as np

# Configure module logger
logger = logging.getLogger(__name__)

# Default thresholds for regime classification
PANIC_THRESHOLD = -0.02  # -2%
TRENDING_UP_THRESHOLD = 0.01  # +1%
TRENDING_DOWN_THRESHOLD = -0.005  # -0.5%


class EGX30Fetcher:
    """
    Fetches EGX30 index data and classifies market regime.
    
    The EGX30 index represents the top 30 stocks by liquidity on the
    Egyptian Exchange. Monitoring its performance provides market context
    for filtering individual stock signals.
    
    Attributes:
        cached_regime: Last known market regime (used when data unavailable)
        fallback_enabled: Whether to use fallback behavior
    """
    
    def __init__(self, supabase_client=None):
        """
        Initialize EGX30Fetcher.
        
        Args:
            supabase_client: Optional Supabase client for database queries
        """
        self.supabase = supabase_client
        self.cached_regime: Optional[str] = None
        self.fallback_enabled = True
        logger.info("EGX30Fetcher initialized")
    
    def fetch_daily_ohlcv(
        self, 
        start_date: str, 
        end_date: str
    ) -> pd.DataFrame:
        """
        Download EGX30 index data from Yahoo Finance or Supabase.
        
        Args:
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
        
        Returns:
            DataFrame with columns: date, open, high, low, close, volume
        
        Raises:
            RuntimeError: If all data sources fail
        """
        # Try Yahoo Finance first
        try:
            data = self._fetch_from_yahoo(start_date, end_date)
            if data is not None and len(data) > 0:
                logger.info(f"Fetched {len(data)} EGX30 records from Yahoo Finance")
                return data
        except Exception as e:
            logger.warning(f"Yahoo Finance fetch failed: {e}")
        
        # Try Supabase
        if self.supabase:
            try:
                data = self._fetch_from_supabase(start_date, end_date)
                if data is not None and len(data) > 0:
                    logger.info(f"Fetched {len(data)} EGX30 records from Supabase")
                    return data
            except Exception as e:
                logger.warning(f"Supabase fetch failed: {e}")
        
        # Try local JSON fallback
        try:
            data = self._fetch_from_local(start_date, end_date)
            if data is not None and len(data) > 0:
                logger.info(f"Fetched {len(data)} EGX30 records from local storage")
                return data
        except Exception as e:
            logger.warning(f"Local fetch failed: {e}")
        
        # All sources failed
        error_msg = f"Failed to fetch EGX30 data from all sources for {start_date} to {end_date}"
        logger.error(error_msg)
        raise RuntimeError(error_msg)
    
    def _fetch_from_yahoo(self, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """Attempt to fetch from Yahoo Finance."""
        try:
            import yfinance as yf
            ticker = yf.Ticker("EGX30.INDX")
            df = ticker.history(start=start_date, end=end_date)
            if len(df) > 0:
                df = df.reset_index()
                df['date'] = df['Date'].dt.strftime('%Y-%m-%d')
                return df[['date', 'Open', 'High', 'Low', 'Close', 'Volume']].rename(
                    columns={'Open': 'open', 'High': 'high', 'Low': 'low', 
                             'Close': 'close', 'Volume': 'volume'}
                )
        except ImportError:
            logger.debug("yfinance not installed")
        except Exception as e:
            logger.debug(f"Yahoo Finance error: {e}")
        return None
    
    def _fetch_from_supabase(self, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """Attempt to fetch from Supabase."""
        if not self.supabase:
            return None
        
        try:
            response = self.supabase.table('stock_prices').select(
                'date, open, high, low, close, volume'
            ).eq('symbol', 'EGX30').gte('date', start_date).lte('date', end_date).execute()
            
            if response.data:
                df = pd.DataFrame(response.data)
                return df
        except Exception as e:
            logger.debug(f"Supabase error: {e}")
        return None
    
    def _fetch_from_local(self, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """Attempt to fetch from local JSON file."""
        import os
        local_path = os.path.join(
            os.path.dirname(__file__), 
            'local_data', 
            'EGX30_historical.json'
        )
        
        if os.path.exists(local_path):
            df = pd.read_json(local_path)
            df = df[(df['date'] >= start_date) & (df['date'] <= end_date)]
            return df
        return None
    
    def calculate_daily_return(self, df: pd.DataFrame) -> pd.Series:
        """
        Calculate daily EGX30 return as (close - prev_close) / prev_close.
        
        Args:
            df: DataFrame with 'close' column
        
        Returns:
            Series with daily returns
        """
        return df['close'].pct_change()
    
    def classify_market_regime(self, egx30_return: float) -> str:
        """
        Classify market regime based on EGX30 daily return.
        
        Args:
            egx30_return: Daily return as decimal (e.g., -0.025 for -2.5%)
        
        Returns:
            Market regime string:
            - "panic" if return < -2%
            - "trending_up" if return > 1%
            - "trending_down" if return < -0.5%
            - "sideways" otherwise
        """
        if egx30_return <= PANIC_THRESHOLD:
            return "panic"
        elif egx30_return >= TRENDING_UP_THRESHOLD:
            return "trending_up"
        elif egx30_return <= TRENDING_DOWN_THRESHOLD:
            return "trending_down"
        else:
            return "sideways"
    
    def get_latest_regime(self) -> str:
        """
        Get the most recent market regime.
        
        Returns:
            Latest regime classification, or "sideways" as default if unavailable
        """
        if self.cached_regime:
            return self.cached_regime
        
        # Default to sideways if no cached data
        logger.debug("No cached regime available, defaulting to 'sideways'")
        return "sideways"
    
    def update_regime_cache(self, regime: str) -> None:
        """
        Update cached regime value.
        
        Args:
            regime: New regime value to cache
        """
        self.cached_regime = regime
        logger.info(f"Updated cached regime to: {regime}")
    
    def get_egx30_context(self, date: str) -> Dict:
        """
        Get complete EGX30 context for a specific date.
        
        Args:
            date: Date in YYYY-MM-DD format
        
        Returns:
            Dictionary with date, egx30_return, regime, and reject_buys flag
        """
        try:
            # Fetch recent data to get the specific date
            start = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=10)).strftime('%Y-%m-%d')
            end = date
            
            df = self.fetch_daily_ohlcv(start, end)
            
            # Find the specific date
            day_data = df[df['date'] == date]
            
            if len(day_data) == 0:
                # Date not found, return fallback context
                logger.warning(f"EGX30 data not available for {date}, using fallback")
                return self._get_fallback_context(date)
            
            close = day_data['close'].values[0]
            prev_close = df[df['date'] < date]['close'].iloc[-1] if len(df[df['date'] < date]) > 0 else close
            
            egx30_return = (close - prev_close) / prev_close
            regime = self.classify_market_regime(egx30_return)
            
            self.update_regime_cache(regime)
            
            return {
                'date': date,
                'egx30_close': close,
                'egx30_return': egx30_return,
                'regime': regime,
                'reject_buys': regime == 'panic'
            }
        except Exception as e:
            logger.warning(f"Error getting EGX30 context for {date}: {e}")
            return self._get_fallback_context(date)
    
    def _get_fallback_context(self, date: str) -> Dict:
        """
        Get fallback context when data is unavailable.
        
        Args:
            date: Date string
        
        Returns:
            Default context dictionary
        """
        fallback_regime = self.get_latest_regime()
        return {
            'date': date,
            'egx30_close': None,
            'egx30_return': None,
            'regime': fallback_regime,
            'reject_buys': fallback_regime == 'panic',
            'fallback': True
        }


def get_market_regime(egx30_return: float) -> str:
    """
    Convenience function to classify market regime.
    
    Args:
        egx30_return: Daily return as decimal
    
    Returns:
        Market regime string
    """
    fetcher = EGX30Fetcher()
    return fetcher.classify_market_regime(egx30_return)


if __name__ == "__main__":
    # Simple test/demo
    logging.basicConfig(level=logging.INFO)
    
    # Test regime classification
    fetcher = EGX30Fetcher()
    
    test_returns = [-0.03, -0.025, -0.015, -0.005, 0.0, 0.005, 0.015, 0.025]
    
    print("\n=== EGX30 Regime Classification Test ===")
    for ret in test_returns:
        regime = fetcher.classify_market_regime(ret)
        print(f"Return: {ret*100:+6.2f}% -> Regime: {regime}")
    
    print(f"\nDefault regime (no cache): {fetcher.get_latest_regime()}")
    fetcher.update_regime_cache("panic")
    print(f"After caching 'panic': {fetcher.get_latest_regime()}")