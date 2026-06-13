# EGX AI Platform Project Roadmap

This document outlines the strategic roadmap and future phases for the EGX AI trading and analytics platform.

---

## 🗺️ Implementation Phases

### Phase 1: MVP Core Consistency & Verification (Current)
* **Status**: ✅ Completed
* **Focus**: Establish solid analytical foundations. Ensure that walk-forward splits, feature engineering, and triple-barrier labelers are perfectly consistent across the training, backtesting, and live execution pipelines. Implement strict volatility filters and circuit breaker detection.

---

### Phase 2: Macro & Sector Feature Integration (Q3 2026)
* **Objective**: Leverage macroeconomic indicators to enhance predictive precision, specifically aligning models with the dollar-pegged and rate-sensitive nature of the Egyptian economy.
* **Key Deliverables**:
  1. **USD/EGP Currency Ingestion**:
     * Fetch daily exchange rates from Yahoo Finance (`EGP=X`).
     * Extract features: `usdegp_change` (daily pct change) and `usdegp_trend` (relative to 20-day MA).
  2. **CBE Interest Rate Tracking**:
     * Ingest Central Bank of Egypt interest rate decisions (8 times per year).
     * Add features: `cbe_rate_level` and `cbe_rate_change`.
  3. **Sector Momentum Indicators**:
     * Group stocks into sectors (Banking, Real Estate, Materials, etc.).
     * Calculate rolling 5-day sector-wide average returns to capture sector rotation momentum.
  4. **Dividend Calendar Exclusions**:
     * Maintain a calendar of ex-dividend dates.
     * Implement an exit/entry filter to block buy entries within **5 days prior to ex-dividend** to avoid dividend drop volatility.
  5. **Recommended Look-Forward Optimization**:
     * **Reducing holding period**: Reduce `look_forward_days` from the current **20 days to 7-10 days** (or bars). EGX signals decay rapidly, and shorter barriers optimize asset utilization and risk exposure.

---

### Phase 3: Paper Trading & Staging Validation (Q4 2026)
* **Objective**: Validate model performance in a live forward-testing environment without financial risk.
* **Validation Guidelines**:
  * **Duration**: Mandatory **3 months** of continuous paper trading.
  * **Precision Threshold**: The primary signal model (KING + Council) must achieve a minimum **60% precision threshold** on paper signals.
  * **Slippage Evaluation**: Track and measure the difference between virtual fill prices and actual live quote prints to refine the `slippage_buffer_pct` parameter.

---

### Phase 4: SaaS Platform Launch (Q1 2027)
* **Objective**: Package the algorithmic engine into a commercial SaaS subscription offering for retail and institutional EGX traders.
* **Features**:
  1. **Subscription Tiers**:
     * **Tier 1 (Bronze)**: Daily market summaries + delayed signals.
     * **Tier 2 (Silver)**: Real-time Telegram signals + basic portfolio tracking.
     * **Tier 3 (Gold)**: Instant WhatsApp alerts + API webhooks (e.g., Cornix) + detailed Signal Explanations.
  2. **Interactive Signal Explanations**:
     * For each generated signal, display a detailed card showing:
       * Primary model (KING) confidence score.
       * Council consensus voting breakdown.
       * Historical Similarity patterns ("شبه ده" - nearest neighbor matching to past similar regimes).
  3. **Risk Profile Customization**:
     * Allow users to select their risk tolerance profile:
       * **Defensive**: Low size, strict panic limits, high volume confirmation.
       * **Aggressive**: Larger sizes, trades during sideways regimes, tighter circuit-breaker tolerances.
