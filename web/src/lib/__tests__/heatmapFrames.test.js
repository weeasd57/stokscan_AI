const { buildHeatmapFramesFromRows } = require("../heatmapFrames.js");

describe("buildHeatmapFramesFromRows", () => {
  it("builds a frame for each requested date and keeps them sorted", () => {
    const rows = [
      { date: "2024-01-02", sector: "Financial Services", close: 100, volume: 2, change_pct: 0.3 },
      { date: "2024-01-02", sector: "Real Estate", close: 50, volume: 4, change_pct: -0.5 },
      { date: "2024-01-03", sector: "Financial Services", close: 90, volume: 3, change_pct: 1.1 },
    ];

    const result = buildHeatmapFramesFromRows(rows, ["2024-01-02", "2024-01-03"]);

    expect(result.animationDates).toEqual(["2024-01-02", "2024-01-03"]);
    expect(Object.keys(result.framesByDate)).toEqual(["2024-01-02", "2024-01-03"]);
    expect(result.framesByDate["2024-01-02"].sectors[0].sector).toBe("Financial Services");
    expect(result.framesByDate["2024-01-03"].total_market_flow).toBe(270);
  });
});
