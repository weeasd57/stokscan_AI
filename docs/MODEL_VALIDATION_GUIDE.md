# 🔍 دليل اختبار الموديلات بشكل احترافي

**الهدف:** معرفة إذا الموديلات فعلاً شغالة كويس ولا لأ  
**التاريخ:** 12 يونيو 2026

---

## 📋 الخلاصة السريعة

### الطرق الذكية للتأكد من جودة الموديل:

1. ✅ **Walk-Forward Validation** (الأذكى) - F1 stable across splits?
2. ✅ **Out-of-Sample Backtest** - يربح على بيانات جديدة؟
3. ✅ **Benchmark Comparison** - أحسن من Buy & Hold؟
4. ✅ **Paper Trading** - يشتغل على السوق الحقيقي؟
5. ✅ **Stress Testing** - يصمد في الأزمات؟
6. ✅ **Feature Importance** - يستخدم features منطقية؟
7. ✅ **Prediction Consistency** - مستقر ولا متقلب؟

---

## 🎯 المستوى 1: Basic Validation (سريع - 10 دقائق)

### ✅ Test 1: Check Walk-Forward Results

**ليه مهم:** إذا الموديل شغال كويس في كل split، يبقى stable

**كيف:**
```python
# بعد التدريب، افحص:
artifact = pickle.load(open("api/models/KING.pkl", "rb"))

# 1. شوف walk-forward summary
wf_summary = artifact.get("walk_forward_summary", {})
print(f"Average F1: {wf_summary.get('average_f1', 0):.3f}")
print(f"Std F1: {wf_summary.get('std_f1', 0):.3f}")
print(f"Min F1: {wf_summary.get('min_f1', 0):.3f}")
print(f"Max F1: {wf_summary.get('max_f1', 0):.3f}")

# 2. شوف كل split
splits = artifact.get("walk_forward_splits_results", [])
for split in splits:
    print(f"Split {split['split_index']}: "
          f"Test {split['test_period']} - "
          f"F1={split['f1']:.3f}, "
          f"Precision={split['precision']:.3f}")
```

**معايير النجاح:**
```python
✅ Average F1 >= 0.45
✅ Std F1 <= 0.08 (مش متقلب جداً)
✅ Min F1 >= 0.35 (مفيش split سيء جداً)
✅ Max F1 <= Average F1 + 0.15 (مفيش overfitting)
```

**إذا فشل:**
- ⚠️ F1 < 0.40 → الموديل ضعيف، جرب features/parameters تانية
- ⚠️ Std F1 > 0.10 → الموديل مش مستقر، جرب regularization أقوى
- ⚠️ Max - Min > 0.30 → في overfitting على split معين

---

### ✅ Test 2: Check Training vs Validation Gap

**ليه مهم:** Gap كبير = overfitting

**كيف:**
```python
# شوف final metrics
train_f1 = artifact.get("train_f1", 0)
val_f1 = artifact.get("f1", 0)
gap = train_f1 - val_f1

print(f"Training F1: {train_f1:.3f}")
print(f"Validation F1: {val_f1:.3f}")
print(f"Gap: {gap:.3f}")
```

**معايير النجاح:**
```python
✅ Gap <= 0.10 (acceptable overfitting)
✅ Gap <= 0.05 (excellent generalization)
```

**إذا فشل:**
- ⚠️ Gap > 0.15 → Overfitting واضح
- 💡 **الحل:** زود regularization (lambda_l1, lambda_l2)
- 💡 **الحل:** قلل max_depth
- 💡 **الحل:** زود min_child_weight

---

### ✅ Test 3: Check Class Balance

**ليه مهم:** إذا الموديل بيتنبأ بكل شيء positive أو negative، يبقى مش شغال

**كيف:**
```python
# Load model and test on validation data
import pickle
import numpy as np

artifact = pickle.load(open("api/models/KING.pkl", "rb"))
# Assume you have X_test, y_test prepared

y_pred = (artifact['model'].predict_proba(X_test)[:, 1] > 0.55).astype(int)

print(f"Actual Positives: {y_test.sum()} ({y_test.mean():.1%})")
print(f"Predicted Positives: {y_pred.sum()} ({y_pred.mean():.1%})")
```

**معايير النجاح:**
```python
✅ Predicted positive rate: 20-60%
✅ Not all 0s or all 1s
```

