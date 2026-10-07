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

import { cairoSessionDate, shortSwingSessionState, shortSwingQuote } from "../short-swings-view";

test("the session date follows Cairo across the UTC date boundary", () => {
  expect(cairoSessionDate(new Date("2026-10-07T22:30:00Z"))).toBe("2026-10-08");
  expect(shortSwingSessionState("2026-09-24", "2026-10-07")).toBe("previous");
  expect(shortSwingSessionState("2026-10-07", "2026-10-07")).toBe("today");
  expect(shortSwingSessionState("2026-10-08", "2026-10-07")).toBe("unknown");
});

test("the legacy entry-price placeholder cannot look like a verified zero return", () => {
  expect(shortSwingQuote({entry_price: 40.921, current_price: 40.921, return_pct: 0,
    is_breakeven_protected: true, trailing_stop: 41.044, ema10_trend: null})).toEqual({price: null, returnPct: null, issue: "unverified"});
  expect(shortSwingQuote({entry_price: 40, current_price: 40, return_pct: 0, ema10_trend: 39})).toEqual({price: 40, returnPct: 0, issue: null});
});

test("missing and mismatched quotes stay unavailable without inventing new prices", () => {
  expect(shortSwingQuote({current_price: null, return_pct: 0}).returnPct).toBeNull();
  expect(shortSwingQuote({current_price: 45, return_pct: 10, price_date: "2026-10-06"}, "2026-10-07").issue).toBe("unverified");
  expect(shortSwingQuote({current_price: 45, return_pct: 10, is_locked: true}).price).toBeNull();
});
