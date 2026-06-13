# 🎯 خارطة طريق تحسين الـPrecision - من 55% إلى 65%+

**الهدف:** رفع دقة التنبؤات من ~55% إلى 65%+ مع الحفاظ على 5-20 إشارة/شهر  
**التاريخ:** 13 يونيو 2026  
**الحالة:** ✅ جاهز للتنفيذ

---

## 📊 الوضع الحالي vs المستهدف

| **المعيار** | **الحالي** | **المستهدف** | **الفرق** |
|------------|-----------|-------------|----------|
| **Precision** | ~55% | **65%+** | +10 نقاط |
| **Signals/Month** | غير محدد | **10-15** | مضبوط |
| **F1 Score** | 0.337 | **0.45+** | +0.11 |
| **Win Rate** | غير معروف | **62%+** | تحقق |
| **Max Drawdown** | غير معروف | **< 15%** | تحكم |

---

## 🔄 الـWorkflow الكامل - 4 مراحل

```
المرحلة 1: Strict Labeling
    ↓
المرحلة 2: Confidence-Filtered Training
    ↓
المرحلة 3: Threshold Calibration
    ↓
المرحلة 4: Walk-Forward Validation
```

---

## 📋 المرحلة 1: Strict Labeling (الأساس)

### المشكلة الحالية:
```python
# الـlabeling الحالي بيقول:
Target = 1  # إذا السهم وصل +2 ATR في 20 يوم

# المشكلة:
- ممكن السهم وصل بعد 19 يوم (متأخر جداً)
- ممكن وصل لكن الـvolume ضعيف (مش حقيقي)
- ممكن السهم على الحد اليومي (circuit breaker)
- ممكن السوق في حالة panic (مش وقت شراء)
```

### الحل: Strict Labeling
```python
# unified_labeling.py - تعديل StrictQualityLabeler

class StrictQualityLabeler:
    """
    Strict labeling - بس الإشارات المثالية
    """
    
    def __init__(self, trading_params: TradingParameters):
        self.target_pct = trading_params.target_pct
        self.stop_loss_pct = trading_params.stop_loss_pct
        self.look_forward_days = trading_params.look_forward_days
        
        # Strict thresholds
        self.max_days_to_tp = min(10, self.look_forward_days // 2)  # نص المدة بس
        self.min_volume_ratio = 1.3   # Volume > SMA * 1.3
        self.max_circuit_breaker_days = 0  # مفيش circuit breaker خالص
        self.max_market_drawdown = -0.02   # EGX30 مش نازل 2%+
    
    def is_strict_quality(self, row, df_symbol, index_df=None):
        """
        Check if this is a strict quality signal
        
        Returns:
            bool: True if passes ALL strict filters
        """
        filters = []
        
        # Filter 1: TP hit before SL
        tp_hit_first = row.get('TP_HIT', False) and not row.get('SL_HIT', False)
        filters.append(('TP before SL', tp_hit_first))
        
        # Filter 2: TP within max days
        days_to_tp = row.get('DAYS_TO_BARRIER', 999)
        within_days = days_to_tp <= self.max_days_to_tp
        filters.append(('Within 10 days', within_days))
        
        # Filter 3: Volume confirmation
        volume = row.get('Volume', 0)
        volume_sma = row.get('Volume_SMA_20', volume)
        volume_conf = volume > (volume_sma * self.min_volume_ratio)
        filters.append(('Volume confirmed', volume_conf))
        
        # Filter 4: No circuit breaker
        circuit_breaker = row.get('feat_circuit_breaker', 0) == 1
        no_circuit = not circuit_breaker
        filters.append(('No circuit breaker', no_circuit))
        
        # Filter 5: Market not in panic
        market_ok = True
        if index_df is not None:
            # Check if EGX30 was falling
            signal_date = row.get('date')
            recent_index = index_df[index_df['date'] <= signal_date].tail(5)
            
            if len(recent_index) >= 2:
                index_return = (recent_index['Close'].iloc[-1] / 
                               recent_index['Close'].iloc[0] - 1)
                market_ok = index_return > self.max_market_drawdown
        
        filters.append(('Market not panic', market_ok))
        
        # All filters must pass
        all_passed = all(passed for _, passed in filters)
        
        # Log rejections (optional)
        if not all_passed:
            failed = [name for name, passed in filters if not passed]
            # print(f"Rejected: {row.get('symbol')} on {row.get('date')}: {failed}")
        
        return all_passed
    
    def apply_strict_filter(self, df_labeled):
        """
        Apply strict quality filter to labeled data
        
        Returns:
            df with Target modified based on strict criteria
        """
        # Make copy
        df = df_labeled.copy()
        
        # Group by symbol
        strict_targets = []
        
        for symbol, group in df.groupby('symbol'):
            group = group.sort_values('date').reset_index(drop=True)
            
            for idx, row in group.iterrows():
                original_target = row['Target']
                
                # If originally 0, keep 0
                if original_target == 0:
                    strict_targets.append(0)
                    continue
                
                # If originally 1, check strict quality
                if self.is_strict_quality(row, group):
                    strict_targets.append(1)
                else:
                    strict_targets.append(0)  # Demote to 0
        
        df['Target'] = strict_targets
        
        return df
```

