# التصميم: توحيد منطق التدريب والـ Live Bot والاختبار

## المعمارية العامة

```
┌─────────────────────────────────────────┐
│   Unified Trading Logic Module          │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────────┐  │
│  │  TradingParameters (dataclass)   │  │
│  │  - entry_mode                    │  │
│  │  - look_forward_days             │  │
│  │  - target_pct, stop_loss_pct     │  │
│  │  - volume_confirmation           │  │
│  │  - thresholds (king, council)    │  │
│  └──────────────────────────────────┘  │
│                   ▲                     │
│                   │                     │
│  ┌────────────────┼────────────────┐   │
│  │ TripleBarrier  │ FeatureEngine  │   │
│  │ Logic          │ Consistency    │   │
│  └────────────────┼────────────────┘   │
│                   │                     │
│  ┌────────────────┼─────────────────────┐
│  │ Shared by:     │                     │
│  │ - Training     │                     │
│  │ - Live Bot     │                     │
│  │ - Backtest     │                     │
│  └────────────────┼─────────────────────┘
│                   │                     │
└─────────────────────────────────────────┘
       ▲            ▲            ▲
       │            │            │
   Training     Live Bot     Backtest
```

## 1. Module جديد: `api/trading_config.py`

يحتوي على:

### TradingParameters Dataclass
```python
@dataclass
class TradingParameters:
    """Unified trading parameters used across training, live bot, backtest"""
    
    # Entry Logic
    entry_mode: str = "next_open"  # "next_open" | "current_close"
    entry_buffer_pct: float = 0.001  # slippage/spread assumption
    
    # Time Horizon
    look_forward_days: int = 20
    look_forward_mode: str = "fixed"  # "fixed" | "atr_based"
    
    # Barrier Mode
    barrier_mode: str = "percent"  # "percent" | "atr_multiplier"
    target_pct: float = 0.10  # 10% target OR 2.5x ATR multiplier
    stop_loss_pct: float = 0.05  # 5% SL OR 1.5x ATR multiplier
    
    # Volume Confirmation (خاص بـ EGX)
    require_volume_confirmation: bool = False
    min_volume_ratio: float = 0.3  # volume must be >= MA_20 * ratio
    volume_confirmation_period: int = 5  # days to confirm volume
    
    # Thresholds
    king_threshold: float = 0.50  # primary model threshold
    council_threshold: float = 0.50  # council consensus threshold
    validator_threshold: float = 0.50  # validator approval threshold
    
    # Feature Engineering
    min_history_needed: int = 100  # bars needed before prediction
    warmup_bars: int = 100  # bars to skip at start
    feature_lookback: int = 252  # lookback for some indicators
    
    # Risk Management
    max_consecutive_losses: int = 5
    daily_loss_limit: float = 1000.0
    
    @classmethod
    def from_model_artifact(cls, artifact: dict) -> "TradingParameters":
        """استخلاص parameters من model artifact"""
        params = cls()
        
        pm = artifact.get("primary_model", {})
        
        # حفظ القيم من artifact
        params.entry_mode = artifact.get("entry_mode", "next_open")
        params.barrier_mode = artifact.get("barrier_mode", "percent")
        params.look_forward_days = artifact.get("look_forward_days", 20)
        params.target_pct = artifact.get("target_pct", 0.10)
        params.stop_loss_pct = artifact.get("stop_loss_pct", 0.05)
        params.king_threshold = artifact.get("optimal_threshold", 0.50)
        params.council_threshold = artifact.get("council_threshold", 0.50)
        params.require_volume_confirmation = artifact.get("require_volume_confirmation", False)
        
        return params
    
    def to_dict(self) -> dict:
        """تحويل إلى dictionary للحفظ في model artifact"""
        return asdict(self)
```

## 2. Module جديد: `api/unified_labeling.py`

يحتوي على:

