import { priorTwentySessionHigh } from "../unusualActivity";

describe("priorTwentySessionHigh", () => {
  it("uses only the 20 prior sessions and excludes the current day's high", () => {
    const bars = Array.from({ length: 22 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      high: index + 1,
    }));
    expect(priorTwentySessionHigh(bars, "2026-08-22")).toBe(21);
    expect(priorTwentySessionHigh(bars, "2026-08-21")).toBe(20);
  });

  it("does not invent resistance when history is insufficient", () => {
    expect(priorTwentySessionHigh([{ date: "2026-08-01", high: 10 }], "2026-08-02")).toBeNull();
  });
});
