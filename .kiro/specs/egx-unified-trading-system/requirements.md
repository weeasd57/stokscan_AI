# Requirements Document

## Introduction

This specification defines the integration of the unified trading system for stokscan_AI and adds Egyptian Exchange (EGX)-specific improvements to the trading AI. The system currently has inconsistency between Training, Backtesting, and Live Bot components, where each uses different entry/exit logic, labeling rules, and feature calculations. Additionally, the system relies purely on technical analysis (RSI, EMA, ATR) without considering Egyptian market-specific factors such as thin liquidity, macro conditions, sector movements, and market regime.

This feature achieves three objectives:
1. **Full integration** of unified files (trading_config.py, unified_features.py, unified_labeling.py, model_catalog.py) across all pipelines
2. **EGX-specific enhancements** for Phase 1 including market context, walk-forward validation, and smarter labeling
3. **Roadmap documentation** for future phases (Phase 2-4) to guide long-term development

## Glossary

- **Trading_System**: The stokscan_AI platform consisting of Training, Backtesting, and Live Bot components
- **Unified_Files**: The set of four pre-built Python modules (trading_config.py, unified_features.py, unified_labeling.py, model_catalog.py) that standardize trading logic
- **Training_Pipeline**: The machine learning workflow that creates predictive models from historical data
- **Backtest_Pipeline**: The simulation system that evaluates trading strategies on historical data
- **Live_Bot**: The real-time trading component that executes trades based on model predictions
- **Entry_Price**: The price at which a position is opened (next open vs current close)
- **TP**: Take Profit target price level
- **SL**: Stop Loss price level
- **EGX30**: The Egyptian Exchange 30 index representing the top 30 stocks by liquidity
- **Walk_Forward_Validation**: Time-series cross-validation where models are trained on past data and tested on future unseen data
- **Circuit_Breaker**: Trading halt mechanism in Egyptian markets when price moves exceed thresholds
- **Label**: Binary classification target (1 = profitable trade, 0 = unprofitable trade) used in supervised learning
- **KING_Model**: The primary prediction model in the stokscan_AI ensemble
- **Council**: The ensemble validation system that filters signals using multiple models
- **Volume_Confirmation**: Requirement that trading volume exceeds a threshold for valid signals

## Requirements

### Requirement 1: Unified Entry Price Logic Integration

**User Story:** As a trading system developer, I want all three pipelines (Training, Backtesting, Live Bot) to use identical entry price logic, so that predictions match actual execution and prevent lookahead bias.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL use unified_labeling.py to calculate entry_price as next_open (shifted by -1 bar)
2. THE Backtest_Pipeline SHALL use trading_config.py entry_mode parameter to determine entry price
3. THE Live_Bot SHALL use trading_config.py entry_mode parameter to determine entry price
4. WHEN barrier_mode is "percent", THE Trading_System SHALL calculate TP and SL using entry_price * (1 + target_pct) and entry_price * (1 - stop_loss_pct)
5. WHEN barrier_mode is "atr_multiplier", THE Trading_System SHALL calculate TP and SL using entry_price + (ATR * target_pct) and entry_price - (ATR * stop_loss_pct)
6. FOR ALL three pipelines, THE Trading_System SHALL produce identical barrier calculations given identical input parameters

### Requirement 2: Unified Feature Engineering Consistency

**User Story:** As a data scientist, I want all pipelines to calculate features using the same logic and parameters, so that training data matches live inference and prevents feature drift.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL use unified_features.py FeatureEngineeringManager to validate data readiness
2. THE Backtest_Pipeline SHALL use unified_features.py FeatureEngineeringManager to validate data readiness
3. THE Live_Bot SHALL use unified_features.py FeatureEngineeringManager to validate data readiness
4. THE FeatureEngineeringManager SHALL enforce min_history_needed bars before predictions are allowed
5. THE FeatureEngineeringManager SHALL enforce warmup_bars to skip initial rows with incomplete indicator history
6. WHEN NaN percentage exceeds 5 percent, THE FeatureEngineeringManager SHALL reject the dataset and return is_ready as False
7. THE FeatureEngineeringManager SHALL validate that all required OHLCV columns (open, high, low, close, volume) are present

### Requirement 3: Unified Triple Barrier Labeling

**User Story:** As a machine learning engineer, I want training labels to match actual backtest outcomes, so that model performance in training accurately predicts live performance.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL use unified_labeling.py TripleBarrierLabeler.label_training_data to generate Target column
2. THE Backtest_Pipeline SHALL use unified_labeling.py TripleBarrierLabeler.backtest_trade to simulate trade outcomes
3. WHEN both TP and SL are hit within look_forward_days window, THE TripleBarrierLabeler SHALL determine outcome by which barrier was hit first
4. IF require_volume_confirmation is True, THEN THE TripleBarrierLabeler SHALL validate average volume exceeds volume_ma_20 * min_volume_ratio
5. THE TripleBarrierLabeler SHALL return label as 1 if TP hit before SL and volume confirmed
6. THE TripleBarrierLabeler SHALL return label as 0 if SL hit first or volume confirmation failed or neither barrier hit

