export interface PriorPriceBar {
  date: string;
  high: number | string | null;
}

/** Prior 20-session high; today's bar must never be included. */
export function priorTwentySessionHigh(bars: PriorPriceBar[], asOf: string): number | null {
  const previous = bars
    .filter((bar) => bar.date < asOf && Number.isFinite(Number(bar.high)) && Number(bar.high) > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
  if (previous.length < 20) return null;
  return Math.max(...previous.map((bar) => Number(bar.high)));
}
