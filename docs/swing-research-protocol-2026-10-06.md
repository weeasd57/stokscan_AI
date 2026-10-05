# Offline swing research protocol — frozen before expanded results

No production edits, deployment, live trades, training or provider inference.

## Question and selection

Can a simple, reproducible price-only entry rule support approximately five-session holds, with a trend extension, without relaxing the production council/R:R filters blindly?

Use the locally pinned HF OHLCV snapshot ending 2026-09-24. Warm up from 2021. All symbols available in the snapshot are considered; historical listing completeness and corporate-action adjustment remain unverified. Do not claim a survivor-free universe.

18 predeclared configurations: three entry families (20-session breakout, EMA10 pullback recovery, moderate five-session momentum), market breadth gate on/off, and three exit rules (fixed five sessions with ATR stop; five-session review plus ATR trend trail; five-session review plus fixed 5% stop/4% trail). No ML inference or current fundamentals/news.

Development: 2022–2023. Validation: 2024. Select only a configuration positive in both, at least 50 closed development trades and 25 validation trades, average hold 3–8 sessions in each, maximum drawdown <=15% each. Rank qualifying configurations by the minimum of return minus drawdown across the two periods. No winner if none qualifies; a diagnostic leader is not a recommended strategy.

Freeze the selection before testing 2025 and 2026-01-01 through 2026-08-31. September 1–24 is a partial-month stress window, not a whole-September result. These are retrospective temporal tests, not genuinely untouched live observations: previous research has already inspected parts of these years.

## Execution assumptions

Signal at completed close, entry next global observed market session only. Prior 20-session turnover >= EGP 2m, at least 120 valid observations, positive volume on 18 of previous 20 bars, no >20% close discontinuity within preceding 20 bars, and normal OHLC consistency. These are known-at-signal restrictions, not exclusions based on future losses. Entry open must be within -5%/+2% of signal close; treat this as an idealized opening-price conditional order, not guaranteed broker execution.

Conservative settlement scenario: sales cannot execute until two market sessions after purchase; cash proceeds are not reusable until two sessions after sale. A stop touched before sale eligibility queues an exit for the first eligible tradable open. This is a stress convention, not a claim that every broker/account requires it. No fills on zero-volume or single-price bars. Orders skipped on missing next-session bars are not delayed to a convenient later date.

EGP 100k starting cash per experiment, <=5 simultaneous positions, <=10% equity allocation per position, <=50% entry exposure, <=1% of preceding turnover. Fees 10bp and slippage 10bp per side (~40bp round trip); stress doubles both (~80bp). These are scenarios, not verified actual broker tariffs. No leverage, dividends, tax model or assumed reinvestment of future profits.

ATR14 known at signal sets initial stop distance clipped to 3–8%; trend ATR trail is 2x signal ATR/price clipped to 3–10%. Five-session review exits next eligible open unless gain >=2%, close > EMA10, EMA5 > EMA10 and EMA10 rising. Maximum 15 completed sessions; trail only uses completed closes and applies on later bars. Fixed-five comparator has identical ATR stop but no extension. Overnight gaps fill at open rather than the stop level. Missing bars retain stale valuation and are reported.

## Acceptance after selection

For a paper-test candidate: positive 2025 and 2026 Jan–Aug returns after doubled costs; >=100 combined closed test trades; drawdown <=15%; average hold 3–8 sessions; positive combined test return after excluding the two largest P&L-contributing symbols (post-hoc sensitivity only). Report monthly returns, open positions, corporate-action-like exposure, and block-bootstrap daily-return uncertainty. These gates do not establish future profitability. Unresolved data/execution issues can still block a candidate.

Compare against cash and the matched fixed-five exit; include equal-weight price-universe context only if clearly labelled non-investable and survivor-affected. No optimizing against final windows after viewing them. If no candidate passes, preserve the failed result rather than widening the grid opportunistically.

Settlement reference: https://www.mcsd.com.eg/en/activities-services/clearing-settlement (T+0 is conditional; ordinary central-depository securities have T+2 settlement). Historical eligibility by symbol/account has not been verified.
