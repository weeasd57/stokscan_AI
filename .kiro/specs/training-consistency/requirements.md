# متطلبات: توحيد منطق التدريب والـ Live Bot والاختبار

## المشكلة الرئيسية
هناك تعارضات جوهرية بين:
1. **منطق التدريب** (كيف تُحضّر البيانات ويتم الاختبار التاريخي)
2. **منطق الـ Live Bot** (كيف يتخذ القرارات فعلياً)
3. **منطق الباك تست** (كيف يتم محاكاة الأداء)

## أهداف الحل

### 1. توحيد Entry Price Logic
**الحالة الحالية:**
- التدريب: يدخل بـ `open_col.shift(-1)` (افتتاح اليوم التالي)
- Live Bot: يدخل بـ `closes[i]` (إغلاق اليوم الحالي)
- Backtest: غير متسق

**الحل المطلوب:**
- استخدام نفس logic في الثلاثة: الدخول بـ "سعر الافتتاح التالي" أو تحديد نقطة دخول واضحة
- حفظ في metadata بـ `entry_mode: "next_open"` أو `entry_mode: "current_close"`

### 2. توحيد Look-Forward Period
**الحالة الحالية:**
- التدريب EGX: 5 أيام (مع volume confirmation)
- التدريب عام: 20 يوم
- Live Bot: 20 بار (متغير حسب الإعداد)
- Backtest: غير معروف

**الحل المطلوب:**
- حفظ `look_forward_days` في model metadata
- استخدام نفس القيمة في Live Bot والـ Backtest
- السماح بـ override لكن بتسجيل الانحراف

### 3. توحيد Volume Confirmation Logic
**الحالة الحالية:**
- التدريب: يتطلب تأكيد حجم للـ EGX عند TP
- Live Bot: لا يطبق نفس المنطق
- Backtest: لا يستخدمه

**الحل المطلوب:**
- نقل Volume Confirmation Logic إلى module مشترك
- تطبيقه في الثلاثة: التدريب، Live Bot، Backtest

### 4. توحيد Threshold Management
**الحالة الحالية:**
- التدريب: يحسب `optimal_threshold` من validation data
- Live Bot: يستخدم hardcoded `king_threshold=0.85`, `council_threshold=0.25`
- Backtest: يستخدم `meta_threshold` من model artifact

**الحل المطلوب:**
- حفظ كل الـ thresholds في model metadata
- استخدام نفس القيم في Live Bot والـ Backtest
- السماح بـ override مع تسجيل في logs

### 5. توحيد Feature Engineering
**الحالة الحالية:**
- التدريب: يستخدم كامل التاريخ المتاح
- Live Bot: يستخدم آخر 500 بار فقط
- Backtest: يختلف حسب الكود

**الحل المطلوب:**
- نقل Feature Engineering إلى module مشترك
- توحيد `min_history_needed` و `warmup_bars`
- توثيق أي قيود على طول البيانات

### 6. منع Data Leakage في Backtesting
**الحالة الحالية:**
- قد يتم استخدام future data أثناء حساب features
- entry price قد يكون من نفس البار (look-ahead bias)

**الحل المطلوب:**
- تطبيق "purged k-fold" cross-validation مثل التدريب
- استخدام نفس entry_price shift logic
- توثيق كل المزامنة الزمنية

## النتائج المتوقعة

1. ✅ نموذج مدرب قابل للتكرار والتوثيق
2. ✅ Live Bot ينتج نتائج مقاربة للـ Backtest
3. ✅ لا توجد مفاجآت بسبب اختلاف الـ Logic
4. ✅ سهولة Debugging والتحسين المستمر

## المقاييس المستخدمة

- **Consistency Score**: نسبة توافق النتائج بين Backtest و Live Bot
- **Data Leakage Detection**: تحقق من عدم استخدام future data
- **Feature Drift**: مراقبة تغييرات في توزيع Features
