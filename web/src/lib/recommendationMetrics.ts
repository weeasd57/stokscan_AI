/** Return performance from entry to a valid positive quote, or null if unknown. */
export function percentageChangeSinceEntry(entryPrice: number, currentPrice: number): number | null {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(currentPrice) || entryPrice <= 0 || currentPrice <= 0) {
    return null;
  }
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}