**إذا فشل:**
- ⚠️ All predictions = 0 → Threshold عالي جداً أو موديل ضعيف
- ⚠️ All predictions = 1 → Threshold واطي جداً
- 💡 **الحل:** Adjust threshold or retrain

---

## 🎯 المستوى 2: Out-of-Sample Backtest (متوسط - 30 دقيقة)

### ✅ Test 4: Backtest على Holdout Period

**ليه مهم:** التدريب شيء، والحقيقة شيء تاني

**كيف:**
```bash
# 1. احفظ آخر 3 شهور كـholdout (مش للتدريب خالص)
# 2. درب الموديل على البيانات حتى 2024-03-01
# 3. اعمل backtest من 2024-03-01 حتى 2024-06-01

python api/backtest_radar.py \
  --model_path api/models/KING.pkl \
  --exchange EGX \
  --start_date 2024-03-01 \
  --end_date 2024-06-01 \
  --capital 100000 \
  --threshold 0.55
```

**معايير النجاح:**
```python
✅ Total Return > 0% (مربح)
✅ Win Rate >= 45% (بعد العمولات)
✅ Max Drawdown < 15%
✅ Sharpe Ratio > 0.5
✅ Average Win > Average Loss
```

**إذا فشل:**
- ⚠️ Return < 0% → الموديل خاسر
- ⚠️ Win Rate < 40% → Precision ضعيف
- ⚠️ Max DD > 20% → Risk management سيء
- 💡 **الحل:** Retrain with better parameters or features

---

### ✅ Test 5: Compare with Benchmark

**ليه مهم:** الموديل لازم يكون أحسن من Buy & Hold

**كيف:**
```python
# في نتائج الـbacktest، قارن:
model_return = backtest_results['total_return']
benchmark_return = backtest_results['benchmark_return']  # EGX30

print(f"Model Return: {model_return:.2%}")
print(f"EGX30 Return: {benchmark_return:.2%}")
print(f"Alpha: {model_return - benchmark_return:.2%}")
```

**معايير النجاح:**
```python
✅ Model Return > Benchmark Return (outperformance)
✅ Alpha > 5% (substantial outperformance)
✅ Sharpe Ratio > Benchmark Sharpe
```

**إذا فشل:**
- ⚠️ Model < Benchmark → الموديل مش مفيد، استخدم ETF
- 💡 **الحل:** Improve features or strategy
- 💡 **الحل:** Focus on high-conviction signals only

---

## 🎯 المستوى 3: Paper Trading (قوي - 2-4 أسابيع)

### ✅ Test 6: Paper Trade for 1 Month

**ليه مهم:** الاختبار الحقيقي الوحيد

**كيف:**
```python
# 1. شغّل الـlive bot في virtual mode
python api/live_bot.py \
  --execution_mode VIRTUAL \
  --model_path api/models/KING.pkl \
  --exchange EGX \
  --threshold 0.60 \
  --capital 100000

# 2. استنى شهر
# 3. حلل النتائج:
#    - كام trade فتح؟
#    - كام كسب/خسر؟
#    - هل التوقيت كان كويس؟
```

**معايير النجاح:**
```python
✅ At least 5-10 trades في الشهر
✅ Win rate >= 50%
✅ Return > 0%
✅ No major slippage issues
✅ Signals make logical sense
```

**إذا فشل:**
- ⚠️ Zero trades → Threshold عالي جداً أو market quiet
- ⚠️ Win rate < 40% → الموديل مش شغال live
- ⚠️ Signals illogical → Feature leakage أو bug
- 💡 **الحل:** Debug thoroughly before live trading

---

## 🎯 المستوى 4: Stress Testing (متقدم - 1 ساعة)

### ✅ Test 7: Crisis Period Performance

**ليه مهم:** الموديل لازم يصمد في الأزمات

**كيف:**
```python
# اختبر على فترات صعبة:
crisis_periods = [
    ("2020-03-01", "2020-06-01"),  # COVID crash
    ("2022-03-01", "2022-12-01"),  # EGX currency crisis
    ("2023-10-01", "2023-12-01"),  # Recent volatility
]

for start, end in crisis_periods:
    results = backtest(model, start_date=start, end_date=end)
    print(f"{start} to {end}:")
    print(f"  Return: {results['return']:.2%}")
    print(f"  Max DD: {results['max_drawdown']:.2%}")
    print(f"  Win Rate: {results['win_rate']:.1%}")
```

**معايير النجاح:**
```python
✅ Stays positive or small loss in crisis
✅ Max DD < 25% in worst crisis
✅ Win rate > 40% even in crisis
✅ Doesn't blow up account
```