### التطبيق:
```python
# في train_exchange_model.py

# بعد الـlabeling العادي:
labeler = TripleBarrierLabeler(trading_params)
df_labeled = labeler.create_labels(df_features)

# أضف الـstrict filter:
strict_labeler = StrictQualityLabeler(trading_params)
df_strict = strict_labeler.apply_strict_filter(df_labeled)

# النتيجة المتوقعة:
# Positive rate: من 30% → 12-15% (أقل بكتير لكن أدق)
```

**التأثير المتوقع:**
- Positive samples: من 30% → 12-15%
- Precision: من 55% → 62%+ (estimated)
- Signals/month: من غير محدود → 8-12

---

## 📋 المرحلة 2: Confidence-Filtered Training

### الهدف:
درّب الموديل على optimize الـProfit Factor مش الـF1

### التعديل في Optuna:
```python
# في train_exchange_model.py - objective function

def objective(trial):
    # ... parameters ...
    
    # Train model
    model = LGBMClassifier(...)
    model.fit(X_train, y_train)
    
    # Validate
    y_proba = model.predict_proba(X_val)[:, 1]
    
    # Calibrate threshold
    best_threshold = 0.5
    best_profit_factor = 0
    
    for threshold in np.arange(0.3, 0.8, 0.05):
        y_pred = (y_proba >= threshold).astype(int)
        
        # Metrics
        tp = ((y_pred == 1) & (y_val == 1)).sum()
        fp = ((y_pred == 1) & (y_val == 0)).sum()
        
        if tp + fp == 0:
            continue
        
        precision = tp / (tp + fp)
        
        # Signals per month
        total_signals = (y_pred == 1).sum()
        signals_per_month = total_signals / n_months
        
        # Reject if too many or too few signals
        if signals_per_month < 5 or signals_per_month > 20:
            continue
        
        # Reject if precision too low
        if precision < 0.58:
            continue
        
        # Calculate profit factor
        avg_win = 0.04   # +2 ATR ≈ 4%
        avg_loss = 0.02  # -1 ATR ≈ 2%
        
        profit_factor = (precision * avg_win) / ((1 - precision) * avg_loss)
        
        if profit_factor > best_profit_factor:
            best_profit_factor = profit_factor
            best_threshold = threshold
    
    # Return profit factor (not F1!)
    return best_profit_factor if best_profit_factor > 0 else -999
```

**الفرق الجوهري:**
```python
# قبل:
return f1_score(y_val, y_pred)  # Optimize F1

# بعد:
return profit_factor  # Optimize Profit
```

**التأثير المتوقع:**
- الموديل هيتعلم يختار الإشارات الأربح مش الأكتر
- Precision: +3-5 نقاط
- Signals: أقل لكن أجود

---

## 📋 المرحلة 3: Threshold Calibration

