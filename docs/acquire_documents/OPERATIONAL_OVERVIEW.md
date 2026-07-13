# Operational Overview — EGX Bots

EGX Bots is a fully automated, microservices-driven stock intelligence and signal generation platform tailored specifically for the Egyptian Stock Exchange (EGX). 

This document explains the architecture, daily automated pipeline, and deployment guide for potential buyers.

---

## 1. System Architecture & Component Flow

The platform separates the user-facing interface from the computationally intensive daily data collection and model evaluations. This separation guarantees high performance and zero database bottlenecks.

```
┌─────────────────────────────────┐
│     Hugging Face Daily Worker   │ (Scheduled Cron Job, Runs Daily)
└───────────────┬─────────────────┘
                │
                │ 1. Syncs stock prices from TradingView/yfinance
                │ 2. Calculates 50+ technical indicators
                │ 3. Processes news sentiment (AI Sentiment Analysis)
                │ 4. Evaluates old recommendations & exits hit positions
                │ 5. Executes AI Scans (LightGBM/Optuna trained models)
                │ 6. Executes KNN-based Historical Similarity Searches
                │ 7. Precomputes & saves heatmaps to database
                │
                ▼
┌─────────────────────────────────┐
│      Supabase Database & API    │ (Core Data Store, Auth, Real-time Engine)
└───────────────┬─────────────────┘
                │
                ├─────────────────────────────────┐
                ▼                                 ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│     Next.js Web Application     │     │      Telegram Alert Bots        │
│    (Vercel hosted dashboard)    │     │   (Private & Central Channels)  │
└─────────────────────────────────┘     └─────────────────────────────────┘
```

---

## 2. Platform Core Tech Stack

* **Frontend:** Next.js (TypeScript, React) styled with custom premium dark-mode glassmorphism and modern tailwind layouts, hosted on **Vercel**.
* **Database & Auth:** **Supabase (PostgreSQL)**, utilising row-level security (RLS) policies for user data security.
* **Backend Automation Engine:** **Python 3.10** running on **Hugging Face Spaces**.
* **AI/ML Infrastructure:** **LightGBM** (gradient boosting classifier) for signal scoring, **Optuna** for hyperparameter tuning, and **Scikit-learn** for cosine-similarity pattern matches.
* **Notification Layer:** **Telegram Bot API** with an asynchronous outbound queue.

---

## 3. The Daily Automated Pipeline (The Engine)

Every day, the Hugging Face engine runs `run_daily_bot_job.py`, executing the following sequential steps:

1. **`sync_inventory`:** Scans current active listings on the EGX.
2. **`sync_prices`:** Connects to free providers to download the latest EOD daily candle bars (OHLCV).
3. **`calculate_indicators`:** Computes moving averages (SMA/EMA), oscillators (RSI, MACD, Stochastic), trend indicators (ADX), and volatility metrics (ATR, Bollinger Bands).
4. **`news_sentiment`:** Fetches financial news feeds, runs sentiment classification, and rates sentiment from -1 (extremely bearish) to +1 (extremely bullish).
5. **`update_positions`:** Checks user portfolio entries against target/stop levels using daily high/low bars, closes triggered entries, and alerts users.
6. **`evaluate_recommendations`:** SMART-adjusts recommendation barriers (TP/SL) based on trend momentum (raising targets in strong uptrends and trailing stops to lock profit).
7. **`generate_recommendations`:** FE-evaluation of ML models (KING & Council) to generate buy signals for stocks with >60% confidence scores.
8. **`historical_similarity`:** Computes cosine-similarity on stock technical indicators over the last 10 years to find matching chart patterns.
9. **`system_digest`:** Compiles and fires a structured summary report to the Telegram administration channel.

---

## 4. Maintenance & Operations

* **Zero-Touch Maintenance:** The entire stack operates autonomously. The Hugging Face worker is scheduled using simple web-crons, requiring no manual script triggers.
* **Alert & Monitoring System:** If any daily job step fails, an immediate notification is pushed to the Admin Telegram channel with stack traces.
* **Database Pruning:** Older logs and historical similarity reports are pruned automatically to keep database sizes under free-tier limits.
