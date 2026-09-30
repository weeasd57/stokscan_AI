import { buildPortfolioPerformance, compareCurrentBasket, maxDrawdown, recordedSaleProfit, type DailyPrice, type PerformanceHolding, type PortfolioSaleEvent } from "../portfolio-performance";
import { loadPortfolioPerformance, loadDailyHistory } from "../portfolio-performance-data";

const holding = (symbol = "COMI", quantity: unknown = 10, entry_price: unknown = 8): PerformanceHolding => ({ id: symbol, symbol, quantity, entry_price, status: "open" });
const prices = (values: number[]): DailyPrice[] => values.map((close, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, close, adjusted_close: close }));
const sale = (payload: Record<string, unknown>): PortfolioSaleEvent => ({ id: "sale", position_id: "COMI", event_at: "2026-09-01", event_type: "portfolio_sell", payload });

describe("portfolio performance mathematics", () => {
  it("uses fixed current quantities, shared sessions, and equal starting points", () => {
    const result = compareCurrentBasket([holding()], { COMI: prices([10, 12, 11]) }, prices([100, 105, 110]), 30);
    expect(result.points[0]).toMatchObject({ basket: 100, benchmark: 100 });
    expect(result.returnPct).toBeCloseTo(10);
    expect(result.benchmarkPct).toBeCloseTo(10);
    expect(result.excessPct).toBeCloseTo(0);
    expect(result.maxDrawdownPct).toBeCloseTo(-8.33333);
  });
  it("weights shares by value, not an unweighted average of percentage returns", () => {
    const result = compareCurrentBasket([holding("COMI", 10), holding("EAST", 1)], { COMI: prices([10, 20]), EAST: prices([100, 100]) }, prices([100, 100]), 30);
    expect(result.returnPct).toBe(50);
  });
  it("aligns exact common dates and never forward-fills or uses future prices", () => {
    const result = compareCurrentBasket([holding()], { COMI: [prices([10])[0], { date: "2026-09-03", close: 12 }, { date: "2026-09-04", close: 999 }] }, prices([100, 101, 102]), 30);
    expect(result.points.map(point => point.date)).toEqual(["2026-09-01", "2026-09-03"]);
    expect(result.returnPct).toBeCloseTo(20);
  });
  it("reports unavailable symbols rather than silently zero-valuing them", () => {
    const result = compareCurrentBasket([holding(), holding("MISSING")], { COMI: prices([10, 11]) }, prices([100, 110]), 30);
    expect(result.excludedSymbols).toEqual(["MISSING"]);
    expect(result.includedSymbols).toEqual(["COMI"]);
    expect(buildPortfolioPerformance([holding("MISSING")], [], {}, prices([100, 110])).unrealized).toBeNull();
  });
  it("uses adjusted prices consistently, with explicit fallback if incomplete", () => {
    const split = [{ date: "2026-09-01", close: 20, adjusted_close: 10 }, { date: "2026-09-02", close: 10, adjusted_close: 10 }];
    expect(compareCurrentBasket([holding()], { COMI: split }, prices([100, 100]), 30).returnPct).toBe(0);
    split[1].adjusted_close = null as any;
    const result = compareCurrentBasket([holding()], { COMI: split }, prices([100, 100]), 30);
    expect(result.returnPct).toBe(-50);
    expect(result.adjusted).toBe(false);
  });
  it("does not invent cost for null/zero legacy entries", () => {
    for (const entry of [null, 0]) {
      const result = buildPortfolioPerformance([holding("COMI", 10, entry)], [], { COMI: prices([10, 11]) }, prices([100, 110]));
      expect(result.unrealized).toBeNull();
      expect(result.holdings[0].value).toBe(110);
    }
  });
  it("uses latest closes for actual current unrealized P/L and excludes watchlist entries", () => {
    const result = buildPortfolioPerformance([holding(), holding("WATCH", null)], [], { COMI: prices([10, 11]) }, prices([100, 110]));
    expect(result.unrealized).toBe(30);
    expect(result.holdings).toHaveLength(1);
  });
  it("calculates realized P/L from sale-time basis, not sale proceeds or current cost", () => {
    expect(recordedSaleProfit([sale({ quantity: 4, sell_price: 10, entry_price: 8, proceeds: 40 })])).toEqual({ total: 8, known: 1, unknown: 0 });
    expect(recordedSaleProfit([sale({ quantity: 4, sell_price: 10, proceeds: 40 })])).toEqual({ total: null, known: 0, unknown: 1 });
    expect(recordedSaleProfit([sale({ quantity: 4, sell_price: 7, entry_price: 8 }), sale({ quantity: 2, sell_price: 10 })])).toEqual({ total: -4, known: 1, unknown: 1 });
  });
  it("returns no comparison for fewer than two common sessions", () => {
    expect(compareCurrentBasket([holding()], { COMI: prices([10]) }, prices([100]), 30).returnPct).toBeNull();
    expect(maxDrawdown([])).toBeNull();
    expect(maxDrawdown([100, 80, 120, 90])).toBe(-25);
  });
});

function clientMock(dataByTable: Record<string, any[]>) {
  const calls: Array<{ table: string; filters: Record<string, unknown>; columns?: string; range?: number[]; limit?: number }> = [];
  return { calls, from: (table: string) => {
    const call: (typeof calls)[number] = { table, filters: {} }; calls.push(call);
    const chain: any = {
      select: (columns: string) => { call.columns = columns; return chain; },
      eq: (key: string, value: unknown) => { call.filters[key] = value; return chain; },
      order: () => chain, limit: (value: number) => { call.limit = value; return chain; },
      range: (from: number, to: number) => { call.range = [from, to]; return chain; },
      then: (resolve: any) => resolve({ data: call.range ? (dataByTable[table] || []).slice(call.range[0], call.range[1] + 1) : dataByTable[table] || [], error: null }),
    }; return chain;
  } };
}

describe("private/public data separation", () => {
  it("uses only owner-scoped private queries, and canonical cookie-free public price queries", async () => {
    const privateClient = clientMock({ positions: [holding()], position_events: [] });
    const publicClient = clientMock({ stock_prices: prices([100, 110]) });
    await loadPortfolioPerformance(privateClient, publicClient, "owner-A");
    expect(privateClient.calls.every(call => call.filters.user_id === "owner-A")).toBe(true);
    expect(publicClient.calls.every(call => call.table === "stock_prices" && !Object.hasOwn(call.filters, "user_id"))).toBe(true);
    expect(publicClient.calls.map(call => call.filters)).toContainEqual({ symbol: "EGX30", exchange: "INDX" });
    expect(publicClient.calls[0].limit).toBe(300);
  });
  it("paginates sale history beyond the default 1,000-row result limit", async () => {
    const privateClient = clientMock({ positions: [], position_events: Array.from({ length: 1001 }, (_, i) => ({ ...sale({ quantity: 1, entry_price: 10, sell_price: 11 }), id: String(i) })) });
    const result = await loadPortfolioPerformance(privateClient, clientMock({ stock_prices: prices([100, 110]) }), "owner-A");
    expect(result.knownSales).toBe(1001);
    expect(result.realized).toBe(1001);
    expect(privateClient.calls.filter(call => call.table === "position_events")).toHaveLength(2);
  });
  it("rejects upstream errors instead of presenting a successful zero-profit report", async () => {
    const market = { from: () => {
      const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: () => Promise.resolve({ data: null, error: { message: "failed" } }) }; return chain;
    } };
    await expect(loadDailyHistory(market, "COMI")).rejects.toThrow("Daily prices unavailable");
  });
});
