/** Only public announcement fields may leave the privileged corporate-actions store. */
export type ChartEvent = {
  symbol: string;
  date: string;
  title: string;
  type: string;
  url: string;
  source: string;
  confidence: number | null;
};
export type ChartEventsResponse = { events: ChartEvent[]; warning: string };
export const CHART_EVENTS_WARNING =
  "إعلانات مصنفة من مصادر عامة وليست أحداثًا متحققًا منها. راجع المصدر وتاريخ تنفيذ الحدث؛ عدم وجود نتائج لا يؤكد عدم وجود أحداث.";

export function validChartEventDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function cairoCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function shiftCalendarDate(date: string, days: number): string {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function projectChartEvents(
  rows: unknown[],
  symbol: string,
  start: string,
  end: string,
): ChartEvent[] {
  const seen = new Set<string>();
  const events: ChartEvent[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (
      row.symbol !== symbol ||
      !validChartEventDate(row.action_date) ||
      row.action_date < start ||
      row.action_date > end ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      typeof row.url !== "string"
    )
      continue;
    let url: URL;
    try {
      url = new URL(row.url);
    } catch {
      continue;
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      continue;
    const key = [row.action_date, url.href, row.title].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      symbol,
      date: row.action_date,
      title: row.title.trim().slice(0, 500),
      type:
        typeof row.action_type === "string"
          ? row.action_type.slice(0, 80)
          : "other",
      url: url.href,
      source:
        typeof row.source === "string" && row.source.trim()
          ? row.source.trim().slice(0, 200)
          : url.hostname,
      confidence:
        typeof row.confidence === "number" &&
        Number.isFinite(row.confidence) &&
        row.confidence >= 0 &&
        row.confidence <= 1
          ? row.confidence
          : null,
    });
    if (events.length >= 30) break;
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
