# TODO: EGX Unified Trading System & Consistency Integration

This file tracks all remaining integration and refactoring tasks based on the specifications in `.kiro/specs/training-consistency` and `.kiro/specs/egx-unified-trading-system`.

---

## � **حالة المشروع - Project Status**

### **✅ مكتمل - Completed**
- Phase 1: Core Consistency & EGX Component Foundation (100%)

### **🔄 قيد التنفيذ - In Progress**
- Phase 2: Walk-Forward Validation & Training Pipeline Integration (30%)

### **⚪ لم يبدأ - Not Started**
- Phase 3: Backtesting Pipeline Refactoring (0%)
- Phase 4: Live Bot Pipeline Refactoring (0%)
- Phase 5: Structured Logging & Monitoring (0%)
- Phase 6: Documentation & Roadmap (0%)
- Phase 7: Macro & Sector Feature Integration (0%)
- Phase 8: Data Acquisition & Admin Panel Management (0%)

---

## �📋 Task Checklist

### Phase 1: Core Consistency & EGX Component Foundation ✅ (Completed)
- [x] **1.1 Unified Config Module (`api/trading_config.py`)**
  - ✅ Implement `TradingParameters` dataclass (entry_mode, barriers, thresholds, volume ratios, warmup)
  - ✅ Implement field validation in `__post_init__`
  - ✅ Add `from_model_artifact()` classmethod with legacy fallback
  - ✅ Add `from_live_bot_config()` classmethod for bot integration
  - ✅ Implement `to_dict()` and `validate()` methods
  - ✅ Add `validate_for_market()` for EGX-specific validation
  - **الحالة:** مكتمل 100% - الملف موجود وجاهز

- [x] **1.2 Unified Labeling Module (`api/unified_labeling.py`)**
  - ✅ Implement `TripleBarrierLabeler` supporting percent and ATR barrier modes
  - ✅ Implement `label_single_trade` and `backtest_trade` outcome simulation
  - ✅ Integrate volume confirmation logic based on 20-day MA
  - ✅ Support for both training labeling and backtest simulation
  - **الحالة:** مكتمل 100% - الملف موجود وجاهز

- [x] **1.3 Unified Features Module (`api/unified_features.py`)**
  - ✅ Implement `FeatureEngineeringManager` and `DataReadinessReport`
  - ✅ Add `check_data_ready()`, `validate_features()`, and `check_data_leakage()`
  - ✅ Add `detect_feature_drift()` for monitoring
  - **الحالة:** مكتمل 100% - الملف موجود وجاهز

- [x] **1.4 EGX Market Context Components**
  - ✅ Create `api/egx30_fetcher.py` supporting Yahoo Finance, Supabase, and local JSON
  - ✅ Implement `classify_market_regime()` (panic, trending_up, trending_down, sideways)
  - ✅ Create `api/circuit_breaker_detector.py` to detect zero-range or range < 0.1% halts
  - ✅ Add event logging and history tracking
  - **الحالة:** مكتمل 100% - الملفات موجودة وجاهزة

- [x] **1.5 Strict Quality-Focused Labeling (`api/strict_quality_labeler.py`)**
  - ✅ Create `StrictQualityLabeler` subclassing `TripleBarrierLabeler`
  - ✅ Enforce EGX quality filters: 7-day TP limit, volume > 20-day MA, no circuit breakers, EGX30 return >= -2%
  - ✅ Add comprehensive rejection logging
  - **الحالة:** مكتمل 100% - الملف موجود وجاهز

- [x] **1.6 Verify Foundation Unit Tests**
  - ✅ `api/tests/test_consistency.py` - 52 tests covering TradingParameters, TripleBarrierLabeler, FeatureEngineeringManager
  - ✅ `api/tests/test_egx_components.py` - Tests for EGX30 regime classification and circuit breaker detection
  - ✅ All tests passing 100%
  - **الحالة:** مكتمل 100% - الاختبارات جاهزة ونجحت

### Phase 2: Walk-Forward Validation & Training Pipeline Integration 🔄 (30% Complete)
- [x] **2.1 Walk-Forward Split Function Created**
  - ✅ `create_walk_forward_splits()` function exists in training pipeline
  - ✅ Time-based splits implemented (train 2019-2021 → test 2022, etc.)
  - ✅ Chronological ordering validated
  - **الحالة:** مكتمل - الدالة موجودة

- [ ] **2.2 Integrate Walk-Forward into Training Script** ⚠️ **Priority: HIGH**
  - ⚪ Modify `train_exchange_model.py` to use walk-forward splits instead of random splits
  - ⚪ Calculate per-split metrics (precision, recall, F1) for each validation window
  - ⚪ Save validation results in model artifact under `validation` section
  - **المتطلبات:** Requirements 6.6, 6.7, 16.5 من egx-unified spec
  - **الجهد المتوقع:** 3-4 ساعات
  - **المخاطر:** MEDIUM - قد تتغير نتائج التدريب بشكل كبير

- [ ] **2.3 Save Unified Parameters in Model Artifact** ⚠️ **Priority: HIGH**
  - ⚪ Update `train_exchange_model.py`'s `save_meta_labeling_system()` to store:
    - `trading_parameters` section (entry_mode, barriers, thresholds)
    - `feature_requirements` section (min_history, warmup_bars)
    - Walk-forward validation split results
  - ⚪ Maintain backward compatibility with old model loading
  - **المتطلبات:** Requirements 12.1-12.4 من egx-unified spec
  - **الجهد المتوقع:** 2-3 ساعات

