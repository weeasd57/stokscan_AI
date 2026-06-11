# Implementation Plan: EGX Unified Trading System

## Overview

This implementation integrates unified trading logic (trading_config.py, unified_features.py, unified_labeling.py, model_catalog.py) across Training, Backtesting, and Live Bot pipelines while adding Egyptian Exchange (EGX)-specific enhancements. The work involves refactoring existing Python scripts to use centralized configuration, implementing walk-forward validation, and adding market context filtering.

## Tasks

- [x] 1. Create EGX30 Market Context Components
  - [x] 1.1 Implement EGX30Fetcher class
    - Create `api/egx30_fetcher.py` with class supporting Yahoo Finance and Supabase data sources
    - Implement `fetch_daily_ohlcv()`, `calculate_daily_return()`, `classify_market_regime()` methods
    - Add fallback logic (Yahoo → Supabase → cached regime)
    - _Requirements: 5.1, 5.2, 5.3, 8.1, 8.2, 8.3_
  
  - [x] 1.2 Implement CircuitBreakerDetector class
    - Create `api/circuit_breaker_detector.py` with detection logic
    - Implement `detect_from_ohlcv()` using zero-range heuristic (high == low or range < 0.1%)
    - Add logging for circuit breaker events
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [x] 1.3 Write unit tests for EGX components
    - Test EGX30 regime classification (panic, trending_up, sideways)
    - Test circuit breaker detection for zero-range and normal-range scenarios
    - Test fallback behavior when data sources unavailable
    - _Requirements: 5.3, 9.1, 9.2_

- [ ] 2. Implement Walk-Forward Validation
  - [x] 2.1 Create walk-forward split function
    - Add `create_walk_forward_splits()` function to training pipeline module
    - Implement time-based splits: train 2019-2021 → test 2022, train 2019-2022 → test 2023, train 2019-2023 → test 2024
    - Validate strict chronological ordering (no test data in training)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [~] 2.2 Integrate walk-forward into training script
    - Modify `train_exchange_model.py` to use walk-forward splits instead of random splits
    - Calculate per-split metrics (precision, recall, F1) for each validation window
    - Save validation results in model artifact under `validation` section
    - _Requirements: 6.6, 6.7, 16.5_
  
  - [~] 2.3 Write integration test for walk-forward validation
    - Test no overlap between train/test splits
    - Test chronological ordering enforcement
    - Verify metrics calculated for each split
    - _Requirements: 6.5, 14.1, 14.2_

- [x] 3. Checkpoint - Validate new components
  - Ensure all tests pass for EGX components and walk-forward validation
  - Verify no data leakage in time-series splits
  - Ask the user if questions arise

- [ ] 4. Refactor Training Pipeline to Use Unified Modules
  - [x] 4.1 Replace barrier calculation with TradingParameters
    - Modify `train_exchange_model.py` to import and initialize `TradingParameters` from `trading_config.py`
    - Replace hardcoded barrier logic with `params.barrier_mode`, `params.target_pct`, `params.stop_loss_pct`
    - Remove legacy `_resolve_barrier_mode()` helper function
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 16.3_
  
  - [x] 4.2 Replace labeling logic with TripleBarrierLabeler
    - Replace custom triple barrier implementation with `unified_labeling.TripleBarrierLabeler`
    - Use `TripleBarrierLabeler.label_training_data()` to generate Target column
    - Ensure entry_mode uses "next_open" to prevent lookahead bias
    - _Requirements: 1.1, 3.1, 3.3, 3.5, 3.6, 16.2_
  
  - [x] 4.3 Add data validation with FeatureEngineeringManager
    - Import `FeatureEngineeringManager` from `unified_features.py`
    - Call `check_data_ready()` before labeling each symbol
    - Skip symbols where `is_ready=False` and log `DataReadinessReport` summary
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 16.2_
  
  - [x] 4.4 Integrate model_catalog for canonical model selection
    - Replace manual model selection with `select_canonical_model_cards()` from `model_catalog.py`
    - Filter out KING-F variants, Council, Validator models during training
    - Log which models are selected (KING and THE BRAIN)
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 16.6_
  
  - [~] 4.5 Save TradingParameters in model artifact
    - Enhance model artifact schema with `trading_parameters`, `thresholds`, `feature_requirements` sections
    - Serialize `TradingParameters.to_dict()` to artifact metadata
    - Save validation results from walk-forward splits
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 16.5_
  
  - [~] 4.6 Write unit tests for training refactoring
    - Test parameter loading and validation
    - Test artifact serialization round-trip (save → load → verify)
    - Test backward compatibility with legacy artifacts
    - _Requirements: 1.6, 12.5, 14.1, 14.4_