**إذا فشل:**
- ⚠️ Big losses in crisis → Add regime filters
- ⚠️ Max DD > 30% → Reduce position sizes
- 💡 **الحل:** Add "panic" regime detection
- 💡 **الحل:** Tighter stop losses in high volatility

---

### ✅ Test 8: Regime-Specific Performance

**ليه مهم:** الموديل قد يكون كويس في regime معين وسيء في تاني

**كيف:**
```python
# حلل performance حسب market regime
results_by_regime = {
    'panic': backtest(model, regime_filter='panic'),
    'trending_up': backtest(model, regime_filter='trending_up'),
    'sideways': backtest(model, regime_filter='sideways'),
    'trending_down': backtest(model, regime_filter='trending_down'),
}

for regime, res in results_by_regime.items():
    print(f"{regime}: Win Rate = {res['win_rate']:.1%}, "
          f"Avg Trade = {res['avg_trade_return']:.2%}")
```

**معايير النجاح:**
```python
✅ Profitable in trending_up (main regime)
✅ Not catastrophic in panic
✅ Breakeven or small profit in sideways
```

**إذا فشل:**
- ⚠️ Loses in trending_up → الموديل مش شغال خالص
- ⚠️ Big losses in panic → Add regime filter
- 💡 **الحل:** Don't trade in panic regime
- 💡 **الحل:** Adjust position sizes by regime

---

## 🎯 المستوى 5: Feature Analysis (احترافي - 30 دقيقة)

### ✅ Test 9: Feature Importance Check

**ليه مهم:** لازم الموديل يستخدم features منطقية

**كيف:**
```python
# Get feature importance
import pickle
artifact = pickle.load(open("api/models/KING.pkl", "rb"))

# LightGBM feature importance
model = artifact['model']
feature_names = artifact['feature_names']
importances = model.feature_importances_

# Sort by importance
top_features = sorted(zip(feature_names, importances), 
                     key=lambda x: x[1], reverse=True)[:20]

print("Top 20 Features:")
for feat, imp in top_features:
    print(f"  {feat}: {imp:.2f}")
```

**معايير النجاح:**
```python
✅ Top features make sense (RSI, MACD, Volume, etc.)
✅ EGX-specific features in top 30
✅ Smart money features present
✅ No suspicious features (e.g., "future_return")
```

**إذا فشل:**
- ⚠️ Suspicious features → Data leakage!
- ⚠️ Random features dominate → Overfitting
- ⚠️ No EGX features in top 50 → Not using EGX logic
- 💡 **الحل:** Check feature engineering for leakage

---

### ✅ Test 10: Prediction Distribution

**ليه مهم:** الموديل لازم يكون confident في predictions

**كيف:**
```python
import matplotlib.pyplot as plt

# Get predictions on test set
probs = model.predict_proba(X_test)[:, 1]

# Plot distribution
plt.figure(figsize=(10, 6))
plt.hist(probs, bins=50, alpha=0.7, edgecolor='black')
plt.xlabel('Predicted Probability')
plt.ylabel('Frequency')
plt.title('Prediction Distribution')
plt.axvline(0.55, color='red', linestyle='--', label='Threshold')
plt.legend()
plt.savefig('prediction_distribution.png')
plt.show()

# Statistics
print(f"Mean: {probs.mean():.3f}")
print(f"Std: {probs.std():.3f}")
print(f"Min: {probs.min():.3f}")
print(f"Max: {probs.max():.3f}")
print(f"% > 0.55: {(probs > 0.55).mean():.1%}")
```

**معايير النجاح:**
```python
✅ Distribution is spread (not all ~0.5)
✅ Mean around 0.3-0.5 (balanced)
✅ Some high-confidence predictions (>0.7)
✅ Not all predictions near threshold
```

**إذا فشل:**
- ⚠️ All predictions ~0.5 → Weak model
- ⚠️ All predictions <0.3 or >0.7 → Overconfident
- ⚠️ Bimodal distribution → Model confused
- 💡 **الحل:** Calibration or retrain

---

## 🎯 المستوى 6: Consistency Tests (احترافي جداً - 1 ساعة)

### ✅ Test 11: Training-Backtest-Live Consistency

**ليه مهم:** لازم كل الأنظمة تنتج نفس النتائج

