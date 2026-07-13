# Pitch Deck: EGX Bots
### Automated AI-Powered Trading Signal & Portfolio Platform for the Egyptian Stock Exchange (EGX)

---

## 1. Executive Summary

**EGX Bots** is a premium, fully automated micro-SaaS platform providing AI-powered stock scanner utilities, trading recommendation signals, and real-time portfolio tracking for retail investors in the Egyptian Stock Exchange (EGX). 

* **The Vision:** Democratise institutional-grade quantitative trading tools for Egyptian retail traders.
* **The Business:** Zero hosting/running costs, fully automated database synchronisation, and a ready-made Telegram premium subscription funnel.

---

## 2. The Problem

The Egyptian Stock Exchange (EGX) represents one of the highest retail-trader concentrations in the Middle East. However:
1. **Lack of Tools:** Retail traders lack easy-to-use quantitative indicators or machine learning algorithms to find entries.
2. **Thin Liquidity & Thin Movements:** EGX contains many stocks that remain stagnant for weeks, making manual tracking time-consuming.
3. **Unique Market Mechanics:** High volatility and specific circuit-breaker rules (trading halts at ±5%, ±10%, or ±20% price changes) create unique trading conditions that global tools (like TradingView screeners) cannot easily handle.

---

## 3. The Solution: EGX Bots

An intelligent, data-driven system built specifically for the Egyptian market:

* **Triple-Barrier Machine Learning Models:** LightGBM classifier models trained using the Triple-Barrier method, optimizing for profit targets, stop-losses, and maximum holding times.
* **Tailored EGX Market Filters:** Built-in safeguards that reject entry signals during market panic, low-volume days, or active circuit breakers.
* **Historical Similarity Engine ("Shabah Dah"):** Computes cosine similarity of technical charts to locate the top 10 historical patterns similar to today's action, predicting future target success rates.
* **Dynamic Portfolio Alerts:** Automatically updates portfolios and pushes real-time Telegram notifications when profit targets or stop-loss hits occur.

---

## 4. Key Platform Features

1. **Market Scanner Dashboard:** Sleek, glassmorphism web interface showing AI buy rankings, technical indicator scores, and news sentiments.
2. **Interactive Chart Analytics:** Displays the historical success rate of signals for each stock.
3. **Sector Heatmap:** Instant sector capital flow and gainers/losers overview.
4. **Subscription-Ready Telegram Bot:** Users sign up on the platform, link their Telegram accounts, and instantly receive premium signals and portfolio exit warnings.

---

## 5. Technology Stack & Running Costs

* **Frontend:** Next.js (React, TypeScript), hosted on **Vercel**.
* **Database:** Supabase (Postgres with REST and Real-time WebSockets).
* **Automation Engine:** Python 3.10 daily crawler hosted on **Hugging Face Spaces**.
* **Monthly Infrastructure Cost:** **$0.00** (Zero). Fully utilizes serverless and free hobby tiers. Acquirer only pays ~$10/year for the domain name.

---

## 6. Target Audience & Growth Potential

* **Target Market:** Over 1 million active retail traders in Egypt (using apps like Thndr, Hermes, and Mubasher).
* **Marketing Advantage:** Ready-to-go viral Telegram bot loop. Users receive free signals in the main channel and subscribe to get custom portfolio tracker notifications.
* **Scale Ready:** Database indexes and API cache layers are optimized for fast response times even during high concurrent traffic.
