const entries = new Map<string, unknown>();
jest.mock("@vercel/functions", () => ({
  getCache: () => ({
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: unknown) => { entries.set(key, value); },
    delete: async (key: string) => { entries.delete(key); },
  }),
}));

import { marketCachedFetch, refreshMarketQueries } from "../market-query-cache";
import { DAILY_CACHE_TAGS } from "../daily";

let scope = { url: "https://example.supabase.co", key: "server-test-key" };
let query = `${scope.url}/rest/v1/stock_prices?select=symbol%2Cclose&symbol=eq.COMI`;
let options = { headers: { Authorization: `Bearer ${scope.key}` } };
let testId = 0;

beforeEach(() => {
  entries.clear();
  scope = { ...scope, key: `server-test-key-${++testId}` };
  query = `${scope.url}/rest/v1/stock_prices?select=symbol%2Cclose&symbol=eq.COMI`;
  options = { headers: { Authorization: `Bearer ${scope.key}` } };
  process.env.NEXT_PUBLIC_SUPABASE_URL = scope.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = scope.key;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
});

it("caches a public table read and reuses it across client instances", async () => {
  const origin = jest.fn(async () => Response.json([{ symbol: "COMI", close: 10 }]));
  const first = marketCachedFetch(scope, origin as typeof fetch);
  const second = marketCachedFetch(scope, origin as typeof fetch);
  expect(await (await first(query, options)).json()).toEqual([{ symbol: "COMI", close: 10 }]);
  const hit = await second(query, options);
  expect(hit.headers.get("x-market-cache")).toBe("HIT");
  expect(origin).toHaveBeenCalledTimes(1);
});

it("keeps private tables and user JWT requests out of the shared cache", async () => {
  const origin = jest.fn(async () => Response.json([{ id: 1 }]));
  const get = marketCachedFetch(scope, origin as typeof fetch);
  await get(`${scope.url}/rest/v1/subscriptions?select=*`, options);
  await get(`${scope.url}/rest/v1/subscriptions?select=*`, options);
  await get(query, { headers: { Authorization: "Bearer user-jwt" } });
  await get(query, { headers: { Authorization: "Bearer user-jwt" } });
  expect(origin).toHaveBeenCalledTimes(4);
});

it("refreshes before switching generations and retains old data on failure", async () => {
  let price = 10;
  let fails = false;
  const origin = jest.fn(async () => fails
    ? Response.json({ error: "upstream" }, { status: 503 })
    : Response.json([{ symbol: "COMI", close: price }]));
  const get = marketCachedFetch(scope, origin as typeof fetch);
  await get(query, options);
  price = 12;
  const event = "2026-09-25T17:00:00.000Z";
  const result = await refreshMarketQueries([DAILY_CACHE_TAGS.market], event, origin as typeof fetch);
  expect(result.queries).toBe(1);
  expect(await (await get(query, options)).json()).toEqual([{ symbol: "COMI", close: 12 }]);
  fails = true;
  await expect(refreshMarketQueries([DAILY_CACHE_TAGS.market], "2026-09-26T17:00:00.000Z", origin as typeof fetch)).rejects.toThrow();
  expect(await (await get(query, options)).json()).toEqual([{ symbol: "COMI", close: 12 }]);
});

it("does not download the same unchanged payload chunk on daily refresh", async () => {
  const origin = jest.fn(async () => Response.json([{ symbol: "COMI", close: 10 }]));
  await marketCachedFetch(scope, origin as typeof fetch)(query, options);
  const before = [...entries.keys()].filter(key => key.startsWith("blob:"));
  const result = await refreshMarketQueries([DAILY_CACHE_TAGS.market], "2026-09-25T17:00:00.000Z", origin as typeof fetch);
  const after = [...entries.keys()].filter(key => key.startsWith("blob:"));
  expect(result.unchanged).toBe(1);
  expect(after).toEqual(before);
});

it("skips inactive stock queries during the next daily refresh", async () => {
  const origin = jest.fn(async () => Response.json([{ symbol: "COMI", close: 10 }]));
  await marketCachedFetch(scope, origin as typeof fetch)(query, options);
  for (const key of [...entries.keys()]) if (key.startsWith("hot:")) entries.delete(key);
  const result = await refreshMarketQueries([DAILY_CACHE_TAGS.market], "2026-09-26T17:00:00.000Z", origin as typeof fetch);
  expect(result.coldSkipped).toBe(1);
  expect(result.queries).toBe(0);
  expect(origin).toHaveBeenCalledTimes(1);
});
