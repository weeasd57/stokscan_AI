import { formatMarketUpdate } from "../market-update-time";

describe("formatMarketUpdate", () => {
  it("returns null for empty, invalid, or date-only inputs", () => {
    expect(formatMarketUpdate(null)).toBeNull();
    expect(formatMarketUpdate(undefined)).toBeNull();
    expect(formatMarketUpdate("")).toBeNull();
    expect(formatMarketUpdate("2026-10-08")).toBeNull(); // Missing time part
    expect(formatMarketUpdate("not-a-date")).toBeNull();
  });

  it("converts UTC midday run (09:15 UTC) to 12:15 Cairo time", () => {
    const formattedEn = formatMarketUpdate("2026-10-08T09:15:00Z", "en-US");
    expect(formattedEn).not.toBeNull();
    expect(formattedEn).toContain("12:15");
  });

  it("converts UTC close run (14:00 UTC) to 17:00 Cairo time", () => {
    const formattedEn = formatMarketUpdate("2026-10-08T14:00:00Z", "en-US");
    expect(formattedEn).not.toBeNull();
    expect(formattedEn).toContain("17:00");
  });

  it("appends Z to naive ISO strings without timezone offsets", () => {
    const formatted = formatMarketUpdate("2026-10-08T09:15:00", "en-US");
    expect(formatted).not.toBeNull();
    expect(formatted).toContain("12:15");
  });

  it("handles ar-EG locale formatting", () => {
    const formattedAr = formatMarketUpdate("2026-10-08T14:00:00Z", "ar-EG");
    expect(formattedAr).not.toBeNull();
    // ar-EG formatted string should be non-empty and valid
    expect(typeof formattedAr).toBe("string");
  });
});