- [ ] **2.4 Create Training Pipeline Integration Tests**
  - ⚪ Write test in `api/tests/test_train_pipeline.py`:
    - Parameter serialization round-trip test
    - Walk-forward splits leakage prevention test
    - Model artifact format validation test
  - **الجهد المتوقع:** 3 ساعات
  - **Note:** Optional for MVP but highly recommended

### Phase 3: Backtesting Pipeline Refactoring (`api/backtest_radar.py`) ⚪ (0% Complete)

**⚠️ Priority: HIGH - Critical for validating model performance**

- [ ] **3.1 Load Unified Parameters** 
  - ⚪ Load `TradingParameters` from model artifact metadata using `TradingParameters.from_model_artifact()`
  - ⚪ Log loaded parameters at the beginning of the backtest
  - ⚪ Validate parameter compatibility
  - **المتطلبات:** Requirements 13.1, 18.1 من egx-unified spec
  - **الجهد المتوقع:** 1-2 ساعات
  - **المخاطر:** MEDIUM - نتائج الـ backtest قد تتغير

- [ ] **3.2 Validate Data Readiness**
  - ⚪ Integrate `FeatureEngineeringManager.check_data_ready()` before starting backtesting
  - ⚪ Alert/warn of missing columns or high NaN rates
  - ⚪ Skip symbols with insufficient data
  - **المتطلبات:** Requirements 2.2, 2.4, 18.3
  - **الجهد المتوقع:** 1 ساعة

- [ ] **3.3 Replace Simulation Logic with TripleBarrierLabeler**
  - ⚪ Replace custom simulation/barrier checks with `TripleBarrierLabeler.backtest_trade()`
  - ⚪ Support percent and ATR modes consistently with training
  - ⚪ Apply volume confirmation if configured
  - **المتطلبات:** Requirements 3.2, 13.2, 18.2
  - **الجهد المتوقع:** 2-3 ساعات
  - **المخاطر:** MEDIUM - منطق الخروج/الدخول سيتغير

- [ ] **3.4 Implement Training-to-Backtest Consistency Check**
  - ⚪ Compare backtest outcomes to training labels on historical bars
  - ⚪ Report/log warning if P&L differs by >1%
  - ⚪ Generate consistency report with entry price, barriers, outcomes
  - **المتطلبات:** Requirements 13.4, 13.5, 18.5
  - **الجهد المتوقع:** 2 ساعات

- [ ] **3.5 Write Backtest Integration Tests**
  - ⚪ Test identical barrier calculation on synthetic datasets
  - ⚪ Test entry pricing consistency with training
  - ⚪ Test parameter round-trip persistence
  - **المتطلبات:** Requirements 13.3, 14.3, 14.4
  - **الجهد المتوقع:** 4 ساعات
  - **Note:** Optional but highly recommended

### Phase 4: Live Bot Pipeline Refactoring (`api/live_bot.py`) ⚪ (0% Complete)

**⚠️ Priority: CRITICAL - Direct impact on live trading**

- [ ] **4.1 Load and Validate Trading Parameters**
  - ⚪ Load `TradingParameters` from model artifact on startup
  - ⚪ Perform parameter validation comparing model artifact parameters to live bot configuration
  - ⚪ Raise error if `STRICT_VALIDATION=true` and configuration mismatches exist
  - ⚪ Log parameter summary and validation results
  - **المتطلبات:** Requirements 1.3, 12.5, 17.1 من egx-unified spec
  - **الجهد المتوقع:** 2 ساعات
  - **المخاطر:** HIGH - أي خطأ يؤثر على التداول المباشر

- [ ] **4.2 Enforce Data Readiness**
  - ⚪ Call `FeatureEngineeringManager.check_data_ready()` before every prediction cycle
  - ⚪ Skip predictions and log warnings if warmup bars or data constraints are not met
  - ⚪ Validate feature consistency before each trade
  - **المتطلبات:** Requirements 2.3, 2.4, 17.2
  - **الجهد المتوقع:** 1-2 ساعات

- [ ] **4.3 Integrate EGX Market Filters**
  - ⚪ Reject buy signals if EGX30 is in "panic" regime (EGX30 daily return <= -2%)
  - ⚪ Reject symbol buy signals if active circuit breaker is detected (high == low or range < 0.1%)
  - ⚪ Enforce volume confirmation if `require_volume_confirmation=True` (volume > 20-day MA * min_volume_ratio)
  - ⚪ Log all rejection reasons for analysis
  - **المتطلبات:** Requirements 5.4, 9.4, 11.3, 11.6, 17.3
  - **الجهد المتوقع:** 2-3 ساعات
  - **المخاطر:** MEDIUM - يجب اختبار جميع سيناريوهات الرفض

- [ ] **4.4 Replace Hardcoded Logic with Unified Parameters**
  - ⚪ Use `params.king_threshold` and `params.council_threshold` from `TradingParameters`
  - ⚪ Calculate expected TP and SL targets using `TradingParameters.calculate_barriers()`
  - ⚪ Remove all hardcoded thresholds and barriers
  - ⚪ Apply entry_mode logic (next_open vs current_close)
  - **المتطلبات:** Requirements 1.3, 17.4
  - **الجهد المتوقع:** 2-3 ساعات

- [ ] **4.5 Write Live Bot Integration Tests**
  - ⚪ Test signal filtering under panic, circuit breakers, and low-volume scenarios
  - ⚪ Test parameter loading and validation
  - ⚪ Test consistency with training/backtest logic on historical data
  - **المتطلبات:** Requirements 10.3, 14.1, 14.4
  - **الجهد المتوقع:** 3-4 ساعات
  - **Note:** Critical for production deployment