### TripleBarrierLabeler
```python
class TripleBarrierLabeler:
    """
    Unified triple barrier labeling logic.
    Used in Training, Backtest, and Live Bot evaluation.
    """
    
    def __init__(self, params: TradingParameters):
        self.params = params
    
    def calculate_barriers(
        self, 
        entry_price: float,
        atr: float,
        barrier_mode: str = None
    ) -> Tuple[float, float]:
        """
        حساب Take Profit و Stop Loss barriers
        Returns: (tp_price, sl_price)
        """
        mode = barrier_mode or self.params.barrier_mode
        
        if mode == "percent":
            tp = entry_price * (1 + self.params.target_pct)
            sl = entry_price * (1 - self.params.stop_loss_pct)
        else:  # atr_multiplier
            tp = entry_price + (atr * self.params.target_pct)
            sl = entry_price - (atr * self.params.stop_loss_pct)
        
        return tp, sl
    
    def label_single_trade(
        self,
        entry_idx: int,
        high_window: np.ndarray,
        low_window: np.ndarray,
        volume_window: np.ndarray = None,
        volume_ma_20: float = None,
    ) -> int:
        """
        Label whether trade would be WIN (1) or LOSS (0)
        
        Returns:
            1 if TP hit before SL (and volume confirmed if required)
            0 otherwise
        """
        if not hasattr(self, '_cached_barriers'):
            raise ValueError("Must call calculate_barriers first")
        
        tp, sl = self._cached_barriers
        
        tp_hit = np.any(high_window >= tp)
        sl_hit = np.any(low_window <= sl)
        
        if not tp_hit:
            return 0  # SL hit or neither hit
        
        if sl_hit:
            # Both hit, check which first
            tp_idx = np.argmax(high_window >= tp)
            sl_idx = np.argmax(low_window <= sl)
            if sl_idx <= tp_idx:
                return 0
        
        # TP hit first, check volume if required
        if self.params.require_volume_confirmation and volume_window is not None:
            if volume_ma_20 is None or volume_ma_20 <= 0:
                return 1
            avg_volume = np.mean(volume_window)
            if avg_volume < volume_ma_20 * self.params.min_volume_ratio:
                return 0
        
        return 1
    
    def backtest_trade(
        self,
        entry_price: float,
        entry_bars_ahead: np.ndarray,  # bars from entry onwards
        atr: float,
    ) -> Dict[str, Any]:
        """
        محاكاة trade واحد كامل.
        Returns: {
            "outcome": "TP_HIT" | "SL_HIT" | "HOLD",
            "exit_price": float,
            "exit_bars": int,
            "pnl_pct": float
        }
        """
        tp, sl = self.calculate_barriers(entry_price, atr)
        
        for i, bar in enumerate(entry_bars_ahead):
            high = bar.get('high')
            low = bar.get('low')
            
            if i >= self.params.look_forward_days:
                return {
                    "outcome": "HOLD",
                    "exit_price": bar.get('close'),
                    "exit_bars": i,
                    "pnl_pct": ((bar.get('close') - entry_price) / entry_price) * 100
                }
            
            if high >= tp:
                return {
                    "outcome": "TP_HIT",
                    "exit_price": tp,
                    "exit_bars": i,
                    "pnl_pct": ((tp - entry_price) / entry_price) * 100
                }
            
            if low <= sl:
                return {
                    "outcome": "SL_HIT",
                    "exit_price": sl,
                    "exit_bars": i,
                    "pnl_pct": ((sl - entry_price) / entry_price) * 100
                }
        
        return {
            "outcome": "TIMEOUT",
            "exit_price": entry_bars_ahead[-1].get('close'),
            "exit_bars": len(entry_bars_ahead),
            "pnl_pct": 0.0
        }
```

## 3. Module جديد: `api/unified_features.py`

يحتوي على:

### FeatureEngineeringManager
```python
class FeatureEngineeringManager:
    """
    Ensures consistent feature engineering across Training, Live Bot, Backtest.
    """
    
    def __init__(self, params: TradingParameters):
        self.params = params
    
    def check_data_ready(self, bars: pd.DataFrame) -> Tuple[bool, str]:
        """
        التحقق من أن البيانات كافية للتنبؤ
        Returns: (is_ready, message)
        """
        if len(bars) < self.params.min_history_needed:
            return False, f"Need {self.params.min_history_needed} bars, got {len(bars)}"
        
        # تحقق من عدم وجود NaN كثيرة
        nan_pct = bars.isna().sum().sum() / (len(bars) * len(bars.columns))
        if nan_pct > 0.1:
            return False, f"Too many NaNs: {nan_pct:.1%}"
        
        return True, "Ready"
    
    def get_warmup_skip(self) -> int:
        """كم bar يجب تخطيه في البداية"""
        return max(
            self.params.warmup_bars,
            self.params.min_history_needed,
            self.params.feature_lookback
        )
    
    def validate_features(
        self, 
        X: pd.DataFrame,
        expected_features: List[str]
    ) -> Tuple[bool, List[str]]:
        """
        التحقق من أن features متوفرة وصحيحة
        Returns: (is_valid, missing_features)
        """
        missing = []
        for feat in expected_features:
            if feat not in X.columns:
                missing.append(feat)
            elif X[feat].isna().all():
                missing.append(f"{feat} (all NaN)")
        
        return len(missing) == 0, missing
```

## 4. تعديل Model Artifact Structure

```python
# عند حفظ النموذج، أضف metadata:
artifact = {
    "kind": "meta_labeling_system",
    "version": "2.0",  # version unified
    
    # === Unified Trading Parameters ===
    "trading_parameters": {
        "entry_mode": "next_open",
        "look_forward_days": 20,
        "barrier_mode": "percent",
        "target_pct": 0.10,
        "stop_loss_pct": 0.05,
        "require_volume_confirmation": False,
        "min_volume_ratio": 0.3,
    },
    
    # === Thresholds ===
    "thresholds": {
        "optimal_threshold": 0.55,  # from training
        "king_threshold": 0.55,
        "council_threshold": 0.50,
        "validator_threshold": 0.50,
    },
    
    # === Feature Requirements ===
    "feature_requirements": {
        "min_history_needed": 100,
        "warmup_bars": 100,
        "expected_features": [...],
        "categorical_features": [...],
    },
    
    # === Model Components ===
    "primary_model": {...},
    "meta_model": {...},
    "council_models": {...},
    
    # === Data Leakage Prevention ===
    "training_config": {
        "n_splits": 3,
        "embargo_pct": 0.01,
        "purged_kfold": True,
    },
    
    # === Live Performance Tracking ===
    "performance": {
        "training_precision": 0.65,
        "training_recall": 0.60,
        "validation_auc": 0.72,
        "backtest_sharpe": 1.5,
    }
}
```

## 5. معايير التقييم

### Consistency Metrics
```python
consistency_score = {
    "entry_price_alignment": 0.98,  # نسبة توافق entry prices
    "tp_sl_alignment": 0.97,        # نسبة توافق barriers
    "feature_drift": 0.05,          # drift في توزيع features
    "threshold_usage": 0.96,        # نسبة استخدام نفس thresholds
    "lookback_alignment": 1.0,      # exact match في lookback
}

# درجة نهائية
overall_consistency = np.mean([v for v in consistency_score.values()])
# يجب أن تكون >= 0.95
```

### Data Leakage Detection
```python
leakage_check = {
    "future_data_used": False,      # لا يتم استخدام data من المستقبل
    "entry_timing_correct": True,   # entry يستخدم shift صحيح
    "look_forward_respected": True, # لا يتم النظر بعد look_forward
}
```

## 6. الملفات التي ستتم تعديلها

1. **api/train_exchange_model.py**
   - import من unified modules
   - استخدام TradingParameters
   - حفظ metadata موحد

2. **api/live_bot.py**
   - load TradingParameters من model artifact
   - استخدام TripleBarrierLabeler
   - استخدام FeatureEngineeringManager

3. **api/backtest_radar.py**
   - استخدام TradingParameters
   - استخدام TripleBarrierLabeler
   - تطبيق نفس entry_price logic

4. **api/council_validator.py**
   - استخدام TradingParameters للـ volume confirmation

5. **api/stock_ai.py**
   - استخدام TradingParameters في predict pipeline

## النتائج

✅ توحيد كامل في:
- Entry Price Logic
- Look-Forward Period
- Volume Confirmation
- Threshold Management
- Feature Engineering
- Data Leakage Prevention

✅ سهولة:
- Debugging
- Testing
- Model Reproducibility
- Performance Tracking