**كيف:**
```python
# 1. Get training labels for same period
train_df = load_training_data(symbol="COMI.CA", 
                               start="2024-01-01", 
                               end="2024-03-01")
train_labels = train_df['Target']

# 2. Run backtest on same period
backtest_results = backtest(model, 
                            symbol="COMI.CA",
                            start="2024-01-01", 
                            end="2024-03-01")
backtest_labels = [1 if t['outcome'] == 'TP_HIT' else 0 
                   for t in backtest_results['trades']]

# 3. Compare
agreement = (train_labels == backtest_labels).mean()
print(f"Training-Backtest Agreement: {agreement:.1%}")
```

**معايير النجاح:**
```python
✅ Agreement >= 95% (excellent consistency)
✅ Agreement >= 90% (good consistency)
```

**إذا فشل:**
- ⚠️ Agreement < 90% → Logic mismatch
- 💡 **الحل:** Check that barrier calculations are identical
- 💡 **الحل:** Verify volume confirmation applied consistently

---

### ✅ Test 12: Prediction Stability Over Time

**ليه مهم:** الموديل لازم يكون stable، مش يتغير كل يوم

**كيف:**
```python
# Get predictions for same stock on consecutive days
dates = ["2024-06-01", "2024-06-02", "2024-06-03"]
predictions = []

for date in dates:
    # Load data up to date
    df = load_data(symbol="COMI.CA", end_date=date)
    pred = model.predict_proba(df.tail(1))[:, 1][0]
    predictions.append(pred)
    print(f"{date}: {pred:.3f}")

# Check stability
std = np.std(predictions)
print(f"Prediction Std: {std:.3f}")
```

**معايير النجاح:**
```python
✅ Std < 0.05 (very stable)
✅ Std < 0.10 (acceptable stability)
✅ No wild swings (>0.20 change in 1 day)
```

**إذا فشل:**
- ⚠️ Std > 0.15 → Unstable features
- ⚠️ Big swings → Check for outliers or data quality
- 💡 **الحل:** Add feature smoothing
- 💡 **الحل:** Use ensemble for stability

---

## 📊 Checklist الشامل

### ✅ Pre-Deployment Checklist

قبل ما تنزل الموديل live، اتأكد من:

#### 1. Training Metrics
- [ ] Walk-forward average F1 >= 0.45
- [ ] Walk-forward std F1 <= 0.08
- [ ] Training-validation gap <= 0.10
- [ ] Purged CV results reasonable

#### 2. Backtest Results
- [ ] Out-of-sample backtest profitable
- [ ] Win rate >= 45%
- [ ] Max drawdown < 15%
- [ ] Beats benchmark (EGX30)

#### 3. Paper Trading
- [ ] 1+ month paper trading completed
- [ ] Win rate >= 50%
- [ ] No major slippage
- [ ] Signals make sense

#### 4. Stress Tests
- [ ] Survived crisis periods
- [ ] Max DD in crisis < 25%
- [ ] Works in different regimes

#### 5. Feature Quality
- [ ] Top features make sense
- [ ] No data leakage detected
- [ ] EGX-specific features used
- [ ] Prediction distribution healthy

#### 6. Consistency
- [ ] Training-backtest agreement >= 90%
- [ ] Prediction stability acceptable
- [ ] Live results match backtest

---

## 🚨 Red Flags - متى توقف فوراً

### Stop Trading Immediately If:

1. ❌ **Walk-forward F1 < 0.35** → الموديل ضعيف جداً
2. ❌ **Backtest return < -5%** → الموديل خاسر
3. ❌ **Win rate < 35%** → Precision سيء جداً
4. ❌ **Max DD > 25%** → Risk management فاشل
5. ❌ **Paper trading losses > 10%** → مش شغال live
6. ❌ **Suspicious features** (data leakage) → Bug خطير
7. ❌ **Training-backtest agreement < 85%** → Logic broken
8. ❌ **All predictions same** → الموديل مش شغال

---

## 📈 مثال عملي: تقييم KING Model