### Phase 5: Structured Logging & Monitoring ⚪ (0% Complete)

**Priority: MEDIUM - Important for debugging and monitoring**

- [ ] **5.1 Create Structured JSON Logger (`api/structured_logger.py`)**
  - ⚪ Implement logger writing structured JSON format
  - ⚪ Include fields: timestamp, event, details, level, parameters
  - ⚪ Support different log levels (DEBUG, INFO, WARNING, ERROR, CRITICAL)
  - **المتطلبات:** Requirements 20.1-20.6 من egx-unified spec
  - **الجهد المتوقع:** 2 ساعات

- [ ] **5.2 Integrate Structured Logging into All Pipelines**
  - ⚪ Add logging in training: parameter load, data readiness, barriers, regime classification
  - ⚪ Add logging in backtesting: parameter consistency, trade outcomes, discrepancies
  - ⚪ Add logging in live bot: EGX filters, signal rejections, parameter validation
  - ⚪ Log parameter mismatches with detailed comparison tables
  - **المتطلبات:** Requirements 20.2-20.5, 20.7
  - **الجهد المتوقع:** 3-4 ساعات

- [ ] **5.3 Write Unit Tests for Structured Logging** (Optional)
  - ⚪ Test JSON format output
  - ⚪ Test log filtering by level
  - ⚪ Verify all required fields present in log events
  - **الجهد المتوقع:** 2 ساعات

---

### Phase 6: Documentation & Roadmap ⚪ (0% Complete)

**Priority: MEDIUM - Important for team collaboration and future planning**

- [ ] **6.1 Create EGX Market Guide (`docs/EGX_MARKET_GUIDE.md`)**
  - ⚪ Document liquidity concentration (60% in top 20 stocks)
  - ⚪ Explain thin trading problem and weeks without movement
  - ⚪ Explain circuit breaker rules (±5% limits) vs US markets
  - ⚪ Document sector correlation patterns (banks move together)
  - ⚪ Explain macro factor dominance (USD/EGP, interest rates)
  - ⚪ Document COVID (2020) and currency crisis (2022-2023) outlier regimes
  - **المتطلبات:** Requirements 19.1-19.7 من egx-unified spec
  - **الجهد المتوقع:** 3 ساعات

- [ ] **6.2 Create Project Roadmap (`docs/ROADMAP.md`)**
  - ⚪ Document Phase 2: Macro features (USD/EGP, CBE rates, sector momentum, dividends)
  - ⚪ Document Phase 3: Paper trading validation (3 months, 60% precision threshold)
  - ⚪ Document Phase 4: SaaS launch (subscription tiers, signal explanations, risk profiles)
  - ⚪ Include recommended optimization: reduce look_forward_days from 20 to 7-10
  - **المتطلبات:** Requirements 15.1-15.8 من egx-unified spec
  - **الجهد المتوقع:** 2-3 ساعات

---

### Phase 7: Macro & Sector Feature Integration ⚪ (0% Complete)

**Priority: LOW - Future enhancement for Phase 2**

**Note:** هذه المرحلة مخططة للمستقبل (Phase 2 من Roadmap) وليست ضرورية للـ MVP الحالي

- [ ] **7.1 Implement USD/EGP Currency Fetcher & Features**
  - ⚪ Fetch USD/EGP exchange rate daily from Yahoo Finance Forex symbol `EGP=X`
  - ⚪ Add local JSON fallback for offline usage
  - ⚪ Calculate `usdegp_change` daily percentage change
  - ⚪ Merge into stock training features
  - **الجهد المتوقع:** 3-4 ساعات

- [ ] **7.2 Implement CBE Interest Rate Feature**
  - ⚪ Create schedule mapping dates to Central Bank of Egypt interest rates
  - ⚪ Add `cbe_interest_rate` level feature
  - ⚪ Add `cbe_rate_change` difference feature
  - ⚪ Manual entry via admin panel (8 times/year)
  - **الجهد المتوقع:** 2-3 ساعات

- [ ] **7.3 Implement Sector Momentum Feature**
  - ⚪ Calculate 5-day sector momentum of banking sector stocks
  - ⚪ Use major bank stocks (e.g., COMI, ADIB) from existing Supabase data
  - ⚪ Add `bank_sector_momentum` feature
  - ⚪ Merge into training features
  - **الجهد المتوقع:** 2-3 ساعات

- [ ] **7.4 Implement Dividend Calendar Filter**
  - ⚪ Create `is_near_ex_dividend()` function
  - ⚪ Avoid buying 5 days before ex-dividend dates
  - ⚪ Apply filter in training target labeling
  - ⚪ Apply filter in backtesting simulation
  - ⚪ Apply filter in live bot prediction
  - **الجهد المتوقع:** 2-3 ساعات

- [ ] **7.5 Write Macro & Sector Integration Tests**
  - ⚪ Write unit tests in `api/tests/test_macro_features.py`
  - ⚪ Verify calculations and correct merge behavior
  - ⚪ Test edge cases (missing data, stale rates)
  - **الجهد المتوقع:** 2-3 ساعات

---

### Phase 8: Data Acquisition & Admin Panel Management ⚪ (0% Complete)

**Priority: LOW - Future enhancement for data management**

**Note:** هذه المرحلة للإدارة المستقبلية للبيانات الاقتصادية والكلية

