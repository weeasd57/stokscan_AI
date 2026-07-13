# EGX Bots — Complete Listing Description (Microns.io)

### 1. Startup Description
EGX Bots is a fully automated, AI-powered stock scanner and trading signal platform designed specifically for the Egyptian Stock Exchange (EGX). The project was started to democratize quantitative, machine-learning-based trading tools for retail stock traders in Egypt, a highly active market with over 1 million retail participants. The platform automates stock scanning, technical analysis (50+ indicators), financial news sentiment scoring, and portfolio risk management.

### 2. Key Highlights
* **Target Market:** Egyptian Stock Exchange (EGX) — a highly active emerging market with massive retail trader participation (e.g. apps like Thndr, Mubasher, Hermes).
* **Zero Running Costs ($0/mo):** Built entirely on free-tier serverless services (Vercel, Supabase, Hugging Face).
* **Pre-revenue / Starter codebase:** The product is fully built, tested, and ready to launch/monetize from day one.
* **Subscription-Ready:** Includes built-in user authentication, profiles, and automated Telegram bot subscription hooks.

### 3. Tech Stack
* **Frontend:** Next.js (React, TypeScript) styled with custom premium dark-mode glassmorphism and modern tailwind layouts, hosted on **Vercel**.
* **Database & Auth:** **Supabase (PostgreSQL)** with Row-Level Security (RLS) policies.
* **Automation Engine:** **Python 3.10** running on **Hugging Face Spaces** as a scheduled cron job.
* **AI/ML Infrastructure:** **LightGBM** classifier optimized with **Optuna** for trading signals, and **Scikit-learn (KNN Cosine Similarity)** for the historical chart similarity search engine.
* **Messaging Layer:** **Telegram Bot API** with asynchronous queue handling for instant user signals and exit alerts.

### 4. Team
* Developed entirely by **one founder** (Full-Stack Engineer).
* **Responsibilities:** No active management is required post-launch; the daily data crawling, machine learning predictions, and Telegram bot notification pipeline run entirely automatically.

### 5. Marketing and Growth
* **Growth activities:** The platform is equipped with a viral loop via Telegram bots. Acquirers can offer free public channel signals and charge a subscription fee for custom real-time portfolio exit alerts.
* **Marketing ready:** High-margin potential via targeted social media marketing (Facebook groups, Twitter finance, Telegram groups focusing on Egyptian stocks).

### 6. Revenue and Profit
* **Current Revenue (ARR/MRR):** $0 (Pre-revenue, starter codebase).
* **Profit Margin:** **99.9%** (Only cost is the domain name renewal of ~$10/year). 

### 7. Return on Investment
* **Monetization:** An acquirer can achieve payback within months by introducing subscription tiers (e.g., $10–$25/month for private Telegram signals and portfolio tracking). With 50 active premium subscribers, the platform generates $500–$1,250/month in pure profit due to the $0 monthly infrastructure cost.

### 8. Startup Assets Included in Sale
* **Source Code:** Complete Next.js frontend code & Python backend automation scripts (100% clean, verified, and green with 97 unit tests).
* **Domain Name:** `egxbots.com`
* **Database Schema:** Full Supabase Postgres schema configuration.
* **Automation setup:** Hugging Face Space configuration.
* **Documentation:** Full deployment guides and guides on market mechanics.

### 9. Risks and Mitigation
* **Data Provider Staleness:** If a free price crawler goes down, indicators could lag.
  * *Mitigation:* The codebase includes automatic fallbacks between Yahoo Finance, TradingView, and local JSON price caches.
* **Localized Market Risk:** Egyptian market dynamics.
  * *Mitigation:* The system includes built-in safeguards (market panic gates and circuit-breaker detectors) that automatically pause signal generation during volatile trading halts.

### 10. Summary
EGX Bots is a unique, fully completed, and zero-cost micro-SaaS targeting a high-demand retail trading market. It is the perfect opportunity for an entrepreneur, developer, or marketer to acquire a high-quality codebase and launch a profitable subscription business on day one with zero ongoing infrastructure overhead.
