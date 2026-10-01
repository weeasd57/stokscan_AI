import { NextRequest } from "next/server";
import { GET as fundamentals } from "../../app/api/market/fundamentals/route";
import { GET as settings } from "../../app/api/market/scan-settings/route";
import { getPublicMarketClient } from "../supabase/route-data";

jest.mock("../supabase/route-data", () => ({ getPublicMarketClient: jest.fn() }));
const savedFetch = global.fetch;
beforeEach(() => jest.clearAllMocks());
afterEach(() => { global.fetch = savedFetch; });

it("serves chart fundamentals through the anonymous RLS client with an exact symbol/exchange filter", async () => {
  const query: any = { maybeSingle: jest.fn().mockResolvedValue({ data: { data: { General: { Name: "Public Company" } } }, error: null }) };
  for (const method of ["from", "select", "eq", "order", "limit"]) query[method] = jest.fn(() => query);
  (getPublicMarketClient as jest.Mock).mockReturnValue(query);
  const response = await fundamentals(new NextRequest("https://egxbots.example/api/market/fundamentals?ticker=abuk.egx"));
  expect(response.status).toBe(200);
  expect(query.eq).toHaveBeenCalledWith("symbol", "ABUK");
  expect(query.eq).toHaveBeenCalledWith("exchange", "EGX");
  expect(response.headers.get("Cache-Control")).toContain("public");
  expect(await response.json()).toEqual({ data: { General: { Name: "Public Company" } } });
});

it("rejects unbounded/invalid tickers before a database query", async () => {
  const response = await fundamentals(new NextRequest("https://egxbots.example/api/market/fundamentals?ticker=a,b,c"));
  expect(response.status).toBe(400);
  expect(getPublicMarketClient).not.toHaveBeenCalled();
});

it("publishes only scanDays, never backend configuration or credentials", async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ scanDays: 600, privateSetting: "hidden", adminKey: "hidden" }), { headers: { "content-type": "application/json" } }));
  const response = await settings();
  expect(await response.json()).toEqual({ scanDays: 600 });
  expect(response.headers.get("Cache-Control")).toContain("s-maxage=300");
});

it("retains the public default when the backend fails", async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
  expect(await (await settings()).json()).toEqual({ scanDays: 450 });
});