- [ ] **8.1 Supabase Database Setup for Macro Data**
  - ⚪ Create migration for `cbe_interest_rates` table (id, date, rate_pct)
  - ⚪ Create migration for `dividend_calendar` table (id, symbol, ex_date, dividend_amount, currency)
  - ⚪ Add foreign key and check constraints
  - **الجهد المتوقع:** 2 ساعات

- [ ] **8.2 API Routes Setup (Next.js & Python FastAPI)**
  - ⚪ Create routes in `web/src/app/api/admin/macro` for:
    - Get/Post CBE interest rate decisions
    - Get/Post stock ex-dividend calendar records
    - Trigger USD/EGP live rate update and cache in Supabase
  - **الجهد المتوقع:** 4-5 ساعات

- [ ] **8.3 Next.js Admin Panel UI Integration**
  - ⚪ Create "Macro & Sector Data Management" tab in `web/src/app/admin/page.tsx`
  - ⚪ Add CRUD table/form for CBE interest rates
  - ⚪ Add CRUD table/form for ex-dividend dates
  - ⚪ Add refresh button for current macro indicators:
    - Current USD/EGP exchange rate
    - Current EGX30 daily return and market regime
    - Current bank sector 5-day momentum
  - **الجهد المتوقع:** 6-8 ساعات

- [ ] **8.4 Verification of Admin Panel Integration**
  - ⚪ Verify manually added CBE rates saved correctly in Supabase
  - ⚪ Verify dividends parsed by Python scripts correctly
  - ⚪ Test integration with `train_exchange_model.py`, `live_bot.py`, `backtest_radar.py`
  - **الجهد المتوقع:** 2-3 ساعات

---

## � Phase 9: Advanced AI & Signal Enhancements ⚪ (0% Complete)

**Priority: HIGH - Core product differentiation features**

**Note:** هذه المميزات مستوحاة من تحليل احتياجات المستخدمين وتهدف لتحسين تجربة المنصة

### 9.1 AI Enhancements - تحسينات الذكاء الاصطناعي

- [ ] **9.1.1 Historical Similarity — شبه ده** ⚠️ **Priority: HIGH**
  - ⚪ تطوير نظام بحث عن أنماط تاريخية مشابهة
  - ⚪ استخدام Cosine Similarity على feature vectors لإيجاد حالات مشابهة
  - ⚪ عرض إحصائيات النتائج التاريخية (win rate، average return، time to target)
  - ⚪ دمج في Signal Explanation لشرح سبب الإشارة
  - **التقنية:** Cosine similarity على normalized features + KNN لأقرب 10 حالات
  - **الأثر المتوقع:** يشرح ليه الإشارة طلعت — مش بس اشتري/بيع - يزيد الثقة بنسبة 40%
  - **الجهد المتوقع:** 6-8 ساعات

- [ ] **9.1.2 EGX-Specific Features Integration**
  - ⚪ إضافة Circuit Breaker Distance feature (المسافة من الحد الأعلى/الأدنى)
  - ⚪ إضافة Bull Consistency feature (استمرارية الصعود)
  - ⚪ إضافة Volume Dry-up Detection (جفاف السيولة)
  - ⚪ إضافة 52-week Position feature (موقع السهم من أعلى/أدنى سنوي)
  - **التقنية:** 4 features جديدة في add_massive_features function
  - **الأثر المتوقع:** الموديل يفهم طبيعة EGX مش بس السوق العالمي
  - **الجهد المتوقع:** 4-5 ساعات

- [ ] **9.1.3 Compound Confidence Score**
  - ⚪ تطوير نظام Confidence Score مركب
  - ⚪ الثقة النهائية = KING × Council × Volume × Market Timing
  - ⚪ تطبيق Floor Threshold عند 0.45
  - ⚪ دمج في Signal Generation Pipeline
  - **التقنية:** Multiplicative scoring مع validation checks
  - **الأثر المتوقع:** يمنع إشارات المصادفة اللي واحد بس وافق عليها
  - **الجهد المتوقع:** 3-4 ساعات

### 9.2 Signal Intelligence - ذكاء الإشارات

- [ ] **9.2.1 Signal Reasoning/Explanation** ⚠️ **Priority: HIGH**
  - ⚪ استخراج Feature Importance من KING booster
  - ⚪ توليد شرح نصي لكل إشارة (RSI على كام، Volume زاد بكام، السهم فين من SMA)
  - ⚪ عرض أهم 3-5 أسباب لكل إشارة
  - ⚪ دمج مع Historical Similarity للسياق
  - **التقنية:** SHAP values أو feature importance extraction من LightGBM
  - **الأثر المتوقع:** المستخدم يفهم ويثق في الإشارة - يزيد conversion بنسبة 50%
  - **الجهد المتوقع:** 5-6 ساعات

- [ ] **9.2.2 Signal Expiry & Lifecycle Management**
  - ⚪ إضافة Timestamp لكل إشارة
  - ⚪ تطبيق Auto-expiry بعد 3 أيام
  - ⚪ إضافة Signal Status (active, expired, executed, cancelled)
  - ⚪ تنظيف الإشارات القديمة تلقائياً
  - **التقنية:** Timestamp comparison في كل scan cycle + status tracking
  - **الأثر المتوقع:** يمنع تنفيذ إشارات قديمة في ظروف مختلفة
  - **الجهد المتوقع:** 3-4 ساعات

- [ ] **9.2.3 Re-entry Protection (Cooldown Period)**
  - ⚪ تتبع الصفقات الخاسرة لكل سهم
  - ⚪ منع إشارة جديدة على نفس السهم لمدة 14 يوم بعد خسارة
  - ⚪ تخزين Cooldown Dict في BotManager
  - ⚪ عرض سبب الرفض في logs
  - **التقنية:** Cooldown dict: {symbol: last_loss_date} مع TTL check
  - **الأثر المتوقع:** يمنع الدخول مرات كتير في سهم فاشل
  - **الجهد المتوقع:** 2-3 ساعات