### Requirement 4: Model Catalog Integration

**User Story:** As a system architect, I want consistent model selection across all pipelines, so that the same canonical models are used in training, backtesting, and production.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL use model_catalog.py select_canonical_model_cards to identify KING and THE BRAIN models
2. THE Backtest_Pipeline SHALL use model_catalog.py select_canonical_model_cards to identify KING and THE BRAIN models
3. THE Live_Bot SHALL use model_catalog.py select_canonical_model_cards to identify KING and THE BRAIN models
4. THE model_catalog SHALL exclude models containing KING-F variants with numeric suffixes
5. THE model_catalog SHALL exclude Council, Validator, and Advisor models from canonical selection
6. THE model_catalog SHALL return at most two models (KING and THE BRAIN or NANO)

### Requirement 5: EGX30 Market Context Integration

**User Story:** As a trader focused on Egyptian stocks, I want the system to consider overall market conditions, so that individual stock signals are filtered during market crashes.

#### Acceptance Criteria

1. THE Trading_System SHALL fetch daily EGX30 index data and store it in a time-series dataset
2. THE Trading_System SHALL calculate daily EGX30 return as (close - prev_close) / prev_close
3. WHEN EGX30 daily return is less than -2 percent, THE Trading_System SHALL classify market regime as "panic"
4. WHILE market regime is "panic", THE Trading_System SHALL reject all new buy signals regardless of individual stock strength
5. THE Trading_System SHALL add EGX30_return as a feature to the feature engineering pipeline
6. THE Trading_System SHALL log market regime classification (trending_up, trending_down, sideways, panic) for each trading day

### Requirement 6: Walk-Forward Validation Implementation

**User Story:** As a researcher preventing overfitting, I want to validate models on strictly future unseen data, so that reported performance is realistic and not artificially inflated.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL implement time-based train/test splits instead of random splits
2. THE Training_Pipeline SHALL create validation scheme: train on 2019-2021 then test on 2022
3. THE Training_Pipeline SHALL create validation scheme: train on 2019-2022 then test on 2023
4. THE Training_Pipeline SHALL create validation scheme: train on 2019-2023 then test on 2024
5. THE Training_Pipeline SHALL ensure test data is strictly chronologically after training data in all splits
6. THE Training_Pipeline SHALL report out-of-sample metrics (precision, recall, F1) for each walk-forward window
7. THE Training_Pipeline SHALL prevent any data leakage by ensuring test bars are never used for feature calculation during training

### Requirement 7: Strict Quality-Focused Labeling

**User Story:** As a trader seeking high-probability setups, I want labels to only mark signals that meet strict quality criteria, so that the model learns to predict only high-quality winning trades.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL label a trade as 1 only if TP is hit within first 7 days (not 20 days)
2. WHEN a signal occurs, THE Training_Pipeline SHALL check if volume on signal day exceeds 20-day average volume
3. IF signal-day volume is less than or equal to 20-day average, THEN THE Training_Pipeline SHALL label the trade as 0 regardless of price outcome
4. THE Training_Pipeline SHALL exclude labels where the stock is on circuit breaker status on signal day
5. WHEN EGX30 daily return is less than -2 percent on signal day, THE Training_Pipeline SHALL label the trade as 0
6. THE Training_Pipeline SHALL count and log how many potential winning trades are rejected due to quality filters
7. THE Training_Pipeline SHALL ensure quality-filtered labels produce higher precision at the cost of reduced recall

### Requirement 8: EGX30 Data Fetcher

**User Story:** As a system operator, I want automated EGX30 index data fetching, so that market context is always current without manual intervention.

#### Acceptance Criteria

1. THE Trading_System SHALL provide a data fetcher module that downloads EGX30 daily OHLCV data
2. THE data fetcher SHALL support multiple data sources (Yahoo Finance, local CSV, Supabase)
3. WHEN EGX30 data is missing for a date range, THE data fetcher SHALL attempt to download from configured source
4. THE data fetcher SHALL validate downloaded EGX30 data for completeness (no gaps exceeding 7 calendar days)
5. THE data fetcher SHALL store EGX30 data in a format compatible with existing stock_prices table schema
6. THE data fetcher SHALL log warnings when EGX30 data is stale (more than 3 business days old)

### Requirement 9: Circuit Breaker Detection

**User Story:** As a risk manager, I want to avoid trading stocks under circuit breaker restrictions, so that orders are not rejected or delayed by exchange rules.

#### Acceptance Criteria