### استخدام السكريبت:
```bash
# على الموديل الحالي
python api/calibrate_threshold.py \
  --model_path api/models/model_EGX_0.pkl \
  --exchange EGX \
  --months_back 6 \
  --min_precision 0.58

# النتيجة:
# جدول بكل thresholds من 0.1 → 0.9
# مع Precision, Signals/Month, Profit Factor

# مثال:
# Threshold | Precision | Sig/Month | Profit Factor
#   0.40    |   60.2%   |    18.5   |     1.82
#   0.50    |   64.1%   |    11.2   |     2.14  ⭐
#   0.60    |   68.5%   |     6.7   |     2.51  ⭐⭐
```

### الاختيار الذكي:
```python
# استراتيجيات مختلفة:

# Conservative (آمن):
threshold = 0.60  # Precision عالي، signals قليلة

# Balanced (متوازن):
threshold = 0.50  # Precision كويس، signals معقولة

# Aggressive (عدواني):
threshold = 0.40  # Precision مقبول، signals كتيرة
```

**التأثير المتوقع:**
- Precision: +5-8 نقاط (من تعديل threshold فقط)
- Signals: مضبوطة حسب الاستراتيجية

---

## 📋 المرحلة 4: Walk-Forward Validation

### الهدف:
تأكد إن الموديل stable عبر الزمن

### التطبيق:
```python
# في train_exchange_model.py

def walk_forward_validation(df, n_splits=4):
    """
    Split data into growing train + test splits
    """
    results = []
    
    # Sort by date
    df = df.sort_values('date')
    total_samples = len(df)
    
    for i in range(n_splits):
        # Calculate split points
        train_end = int(total_samples * (0.6 + i * 0.1))
        test_start = train_end
        test_end = int(total_samples * (0.7 + i * 0.1))
        
        if test_end > total_samples:
            test_end = total_samples
        
        # Split
        train_data = df.iloc[:train_end]
        test_data = df.iloc[test_start:test_end]
        
        train_period = f"{train_data['date'].min()} to {train_data['date'].max()}"
        test_period = f"{test_data['date'].min()} to {test_data['date'].max()}"
        
        # Train model
        X_train = train_data[feature_cols]
        y_train = train_data['Target']
        X_test = test_data[feature_cols]
        y_test = test_data['Target']
        
        model = LGBMClassifier(...)
        model.fit(X_train, y_train)
        
        # Evaluate
        y_proba = model.predict_proba(X_test)[:, 1]
        
        # Find best threshold for this split
        best_threshold, metrics = calibrate_threshold(y_test, y_proba)
        
        results.append({
            'split_index': i,
            'train_period': train_period,
            'test_period': test_period,
            'threshold': best_threshold,
            'precision': metrics['precision'],
            'signals_per_month': metrics['signals_per_month'],
            'profit_factor': metrics['profit_factor']
        })
    
    return results

# تحليل النتائج
wf_results = walk_forward_validation(df_labeled, n_splits=4)

# Statistics
precisions = [r['precision'] for r in wf_results]
avg_precision = np.mean(precisions)
std_precision = np.std(precisions)

print(f"Walk-Forward Precision: {avg_precision:.1%} ± {std_precision:.1%}")

# معايير القبول:
# ✅ Avg Precision >= 60%
# ✅ Std Precision <= 5%
# ✅ Min Precision >= 55%
```

**التأثير المتوقع:**
- Stability: نتأكد إن الموديل مش overfitting على period معين
- Confidence: ثقة أعلى في النتائج المستقبلية

---

## 🎯 المراحل العملية - خطوة بخطوة

### **الأسبوع 1: Threshold Calibration (بدون إعادة تدريب)**
```bash
# اليوم 1-2: Calibrate الموديل الحالي
python api/calibrate_threshold.py --model_path api/models/model_EGX_0.pkl

# اليوم 3-4: Backtest بالـthreshold الجديد
python api/backtest_radar.py \
  --model_path api/models/model_EGX_0.pkl \
  --threshold 0.55 \
  --capital 100000

# اليوم 5-7: Paper trading بالـthreshold المعدّل
python api/live_bot.py \
  --execution_mode VIRTUAL \
  --model_path api/models/model_EGX_0.pkl \
  --threshold 0.55
```

**المتوقع:** Precision من 55% → 58-60% (فقط من threshold)

