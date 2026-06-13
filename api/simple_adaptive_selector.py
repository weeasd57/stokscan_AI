#!/usr/bin/env python
"""
Simple Adaptive Model Selector (Performance-Based)
نظام تكيفي بسيط يختار الموديل بناءً على الأداء الفعلي

Strategy:
- يبدأ بـ model_EGX (الآمن)
- كل 30 يوم، يقيّم أداء الموديل الحالي
- لو الأداء ضعيف (<10% ROI في 30 يوم) → يجرب الموديل التاني
- لو الموديل التاني أحسن → يبقى عليه
- لو أسوأ → يرجع للأول

Author: Kiro AI
Date: 2026-06-13
"""
from dataclasses import dataclass
from typing import Literal, Optional
from datetime import datetime, timedelta


@dataclass
class ModelPerformance:
    """تتبع أداء الموديل"""
    model_path: str
    start_date: datetime
    end_date: datetime
    trades_count: int
    win_rate: float
    roi: float  # Return on Investment %
    sharpe_ratio: Optional[float] = None
    max_drawdown: Optional[float] = None


class SimpleAdaptiveSelector:
    """
    نظام تكيفي بسيط يختار الموديل بناءً على الأداء الفعلي
    """
    
    def __init__(
        self,
        king_model_path: str = "api/models/KING.pkl",
        egx_model_path: str = "api/models/model_EGX.pkl",
        evaluation_period_days: int = 30,  # كل كام يوم نقيّم؟
        min_trades_for_evaluation: int = 3,  # أقل عدد صفقات للتقييم
        underperformance_threshold: float = 0.10,  # أقل من 10% ROI في الشهر = ضعيف
    ):
        self.king_model_path = king_model_path
        self.egx_model_path = egx_model_path
        self.evaluation_period_days = evaluation_period_days
        self.min_trades_for_evaluation = min_trades_for_evaluation
        self.underperformance_threshold = underperformance_threshold
        
        # Current active model
        self.current_model = egx_model_path  # نبدأ بالآمن
        self.last_evaluation_date: Optional[datetime] = None
        self.performance_history: list[ModelPerformance] = []
        
    def get_current_model(self) -> str:
        """يرجع المسار للموديل الحالي"""
        return self.current_model
    
    def should_evaluate(self, current_date: datetime) -> bool:
        """
        يحدد إذا كان الوقت مناسب للتقييم
        """
        if self.last_evaluation_date is None:
            return True
        
        days_since_eval = (current_date - self.last_evaluation_date).days
        return days_since_eval >= self.evaluation_period_days
    
    def evaluate_and_switch(
        self,
        current_date: datetime,
        trades_history: list[dict],  # [{symbol, action, pnl, timestamp}, ...]
        current_capital: float,
        initial_capital: float
    ) -> tuple[str, str]:  # (new_model, reason)
        """
        يقيّم الأداء ويقرر لو نبدل الموديل
        
        Returns:
            (model_path, reason_for_decision)
        """
        # Filter trades from last evaluation period
        if self.last_evaluation_date:
            start_date = self.last_evaluation_date
        else:
            start_date = current_date - timedelta(days=self.evaluation_period_days)
        
        period_trades = [
            t for t in trades_history
            if datetime.fromisoformat(t['timestamp'].replace('Z', '+00:00')) >= start_date
        ]
        
        # Calculate performance metrics
        if len(period_trades) < self.min_trades_for_evaluation:
            reason = f"Not enough trades ({len(period_trades)}<{self.min_trades_for_evaluation}) - keeping {self.current_model.split('/')[-1]}"
            return self.current_model, reason
        
        # Win rate
        winning_trades = [t for t in period_trades if t.get('pnl', 0) > 0]
        win_rate = len(winning_trades) / len(period_trades) if period_trades else 0
        
        # ROI
        roi = ((current_capital - initial_capital) / initial_capital) * 100
        
        # Record performance
        perf = ModelPerformance(
            model_path=self.current_model,
            start_date=start_date,
            end_date=current_date,
            trades_count=len(period_trades),
            win_rate=win_rate,
            roi=roi
        )
        self.performance_history.append(perf)
        
        # Update evaluation date
        self.last_evaluation_date = current_date
        
        # Decision logic
        if roi < self.underperformance_threshold:
            # Performance is weak - try the other model
            if self.current_model == self.egx_model_path:
                self.current_model = self.king_model_path
                reason = f"⚠️  model_EGX underperforming ({roi:.1f}% < {self.underperformance_threshold*100:.0f}%) - switching to KING"
            else:
                self.current_model = self.egx_model_path
                reason = f"⚠️  KING underperforming ({roi:.1f}% < {self.underperformance_threshold*100:.0f}%) - switching to model_EGX"
        else:
            # Performance is good - keep current model
            reason = f"✅ Current model performing well (ROI: {roi:.1f}%, WR: {win_rate:.1%}) - keeping {self.current_model.split('/')[-1]}"
        
        return self.current_model, reason
    
    def force_switch_model(self, reason: str = "Manual override") -> str:
        """يبدل للموديل التاني (للاختبار أو manual override)"""
        if self.current_model == self.egx_model_path:
            self.current_model = self.king_model_path
        else:
            self.current_model = self.egx_model_path
        
        return self.current_model
    
    def get_performance_summary(self) -> dict:
        """يرجع ملخص الأداء"""
        if not self.performance_history:
            return {
                "total_evaluations": 0,
                "current_model": self.current_model.split('/')[-1],
                "avg_roi": 0,
                "avg_win_rate": 0
            }
        
        return {
            "total_evaluations": len(self.performance_history),
            "current_model": self.current_model.split('/')[-1],
            "avg_roi": sum(p.roi for p in self.performance_history) / len(self.performance_history),
            "avg_win_rate": sum(p.win_rate for p in self.performance_history) / len(self.performance_history),
            "last_evaluation": self.performance_history[-1].end_date.isoformat() if self.performance_history else None
        }


if __name__ == "__main__":
    # Test
    selector = SimpleAdaptiveSelector()
    
    print("🧪 Testing Simple Adaptive Selector...")
    print(f"Initial model: {selector.get_current_model().split('/')[-1]}")
    
    # Simulate poor performance
    fake_trades = [
        {"symbol": "CIB", "action": "BUY", "pnl": -500, "timestamp": "2024-01-01T10:00:00Z"},
        {"symbol": "COMI", "action": "BUY", "pnl": -300, "timestamp": "2024-01-05T10:00:00Z"},
        {"symbol": "HDB", "action": "BUY", "pnl": 200, "timestamp": "2024-01-10T10:00:00Z"},
        {"symbol": "OCDI", "action": "BUY", "pnl": -100, "timestamp": "2024-01-15T10:00:00Z"},
    ]
    
    current_date = datetime(2024, 2, 1)
    new_model, reason = selector.evaluate_and_switch(
        current_date=current_date,
        trades_history=fake_trades,
        current_capital=99300,  # Lost 700
        initial_capital=100000
    )
    
    print(f"\nAfter evaluation:")
    print(f"  Model: {new_model.split('/')[-1]}")
    print(f"  Reason: {reason}")
    print(f"\nSummary: {selector.get_performance_summary()}")
    
    print("\n✅ Test complete!")