1. THE Trading_System SHALL detect circuit breaker events by identifying days where high equals low for stocks
2. THE Trading_System SHALL mark bars as circuit_breaker_active when price range is less than 0.1 percent of close price
3. WHEN circuit_breaker_active is True for a bar, THE Training_Pipeline SHALL exclude that bar from labeling
4. WHEN circuit_breaker_active is True for current bar, THE Live_Bot SHALL reject buy signals for that symbol
5. THE Trading_System SHALL maintain a circuit_breaker_history log for analysis and debugging

### Requirement 10: Parameter Validation Across Pipelines

**User Story:** As a quality assurance engineer, I want automated validation that Training and Live Bot use compatible parameters, so that deployment mismatches are caught before production.

#### Acceptance Criteria

1. THE Trading_System SHALL implement validate_unified_parameters function in unified_features.py
2. THE validate_unified_parameters function SHALL compare TradingParameters from training artifact against Live_Bot configuration
3. WHEN barrier_mode differs between training and live, THE function SHALL return mismatch error listing the difference
4. WHEN target_pct differs between training and live, THE function SHALL return mismatch error listing the difference
5. WHEN stop_loss_pct differs between training and live, THE function SHALL return mismatch error listing the difference
6. WHEN look_forward_days differs between training and live, THE function SHALL return mismatch error listing the difference
7. IF no mismatches are found, THE function SHALL return is_compatible as True with empty mismatch list

### Requirement 11: Volume Confirmation Enhancement

**User Story:** As an Egyptian market specialist, I want volume-based signal filtering, so that trades only occur on stocks with sufficient liquidity.

#### Acceptance Criteria

1. WHEN require_volume_confirmation is True, THE Trading_System SHALL calculate 20-day volume moving average
2. THE Trading_System SHALL compare current bar volume against volume_ma_20 * min_volume_ratio
3. IF current volume is less than threshold, THEN THE Trading_System SHALL reject the signal
4. THE Trading_System SHALL add volume_ratio feature (current_volume / volume_ma_20) to the feature set
5. THE Training_Pipeline SHALL use volume confirmation in labeling when require_volume_confirmation is True
6. THE Live_Bot SHALL use volume confirmation in signal filtering when require_volume_confirmation is True

### Requirement 12: Model Artifact Parameter Persistence

**User Story:** As a deployment engineer, I want trading parameters saved in model artifacts, so that trained models carry their configuration for consistent inference.

#### Acceptance Criteria

1. WHEN a model is trained, THE Training_Pipeline SHALL save TradingParameters to model artifact metadata
2. THE model artifact SHALL include trading_parameters section with entry_mode, barrier_mode, target_pct, stop_loss_pct, look_forward_days
3. THE model artifact SHALL include thresholds section with king_threshold, council_threshold, validator_threshold
4. THE model artifact SHALL include feature_requirements section with min_history_needed, warmup_bars, feature_lookback
5. WHEN Live_Bot loads a model, THE Live_Bot SHALL extract TradingParameters using TradingParameters.from_model_artifact
6. THE Live_Bot SHALL log a warning if loaded parameters differ from bot configuration

### Requirement 13: Backtesting Consistency Verification

**User Story:** As a quant researcher, I want backtesting to exactly replicate training conditions, so that backtest results are trustworthy predictors of live performance.

#### Acceptance Criteria

1. THE Backtest_Pipeline SHALL load same TradingParameters used during training from model artifact
2. THE Backtest_Pipeline SHALL use unified_labeling.py backtest_trade method for outcome simulation
3. FOR ALL simulated trades, THE Backtest_Pipeline SHALL calculate P&L using same barrier logic as training labels
4. THE Backtest_Pipeline SHALL report discrepancies if actual trade outcomes differ from training labels by more than 1 percent
5. THE Backtest_Pipeline SHALL validate that entry_price, TP, and SL match training calculations within floating point tolerance

### Requirement 14: Integration Test Suite

**User Story:** As a continuous integration engineer, I want automated tests that verify unified system consistency, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE Trading_System SHALL provide a test suite that validates identical outputs across Training, Backtest, and Live components
2. THE test suite SHALL generate synthetic OHLCV data with known outcomes
3. THE test suite SHALL run identical data through Training labeling, Backtest simulation, and Live prediction
4. THE test suite SHALL assert that all three pipelines produce identical entry_price, TP, SL, and outcome predictions
5. IF any discrepancy is found, THE test suite SHALL fail with detailed error message showing the mismatch
6. THE test suite SHALL include tests for percent mode and atr_multiplier mode

### Requirement 15: Phase 2 Roadmap Documentation

**User Story:** As a product manager, I want a documented roadmap for future enhancements, so that stakeholders understand the long-term vision and prioritization.

#### Acceptance Criteria