### 9.3 Market Intelligence - ذكاء السوق

- [ ] **9.3.1 Enhanced Sector Momentum Analysis** ⚠️ **Priority: HIGH**
  - ⚪ حساب Sector Momentum لكل قطاع (بنوك، عقارات، تشييد، أغذية، اتصالات)
  - ⚪ تطوير `calculate_sector_momentum()` function
  - ⚪ تطوير `adjust_confidence_by_sector()` للتحذير لو القطاع ضعيف
  - ⚪ دمج في Signal Confidence Calculation
  - **التقنية:** Group by sector → calculate 5/20 day returns → weighted average
  - **الأثر المتوقع:** يضيف context حقيقي للإشارة - يقلل الإشارات الخاطئة بنسبة 20%
  - **الجهد المتوقع:** 4-5 ساعات

- [ ] **9.3.2 Market Timing Score Enhancement**
  - ⚪ تطوير `calculate_market_timing_score()` function
  - ⚪ استخدام EGX30 آخر 5 و20 يوم
  - ⚪ تطبيق Confidence Multipliers: BULL = +10%، BEAR = -25%
  - ⚪ دمج في Signal Generation
  - **التقنية:** EGX30 momentum + ADX strength → confidence multiplier
  - **الأثر المتوقع:** يمنع الشراء في وسط crash
  - **الجهد المتوقع:** 3-4 ساعات

- [ ] **9.3.3 Market Breadth Indicator**
  - ⚪ حساب Advance/Decline Ratio يومياً
  - ⚪ نسبة الأسهم الصاعدة vs الهابطة في EGX
  - ⚪ تحديد صحة السوق: >70% = قوي، <30% = ضعيف
  - ⚪ استخدام كـ filter إضافي للإشارات
  - **التقنية:** Daily calculation على كل أسهم EGX + caching
  - **الأثر المتوقع:** مؤشر صحة السوق الحقيقي
  - **الجهد المتوقع:** 3-4 ساعات

### 9.4 Risk Management Intelligence - ذكاء إدارة المخاطر

- [ ] **9.4.1 Risk Transparency & Profile** ⚠️ **Priority: HIGH**
  - ⚪ تطوير `calculate_risk_profile()` function لكل إشارة
  - ⚪ حساب: نسبة المكسب/الخسارة المتوقعة، أسوأ حالة تاريخية
  - ⚪ استخدام Kelly Criterion لاقتراح حجم الصفقة
  - ⚪ عرض Risk Profile مع كل إشارة
  - **التقنية:** Historical stats + Kelly Criterion + Monte Carlo simulation
  - **الأثر المتوقع:** المستخدم يقرر بوعي مش بالعاطفة
  - **الجهد المتوقع:** 5-6 ساعات

- [ ] **9.4.2 Enhanced Circuit Breaker Awareness**
  - ⚪ حساب Distance from Upper/Lower Limit (±10% في EGX)
  - ⚪ إضافة تحذير لو السهم قريب من Circuit Breaker
  - ⚪ منع الدخول لو السهم على بُعد <2% من الحد
  - **التقنية:** pct_from_upper/lower_limit features + early warning
  - **الأثر المتوقع:** يتجنب الدخول قبل circuit breaker مباشرة
  - **الجهد المتوقع:** 2-3 ساعات

---

## 🆕 Phase 10: Portfolio Management & User Experience ⚪ (0% Complete)

**Priority: MEDIUM-HIGH - User-facing features for retention**

### 10.1 Portfolio Tracking System

- [ ] **10.1.1 Portfolio Tracker Database Schema** ⚠️ **Priority: HIGH**
  - ⚪ إنشاء جدول `user_positions` في Supabase:
    - Columns: user_id, symbol, entry_price, quantity, entry_date, notes
  - ⚪ إنشاء جدول `user_transactions` للتتبع التاريخي
  - ⚪ إضافة Foreign Keys و Constraints
  - **الجهد المتوقع:** 2 ساعات

- [ ] **10.1.2 Portfolio Tracker API & Logic**
  - ⚪ إنشاء API endpoints: Add/Edit/Delete positions
  - ⚪ Real-time P&L calculation من أسعار السوق الحية
  - ⚪ مقارنة أداء المحفظة مع EGX30 benchmark
  - ⚪ حساب Portfolio Metrics: Total Return، Win Rate، Sharpe Ratio
  - **التقنية:** Real-time price fetch + aggregation queries
  - **الأثر المتوقع:** يعرف أداء محفظته بدقة في أي وقت
  - **الجهد المتوقع:** 6-8 ساعات

- [ ] **10.1.3 TP/SL Alerts for Portfolio**
  - ⚪ Price monitoring لكل سهم في محفظة المستخدم
  - ⚪ تنبيه فوري على واتساب/تيليجرام عند الوصول للهدف أو وقف الخسارة
  - ⚪ Custom alerts (يحددها المستخدم)
  - **التقنية:** Price check في scan cycle + WhatsApp/Telegram dispatch
  - **الأثر المتوقع:** مش محتاج تراقب الشاشة طول اليوم
  - **الجهد المتوقع:** 4-5 ساعات

### 10.2 Performance Analytics Dashboard