- [x] 5. Implement Strict Quality-Focused Labeling
  - [x] 5.1 Create StrictQualityLabeler class
    - Extend `TripleBarrierLabeler` with EGX-specific quality filters
    - Implement `label_single_trade_strict()` with criteria: TP within 7 days, volume > MA_20, no circuit breaker, EGX30 return >= -2%
    - Add logging for rejected trades with reasons
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [x] 5.2 Integrate strict labeling into training pipeline
    - Modify training to use `StrictQualityLabeler` for Target column generation
    - Merge EGX30 data and circuit breaker flags into DataFrame before labeling
    - Log quality filtering impact (rejected wins count and percentage)
    - _Requirements: 7.6, 7.7, 5.4, 5.5_
  
  - [x] 5.3 Write unit tests for strict labeling
    - Test rejection of TP hits after 7 days
    - Test rejection of low-volume signals
    - Test rejection during circuit breaker and panic regime
    - _Requirements: 7.1, 7.2, 7.5_
 
- [x] 6. Checkpoint - Validate training pipeline integration
  - Run training on sample symbol with unified modules
  - Verify model artifact contains all required sections
  - Ensure labels match strict quality criteria
  - Ask the user if questions arise

- [ ] 7. Refactor Backtesting Pipeline to Use Unified Modules
  - [~] 7.1 Load TradingParameters from model artifact
    - Modify `backtest_radar.py` to load model artifact and extract parameters using `TradingParameters.from_model_artifact()`
    - Log loaded parameter values (entry_mode, barrier_mode, thresholds)
    - _Requirements: 1.2, 13.1, 18.1_
  
  - [~] 7.2 Replace simulation logic with TripleBarrierLabeler
    - Use `TripleBarrierLabeler.backtest_trade()` for trade outcome simulation
    - Calculate entry_price, TP, SL using same logic as training
    - Simulate bar-by-bar trade execution with look_forward_days window
    - _Requirements: 3.2, 13.2, 13.3, 18.2_
  
  - [~] 7.3 Add data validation to backtest script
    - Use `FeatureEngineeringManager.check_data_ready()` before starting backtest
    - Validate feature consistency with training expectations
    - _Requirements: 2.2, 2.4, 18.3_
  
  - [~] 7.4 Implement consistency verification
    - Compare backtest outcomes to training labels for same bars
    - Report discrepancies if P&L differs by >1%
    - Log parameter consistency check results
    - _Requirements: 13.4, 13.5, 18.5_
  
  - [~] 7.5 Write integration tests for backtesting
    - Test training-to-backtest consistency with synthetic data
    - Verify identical barrier calculations given identical inputs
    - Test parameter round-trip persistence
    - _Requirements: 13.3, 13.4, 14.3, 14.4, 14.5_