1. THE Trading_System SHALL include roadmap document describing Phase 2 features (Month 2-3)
2. THE roadmap SHALL specify USD/EGP exchange rate integration as daily feature
3. THE roadmap SHALL specify Central Bank interest rate as monthly feature
4. THE roadmap SHALL specify sector momentum features (banking sector correlation)
5. THE roadmap SHALL specify dividend calendar integration to avoid buying before ex-dividend dates
6. THE roadmap SHALL recommend reducing look_forward_days from 20 to 7-10 for faster capital turnover
7. THE roadmap SHALL document Phase 3 (Month 4-6): paper trading for 3 months with precision threshold of 60 percent
8. THE roadmap SHALL document Phase 4: SaaS launch with subscription tiers, signal explanations, and user risk profiles

### Requirement 16: Training Script Refactoring

**User Story:** As a codebase maintainer, I want training scripts to use unified modules instead of legacy custom logic, so that the system is easier to understand and modify.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL replace all legacy entry price calculations with unified_labeling.py
2. THE Training_Pipeline SHALL replace all legacy feature validation with unified_features.py FeatureEngineeringManager
3. THE Training_Pipeline SHALL replace all legacy barrier calculations with TradingParameters from trading_config.py
4. THE Training_Pipeline SHALL remove or deprecate duplicate labeling functions that conflict with unified_labeling.py
5. WHEN training completes, THE Training_Pipeline SHALL save unified TradingParameters to model artifact
6. THE Training_Pipeline SHALL log which unified modules are loaded and their versions

### Requirement 17: Live Bot Refactoring

**User Story:** As a live trading operator, I want Live Bot to use unified modules instead of hardcoded logic, so that bot behavior matches training and backtesting exactly.

#### Acceptance Criteria

1. THE Live_Bot SHALL load TradingParameters from trading_config.py at startup
2. THE Live_Bot SHALL use unified_features.py to validate incoming market data before prediction
3. THE Live_Bot SHALL use unified_labeling.py to calculate expected TP and SL for each signal
4. THE Live_Bot SHALL replace legacy threshold logic with TradingParameters king_threshold and council_threshold
5. THE Live_Bot SHALL log parameter validation results at startup showing compatibility with loaded model
6. IF parameter mismatch is detected, THE Live_Bot SHALL log critical warning and optionally refuse to start

### Requirement 18: Backtest Script Refactoring

**User Story:** As a strategy researcher, I want backtesting scripts to use unified modules, so that optimization experiments are consistent with production systems.

#### Acceptance Criteria

1. THE Backtest_Pipeline SHALL load TradingParameters from model artifact or trading_config.py
2. THE Backtest_Pipeline SHALL use unified_labeling.py TripleBarrierLabeler.backtest_trade for all trade simulations
3. THE Backtest_Pipeline SHALL use unified_features.py for data validation before backtesting begins
4. THE Backtest_Pipeline SHALL replace legacy barrier calculations with TradingParameters barrier logic
5. THE Backtest_Pipeline SHALL report parameter consistency check at start of each backtest run
6. THE Backtest_Pipeline SHALL save backtest results with metadata indicating which TradingParameters were used

### Requirement 19: EGX Market Characteristics Documentation

**User Story:** As a new team member onboarding to the project, I want documentation explaining Egyptian market quirks, so that I understand why certain features and rules exist.

#### Acceptance Criteria

1. THE Trading_System SHALL include documentation describing EGX liquidity concentration (60 percent in top 20 stocks)
2. THE documentation SHALL explain thin trading problem where many stocks have weeks without movement
3. THE documentation SHALL explain circuit breaker rules and how they differ from US markets
4. THE documentation SHALL explain sector correlation patterns (banks move together)
5. THE documentation SHALL explain macro factor dominance (USD/EGP, interest rates)
6. THE documentation SHALL explain COVID period (2020) and currency crisis (2022-2023) as outlier regimes
7. THE documentation SHALL recommend against using pure technical analysis without fundamental or macro context

### Requirement 20: Logging and Monitoring Enhancements

**User Story:** As a system operator, I want comprehensive logging of unified system usage, so that I can debug issues and verify correct integration.

#### Acceptance Criteria

1. WHEN unified_labeling.py calculates barriers, THE Trading_System SHALL log entry_price, TP, SL, and barrier_mode
2. WHEN unified_features.py validates data, THE Trading_System SHALL log DataReadinessReport summary
3. WHEN model_catalog selects models, THE Trading_System SHALL log which models were selected and which were filtered out
4. WHEN TradingParameters are loaded, THE Trading_System SHALL log source (model artifact, config file, defaults)
5. WHEN parameter mismatch is detected, THE Trading_System SHALL log detailed comparison table showing differences
6. THE Trading_System SHALL include log levels (DEBUG, INFO, WARNING, ERROR) appropriate to each message
7. THE Trading_System SHALL support structured logging (JSON format) for integration with log aggregation tools
