import { describe, expect, it } from "@jest/globals";
import { isLiveUnsupportedSymbol, liveTickerCandidates, liveUnsupportedNotice } from "../live-coverage";

describe("live quote coverage", () => {
  it("marks EGX fund certificates as unsupported rather than failed", () => {
    expect(isLiveUnsupportedSymbol("KASABF")).toBe(true);
    expect(isLiveUnsupportedSymbol("EGREF")).toBe(true);
    expect(liveUnsupportedNotice("KASABF")).toContain("لا يتوفر لها تغذية أسعار لحظية");
  });

  it("keeps the requested ticker first for future explicit aliases", () => {
    expect(liveTickerCandidates("EGX:KASABF")).toEqual(["KASABF"]);
  });
});