---

### **الأسبوع 2: Strict Labeling**
```bash
# اليوم 1-2: تطبيق StrictQualityLabeler
# تعديل unified_labeling.py
# إضافة strict filters

# اليوم 3-5: إعادة التدريب
python api/train_exchange_model.py \
  --exchange EGX \
  --use_strict_labeling \
  --n_trials 100

# اليوم 6-7: تقييم الموديل الجديد
python api/validate_model.py --model_path api/models/model_EGX_strict.pkl
python api/calibrate_threshold.py --model_path api/models/model_EGX_strict.pkl
```

**المتوقع:** Precision من 58-60% → 62-65%

---

### **الأسبوع 3: Confidence-Filtered Training**
```bash
# اليوم 1-3: تعديل Optuna objective
# تغيير من F1 → Profit Factor

# اليوم 4-6: التدريب بالـobjective الجديد
python api/train_exchange_model.py \
  --exchange EGX \
  --use_strict_labeling \
  --optimize_profit_factor \
  --n_trials 150

# اليوم 7: تقييم نهائي
python api/validate_model.py --model_path api/models/model_EGX_final.pkl
```

**المتوقع:** Precision من 62-65% → 65-68%

---

### **الأسبوع 4: Walk-Forward Validation & Paper Trading**
```bash
# اليوم 1-2: Walk-forward validation
python api/train_exchange_model.py \
  --exchange EGX \
  --walk_forward_splits 4 \
  --use_strict_labeling

# اليوم 3-7: Paper trading مكثف
python api/live_bot.py \
  --execution_mode VIRTUAL \
  --model_path api/models/model_EGX_final.pkl \
  --log_all_decisions
```

**المتوقع:** Validation على stability قبل live deployment

---

## 📊 Compound Confidence System

### المفهوم:
```python
# بدل threshold واحد:
if king_confidence >= 0.55:
    trade()

# استخدم compound confidence:
compound = (
    king_confidence * 0.4 +           # وزن أساسي
    council_confidence * 0.3 +         # تأكيد من council
    volume_score * 0.2 +               # volume confirmation
    market_regime_score * 0.1          # market not panic
)

if compound >= threshold:
    trade()
```

### التطبيق:
```python
# في live_bot.py

def calculate_compound_confidence(
    king_conf: float,
    council_conf: float,
    volume_ratio: float,
    market_regime: str
) -> float:
    """
    Calculate compound confidence from multiple sources
    """
    # Volume score (0-1)
    volume_score = min(volume_ratio / 1.5, 1.0)  # 1.5x = full score
    
    # Market regime score
    regime_scores = {
        "BULL": 1.0,
        "SIDEWAYS": 0.7,
        "BEAR": 0.3
    }
    market_score = regime_scores.get(market_regime, 0.5)
    
    # Compound
    compound = (
        king_conf * 0.40 +
        council_conf * 0.30 +
        volume_score * 0.20 +
        market_score * 0.10
    )
    
    return compound


def should_trade(symbol_data, market_regime):
    """
    Decide if we should trade based on compound confidence
    """
    # Get individual confidences
    king_conf = symbol_data['king_confidence']
    council_conf = symbol_data.get('council_confidence', king_conf)
    volume_ratio = symbol_data['Volume'] / symbol_data['Volume_SMA_20']
    
    # Calculate compound
    compound = calculate_compound_confidence(
        king_conf, council_conf, volume_ratio, market_regime
    )
    
    # Regime-dependent thresholds
    thresholds = {
        "BULL": 0.45,      # أسهل في BULL
        "SIDEWAYS": 0.55,  # متوسط
        "BEAR": 0.70       # صعب جداً في BEAR
    }
    
    threshold = thresholds.get(market_regime, 0.55)
    
    return compound >= threshold, compound
```

**التأثير المتوقع:**
- في BULL market: إشارات أكتر، threshold أقل
- في BEAR market: إشارات أقل جداً، threshold عالي
- Overall precision: +3-5 نقاط من الفلترة الذكية

---

## 📈 الأرقام المستهدفة النهائية

