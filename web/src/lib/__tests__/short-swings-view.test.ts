import { formatShortSwingReturn } from "../short-swings-view";

test("a missing session quote is distinct from a measured zero return", () => {
  expect(formatShortSwingReturn(null)).toBe("—");
  expect(formatShortSwingReturn(undefined)).toBe("—");
  expect(formatShortSwingReturn(NaN)).toBe("—");
  expect(formatShortSwingReturn(0)).toBe("+0.0%");
});

test("verified returns retain sign and requested precision", () => {
  expect(formatShortSwingReturn(5.12, 2)).toBe("+5.12%");
  expect(formatShortSwingReturn(-4.5)).toBe("-4.5%");
});
