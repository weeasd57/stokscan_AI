# Financial and Spend Breakdown — EGX Bots

EGX Bots was engineered with a **zero-maintenance, serverless architecture** to keep operational costs virtually non-existent, maximizing profit margins for any potential acquirer.

---

## 1. Monthly Operating Costs (Spend Breakdown)

| Service | Provider | Purpose | Monthly Cost (USD) | Tier |
|---|---|---|---|---|
| **Frontend Hosting** | Vercel | Hosting the Next.js web application | **$0.00** | Hobby / Free Tier |
| **Database & Auth** | Supabase | Storing stock data, user profiles, portfolios, and authentication | **$0.00** | Free Tier (Up to 500MB DB) |
| **Automation Worker** | Hugging Face | Running the daily automated pipeline (syncing prices, AI runs, alerts) | **$0.00** | Spaces Free CPU Basic |
| **Market Data APIs** | YFinance & TV | Free scraped/unauthenticated data providers | **$0.00** | Open-source libraries |
| **Notifications** | Telegram | Real-time buy/sell and portfolio exit alert delivery | **$0.00** | Telegram Bot API (Unlimited Free) |
| **Domain Name** | Namecheap/GoDaddy | Platform domain (e.g. `egxbots.com`) | **~$0.83** | ~$10.00/year |
| **TOTAL** | | | **~$0.83 / month** | |

---

## 2. Infrastructure Profitability Analysis

* **99.9% Gross Profit Margin:** Because all backend computations, databases, and hosting tiers reside on free or extremely low-cost serverless packages, scaling to thousands of active users incurs no additional infrastructure costs.
* **Database Optimization:** The system is heavily optimized. It pre-computes and caches summaries (like heatmaps and news sentiments) during the daily run, preventing query bloat on the Supabase database.
* **No Premium Data Subscriptions Required:** The system operates successfully on reliable free financial data crawlers, avoiding expensive premium feed costs (like Bloomberg or Reuters APIs).

---

## 3. Potential Revenue Models for Acquirers

1. **Premium Telegram Signals:** Charge EGX retail traders a monthly fee (e.g., $10–$25/month) to receive instant private buy/sell triggers.
2. **SaaS Web Subscription:** Lock advanced features (like the *Historical Similarity Scan* and *AI Scanner*) behind a premium web dashboard paywall (Stripe/Paymob integration ready).
3. **Copy-Trading / Managed Portfolios:** Partner with Egyptian brokers to route signals directly to active trading accounts.