- [ ] **10.2.1 User Performance Dashboard UI**
  - ⚪ إنشاء صفحة Dashboard في Next.js
  - ⚪ عرض إحصائيات: عدد الصفقات، Win Rate، Average Profit، Best/Worst Trade
  - ⚪ رسم بياني للأداء مقارنة بـ EGX30
  - ⚪ تقرير شهري/سنوي
  - **التقنية:** Recharts للرسوم + Aggregation على trades history
  - **الأثر المتوقع:** تعرف هل أداءك أحسن من السوق ولا لأ
  - **الجهد المتوقع:** 8-10 ساعات

- [ ] **10.2.2 Trade History & Journal**
  - ⚪ سجل تاريخي لكل الصفقات (manual + signals)
  - ⚪ إمكانية إضافة ملاحظات لكل صفقة
  - ⚪ Filtering & Search capabilities
  - ⚪ Export to CSV/PDF
  - **الجهد المتوقع:** 5-6 ساعات

### 10.3 Advanced Notifications & Calendar

- [ ] **10.3.1 Enhanced Dividend Calendar**
  - ⚪ جمع تواريخ توزيع الأرباح من EGX disclosures
  - ⚪ تنبيه المستخدم قبل الجمعية العمومية بـ 7 أيام
  - ⚪ عرض Expected Dividend Amount
  - ⚪ تكامل مع Portfolio Tracker
  - **التقنية:** EGX disclosure scraping أو manual entry + calendar integration
  - **الأثر المتوقع:** تخطيط أفضل لقرارات الشراء/البيع
  - **الجهد المتوقع:** 6-8 ساعات

- [ ] **10.3.2 Earnings Calendar Integration**
  - ⚪ تواريخ إعلان النتائج المالية
  - ⚪ تنبيه قبل الإعلان بـ 3 أيام
  - ⚪ Historical earnings performance
  - **الجهد المتوقع:** 4-5 ساعات

---

## �🎯 الأولويات والتوصيات - Priorities & Recommendations

### ⚠️ **الخطوات التالية الموصى بها - Recommended Next Steps:**

#### **المرحلة الحالية (Core Integration):**
1. **Phase 2.2** - دمج Walk-Forward في التدريب ✅ **START HERE**
   - أولوية قصوى لتحسين validation
   - الجهد: 3-4 ساعات
   - المخاطر: متوسطة

2. **Phase 2.3** - حفظ Parameters في Model Artifact ✅ **THEN THIS**
   - ضروري لـ Phase 3 و Phase 4
   - الجهد: 2-3 ساعات
   - المخاطر: منخفضة

3. **Phase 3** - تحديث Backtesting Pipeline ✅ **HIGH PRIORITY**
   - حاسم للتحقق من أداء النموذج
   - الجهد: 6-9 ساعات
   - المخاطر: متوسطة

4. **Phase 4** - تحديث Live Bot ⚠️ **CRITICAL BUT CAREFUL**
   - تأثير مباشر على التداول الحي
   - الجهد: 8-12 ساعة
   - المخاطر: عالية - يتطلب اختبار دقيق

#### **المرحلة التالية (Product Enhancement):**
5. **Phase 9.1.1** - Historical Similarity ⭐ **HIGH VALUE**
   - ميزة تنافسية قوية
   - الجهد: 6-8 ساعات
   - الأثر: يزيد الثقة بنسبة 40%

6. **Phase 9.2.1** - Signal Reasoning ⭐ **HIGH VALUE**
   - شرح الإشارات للمستخدم
   - الجهد: 5-6 ساعات
   - الأثر: يزيد conversion بنسبة 50%

7. **Phase 10.1** - Portfolio Tracker ⭐ **USER RETENTION**
   - ميزة أساسية للاحتفاظ بالمستخدمين
   - الجهد: 12-15 ساعة
   - الأثر: زيادة engagement بنسبة 70%

### 📊 **ملخص الجهد المتبقي - Remaining Effort Summary:**

| المرحلة | الحالة | الجهد المتبقي | الأولوية | الأثر المتوقع |
|---------|-------|---------------|----------|---------------|
| Phase 1 | ✅ مكتمل | 0 ساعات | - | - |
| Phase 2 | 🔄 30% | 8-10 ساعات | 🔴 عالية جداً | تحسين validation |
| Phase 3 | ⚪ 0% | 10-14 ساعة | 🔴 عالية | ثقة في النتائج |
| Phase 4 | ⚪ 0% | 12-16 ساعة | 🔴 حرجة | live trading |
| Phase 5 | ⚪ 0% | 7-10 ساعات | 🟡 متوسطة | debugging |
| Phase 6 | ⚪ 0% | 5-6 ساعات | 🟡 متوسطة | documentation |
| Phase 7 | ⚪ 0% | 11-16 ساعة | 🟢 منخفضة | macro context |
| Phase 8 | ⚪ 0% | 14-18 ساعة | 🟢 منخفضة | data management |
| **Phase 9** | ⚪ **0%** | **35-45 ساعة** | 🔴 **عالية** | **product differentiation** |
| **Phase 10** | ⚪ **0%** | **25-35 ساعة** | 🟡 **متوسطة-عالية** | **user retention** |

**إجمالي الجهد المتبقي للـ MVP (Phase 1-4):** ~37-50 ساعة (6-8 أيام عمل)  
**إجمالي الجهد للمنتج المتقدم (Phase 1-6):** ~67-90 ساعة (11-15 يوم عمل)  
**إجمالي الجهد الكامل (Phase 1-10):** ~127-170 ساعة (21-28 يوم عمل)

### 🎯 **مسارات التنفيذ المقترحة - Recommended Execution Paths:**

