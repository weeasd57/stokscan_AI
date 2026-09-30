import { explainSignal, finiteNumber, savedSignalReasons } from "../signal-explanation";

describe("saved signal explanations", () => {
  it("does not interpret missing data as zero", () => {
    for (const value of [null, undefined, "", false, NaN, Infinity]) expect(finiteNumber(value)).toBeNull();
    expect(explainSignal({}).rewardRisk).toBeNull();
  });
  it("accepts legacy arrays, serialized JSON and rich saved rationale", () => {
    expect(savedSignalReasons(["RSI", null, 10])).toEqual(["RSI"]);
    expect(savedSignalReasons('{"brief_rationale":"Saved reason","technical_rationale":"Measured context"}')).toEqual(["Saved reason", "Measured context"]);
    expect(savedSignalReasons({ text_reasons: ["RSI"], brief_rationale: "RSI", news_source: "Unverified news" })).toEqual(["RSI"]);
    expect(savedSignalReasons(null)).toEqual([]);
  });
  it("calculates a long trade without clipping the reward/risk ratio", () => {
    const result = explainSignal({ signal: "BUY", entry_price: 100, stop_loss: 99, target_price: 120, current_price: 110 });
    expect(result.rewardPct).toBe(20);
    expect(result.riskPct).toBe(1);
    expect(result.rewardRisk).toBe(20);
    expect(result.remainingPct).toBeCloseTo(9.0909);
  });
  it("handles SELL direction and crossing the stop", () => {
    const result = explainSignal({ signal: "SELL", entry_price: 100, stop_loss: 110, target_price: 80, current_price: 111 });
    expect(result.rewardRisk).toBe(2);
    expect(result.crossedStop).toBe(true);
  });
  it("does not manufacture 8% risk for a profit-protection stop", () => {
    const result = explainSignal({ signal: "BUY", entry_price: 100, stop_loss: 105, target_price: 120 });
    expect(result.protectedStop).toBe(true);
    expect(result.riskPct).toBeNull();
    expect(result.rewardRisk).toBeNull();
  });
  it("does not turn a target in the wrong direction into an absolute reward", () => {
    expect(explainSignal({ entry_price: 100, stop_loss: 90, target_price: 95 }).rewardRisk).toBeNull();
    expect(explainSignal({ precision: null }).scorePct).toBeNull();
    expect(explainSignal({ precision: 2 }).scorePct).toBeNull();
  });
});