- [ ] 8. Refactor Live Bot to Use Unified Modules
  - [~] 8.1 Load TradingParameters at bot startup
    - Modify `live_bot.py` to load parameters from model artifact using `from_model_artifact()`
    - Implement parameter validation comparing artifact params to bot config
    - Raise error if `STRICT_VALIDATION=true` and mismatches detected
    - _Requirements: 1.3, 12.5, 12.6, 17.1, 17.5_
  
  - [~] 8.2 Integrate data validation before predictions
    - Use `FeatureEngineeringManager.check_data_ready()` before each prediction cycle
    - Skip prediction if `is_ready=False` and log warnings
    - _Requirements: 2.3, 2.4, 17.2_
  
  - [~] 8.3 Implement signal filtering with EGX context
    - Add EGX30 regime check: reject buys during "panic" regime
    - Add circuit breaker check: reject symbols with active circuit breakers
    - Add volume confirmation: reject if volume < MA_20 * min_volume_ratio
    - _Requirements: 5.4, 9.4, 11.3, 11.6, 17.3_
  
  - [~] 8.4 Replace threshold logic with TradingParameters
    - Use `params.king_threshold`, `params.council_threshold` instead of hardcoded values
    - Calculate TP and SL using `unified_labeling` barrier logic
    - Log expected trade parameters for each signal
    - _Requirements: 1.3, 17.4_
  
  - [~] 8.5 Write integration tests for live bot
    - Test parameter loading and validation
    - Test signal filtering with EGX context (panic, circuit breaker, volume)
    - Verify consistency with training/backtest logic
    - _Requirements: 10.3, 10.4, 14.1, 14.4_

- [x] 9. Implement Parameter Validation Utility
  - [x] 9.1 Create validate_unified_parameters function
    - Add function to `unified_features.py` or create `parameter_validator.py`
    - Compare critical parameters: barrier_mode, target_pct, stop_loss_pct, look_forward_days, thresholds
    - Return tuple: (is_compatible: bool, mismatches: List[str])
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  
  - [x] 9.2 Write unit tests for parameter validation
    - Test compatible parameters return (True, [])
    - Test incompatible parameters return detailed mismatch list
    - Test validation across different barrier_mode values
    - _Requirements: 10.2, 10.3, 10.4_

- [~] 10. Checkpoint - Validate all pipeline integrations
  - Run end-to-end test: Training → Backtesting → Live Bot (dry run)
  - Verify parameter consistency across all three pipelines
  - Ensure no regressions in existing functionality
  - Ask the user if questions arise

- [ ] 11. Implement Logging and Monitoring Enhancements
  - [~] 11.1 Create StructuredLogger class
    - Implement JSON-formatted logging in `api/structured_logger.py`
    - Add methods: `log_parameter_load()`, `log_data_readiness()`, `log_barrier_calculation()`, `log_egx30_regime()`
    - Support different log levels (DEBUG, INFO, WARNING, ERROR)
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.6_
  
  - [~] 11.2 Integrate structured logging into all pipelines
    - Add logging calls in Training, Backtest, and Live Bot for critical events
    - Log parameter loading, data validation, model selection, regime classification
    - Log parameter mismatches with detailed comparison tables
    - _Requirements: 20.5, 20.7_
  
  - [~] 11.3 Write unit tests for structured logging
    - Test JSON format output
    - Test log filtering by level
    - Verify all required fields present in log events
    - _Requirements: 20.6, 20.7_

- [ ] 12. Add Volume Confirmation Features
  - [~] 12.1 Implement volume_ratio feature calculation
    - Add volume_ratio feature (current_volume / volume_ma_20) to feature engineering
    - Calculate 20-day volume moving average in training and live pipelines
    - _Requirements: 11.4, 11.5_
  
  - [~] 12.2 Integrate volume confirmation into labeling
    - Ensure `TripleBarrierLabeler` uses volume confirmation when `require_volume_confirmation=True`
    - Add volume check in `StrictQualityLabeler` for quality filtering
    - _Requirements: 3.4, 7.2, 11.5_
  
  - [~] 12.3 Write unit tests for volume confirmation
    - Test label rejection when volume below threshold
    - Test label acceptance when volume above threshold
    - Test graceful handling when volume data missing
    - _Requirements: 11.2, 11.3_