#### **مسار 1: MVP السريع (6-8 أيام)**
```
Phase 2 → Phase 3 → Phase 4 → إطلاق أولي
```
- يركز على تحسين الدقة والاتساق
- يؤمن live trading بشكل صحيح
- يؤجل المميزات المتقدمة

#### **مسار 2: المنتج المتميز (3-4 أسابيع)**
```
Phase 2-4 → Phase 9 (AI Enhancements) → Phase 10.1 (Portfolio) → إطلاق
```
- يضيف مميزات تنافسية قوية
- Historical Similarity + Signal Reasoning
- Portfolio Tracking للاحتفاظ بالمستخدمين

#### **مسار 3: المنتج الكامل (4-6 أسابيع)**
```
Phase 2-6 → Phase 9 → Phase 10 → Phase 7-8 → إطلاق SaaS
```
- منتج كامل جاهز للسوق
- جميع المميزات المتقدمة
- Admin panel + macro features

### 🆕 **المميزات الجديدة المضافة - Newly Added Features:**

#### **من فئة الذكاء الاصطناعي (Phase 9.1):**
- ✨ Historical Similarity — أنماط مشابهة تاريخية
- ✨ EGX-Specific Features — مميزات خاصة بالبورصة المصرية
- ✨ Compound Confidence Score — درجة ثقة مركبة

#### **من فئة الإشارات (Phase 9.2):**
- ✨ Signal Reasoning/Explanation — شرح سبب كل إشارة
- ✨ Signal Expiry & Lifecycle — انتهاء صلاحية الإشارات
- ✨ Re-entry Protection — حماية من الدخول المتكرر

#### **من فئة تحليل السوق (Phase 9.3):**
- ✨ Enhanced Sector Momentum — تحليل زخم القطاعات
- ✨ Market Timing Score — نقاط توقيت السوق
- ✨ Market Breadth — عرض السوق (نسبة الصاعد/الهابط)

#### **من فئة إدارة المخاطر (Phase 9.4):**
- ✨ Risk Transparency & Profile — شفافية المخاطر
- ✨ Enhanced Circuit Breaker — وعي محسن بالقواطع

#### **من فئة المحفظة (Phase 10):**
- ✨ Portfolio Tracker — متابعة المحفظة
- ✨ TP/SL Alerts — تنبيهات الأهداف والخسائر
- ✨ Performance Dashboard — لوحة الأداء
- ✨ Dividend Calendar — تقويم توزيع الأرباح
- ✨ Earnings Calendar — تقويم النتائج المالية

---

## 📚 المراجع والتوثيق - References & Documentation

### **Specification Files:**
- `.kiro/specs/training-consistency/` - ✅ التوحيد الأساسي (مكتمل)
- `.kiro/specs/egx-unified-trading-system/` - 🔄 نظام EGX الموحد (جزئي)

### **Implementation Files:**
- `api/trading_config.py` - ✅ معاملات موحدة
- `api/unified_labeling.py` - ✅ منطق التسمية
- `api/unified_features.py` - ✅ إدارة Features
- `api/egx30_fetcher.py` - ✅ جلب بيانات EGX30
- `api/circuit_breaker_detector.py` - ✅ كشف القواطع
- `api/strict_quality_labeler.py` - ✅ تسمية صارمة

### **Test Files:**
- `api/tests/test_consistency.py` - ✅ 52 اختبار (نجحت جميعها)
- `api/tests/test_egx_components.py` - ✅ اختبارات EGX
- `api/tests/test_strict_quality_labeler.py` - ✅ اختبارات التسمية الصارمة

### **Documentation:**
- `INTEGRATION_GUIDE.md` - ✅ دليل التكامل الشامل
- `.kiro/specs/training-consistency/SOLUTION_SUMMARY.md` - ✅ ملخص الحل

---

## 🔍 ملاحظات هامة - Important Notes

### **للمطورين - For Developers:**

1. **Phase 1 مكتملة بالكامل** - جميع الوحدات الأساسية جاهزة وتم اختبارها
2. **الأولوية الآن:** دمج الوحدات في pipelines الموجودة (Training، Backtest، Live Bot)
3. **الاختبار ضروري:** كل تغيير في Live Bot يجب اختباره بدقة قبل النشر
4. **Backward Compatibility:** جميع التغييرات يجب أن تدعم النماذج القديمة
5. **Phase 9 & 10:** مميزات تنافسية للمنتج - يمكن تنفيذها بعد Phase 4

### **المميزات ذات الأولوية القصوى - Top Priority Features:**

#### **للـ MVP (Phase 2-4):**
- ✅ Walk-Forward Validation
- ✅ Parameter Persistence
- ✅ Backtesting Consistency
- ✅ Live Bot Integration

#### **للمنتج المتقدم (Phase 9-10):**
- ⭐ Historical Similarity (6-8h) - **أعلى قيمة مضافة**
- ⭐ Signal Reasoning (5-6h) - **يزيد conversion بنسبة 50%**
- ⭐ Portfolio Tracker (12-15h) - **retention أساسي**
- ⭐ Risk Transparency (5-6h) - **ثقة المستخدم**

### **المخاطر المحتملة - Potential Risks:**

1. **تغيير نتائج التدريب:** Walk-Forward قد يُظهر دقة أقل من Random Split
2. **تغيير نتائج Backtest:** الـ simulation الجديد قد يعطي نتائج مختلفة
3. **تأثير Live Bot:** أي خطأ في Phase 4 يؤثر على التداول الفعلي
4. **Data Migration:** النماذج القديمة تحتاج معالجة خاصة

