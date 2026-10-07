/** Missing prices must never look like a verified zero return. */
export function formatShortSwingReturn(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function cairoSessionDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

export function shortSwingSessionState(asOf?: string, today = cairoSessionDate()) {
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "unknown";
  if (asOf > today) return "unknown";
  return asOf < today ? "previous" : "today";
}

interface SavedShortSwingQuote {
  current_price?: number | null;
  entry_price?: number | null;
  return_pct?: number | null;
  trailing_stop?: number | null;
  ema10_trend?: number | null;
  price_date?: string | null;
  is_breakeven_protected?: boolean;
  is_pending_entry?: boolean;
  is_locked?: boolean;
}

/** Display safeguards for older HF payloads. Never invent a replacement quote. */
export function shortSwingQuote(trade: SavedShortSwingQuote, session?: string) {
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const legacyConflict = !trade.is_pending_entry && trade.is_breakeven_protected
    && finite(trade.entry_price) && trade.current_price === trade.entry_price
    && trade.return_pct === 0 && trade.ema10_trend == null
    && finite(trade.trailing_stop) && trade.trailing_stop > trade.entry_price;
  const wrongSession = Boolean(trade.price_date && session && trade.price_date !== session);
  const missing = !finite(trade.current_price);
  const unavailable = trade.is_locked || legacyConflict || wrongSession || missing;
  return {
    price: unavailable ? null : trade.current_price!,
    returnPct: unavailable || !finite(trade.return_pct) ? null : trade.return_pct!,
    issue: trade.is_locked ? "locked" : legacyConflict || wrongSession ? "unverified" : missing ? "missing" : null,
  };
}