```python
#!/usr/bin/env python
"""
Quick model validation script
"""
import pickle
import numpy as np
import pandas as pd

def validate_model(model_path="api/models/KING.pkl"):
    """Run all basic validation tests"""
    
    print("=" * 50)
    print("MODEL VALIDATION REPORT")
    print("=" * 50)
    
    # Load model
    artifact = pickle.load(open(model_path, "rb"))
    
    # Test 1: Walk-Forward Results
    print("\n1. Walk-Forward Validation:")
    wf_summary = artifact.get("walk_forward_summary", {})
    avg_f1 = wf_summary.get("average_f1", 0)
    std_f1 = wf_summary.get("std_f1", 0)
    min_f1 = wf_summary.get("min_f1", 0)
    max_f1 = wf_summary.get("max_f1", 0)
    
    print(f"   Average F1: {avg_f1:.3f} {'✅' if avg_f1 >= 0.45 else '❌'}")
    print(f"   Std F1: {std_f1:.3f} {'✅' if std_f1 <= 0.08 else '❌'}")
    print(f"   Min F1: {min_f1:.3f} {'✅' if min_f1 >= 0.35 else '❌'}")
    print(f"   Range: {max_f1 - min_f1:.3f} {'✅' if max_f1 - min_f1 <= 0.30 else '❌'}")
    
    # Test 2: Overfitting Check
    print("\n2. Overfitting Check:")
    train_f1 = artifact.get("train_f1", 0)
    val_f1 = artifact.get("f1", 0)
    gap = train_f1 - val_f1
    print(f"   Training F1: {train_f1:.3f}")
    print(f"   Validation F1: {val_f1:.3f}")
    print(f"   Gap: {gap:.3f} {'✅' if gap <= 0.10 else '❌'}")
    
    # Test 3: Feature Importance
    print("\n3. Top 10 Features:")
    feature_names = artifact.get("feature_names", [])
    importances = artifact.get("feature_importance", {})
    if importances:
        top_10 = sorted(importances.items(), 
                       key=lambda x: x[1], reverse=True)[:10]
        for feat, imp in top_10:
            print(f"   {feat}: {imp:.2f}")
    
    # Overall Assessment
    print("\n" + "=" * 50)
    print("OVERALL ASSESSMENT:")
    
    passed_tests = 0
    total_tests = 0
    
    # Test results
    tests = [
        ("Walk-forward F1", avg_f1 >= 0.45),
        ("Walk-forward stability", std_f1 <= 0.08),
        ("Min F1", min_f1 >= 0.35),
        ("Overfitting", gap <= 0.10),
    ]
    
    for test_name, passed in tests:
        total_tests += 1
        if passed:
            passed_tests += 1
            print(f"✅ {test_name}")
        else:
            print(f"❌ {test_name}")
    
    score = (passed_tests / total_tests) * 100
    print(f"\nScore: {score:.0f}%")
    
    if score >= 75:
        print("🎯 Model is READY for deployment!")
    elif score >= 50:
        print("⚠️ Model needs IMPROVEMENT before deployment")
    else:
        print("❌ Model is NOT READY - retrain required")
    
    return score >= 75

if __name__ == "__main__":
    validate_model()
```

**Usage:**
```bash
python validate_model.py
```

---

## ✅ الخلاصة النهائية

### الطرق الذكية (مرتبة بالأهمية):

1. **Walk-Forward Validation** ⭐⭐⭐⭐⭐
   - أسرع (10 دقائق)
   - أدق indicator للـgeneralization
   - Built-in في النظام

2. **Out-of-Sample Backtest** ⭐⭐⭐⭐⭐
   - متوسط السرعة (30 دقيقة)
   - اختبار حقيقي على holdout data
   - يكشف overfitting

3. **Paper Trading** ⭐⭐⭐⭐⭐
   - بطيء (1+ شهر)
   - الاختبار النهائي الوحيد
   - يكشف live trading issues

4. **Stress Testing** ⭐⭐⭐⭐
   - متوسط (1 ساعة)
   - يختبر robustness
   - يكشف نقاط الضعف

5. **Feature Analysis** ⭐⭐⭐⭐
   - سريع (30 دقيقة)
   - يكشف data leakage
   - يتأكد من المنطق

6. **Consistency Tests** ⭐⭐⭐
   - متوسط (1 ساعة)
   - يتأكد من implementation
   - يكشف bugs

### الترتيب الموصى به:

```
1. Check walk-forward results (10 min) ✅
   ↓ If Pass
2. Run out-of-sample backtest (30 min) ✅
   ↓ If Pass
3. Analyze features (30 min) ✅
   ↓ If Pass
4. Run stress tests (1 hour) ✅
   ↓ If Pass
5. Paper trade (1+ month) ✅
   ↓ If Pass
6. GO LIVE! 🚀
```

---

**دليل أُعِدّ بواسطة:** Kiro AI Agent  
**التاريخ:** 12 يونيو 2026  
**الحالة:** ✅ Complete - Ready to Use!