| **المعيار** | **قبل** | **بعد الأسبوع 1** | **بعد الأسبوع 2** | **بعد الأسبوع 3** | **الهدف النهائي** |
|------------|--------|----------------|----------------|----------------|-----------------|
| **Precision** | 55% | 58-60% | 62-65% | 65-68% | **68%+** |
| **Signals/Month** | غير محدد | 15-20 | 10-15 | 8-12 | **10-12** |
| **F1 Score** | 0.337 | 0.38 | 0.42 | 0.48 | **0.50+** |
| **Profit Factor** | غير معروف | 1.5 | 1.8 | 2.2 | **2.0+** |
| **Win Rate** | غير معروف | 58% | 62% | 66% | **65%+** |

---

## ✅ Checklist التنفيذ

### الأسبوع 1: Quick Wins
- [ ] تشغيل calibrate_threshold.py على model_EGX_0.pkl
- [ ] اختيار threshold مناسب (0.50-0.60)
- [ ] Backtest بالـthreshold الجديد
- [ ] Paper trading لمدة 3-5 أيام
- [ ] قياس Precision الفعلي

### الأسبوع 2: Strict Labeling
- [ ] تطبيق StrictQualityLabeler في unified_labeling.py
- [ ] إعادة تدريب الموديل
- [ ] Validate الموديل الجديد
- [ ] Calibrate threshold للموديل الجديد
- [ ] مقارنة مع الموديل القديم

### الأسبوع 3: Advanced Training
- [ ] تعديل Optuna objective → Profit Factor
- [ ] التدريب بالـobjective الجديد
- [ ] Walk-forward validation (4 splits)
- [ ] تحليل stability
- [ ] اختيار الموديل الأفضل

### الأسبوع 4: Final Validation
- [ ] Paper trading مكثف (7 أيام)
- [ ] قياس Precision, Signals, Win Rate
- [ ] مقارنة مع Benchmark (EGX30)
- [ ] تحليل Max Drawdown
- [ ] اتخاذ قرار Go-Live أو تحسين إضافي

---

## 🚨 Red Flags - متى تتوقف

### خلال التنفيذ:
- ❌ **Precision < 50%** في paper trading → توقف فوراً
- ❌ **Signals < 3/month** → Threshold عالي جداً
- ❌ **Max Drawdown > 20%** → Risk management سيء
- ❌ **Win Rate < 45%** → الموديل مش شغال

### خلال التدريب:
- ❌ **Walk-forward F1 < 0.35** → الموديل ضعيف
- ❌ **Positive rate < 5%** → Strict labeling مبالغ فيه
- ❌ **Training time > 8 hours** → Parameters غلط

---

## 💡 نصائح إضافية

### 1. ابدأ بالـQuick Wins:
الـthreshold calibration ممكن يعطيك +5 نقاط في يومين بدون إعادة تدريب

### 2. Test incrementally:
كل تعديل اعمله backtest + paper trade قبل ما تكمل

### 3. Document everything:
سجّل كل تجربة - النتائج، الـparameters، المشاكل

### 4. Compare with baseline:
دايماً قارن الموديل الجديد بالـbaseline (model_EGX_0.pkl)

### 5. Don't overfit:
لو شفت نتائج "perfect" (Precision > 85%)، افحص data leakage

---

## 📁 الملفات المطلوبة

### الموجودة:
- ✅ `api/validate_model.py` - جاهز
- ✅ `api/calibrate_threshold.py` - جاهز
- ✅ `MODEL_VALIDATION_SUMMARY.md` - جاهز

### المطلوب إنشاؤها:
- [ ] `api/unified_labeling.py` - إضافة StrictQualityLabeler
- [ ] `api/train_exchange_model.py` - تعديل Optuna objective
- [ ] `api/live_bot.py` - إضافة Compound Confidence

---

**الخلاصة:** الخطة واضحة، الأدوات جاهزة، والهدف realistic. ابدأ بالـthreshold calibration وشوف النتائج فوراً!

**إعداد:** Kiro AI Agent  
**التاريخ:** 13 يونيو 2026  
**الحالة:** ✅ **جاهز للتنفيذ - البداية من الأسبوع 1**