### **Best Practices:**

1. **اختبر على بيانات صغيرة أولاً** قبل التطبيق الكامل
2. **احفظ نسخة احتياطية** من النماذج الحالية قبل التحديث
3. **راقب الـ logs** بعناية أثناء التنفيذ
4. **قارن النتائج** بين الإصدار القديم والجديد
5. **وثّق جميع التغييرات** والقرارات المأخوذة

---

## 📖 تفاصيل إدارة البيانات الاقتصادية والكلية - Macro Data Management Details

**Note:** هذا القسم يوضح آلية عمل Phase 7 و Phase 8 (ميزات مستقبلية)

### **كيفية جلب وإدارة البيانات:**

#### **1. سعر صرف الدولار مقابل الجنيه (USD/EGP)** 💱
- **النوع:** تلقائي بالكامل ✅
- **المصدر:** Yahoo Finance (الرمز: `EGP=X`)
- **التحديث:** يومياً تلقائياً
- **إدارياً:** زر في لوحة المسؤول لتحديث فوري وحفظ في Supabase

#### **2. أسعار فائدة البنك المركزي المصري (CBE Interest Rates)** 📊
- **النوع:** يدوي ✋
- **المصدر:** إدخال المسؤول عبر Admin Panel
- **التحديث:** ~8 مرات سنوياً (اجتماعات لجنة السياسة النقدية)
- **الاستخدام:** الكود يقرأ جدول `cbe_interest_rates` في Supabase

#### **3. تواريخ توزيع الأرباح (Dividend Calendar)** 💰
- **النوع:** يدوي ✋
- **المصدر:** إدخال المسؤول عبر Admin Panel
- **الهدف:** تجنب الشراء قبل 5 أيام من موعد التوزيع (ex-dividend date)
- **الاستخدام:** الكود يقرأ جدول `dividend_calendar` في Supabase

#### **4. قوة دفع قطاع البنوك (Bank Sector Momentum)** 🏦
- **النوع:** تلقائي داخلي ✅
- **المصدر:** حساب داخلي من أسهم البنوك الموجودة في Supabase
- **الحساب:** متوسط العائد اليومي لأسهم مثل COMI، ADIB
- **التحديث:** يومياً تلقائياً

---

## 🔗 الربط مع الـ Specs - Linking to Specifications

### **training-consistency spec:**
- ✅ **Phase 1 مكتمل:** جميع الوحدات الأساسية منفذة
- ✅ **Requirements 1-6:** تم تحقيقها بالكامل
- 🔄 **Integration:** Phase 2-4 من TODO تُكمل التكامل

### **egx-unified-trading-system spec:**
- ✅ **Requirements 1-4:** Unified modules (مكتملة)
- ✅ **Requirements 5, 8, 9:** EGX Context و Circuit Breakers (مكتملة)
- ✅ **Requirement 7:** Strict Quality Labeling (مكتملة)
- 🔄 **Requirement 6:** Walk-Forward Validation (جزئي - Phase 2.2)
- ⚪ **Requirements 10-20:** Integration و Testing (Phase 2-6)

### **الملفات المُنشأة vs المطلوبة:**

| الملف | training-consistency | egx-unified | TODO.md | الحالة |
|-------|---------------------|-------------|---------|--------|
| `trading_config.py` | Task 1.1 ✅ | Req 1.1 ✅ | Phase 1.1 ✅ | مكتمل |
| `unified_labeling.py` | Task 2.1-2.3 ✅ | Req 3.1-3.6 ✅ | Phase 1.2 ✅ | مكتمل |
| `unified_features.py` | Task 3.1-3.2 ✅ | Req 2.1-2.7 ✅ | Phase 1.3 ✅ | مكتمل |
| `egx30_fetcher.py` | ❌ | Req 5.1-5.6 ✅ | Phase 1.4 ✅ | مكتمل |
| `circuit_breaker_detector.py` | ❌ | Req 9.1-9.5 ✅ | Phase 1.4 ✅ | مكتمل |
| `strict_quality_labeler.py` | ❌ | Req 7.1-7.7 ✅ | Phase 1.5 ✅ | مكتمل |
| `test_consistency.py` | Tasks ✅ | Req 14.1-14.6 ✅ | Phase 1.6 ✅ | مكتمل |

---

## 📞 الدعم والمساعدة - Support & Help

### **عند مواجهة مشاكل:**

1. **راجع الـ specs:**
   - `.kiro/specs/training-consistency/` للمشاكل الأساسية
   - `.kiro/specs/egx-unified-trading-system/` للميزات الخاصة بـ EGX

2. **راجع الوثائق:**
   - `INTEGRATION_GUIDE.md` - دليل التكامل الشامل
   - `.kiro/specs/training-consistency/SOLUTION_SUMMARY.md` - ملخص الحل

3. **اختبر الوحدات:**
   - شغّل `pytest api/tests/test_consistency.py -v`
   - شغّل `pytest api/tests/test_egx_components.py -v`

4. **استخدم الأدوات المساعدة:**
   - `FeatureEngineeringManager.check_data_ready()` للتحقق من البيانات
   - `TradingParameters.validate()` للتحقق من المعاملات
   - Logging للمراقبة والتشخيص

---

**آخر تحديث:** 2026-06-12  
**الإصدار:** 4.0  
**الحالة:** محدّث بالكامل - تمت إضافة Phase 9 & 10 (المميزات المتقدمة)  
**المصدر:** دمج المميزات من FeaturesList Component + egx-unified + training-consistency specs
