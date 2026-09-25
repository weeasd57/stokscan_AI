# Vercel / Supabase usage audit — 2026-09-25

## Scope and limitations

Read-only diagnosis; no application, infrastructure, billing, or deployment changes.
Supabase evidence window: 2026-09-24 13:00 UTC to 2026-09-25 13:00 UTC (16:00 to 16:00 Cairo).
This includes traffic before the latest polling fixes. It cannot measure their resulting savings.
Content-Length was available for 16,671 of 26,065 edge requests. Missing/chunked lengths are unknown, not zero. Known response bytes below are not a reconciliation of billed egress.

## Largest proven transfer source

| Source | Requests | Known response bytes |
| --- | ---: | ---: |
| Supabase old-stock-data object downloads | 2,446 | 68,488,681 |
| old-stock-data object listings | 22 | 1,713,254 |
| Auth /user | 1,139 | 559,533 |
| Telegram recommendation claim RPC | 1,480 | 2,960 |

235 distinct archive paths were downloaded repeatedly. Summing the maximum observed size per distinct path gives 6,657,793 bytes, versus 68,488,681 downloaded. If files were unchanged, reusing them could theoretically avoid 61.83 MB (90.28%) of these object downloads—not 90% of overall project egress.

All observed archive downloads used supabase-py/storage3 v0.5.5 on Vodafone-Data-Routes. This is consistent with local Python migration/audit runs, not proof of an exact process. api/migrate_egx_history.py and api/migrate_storage_archive.py contain full archive download paths. The current api/archive_reader.py reads the HF history snapshot instead.

| Cairo hour on September 24 | All API requests | Archive downloads | Known bytes, all sized responses |
| --- | ---: | ---: | ---: |
| 16:00–16:59 | 1,884 | 917 | 26,147,414 |
| 17:00–17:59 | 6,102 | 692 | 19,916,870 |
| 22:00–22:59 | 1,995 | 837 | 24,692,321 |

Other frequent paths: stock_prices 4,830; subscriptions 4,023; profiles 1,851; stock_fundamentals 1,483; stock_technical_indicators 1,127; scan_results 860; market_cache 695. Their missing response sizes prevent a reliable total bandwidth ranking. Some stock_prices requests are writes/deletes, not chart reads.

## Caching findings

Not all data is cached for 24 hours.

| Path / workload | Observed or implemented behavior |
| --- | --- |
| /api/scan/similarity/published | Production MISS then HIT; decoded JSON 1,676,405 bytes; CDN TTL 86,400 seconds |
| /stocks/comi | Two production MISS responses; private/no-store; decoded HTML 73,894 bytes |
| Stock detail rendering | Seven Supabase query call sites across metadata/page; cookie-based server client; no explicit common dataset cache |
| /api/scan/technical | POST; underlying technical/fundamental reads and filtering are not covered by ordinary CDN GET caching |
| /api/ai_bot/recommendations | Private 300-second response; auth/plan checks and fallback reads |
| /api/ai_bot/candles | Private 60-second response; upstream no-store |
| Admin user statistics | Dynamic reads, including paginated 90-day activity/message retrieval and Node aggregation |
| Admin portfolios | Dynamic holdings/prices/profiles/auth reads and Node aggregation |

The latest similarity_reports.scans JSON text measured 2,058,127 bytes in SQL. This differs from the public API body and is not a wire-size or disk-size measurement. Thirty successful report GETs lacked response lengths; multiplying the current report size by 30 would not establish actual past egress.

Total cache size remains unmeasured. The 1.676 MB response is one entry, not the whole cache. There are URL/query variants, regional copies, and different TTLs. A 24-hour TTL is not evidence that the entire cache is downloaded once per day. Daily invalidation uses category tags; it does not merge changed database rows. A full-layout invalidation path exists but is not the ordinary daily tagged path.

## Vercel CPU attribution

The per-route function_cpu_time_ms metric request was rejected with payment_required: Observability Plus is required. No upgrade was performed. The usage CLI returned 404, not zero usage.

Runtime request logs expose route, timestamp, method, status, cache state, and deployment, but not per-request CPU or response size. Pagination repeated records; results were deduplicated by ID rather than counted as additional requests.

Usable sample: 50 unique requests, September 25 12:50:37–12:58:52 UTC (15:50:37–15:58:52 Cairo). Serverless misses included recommendations 5, quota 5, ai-chat GET 2, similarity 2, news 2, and one each technical POST, portfolio, stock detail, and analytics POST. ai-chat GET is session retrieval, not evidence of an AI completion. This short sample cannot rank daily billed CPU.

Fluid Active CPU counts execution, not time waiting for network I/O. Request duration, response size, and invocation count therefore cannot individually establish billed CPU consumption.

## Prioritized next changes — not implemented by this audit

1. If archive migration/audit runs continue, persist and reuse unchanged archive files and avoid repeated listing/download passes.
2. Cache common public stock datasets by symbol/date and reuse metadata/page reads; keep private/auth-dependent responses isolated.
3. Cache scanner input datasets independently of POST filter requests; filter the cached dataset.
4. Split similarity index/summary from per-symbol match detail instead of reading/transferring the full report for small result lists.
5. Aggregate admin activity in the database; use bounded date ranges and controlled refresh instead of repeatedly loading raw events into Node.
6. For future attribution, record lightweight aggregated per-route upstream byte counters, cache hits/misses, and query counts. Do not store payloads, credentials, or user data. Sampled execution timings are diagnostic, not a substitute for Vercel billed CPU metrics.

## Sources

- https://vercel.com/docs/functions/usage-and-pricing
- https://vercel.com/docs/caching/cdn-cache
- https://vercel.com/docs/observability
- https://supabase.com/docs/guides/observability/log-field-reference
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
