/** Format the persisted calculation time, never the browser's fetch time. */
export function formatMarketUpdate(value: string | null | undefined, locale = "ar-EG"): string | null {
  if (!value || !value.includes("T")) return null;
  const utcValue = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(utcValue);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
