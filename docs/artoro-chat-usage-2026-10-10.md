# ARTORO chat and admin usage — 2026-10-10

- The widget header is compact and named ARTORO; the agent identifies itself as ARTORO.
- Empty/cleared/reopened composer resets to 40px regardless of placeholder wrapping. Nonempty input grows to 160px, then scrolls. Message area can shrink in flex layout; mobile uses dynamic viewport height and real safe-area insets.
- Per-request accounting captures chat, reviewer, repair, portfolio authorization and vision provider attempts. Response usage is captured before content validation, so truncated/invalid results retain tokens. Known usage survives fallbacks/deadlines; unanswered attempts are unavailable rather than free.
- Existing `ai_chat_messages.metadata.usage` persists accounting for streaming and ordinary replies; no migration is required. Non-streamed replies also persist correlation IDs.
- Admin message details show model, tokens, cache hits, provider calls and individual USD estimates, message/session/request IDs, timestamp, data source and review status.
- Admin-only `/api/admin/ai-chatbot/usage` aggregates retained assistant history independently of displayed logs. Identity/usage-only projection, stable ID pagination, request cutoff and incremental summaries; cap 50,000 messages with explicit partial flag. Failed queries never report zero totals. Private/no-store responses. Hard-deleted history cannot be reconstructed.
- Historical messages without complete accounting are counted as unpriced, never guessed or set to zero. User estimates include known portions of partially priced messages.
- Pricing snapshot: https://api-docs.deepseek.com/quick_start/pricing/ accessed 2026-10-10. Cache-aware Flash/Pro USD estimates use UTC peak/off-peak scheduling. Missing cache details use the higher input rate. Chinese public-holiday discounts are not inferred. NVIDIA/unknown models remain unpriced. Displayed costs are estimates, not invoices or confirmed cash deductions.
- Provider retirement reference: https://api-docs.deepseek.com/news/news260424/. Legacy UI `deepseek-chat`/`deepseek-reasoner` selections use supported `deepseek-flash` with thinking disabled/enabled respectively; returned model recorded. No paid smoke calls or production jobs were run.

## Validation

- Full offline suite: 1,242 passed, 22 skipped before final targeted additions.
- Targeted checks cover composer reset/reopening, precise USD display, missing/partial totals, cache/peak rates, retries/fallback retention, vision truncation accounting, admin authorization and pagination beyond 1,000 messages.
- TypeScript passed; production build verified in an isolated copy using an empty local Supabase fixture for public-page generation.
