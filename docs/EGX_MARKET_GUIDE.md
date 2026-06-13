# EGX Market Guide

This guide describes the unique characteristics, structural mechanics, and macroeconomic factors governing the Egyptian Exchange (EGX). It is designed to provide critical context for developers and algorithmic systems trading EGX assets.

---

## 1. Liquidity Concentration & Thin Trading

### The Pareto Principle in EGX
Liquidity on the Egyptian Exchange is heavily skewed towards a handful of large-cap stocks.
* **Top 20 Concentration**: Approximately **60% of total daily traded value** is concentrated in the top 20 stocks (dominated by Commercial International Bank - `COMI`).
* **The Tail**: The remaining 100+ listed companies suffer from extremely low liquidity.

### The Thin Trading Problem
Thin trading is a primary source of data anomalies in the EGX:
* **Stagnant Price Series**: It is common for mid-cap and small-cap stocks to go **days or even weeks without a single transaction**, resulting in flat price charts.
* **Algorithmic Hazard**: Flat periods can lead to artificial volatility suppression, rendering standard indicators like ATR, Bollinger Bands, and RSI unreliable or static.
* **Execution Slippage**: Placing market orders on illiquid symbols will result in massive slippage. Systems must prioritize liquid symbols (`COMI.CA`, `EAST.CA`, `FWRY.CA`, etc.) and enforce strict minimum volume filters.

---

## 2. Circuit Breaker Rules (EGX vs. US)

The EGX utilizes a strict, symbol-level price limit mechanism to control volatility, which differs fundamentally from the US market-wide circuit breakers.

| Feature | EGX Circuit Breakers | US Circuit Breakers (LULD) |
| :--- | :--- | :--- |
| **Trigger Mechanism** | Daily price movements relative to the previous day's close. | Dynamic price bands based on recent average price (Limit-Up/Limit-Down). |
| **Symbol Limits** | **±5%** daily limit triggers a temporary halt (10-30 minutes). **±10% to ±20%** triggers a halt for the rest of the session. | **±5%, ±10%, or ±20%** triggers a 5-minute pause. |
| **Market-Wide Halts** | Triggers if the `EGX100` or `EGX30` index drops **-10%** (halts trading for 30 mins or the session). | Triggers if the `S&P 500` drops **-7% (Level 1)**, **-13% (Level 2)**, or **-20% (Level 3)**. |
| **Data Implication** | **Price Flattening**: Once a stock hits its daily limit, trade halts or stagnates, resulting in high == low bar structures. | Trading continues within bands; halts only happen on limit state duration. |

### Algorithmic Handling
Trading systems must detect active circuit breakers to avoid issuing buy orders at limit prices where liquidity has vanished:
* **Circuit Breaker Condition**: If `high == low` or `(high - low) / close < 0.1%` on intraday or daily bars, a circuit breaker is likely active.
* **Filtering**: Reject new entry signals on flagged bars.

---

## 3. Sector Correlation Patterns

Egyptian stocks display strong intra-sector correlations, primarily driven by institutional asset allocations and index-tracking funds.

### The Banking Sector
* **Anchor**: `COMI` (Commercial International Bank) is the bellwether of the EGX.
* **Sympathy Movements**: Other banks (e.g., ADIB, QNBA, CIEB) exhibit high correlation with `COMI`. When foreign institutions buy/sell Egypt, they primarily trade `COMI`, which drags the entire financial sector and index with it.

### Real Estate and Materials
* **Real Estate**: Companies like TMG Holding (`TMGH`), Heliopolis Housing (`HELI`), and Madinet Masr (`MASR`) move in tight tandem, highly sensitive to interest rate decisions and national development announcements.
* **Materials & Construction**: Ezz Steel (`ESRS`) and Misr Cement are highly correlated with real estate cycles and global commodity prices.

---

## 4. Macro Factor Dominance

Unlike developed markets where micro-fundamentals (earnings, product launches) drive individual stock prices, the EGX is heavily dominated by macroeconomic factors.

### USD/EGP Exchange Rate (Forex)
* **Inflation Hedge**: Currency devaluations (e.g., 2016, 2022, 2023, 2024) historically trigger **massive equity rallies** in EGP terms. Local investors buy stocks (especially exporters or asset-rich companies like `COMI` or `TMGH`) to hedge against currency depreciation.
* **Exporters vs. Importers**: Exporters (e.g., fertilizers, chemicals, agribusiness) benefit directly from a weaker EGP, while import-dependent manufacturers face margin squeezes.

### CBE Interest Rates
* **Monetary Policy**: High interest rates set by the Central Bank of Egypt (CBE) to combat inflation present a major headwind for equities.
* **Capital Reallocation**: When risk-free treasury yields and certificates of deposit (CDs) yield 20%+, capital flows out of the stock market into bank deposits and fixed-income assets.

---

## 5. Historical Outlier Regimes

Historical backtests must account for specific outlier regimes that behave unlike normal market conditions:

1. **The 2020 COVID-19 Crash (March - May 2020)**:
   * **Behavior**: Severe liquidity crunch, consecutive limit-down days, index halts. Standard momentum and mean-reversion strategies suffered heavy losses.
2. **The 2022 Currency Devaluation Crisis (Oct 2022 - Early 2023)**:
   * **Behavior**: The EGP floated, losing ~50% of its value. Equity markets surged in EGP terms, causing massive bullish trend-following expansions.
3. **The 2024 IMF & Ras El Hekma Deal (Feb - March 2024)**:
   * **Behavior**: Egypt secured a $35B investment deal, leading to currency stabilization and interest rate hikes. Markets experienced extreme volatility with massive sector rotations.
