import { calculateSimilarityStats, marketRegimeAt, prepareSimilarityReport, quantile, sectorFlowAt, wilsonInterval, type SimilarityMatch } from "../historical-similarity";

function match(similarity: number, final_return: number | null, outcome = "win"): SimilarityMatch {
  return { symbol: "TEST.EGX", date: "2026-01-01", similarity, outcome, final_return, mfe: .1, mae: -.1,
    before_path: [], forward_path: [{ date: "2026-01-08", day: 5, close: 100, return: -.08 }] };
}

test("recomputes old reports after excluding weak, future and stale cases", () => {
  const report = prepareSimilarityReport({ forward_days: 20, scans: [
    { symbol: "TEST.EGX", target_date: "2026-09-30", matches: [match(.95, .05), match(-.2, .05), { ...match(.9, .05), date: "2026-10-01" }], stats: { wins: 99 } },
    { symbol: "OLD.EGX", target_date: "2026-06-11", matches: [] },
    { symbol: "EGX30.EGX", target_date: "2026-09-30", matches: [] },
  ] });
  expect(report.scans).toHaveLength(1);
  expect(report.scans[0].stats.wins).toBe(1);
  expect(report.scans[0].rejected_matches).toBe(2);
  expect(report.excluded).toEqual({ stale: 1, indices: 1 });
});

test("separates target exits from holding returns and excludes incomplete simulation outcomes", () => {
  const stats = calculateSimilarityStats([match(.95, .05), match(.9, null, "incomplete"), match(.91, 0, "flat")], 20, .05, -.03);
  expect(stats.total_matches).toBe(2);
  expect(stats.wins).toBe(1);
  expect(stats.flat).toBe(1);
  expect(stats.average_return).toBeCloseTo(.025);
  expect(stats.horizon_stats["5"].sample_size).toBe(3);
  expect(stats.horizon_stats["5"].median_return).toBe(-.08);
  expect(stats.horizon_stats["20"].average_return).toBeNull();
  expect(stats.exit_counts.target).toBe(1);
});

test("uses all accepted cases for quantiles and a finite uncertainty interval", () => {
  expect(quantile([-.2, .1, .2, .3], .5)).toBeCloseTo(.15);
  expect(quantile([], .5)).toBeNull();
  expect(wilsonInterval(0, 0)).toBeNull();
  const interval = wilsonInterval(9, 10)!;
  expect(interval[0]).toBeLessThan(.6);
  expect(interval[1]).toBeLessThan(1);
});

test("never applies future or stale context to historical cases", () => {
  const prices = Array.from({ length: 31 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 100 + i }));
  expect(marketRegimeAt(prices, "2026-01-21")).toBe("up");
  expect(marketRegimeAt(prices, "2025-12-01")).toBeNull();
  expect(marketRegimeAt(prices, "2026-02-10")).toBeNull();
  expect(sectorFlowAt([{ date: "2026-01-01", cmf: -.2 }, { date: "2026-01-03", cmf: .2 }], "2026-01-02")).toBe("outflow");
  expect(sectorFlowAt([{ date: "2026-01-01", cmf: -.2 }], "2026-01-20")).toBeNull();
});

test("does not count two cases with overlapping forward windows as independent evidence", () => {
  const first = { ...match(.95, .05), date: "2026-01-01", forward_path: [{ date: "2026-02-01", day: 20, close: 105, return: .05 }] };
  const second = { ...match(.9, .05), date: "2026-01-25" };
  const report = prepareSimilarityReport({ scans: [{ symbol: "TEST.EGX", target_date: "2026-09-30", matches: [first, second] }] });
  expect(report.scans[0].stats.observed_matches).toBe(1);
  expect(report.scans[0].matches?.[0].date).toBe("2026-01-01");
});
