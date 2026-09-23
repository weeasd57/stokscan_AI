import { pairTradeReturns } from "../recommendationBenchmark";

describe("pairTradeReturns", () => {
  const closes = [
    { date: "2026-09-17", close: 100 },
    { date: "2026-09-20", close: 105 },
    { date: "2026-09-23", close: 110 },
  ];

  it("uses the last prior close for a holiday and aligns each trade's dates", () => {
    expect(pairTradeReturns([{ startDate: "2026-09-18", endDate: "2026-09-23", returnPct: 8 }], closes))
      .toEqual([{ strategy: 8, benchmark: 10 }]);
  });

  it("omits stale prices rather than comparing unrelated periods", () => {
    expect(pairTradeReturns([{ startDate: "2026-09-01", endDate: "2026-09-23", returnPct: 8 }], closes)).toEqual([]);
    expect(pairTradeReturns([{ startDate: "2026-09-17", endDate: "2026-10-05", returnPct: 8 }], closes)).toEqual([]);
  });
});
