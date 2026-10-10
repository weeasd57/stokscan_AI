# Admin portfolio review regression — 2026-10-10

## Observed cases

The two latest admin requests (07:38 and 07:39 Cairo) returned safe fallbacks:
- Explicit 60/25/15 concentration analysis: both reviewer outputs hit the 800-token ceiling; neither produced a complete verdict.
- Equal-weight 100,000 EGP scenario: table validation incorrectly attributed total remaining portfolio values 95,000 and 90,000 to TMGH, the last stock mentioned in a previous table.

## Changes

- Bind portfolio stress rows to their own percentage and derived remaining capital. Override inherited stock ownership only for recognized portfolio/group rows. Keep stock-specific and per-row checks: incorrect remaining values and attributing a portfolio total to a stock still fail.
- Require concise reviewer JSON, disable thinking for review requests, allow 1,200 output tokens, and retry a truncated review once with 1,600 tokens before rewriting the answer. The existing seven-call limit and request deadline remain in force. Partial verdicts are never accepted; retry costs remain recorded.
- Add explicit LLM-selectable equal allocation mode. Tool instructions distinguish equality from rounded explicit weights. Equal amounts use integer cents, distributing rounding cents across the last amounts while preserving the capital; percentages retain equal four-decimal shares. Existing specified 60/25/15 weights are preserved.
- Provide clear scenario limitations: allocation concentration and hypothetical stress do not measure actual historical volatility/correlation or purchase costs.

## Verification

- 658 offline AI tests across 47 suites passed, including replayed portfolio stress output, reviewer truncation recovery, stock-total isolation, wrong remaining amounts, exact equal-weight capital sum and nonnegative tiny-capital rounding.
- TypeScript passed. Production build checked in an isolated copy with empty local Supabase fixtures; no paid LLM calls or saved-portfolio writes performed.
