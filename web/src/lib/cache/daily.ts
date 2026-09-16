/** Public datasets produced by the daily Python job. */
export const DAILY_CACHE_TAGS = {
  market: "daily-market-data",
  news: "daily-news-data",
  recommendations: "daily-recommendations",
  symbols: "daily-symbols",
} as const;

export const DAILY_CACHE_TAG_VALUES = Object.values(DAILY_CACHE_TAGS);

export function dailyCacheHeaders(tag: string): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=60",
    "Vercel-CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400, stale-if-error=86400",
    "Vercel-Cache-Tag": tag,
  };
}

/**
 * Tag a response so the daily job can invalidate it, without overriding the
 * freshness policy that route already chose for itself.
 */
export function withDailyTag<T extends Record<string, string>>(headers: T, tag: string): T & { "Vercel-Cache-Tag": string } {
  return { ...headers, "Vercel-Cache-Tag": tag };
}
