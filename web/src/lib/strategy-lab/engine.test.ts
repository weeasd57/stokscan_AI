import {
  aggregateCandles,
  analyzeStrategy,
  calculateTradeSizing,
  Candle,
  compareStrategies,
  STRATEGIES,
  normalizeCandles,
  detectFalseBreakouts,
  calculateRelativeStrength,
  estimateFairValue,
} from "./index";
const candles: Candle[] = Array.from({ length: 90 }, (_, i) => {
  const close = 100 + Math.sin(i / 5) * 12 + i / 10;
  return {
    time: 1704067200 + i * 86400,
    open: close - 0.4,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + i * 10,
  };
});
describe("strategy lab causal engine", () => {
  test("SMC liquidity reclaim differs from the price-action range breakout", () => {
    const sample = Array.from({ length: 4 }, (_, index) => ({ time: 1700000000 + index * 86400, open: 10, high: 12, low: 8, close: 10, volume: 1000 }));
    sample[2] = { ...sample[2], open: 8, high: 10, low: 7, close: 9 };
    expect(analyzeStrategy(sample, "smc", { lookback: 2 }).signals).toContainEqual(expect.objectContaining({ index: 2, side: "buy" }));
    expect(analyzeStrategy(sample, "price_action", { lookback: 2 }).signals).not.toContainEqual(expect.objectContaining({ index: 2, side: "buy" }));
  });
  test("EGX Sunday and Thursday aggregate in same week", () => {
    const sunday = {
      ...candles[0],
      time: Date.parse("2026-10-04T00:00:00Z") / 1000,
    };
    const thursday = {
      ...candles[1],
      time: Date.parse("2026-10-08T00:00:00Z") / 1000,
    };
    expect(aggregateCandles([sunday, thursday], "weekly")).toHaveLength(1);
  });
  test("zero signals have null profit factor and finite neutral metrics", () => {
    const flat = candles.map((c) => ({
      ...c,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    }));
    const result = compareStrategies(flat, ["price_action"]).results[0];
    expect(result.metrics).toMatchObject({
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      closedTrades: 0,
      winRatePct: 0,
      profitFactor: null,
    });
  });
  test("initial capital anchors drawdown and benchmark pays both costs", () => {
    const flat = candles.map((c) => ({
      ...c,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    }));
    const result = compareStrategies(flat, ["price_action"], {
      initialCapital: 10000,
      commissionBps: 100,
      slippageBps: 100,
    });
    expect(result.benchmark[0].value).toBeLessThan(10000);
    expect(result.benchmark.at(-1)?.value).toBe(result.benchmark[0].value);
  });
  test("invalid/duplicate OHLC rows are excluded and sources untouched", () => {
    const original = JSON.stringify(candles);
    expect(
      normalizeCandles([
        ...candles,
        candles[0],
        { ...candles[0], time: 999, close: NaN },
        { ...candles[0], time: 888, high: 1 },
      ]),
    ).toHaveLength(candles.length);
    expect(JSON.stringify(candles)).toBe(original);
  });
  test("fees reduce position sizing and are included in risk", () => {
    const free = calculateTradeSizing(100, 90, 120, 10000, 1),
      paid = calculateTradeSizing(100, 90, 120, 10000, 1, {
        commissionBps: 100,
        slippageBps: 100,
      });
    expect(paid.quantity).toBeLessThan(free.quantity);
    expect(paid.riskAmount).toBeLessThanOrEqual(100);
    expect(paid.riskReward).toBeLessThan(free.riskReward);
  });
  test("relative strength uses only shared timestamps", () => {
    const result = calculateRelativeStrength(
      candles.slice(0, 4),
      candles.slice(1, 5),
    );
    expect(result).toHaveLength(3);
    expect(result[0].relativeStrength).toBe(100);
  });
  test("fakeout closes back inside known range and valuation requires assumptions", () => {
    const fixture = [
      ...candles
        .slice(0, 2)
        .map((c) => ({ ...c, open: 100, high: 101, low: 99, close: 100 })),
      { ...candles[2], open: 100, high: 105, low: 99, close: 100 },
    ];
    expect(detectFalseBreakouts(fixture, 2)[0]).toMatchObject({
      index: 2,
      side: "sell",
    });
    expect(
      estimateFairValue({
        eps: 2,
        peLow: 5,
        peHigh: 10,
        asOf: "2026-10-01",
        source: "user",
      }),
    ).toMatchObject({ low: 10, high: 20 });
    expect(() =>
      estimateFairValue({
        eps: -1,
        peLow: 5,
        peHigh: 10,
        asOf: "2026-10-01",
        source: "user",
      }),
    ).toThrow();
  });
  test("catalog honestly separates drawings from trading rules", () => {
    expect(STRATEGIES).toHaveLength(10);
    expect(STRATEGIES.filter((s) => s.backtestable)).toHaveLength(4);
    for (const s of STRATEGIES)
      expect(analyzeStrategy(candles, s.id).strategyId).toBe(s.id);
  });
  test("later candles never alter historical signals", () => {
    for (const s of STRATEGIES.filter((s) => s.backtestable)) {
      const prefix = analyzeStrategy(candles.slice(0, 55), s.id);
      expect(
        analyzeStrategy(candles, s.id).signals.filter((v) => v.index < 55),
      ).toEqual(prefix.signals);
    }
  });
  test("orders execute at next bar open and include fees", () => {
    const fixture: Candle[] = [10, 10, 10, 14, 15, 7, 8].map((close, i) => ({
      time: i + 1,
      open: close,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 100,
    }));
    const result = compareStrategies(fixture, ["price_action"], {
      params: { lookback: 2 },
      initialCapital: 1000,
      commissionBps: 100,
      slippageBps: 100,
    }).results[0];
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryTime).toBe(5);
    expect(result.trades[0].exitTime).toBe(7);
    expect(result.trades[0].entryPrice).toBeCloseTo(15.15);
    expect(result.trades[0].exitPrice).toBeCloseTo(7.92);
    expect(result.trades[0].pnl).toBeLessThan(0);
  });
  test("drawing-only techniques produce no invented performance", () => {
    const r = compareStrategies(candles, ["elliott"]);
    expect(r.results).toEqual([]);
    expect(r.excludedStrategyIds).toEqual(["elliott"]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  test("weekly aggregation preserves OHLC and volume without mutating source", () => {
    const original = JSON.stringify(candles);
    const weekly = aggregateCandles(candles, "weekly");
    expect(weekly.length).toBeLessThan(candles.length);
    expect(weekly.reduce((s, c) => s + c.volume, 0)).toBe(
      candles.reduce((s, c) => s + c.volume, 0),
    );
    expect(JSON.stringify(candles)).toBe(original);
  });
  test("trade sizing honors capital and risk and rejects inverted stops", () => {
    expect(calculateTradeSizing(100, 90, 120, 10000, 1)).toMatchObject({
      quantity: 10,
      riskAmount: 100,
      riskReward: 2,
    });
    expect(() => calculateTradeSizing(100, 110, 120, 10000)).toThrow();
    expect(() =>
      compareStrategies(candles, ["price_action"], { initialCapital: -1 }),
    ).toThrow();
  });
});
