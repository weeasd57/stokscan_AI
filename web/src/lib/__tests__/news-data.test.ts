import { getNewsRows, newsLabel } from "../news-data";
import { getSupabaseClient } from "../supabase/route-data";

jest.mock("../supabase/route-data", () => ({ getSupabaseClient: jest.fn() }));

describe("shared monthly news inputs", () => {
  test("retrieves all pages and applies symbol/date filters after the shared read", async () => {
    const rows = Array.from({ length: 501 }, (_, id) => ({
      id, symbol: id === 500 ? "COMI" : "AMER", date: "2026-09-29", exchange: "EGX",
      sentiment_score: 0.12, news_count: 1, headlines: ["News"], sources: ["Source"],
    }));
    const chain: any = {};
    for (const method of ["select", "eq", "gt", "gte", "lt", "order"]) chain[method] = jest.fn(() => chain);
    chain.range = jest.fn(async (a, b) => ({ data: rows.slice(a, b + 1), error: null }));
    (getSupabaseClient as jest.Mock).mockReturnValue({ from: jest.fn(() => chain) });
    const result = await getNewsRows(new URLSearchParams("date=2026-09-29&search=COMI&sort=oldest&limit=10"));
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("COMI");
    expect(chain.range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(chain.gte).toHaveBeenCalledWith("date", "2026-09-01");
    expect(chain.lt).toHaveBeenCalledWith("date", "2026-10-01");
  });

  test("classification agrees at neutral boundaries", () => {
    expect(newsLabel(0.12)).toBe("neutral");
    expect(newsLabel(0.15)).toBe("neutral");
    expect(newsLabel(-0.15)).toBe("neutral");
    expect(newsLabel(0.16)).toBe("positive");
    expect(newsLabel(-0.16)).toBe("negative");
  });

  test("rejects invalid months before loading data", async () => {
    await expect(getNewsRows(new URLSearchParams("month=2026-13"))).rejects.toThrow("Invalid month");
  });
});