- [ ] 13. Create Integration Test Suite
  - [~] 13.1 Write test for training-backtest consistency
    - Generate synthetic OHLCV data with known outcomes
    - Run training labeling and backtest simulation on identical data
    - Assert outcomes match within tolerance (<10% mismatch)
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  
  - [~] 13.2 Write test for parameter persistence
    - Test parameter round-trip: create → save → load → verify
    - Test with multiple barrier modes (percent, atr_multiplier)
    - _Requirements: 14.5_
  
  - [~] 13.3 Write test for data leakage prevention
    - Test walk-forward splits have no train/test overlap
    - Test feature calculation doesn't use future data
    - _Requirements: 6.7, 14.3_
  
  - [~] 13.4 Write regression tests for legacy compatibility
    - Test loading old model artifacts without unified sections
    - Verify defaults applied correctly for missing parameters
    - Ensure existing trained models still work
    - _Requirements: 12.5, 14.1_

- [ ] 14. Create Documentation for EGX Market Characteristics
  - [~] 14.1 Document liquidity concentration and thin trading
    - Create `docs/EGX_MARKET_GUIDE.md` explaining 60% liquidity in top 20 stocks
    - Document implications for volume filtering and signal quality
    - _Requirements: 19.1, 19.2_
  
  - [~] 14.2 Document circuit breaker rules and detection
    - Explain ±5% daily limits and trading halt mechanisms
    - Document detection heuristics and edge cases
    - _Requirements: 19.3_
  
  - [~] 14.3 Document sector concentration and macro factors
    - Explain banking sector dominance (40% market cap)
    - Document USD/EGP, interest rate, and regime impacts
    - _Requirements: 19.4, 19.5, 19.6, 19.7_

- [ ] 15. Create Roadmap Documentation
  - [~] 15.1 Document Phase 2 macro features
    - Create `docs/ROADMAP.md` with Phase 2-4 plans
    - Specify USD/EGP, interest rate, sector momentum, dividend calendar features
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
  
  - [~] 15.2 Document Phase 3-4 plans
    - Document paper trading validation plan with success criteria
    - Document SaaS launch features: subscription tiers, signal dashboard, risk profiles
    - _Requirements: 15.7, 15.8_

- [~] 16. Final Checkpoint - End-to-end validation
  - Run complete training on real EGX data with unified system
  - Run backtest on trained model and verify consistency
  - Run live bot in dry-run mode with parameter validation
  - Review all logs for errors or warnings
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability (e.g., _Requirements: 1.1, 1.2_)
- Checkpoints ensure incremental validation at key milestones
- Python is used throughout (existing codebase language)
- All code integrates with existing `api/` directory structure
- Testing strategy focuses on integration tests and example-based unit tests (property-based testing not applicable for this infrastructure/integration work)
- Unified modules (trading_config.py, unified_features.py, unified_labeling.py, model_catalog.py) already exist and are being integrated
- Focus is on refactoring existing scripts to use centralized logic and adding EGX-specific enhancements

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "4.1"] },
    { "id": 3, "tasks": ["2.3", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["4.5", "5.1"] },
    { "id": 5, "tasks": ["4.6", "5.2"] },
    { "id": 6, "tasks": ["5.3", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "8.1"] },
    { "id": 8, "tasks": ["7.4", "8.2", "8.3", "9.1"] },
    { "id": 9, "tasks": ["7.5", "8.4", "9.2", "12.1"] },
    { "id": 10, "tasks": ["8.5", "11.1", "12.2"] },
    { "id": 11, "tasks": ["11.2", "12.3", "13.1"] },
    { "id": 12, "tasks": ["11.3", "13.2", "13.3"] },
    { "id": 13, "tasks": ["13.4", "14.1", "14.2"] },
    { "id": 14, "tasks": ["14.3", "15.1"] },
    { "id": 15, "tasks": ["15.2"] }
  ]
}
```
