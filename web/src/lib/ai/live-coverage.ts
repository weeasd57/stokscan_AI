/**
 * live-coverage.ts
 *
 * Which EGX instruments can and cannot be quoted from the live TradingView
 * scanner, and the alias candidates used when a ticker is not recognised.
 *
 * Fund certificates (e.g. KASABF, EGREF) are listed on EGX but have no
 * TradingView quote feed. Treating them as a transient failure produced
 * misleading "temporarily unavailable" answers, so they are marked as
 * unsupported coverage instead.
 */

/** Instruments listed on EGX without a live quote feed. */
export const LIVE_UNSUPPORTED_SYMBOLS: ReadonlySet<string> = new Set([
    "KASABF", // Certificates of Odin Egyptian Equity Investment Fund - KASAB
    "EGREF",  // Egyptians Real Estate Fund Certificates
]);

/**
 * Optional ticker overrides for symbols the scanner misses under their EGX
 * symbol. Extend this from observed failures instead of guessing tickers.
 */
export const LIVE_TICKER_ALIASES: Readonly<Record<string, readonly string[]>> = {};

export function normalizeLiveSymbol(symbol: string): string {
    return String(symbol || "").trim().toUpperCase().replace(/^(EGX:|CA:)/, "");
}

export function isLiveUnsupportedSymbol(symbol: string): boolean {
    return LIVE_UNSUPPORTED_SYMBOLS.has(normalizeLiveSymbol(symbol));
}

/** Candidate scanner tickers for a symbol, primary first. */
export function liveTickerCandidates(symbol: string): string[] {
    const clean = normalizeLiveSymbol(symbol);
    if (!clean) return [];
    const aliases = LIVE_TICKER_ALIASES[clean] || [];
    return Array.from(new Set([clean, ...aliases.map(normalizeLiveSymbol)])).filter(Boolean);
}

export function liveUnsupportedNotice(symbol: string): string {
    return `${normalizeLiveSymbol(symbol)} أداة صندوق/شهادة استثمار مدرجة بالبورصة ولا يتوفر لها تغذية أسعار لحظية؛ لا يمكنني عرض سعر لحظي أو مؤشرات فنية آلية لها.`;
}
