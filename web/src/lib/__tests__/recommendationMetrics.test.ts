import { percentageChangeSinceEntry } from "../recommendationMetrics";

describe("percentageChangeSinceEntry", () => {
  it("does not turn a missing quote into a false 100% loss", () => {
    expect(percentageChangeSinceEntry(2.27, 0)).toBeNull();
  });

  it("calculates a real return when both prices are available", () => {
    expect(percentageChangeSinceEntry(2.27, 2.57)).toBeCloseTo(13.2159, 3);
  });
});
