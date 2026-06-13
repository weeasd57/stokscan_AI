"""
Configuration settings for backtest system.

Controls whether to use enhanced or legacy backtest calculations.
"""

import os
from typing import Optional

class BacktestConfig:
    """Configuration for backtest behavior"""
    
    # Default settings
    DEFAULT_USE_ENHANCED = True
    DEFAULT_MAX_POSITION_PCT = 0.10         # 10% max per position
    DEFAULT_MAX_TOTAL_EXPOSURE = 0.50       # 50% max total exposure  
    DEFAULT_MAX_CONCURRENT_POSITIONS = 5    # Max 5 concurrent positions
    DEFAULT_RESERVE_CASH_PCT = 0.20         # 20% cash reserve
    DEFAULT_COMMISSION_PCT = 0.001          # 0.1% commission
    
    @classmethod
    def use_enhanced_simulation(cls) -> bool:
        """
        Determine whether to use enhanced simulation.
        
        Checks environment variable first, then defaults to True.
        """
        env_value = os.getenv("USE_ENHANCED_BACKTEST", "").lower()
        
        if env_value in ("true", "1", "yes", "on"):
            return True
        elif env_value in ("false", "0", "no", "off"):
            return False
        else:
            return cls.DEFAULT_USE_ENHANCED
    
    @classmethod
    def get_portfolio_settings(cls) -> dict:
        """
        Get portfolio manager settings from environment or defaults.
        """
        return {
            "max_position_pct": float(os.getenv("BT_MAX_POSITION_PCT", cls.DEFAULT_MAX_POSITION_PCT)),
            "max_total_exposure": float(os.getenv("BT_MAX_TOTAL_EXPOSURE", cls.DEFAULT_MAX_TOTAL_EXPOSURE)),
            "max_concurrent_positions": int(os.getenv("BT_MAX_CONCURRENT_POSITIONS", cls.DEFAULT_MAX_CONCURRENT_POSITIONS)),
            "reserve_cash_pct": float(os.getenv("BT_RESERVE_CASH_PCT", cls.DEFAULT_RESERVE_CASH_PCT)),
            "commission_pct": float(os.getenv("BT_COMMISSION_PCT", cls.DEFAULT_COMMISSION_PCT))
        }
    
    @classmethod
    def log_configuration(cls):
        """Log current configuration settings"""
        enhanced = cls.use_enhanced_simulation()
        settings = cls.get_portfolio_settings()
        
        print("=" * 50)
        print("BACKTEST CONFIGURATION")
        print("=" * 50)
        print(f"Enhanced Simulation: {'ENABLED' if enhanced else 'DISABLED (LEGACY)'}")
        
        if enhanced:
            print("Portfolio Settings:")
            print(f"  Max Position Size: {settings['max_position_pct']:.1%}")
            print(f"  Max Total Exposure: {settings['max_total_exposure']:.1%}")
            print(f"  Max Concurrent Positions: {settings['max_concurrent_positions']}")
            print(f"  Cash Reserve: {settings['reserve_cash_pct']:.1%}")
            print(f"  Commission Rate: {settings['commission_pct']:.3%}")
        else:
            print("⚠️  WARNING: Using legacy system - results may be inaccurate!")
        
        print("=" * 50)


# Environment variable examples for .env file:
"""
# Enable/disable enhanced backtest system
USE_ENHANCED_BACKTEST=true

# Portfolio manager settings (only used if enhanced is enabled)
BT_MAX_POSITION_PCT=0.15          # 15% max per position
BT_MAX_TOTAL_EXPOSURE=0.60        # 60% max total exposure
BT_MAX_CONCURRENT_POSITIONS=7     # Max 7 positions
BT_RESERVE_CASH_PCT=0.15          # 15% cash reserve
BT_COMMISSION_PCT=0.0015          # 0.15% commission
"""

def get_simulation_function():
    """
    Get the appropriate simulation function based on configuration.
    
    Returns:
        function: Either run_enhanced_radar_simulation or run_radar_simulation
    """
    from api.backtest_radar import run_enhanced_radar_simulation, run_radar_simulation
    
    if BacktestConfig.use_enhanced_simulation():
        return run_enhanced_radar_simulation
    else:
        return run_radar_simulation

def create_portfolio_manager(initial_capital: float):
    """
    Create a portfolio manager with configured settings.
    
    Args:
        initial_capital: Initial capital amount
        
    Returns:
        PortfolioManager: Configured portfolio manager instance
    """
    from api.portfolio_manager import PortfolioManager
    
    settings = BacktestConfig.get_portfolio_settings()
    
    return PortfolioManager(
        initial_capital=initial_capital,
        **settings
    )