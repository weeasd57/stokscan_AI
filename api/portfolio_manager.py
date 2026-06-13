"""
Portfolio Management Core Classes

This module implements realistic capital allocation tracking to replace the current 
unlimited capital system causing unrealistic returns like +7,930%.

Core classes:
- PortfolioManager: Tracks capital allocation and position management
- TradePosition: Represents individual trade positions
- AllocationRequest/Response: Handles trade allocation requests
- AllocationStatus: Enum for allocation request outcomes
- TradeCalculator: Utility class for trade calculations
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from enum import Enum
import pandas as pd
import numpy as np


import logging

logger = logging.getLogger(__name__)

@dataclass
class Position:
    symbol: str
    entry_date: datetime
    entry_price: float
    position_size: float
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    max_hold_days: int = 5
    regime_multiplier: float = 1.0
    entry_reason: str = ""

    @property
    def shares(self) -> float:
        return self.position_size / self.entry_price if self.entry_price > 0 else 0.0

@dataclass
class Trade:
    symbol: str
    entry_date: datetime
    exit_date: datetime
    entry_price: float
    exit_price: float
    position_size: float
    pnl: float
    pnl_pct: float
    exit_reason: str
    days_held: int
    regime_multiplier: float = 1.0
    entry_reason: str = ""

class AllocationStatus(Enum):
    """Status enum for allocation request outcomes"""
    APPROVED = "approved"
    REJECTED_INSUFFICIENT_CAPITAL = "rejected_insufficient_capital"
    REJECTED_MAX_POSITIONS = "rejected_max_positions"
    REJECTED_POSITION_SIZE = "rejected_position_size"


@dataclass
class TradePosition:
    """Dataclass for position management"""
    trade_id: str
    symbol: str
    entry_time: datetime
    entry_price: float
    position_size: float
    allocated_capital: float
    status: str  # "open", "closed"
    exit_time: Optional[datetime] = None
    exit_price: Optional[float] = None
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None


@dataclass
class AllocationRequest:
    """Request class for trade allocation"""
    symbol: str
    signal_time: datetime
    requested_allocation_pct: float
    entry_price: float
    regime_size_mult: float = 1.0


@dataclass
class AllocationResponse:
    """Response class for allocation requests"""
    status: AllocationStatus
    approved_amount: float
    position_size: float
    rejection_reason: Optional[str] = None


@dataclass
class PortfolioSnapshot:
    """Snapshot of portfolio state at a point in time"""
    timestamp: datetime
    total_capital: float
    available_capital: float
    allocated_capital: float
    unrealized_pnl: float
    realized_pnl: float
    total_value: float
    capital_utilization_pct: float
    open_positions_count: int


class PortfolioManager:
    """
    Advanced Portfolio Manager for realistic backtest calculations.
    
    Features:
    - Proper position sizing based on available capital
    - Risk management with max exposure limits
    - Concurrent trade tracking
    - Accurate portfolio-level returns
    """
    
    def __init__(
        self, 
        initial_capital: float = 100000.0,
        max_position_pct: float = 0.10,  # Max 10% per position
        max_total_exposure: float = 0.50,  # Max 50% total exposure
        max_concurrent_positions: int = 5,  # Max 5 concurrent positions
        reserve_cash_pct: float = 0.20,  # Keep 20% cash reserve
        commission_pct: float = 0.001  # 0.1% commission per trade
    ):
        self.initial_capital = initial_capital
        self.cash = initial_capital
        self.max_position_pct = max_position_pct
        self.max_total_exposure = max_total_exposure
        self.max_concurrent_positions = max_concurrent_positions
        self.reserve_cash_pct = reserve_cash_pct
        self.commission_pct = commission_pct
        
        # Tracking
        self.positions: Dict[str, Position] = {}  # symbol -> Position
        self.completed_trades: List[Trade] = []
        self.daily_balances: List[Tuple[datetime, float, float, float]] = []  # date, total_value, cash, positions_value
        
        # Statistics
        self.total_trades = 0
        self.winning_trades = 0
        self.total_commission_paid = 0.0
        
    @property
    def portfolio_value(self) -> float:
        """Current portfolio value including cash and positions"""
        positions_value = sum(pos.position_size for pos in self.positions.values())
        return self.cash + positions_value
    
    @property
    def available_cash(self) -> float:
        """Available cash for new positions (excluding reserve)"""
        reserved = self.initial_capital * self.reserve_cash_pct
        return max(0.0, self.cash - reserved)
    
    @property
    def current_exposure(self) -> float:
        """Current total exposure as percentage of portfolio value"""
        total_positions_value = sum(pos.position_size for pos in self.positions.values())
        return total_positions_value / self.portfolio_value if self.portfolio_value > 0 else 0.0
    
    @property
    def total_return_pct(self) -> float:
        """Total return percentage since inception"""
        return (self.portfolio_value - self.initial_capital) / self.initial_capital
    
    def can_open_position(
        self, 
        symbol: str, 
        entry_price: float, 
        regime_multiplier: float = 1.0
    ) -> Tuple[bool, float, str]:
        """
        Check if we can open a new position and return the position size.
        
        Returns:
            (can_open, position_size, reason)
        """
        if symbol in self.positions:
            return False, 0.0, f"Position already exists for {symbol}"
        
        if len(self.positions) >= self.max_concurrent_positions:
            return False, 0.0, f"Max concurrent positions reached ({self.max_concurrent_positions})"
        
        if self.current_exposure >= self.max_total_exposure:
            return False, 0.0, f"Max total exposure reached ({self.max_total_exposure:.1%})"
        
        # Calculate base position size
        base_size = min(
            self.available_cash,  # Available cash
            self.portfolio_value * self.max_position_pct,  # Max position size
            (self.max_total_exposure - self.current_exposure) * self.portfolio_value  # Remaining exposure capacity
        )
        
        # Apply regime multiplier (but cap it)
        regime_multiplier = max(0.1, min(2.0, regime_multiplier))  # Between 10% and 200%
        position_size = base_size * regime_multiplier
        
        # Ensure we don't exceed limits after regime adjustment
        position_size = min(position_size, self.available_cash)
        
        if position_size < self.portfolio_value * 0.01:  # Minimum 1% position
            return False, 0.0, f"Position size too small: {position_size:.2f}"
        
        return True, position_size, "OK"
    
    def open_position(
        self,
        symbol: str,
        entry_date: datetime,
        entry_price: float,
        regime_multiplier: float = 1.0,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        max_hold_days: int = 5,
        entry_reason: str = ""
    ) -> Tuple[bool, str]:
        """
        Open a new trading position.
        
        Returns:
            (success, message)
        """
        can_open, position_size, reason = self.can_open_position(symbol, entry_price, regime_multiplier)
        
        if not can_open:
            return False, reason
        
        # Calculate commission
        commission = position_size * self.commission_pct
        total_cost = position_size + commission
        
        if total_cost > self.cash:
            return False, f"Insufficient cash: need {total_cost:.2f}, have {self.cash:.2f}"
        
        # Create position
        position = Position(
            symbol=symbol,
            entry_date=entry_date,
            entry_price=entry_price,
            position_size=position_size,
            stop_loss=stop_loss,
            take_profit=take_profit,
            max_hold_days=max_hold_days,
            regime_multiplier=regime_multiplier,
            entry_reason=entry_reason
        )
        
        # Update portfolio
        self.positions[symbol] = position
        self.cash -= total_cost
        self.total_commission_paid += commission
        
        logger.debug(
            f"Opened position: {symbol} @ {entry_price:.4f}, "
            f"size: {position_size:.2f}, commission: {commission:.2f}, "
            f"remaining cash: {self.cash:.2f}"
        )
        
        return True, f"Position opened: {symbol}"
    
    def close_position(
        self,
        symbol: str,
        exit_date: datetime,
        exit_price: float,
        exit_reason: str = "Manual"
    ) -> Tuple[bool, str, Optional[Trade]]:
        """
        Close an existing position.
        
        Returns:
            (success, message, trade_record)
        """
        if symbol not in self.positions:
            return False, f"No position found for {symbol}", None
        
        position = self.positions[symbol]
        
        # Calculate trade results
        gross_proceeds = position.shares * exit_price
        commission = gross_proceeds * self.commission_pct
        net_proceeds = gross_proceeds - commission
        
        # Calculate P&L
        pnl = net_proceeds - position.position_size
        pnl_pct = pnl / position.position_size if position.position_size > 0 else 0.0
        
        # Days held
        days_held = (exit_date - position.entry_date).days
        
        # Create trade record
        trade = Trade(
            symbol=symbol,
            entry_date=position.entry_date,
            exit_date=exit_date,
            entry_price=position.entry_price,
            exit_price=exit_price,
            position_size=position.position_size,
            pnl=pnl,
            pnl_pct=pnl_pct,
            exit_reason=exit_reason,
            days_held=days_held,
            regime_multiplier=position.regime_multiplier,
            entry_reason=position.entry_reason
        )
        
        # Update portfolio
        del self.positions[symbol]
        self.cash += net_proceeds
        self.completed_trades.append(trade)
        self.total_commission_paid += commission
        
        # Update statistics
        self.total_trades += 1
        if pnl > 0:
            self.winning_trades += 1
        
        logger.debug(
            f"Closed position: {symbol} @ {exit_price:.4f}, "
            f"P&L: {pnl:.2f} ({pnl_pct:.2%}), commission: {commission:.2f}, "
            f"cash: {self.cash:.2f}"
        )
        
        return True, f"Position closed: {symbol}", trade
    
    def update_daily_snapshot(self, date: datetime, current_prices: Dict[str, float] = None):
        """Update daily portfolio snapshot for tracking"""
        if current_prices is None:
            current_prices = {}
        
        # Calculate current positions value
        positions_value = 0.0
        for symbol, position in self.positions.items():
            current_price = current_prices.get(symbol, position.entry_price)
            current_value = position.shares * current_price
            positions_value += current_value
        
        total_value = self.cash + positions_value
        
        self.daily_balances.append((date, total_value, self.cash, positions_value))
    
    def force_close_expired_positions(
        self, 
        current_date: datetime, 
        current_prices: Dict[str, float]
    ) -> List[Trade]:
        """Force close positions that have reached max hold period"""
        expired_trades = []
        
        symbols_to_close = []
        for symbol, position in self.positions.items():
            days_held = (current_date - position.entry_date).days
            if days_held >= position.max_hold_days:
                symbols_to_close.append(symbol)
        
        for symbol in symbols_to_close:
            exit_price = current_prices.get(symbol, self.positions[symbol].entry_price)
            success, message, trade = self.close_position(
                symbol, 
                current_date, 
                exit_price, 
                "TIMEOUT"
            )
            if success and trade:
                expired_trades.append(trade)
        
        return expired_trades
    
    def get_statistics(self) -> Dict:
        """Get comprehensive portfolio statistics"""
        if not self.completed_trades:
            return {
                "total_trades": 0,
                "win_rate": 0.0,
                "total_return_pct": self.total_return_pct,
                "total_pnl": 0.0,
                "avg_trade_pnl": 0.0,
                "avg_trade_pnl_pct": 0.0,
                "total_commission": self.total_commission_paid,
                "max_concurrent_positions": len(self.positions),
                "current_positions": len(self.positions),
                "current_exposure": self.current_exposure
            }
        
        # Calculate metrics
        total_pnl = sum(trade.pnl for trade in self.completed_trades)
        total_pnl_pct = sum(trade.pnl_pct for trade in self.completed_trades)
        win_rate = self.winning_trades / self.total_trades if self.total_trades > 0 else 0.0
        
        # Average trade metrics
        avg_trade_pnl = total_pnl / self.total_trades
        avg_trade_pnl_pct = total_pnl_pct / self.total_trades
        
        # Risk metrics
        trade_returns = [trade.pnl_pct for trade in self.completed_trades]
        sharpe_ratio = 0.0
        max_drawdown = 0.0
        
        if len(trade_returns) > 1:
            returns_std = np.std(trade_returns)
            if returns_std > 0:
                sharpe_ratio = np.mean(trade_returns) / returns_std
        
        # Calculate max drawdown from daily balances
        if len(self.daily_balances) > 1:
            values = [balance[1] for balance in self.daily_balances]  # total_value
            peak = values[0]
            max_dd = 0.0
            
            for value in values:
                if value > peak:
                    peak = value
                drawdown = (peak - value) / peak if peak > 0 else 0.0
                max_dd = max(max_dd, drawdown)
            
            max_drawdown = max_dd
        
        return {
            "total_trades": self.total_trades,
            "win_rate": win_rate,
            "total_return_pct": self.total_return_pct,
            "total_pnl": total_pnl,
            "avg_trade_pnl": avg_trade_pnl,
            "avg_trade_pnl_pct": avg_trade_pnl_pct,
            "total_commission": self.total_commission_paid,
            "sharpe_ratio": sharpe_ratio,
            "max_drawdown": max_drawdown,
            "current_positions": len(self.positions),
            "current_exposure": self.current_exposure,
            "portfolio_value": self.portfolio_value,
            "cash": self.cash
        }
    
    def get_trades_dataframe(self) -> pd.DataFrame:
        """Convert completed trades to pandas DataFrame"""
        if not self.completed_trades:
            return pd.DataFrame()
        
        trades_data = []
        for trade in self.completed_trades:
            trades_data.append({
                'Symbol': trade.symbol,
                'Entry_Date': trade.entry_date.strftime('%Y-%m-%d'),
                'Exit_Date': trade.exit_date.strftime('%Y-%m-%d'),
                'Entry': trade.entry_price,
                'Exit': trade.exit_price,
                'Position_Size': trade.position_size,
                'PnL': trade.pnl,
                'PnL_Pct': trade.pnl_pct * 100,  # Convert to percentage
                'Days_Held': trade.days_held,
                'Exit_Reason': trade.exit_reason,
                'Entry_Reason': trade.entry_reason,
                'Regime_Multiplier': trade.regime_multiplier
            })
        
        return pd.DataFrame(trades_data)