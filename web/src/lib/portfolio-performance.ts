import { finiteNumber } from "./signal-explanation";

export interface PerformanceHolding {
  id: string; symbol: string; quantity: unknown; entry_price: unknown; status: string;
}
export interface PortfolioSaleEvent {
  id: string; position_id: string | null; event_at: string; event_type: string;
  payload: Record<string, unknown> | null;
}
export interface DailyPrice { date: string; close: unknown; adjusted_close?: unknown; }
export interface PerformancePoint { date: string; basket: number; benchmark: number; }
export interface BasketComparison {
  days: number; from: string | null; to: string | null; points: PerformancePoint[];
  returnPct: number | null; benchmarkPct: number | null; excessPct: number | null;
  maxDrawdownPct: number | null; benchmarkDrawdownPct: number | null;
  includedSymbols: string[]; excludedSymbols: string[]; adjusted: boolean;
}
export interface PortfolioPerformance {
  asOf: string | null;
  holdings: Array<{ symbol: string; quantity: number; value: number | null; cost: number | null; profit: number | null; profitPct: number | null; priceDate: string | null }>;
  unrealized: number | null;
  realized: number | null;
  knownSales: number; unknownSales: number; historyTruncated: boolean;
  comparisons: BasketComparison[];
}

/** Only explicit sale-time basis is reliable. Legacy sale proceeds alone are not profit. */
export function recordedSaleProfit(events: PortfolioSaleEvent[]) {
  let total = 0, known = 0, unknown = 0;
  for (const event of events) {
    if (event.event_type !== "portfolio_sell") continue;
    const payload = event.payload || {};
    const quantity = finiteNumber(payload.quantity), sell = finiteNumber(payload.sell_price);
    const entry = finiteNumber(payload.entry_price);
    if (quantity === null || quantity <= 0 || sell === null || sell <= 0 || entry === null || entry <= 0) {
      unknown++;
      continue;
    }
    total += quantity * (sell - entry);
    known++;
  }
  return { total: known > 0 || unknown === 0 ? total : null, known, unknown };
}

function positive(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

export function maxDrawdown(values: number[]): number | null {
  if (values.length < 2) return null;
  let peak = values[0], worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, (value / peak - 1) * 100);
  }
  return worst;
}

/** Fixed quantities of today's holdings, excluding cash/trades/fees — NOT account returns. */
export function compareCurrentBasket(holdings: PerformanceHolding[], histories: Record<string, DailyPrice[]>, benchmark: DailyPrice[], days: number): BasketComparison {
  const active = holdings.filter(row => row.status === "open" && positive(row.quantity) !== null);
  const indexRows = benchmark.filter(row => positive(row.close) !== null).sort((a, b) => a.date.localeCompare(b.date));
  const anchor = indexRows.at(-1)?.date;
  const cutoff = anchor ? new Date(`${anchor}T00:00:00Z`) : new Date(0);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const from = cutoff.toISOString().slice(0, 10);
  const index = new Map(indexRows.filter(row => row.date >= from).map(row => [row.date, Number(row.close)]));
  const series: Array<{ symbol: string; quantity: number; prices: Map<string, number> }> = [];
  let adjusted = true;
  for (const row of active) {
    const prices = (histories[row.symbol] || []).filter(price => index.has(price.date) && positive(price.close) !== null);
    if (prices.length < 2) continue;
    // Never switch between adjusted/unadjusted within one series (can create fake jumps).
    const useAdjusted = prices.every(price => positive(price.adjusted_close) !== null);
    if (!useAdjusted) adjusted = false;
    series.push({ symbol: row.symbol, quantity: Number(row.quantity), prices: new Map(prices.map(price => [price.date, Number(useAdjusted ? price.adjusted_close : price.close)])) });
  }
  // Exact common sessions; no future prices or stale forward-fills.
  const dates = [...index.keys()].filter(date => series.length > 0 && series.every(row => row.prices.has(date))).sort();
  const basketValues = dates.map(date => series.reduce((sum, row) => sum + row.quantity * row.prices.get(date)!, 0));
  const base = basketValues[0], benchmarkBase = index.get(dates[0]);
  const points = base > 0 && benchmarkBase && dates.length >= 2 ? dates.map((date, i) => ({
    date, basket: basketValues[i] / base * 100, benchmark: index.get(date)! / benchmarkBase * 100,
  })) : [];
  const last = points.at(-1);
  const includedSymbols = series.map(row => row.symbol);
  return {
    days, from: points[0]?.date || null, to: last?.date || null, points,
    returnPct: last ? last.basket - 100 : null, benchmarkPct: last ? last.benchmark - 100 : null,
    excessPct: last ? last.basket - last.benchmark : null,
    maxDrawdownPct: maxDrawdown(points.map(point => point.basket)),
    benchmarkDrawdownPct: maxDrawdown(points.map(point => point.benchmark)),
    includedSymbols, excludedSymbols: active.filter(row => !includedSymbols.includes(row.symbol)).map(row => row.symbol), adjusted,
  };
}

export function buildPortfolioPerformance(positions: PerformanceHolding[], events: PortfolioSaleEvent[], histories: Record<string, DailyPrice[]>, benchmark: DailyPrice[], historyTruncated = false): PortfolioPerformance {
  const holdings = positions.filter(row => row.status === "open" && positive(row.quantity) !== null).map(row => {
    const latest = [...(histories[row.symbol] || [])].filter(price => positive(price.close) !== null).sort((a, b) => b.date.localeCompare(a.date))[0];
    const quantity = Number(row.quantity), price = latest ? positive(latest.close) : null;
    const entry = positive(row.entry_price);
    const cost = entry !== null ? quantity * entry : null;
    const value = price !== null ? quantity * price : null;
    const profit = cost !== null && value !== null ? value - cost : null;
    return { symbol: row.symbol, quantity, value, cost, profit, profitPct: profit !== null && cost ? profit / cost * 100 : null, priceDate: latest?.date || null };
  });
  const saleProfit = recordedSaleProfit(events);
  return {
    asOf: benchmark.filter(row => positive(row.close) !== null).map(row => row.date).sort().at(-1) || null,
    holdings,
    unrealized: holdings.every(row => row.profit !== null) ? holdings.reduce((sum, row) => sum + row.profit!, 0) : null,
    realized: saleProfit.total, knownSales: saleProfit.known, unknownSales: saleProfit.unknown, historyTruncated,
    comparisons: [30, 90, 365].map(days => compareCurrentBasket(positions, histories, benchmark, days)),
  };
}
