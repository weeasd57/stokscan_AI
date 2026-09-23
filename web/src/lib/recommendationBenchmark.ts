export interface TradeWindow {
  startDate: string;
  endDate: string;
  returnPct: number;
}

export interface BenchmarkClose {
  date: string;
  close: number;
}

function lastFreshClose(prices: BenchmarkClose[], date: string): BenchmarkClose | null {
  let found: BenchmarkClose | null = null;
  for (const price of prices) {
    if (price.date > date) break;
    if (Number.isFinite(price.close) && price.close > 0) found = price;
  }
  if (!found) return null;
  const daysOld = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${found.date}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(daysOld) && daysOld >= 0 && daysOld <= 7 ? found : null;
}

/** Paired price returns over the same dates; stale/missing market prices are omitted. */
export function pairTradeReturns(trades: TradeWindow[], prices: BenchmarkClose[]) {
  return trades.flatMap((trade) => {
    const entry = lastFreshClose(prices, trade.startDate);
    const exit = lastFreshClose(prices, trade.endDate);
    if (!entry || !exit || !Number.isFinite(trade.returnPct)) return [];
    return [{ strategy: trade.returnPct, benchmark: ((exit.close - entry.close) / entry.close) * 100 }];
  });
}
