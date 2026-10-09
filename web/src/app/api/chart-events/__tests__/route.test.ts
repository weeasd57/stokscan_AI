/** @jest-environment node */
import { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";
import { cairoCalendarDate, shiftCalendarDate } from "@/lib/chart-events";
import { GET } from "../route";
const mockCache = new Map<string, unknown>();
jest.mock("next/cache", () => ({
  unstable_cache: jest.fn((callback, keys) => async () => {
    const key = JSON.stringify(keys);
    if (mockCache.has(key)) return mockCache.get(key);
    const result = await callback();
    mockCache.set(key, result);
    return result;
  }),
}));
jest.mock("@/lib/supabase/route-data", () => ({
  getSupabaseServiceClient: jest.fn(),
}));
const publicRow = {
  symbol: "COMI",
  action_date: "2026-10-10",
  title: "Dividend announcement",
  action_type: "dividend",
  url: "https://example.com/announcement",
  source: "Public publisher",
  confidence: 0.8,
};
function mockClient(rows: unknown[] = [publicRow], error: unknown = null) {
  const chain: any = {};
  for (const method of ["select", "eq", "gte", "lte", "not", "order"])
    chain[method] = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue({ data: rows, error });
  const client = { from: jest.fn().mockReturnValue(chain) };
  (getSupabaseServiceClient as jest.Mock).mockReturnValue(client);
  return { client, chain };
}
const request = (extra = "") =>
  new NextRequest(
    "http://localhost/api/chart-events?symbol=COMI&start_date=2026-10-01&end_date=2026-11-01" +
      extra,
  );
describe("public stored corporate announcements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.clear();
  });
  test("projects only sourced public fields and filters private/invalid rows", async () => {
    const { chain } = mockClient([
      {
        ...publicRow,
        details: { user_id: "private-user", secret: "never-export" },
        origin: "chat_cache",
      },
      { ...publicRow, url: "javascript:alert(1)" },
      { ...publicRow, url: "https://example.com/missing", action_date: null },
      { ...publicRow, symbol: "EAST" },
      { ...publicRow, url: "https://u:p@example.com/path" },
    ]);
    const response = await GET(request("&user_id=private-user"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toEqual([
      {
        symbol: "COMI",
        date: publicRow.action_date,
        title: publicRow.title,
        type: "dividend",
        url: publicRow.url,
        source: publicRow.source,
        confidence: 0.8,
      },
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /private-user|never-export|details|origin/,
    );
    expect(body.warning).toContain("ليست أحداثًا متحققًا");
    expect(chain.select).toHaveBeenCalledWith(
      "symbol,action_date,title,action_type,url,source,confidence",
    );
    expect(chain.eq).toHaveBeenCalledWith("exchange", "EGX");
    expect(chain.eq).toHaveBeenCalledWith("symbol", "COMI");
    expect(chain.gte).toHaveBeenCalledWith("action_date", "2026-10-01");
    expect(chain.lte).toHaveBeenCalledWith("action_date", "2026-11-01");
    expect(chain.not).toHaveBeenCalledWith("action_date", "is", null);
    expect(chain.not).toHaveBeenCalledWith("url", "is", null);
    expect(chain.order).toHaveBeenCalledWith("action_date", {
      ascending: true,
    });
    expect(chain.limit).toHaveBeenCalledWith(30);
  });
  test("public daily-news cache ignores credentials and reuses projection", async () => {
    const { client } = mockClient();
    const first = await GET(request()),
      second = await GET(request("&user_id=someone-else"));
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(await first.json()).toEqual(await second.json());
    expect(first.headers.get("cache-control")).toBe("public, max-age=60");
    expect(first.headers.get("vercel-cache-tag")).toBe(DAILY_CACHE_TAGS.news);
    expect(unstable_cache).toHaveBeenCalledWith(
      expect.any(Function),
      ["chart-events-public-v1", "COMI", "2026-10-01", "2026-11-01"],
      { tags: [DAILY_CACHE_TAGS.news], revalidate: 86400 },
    );
  });
  test("rejects impossible dates and oversized windows before client construction", async () => {
    mockClient();
    for (const url of [
      "?symbol=BAD%20SYMBOL",
      "?symbol=COMI&start_date=2026-02-30",
      "?symbol=COMI&start_date=2020-01-01&end_date=2026-01-01",
      "?symbol=COMI&start_date=2026-12-01&end_date=2026-01-01",
      "?symbol=COMI&exchange=US",
    ])
      expect(
        (await GET(new NextRequest("http://localhost/api/chart-events" + url)))
          .status,
      ).toBe(400);
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });
  test("Cairo day defaults cross UTC midnight correctly", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-08T22:30:00Z"));
    try {
      const { chain } = mockClient([]);
      expect(cairoCalendarDate()).toBe("2026-10-09");
      await GET(
        new NextRequest("http://localhost/api/chart-events?symbol=COMI"),
      );
      expect(chain.gte).toHaveBeenCalledWith(
        "action_date",
        shiftCalendarDate("2026-10-09", -90),
      );
      expect(chain.lte).toHaveBeenCalledWith(
        "action_date",
        shiftCalendarDate("2026-10-09", 365),
      );
    } finally {
      jest.useRealTimers();
    }
  });
  test("missing service credentials or database failure returns uncached 503", async () => {
    (getSupabaseServiceClient as jest.Mock).mockImplementation(() => {
      throw new Error("missing credentials");
    });
    const missing = await GET(request());
    expect(missing.status).toBe(503);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(mockCache.size).toBe(0);
    mockClient([], new Error("query failed"));
    expect((await GET(request())).status).toBe(503);
    expect(mockCache.size).toBe(0);
  });
});
