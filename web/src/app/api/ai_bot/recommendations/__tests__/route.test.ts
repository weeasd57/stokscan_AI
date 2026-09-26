import { NextRequest } from "next/server";

const calls: string[] = [];
const FETCH_ROWS: Array<Record<string, unknown>> = [];

jest.mock("../../../../../lib/supabase/route-data", () => ({
  toNumber: (value: unknown, fallback = 0) => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      let ensured: Promise<{ data: unknown; error: unknown } | null> | null = null;
      const ensure = () => {
        if (!ensured) {
          ensured = (async () => {
            calls.push(`from:${table}`);
            try {
              const res = await globalThis.fetch("https://example.supabase.co/rest/v1/x");
              const data = await res.json();
              return { data, error: null };
            } catch (err: any) {
              return { data: null, error: err };
            }
          })();
        }
        return ensured;
      };
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        lt: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
          ensure().then(resolve, reject),
      };
      return builder;
    },
  }),
}));

jest.mock("../../../../../lib/supabase/viewer-context", () => ({
  getViewerContext: jest.fn(async (req: NextRequest) => {
    const userId = req.headers.get("x-user-id");
    const pro = req.headers.get("x-pro") === "true";
    calls.push(`viewer:${userId ?? "anon"}`);
    if (!userId) return { authenticated: false, pro: false, userId: null };
    return { authenticated: true, pro, userId };
  }),
}));

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  calls.length = 0;
  process.env.PAYMENTS_ENABLED = "true";
  process.env.NEXT_PUBLIC_PAYMENTS_ENABLED = "true";
  process.env.FREE_SIGNAL_DELAY_DAYS = "15";
  FETCH_ROWS.length = 0;
  FETCH_ROWS.push(
    { id: "fresh", symbol: "FRESH", name: "Fresh Co", exchange: "EGX", signal: "BUY", status: "open", precision: 0.9, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), top_reasons: ["hot"], is_public: true },
    { id: "old-high-safety", symbol: "SAFE", name: "Safe Co", exchange: "EGX", signal: "BUY", status: "open", precision: 0.8, created_at: new Date(Date.now() - 40 * DAY).toISOString(), updated_at: new Date(Date.now() - 40 * DAY).toISOString(), last_close: 100, stop_loss: 99, is_public: true },
    { id: "old-safe", symbol: "OLD", name: "Old Co", exchange: "EGX", signal: "SELL", status: "open", precision: 0.6, created_at: new Date(Date.now() - 40 * DAY).toISOString(), updated_at: new Date(Date.now() - 40 * DAY).toISOString(), last_close: 100, stop_loss: 70, is_public: true },
    { id: "old-loss", symbol: "LOSS", name: "Loss Co", exchange: "EGX", signal: "BUY", status: "loss", precision: 0.8, created_at: new Date(Date.now() - 40 * DAY).toISOString(), updated_at: new Date(Date.now() - 20 * DAY).toISOString(), last_close: 90, stop_loss: 89, profit_loss_pct: -10, is_public: true },
    { id: "recent-loss", symbol: "RECENT", name: "Recent Loss", exchange: "EGX", signal: "BUY", status: "loss", precision: 0.8, created_at: new Date(Date.now() - 40 * DAY).toISOString(), updated_at: new Date(Date.now() - 2 * DAY).toISOString(), last_close: 90, stop_loss: 89, profit_loss_pct: -10, is_public: true },
    { id: "fresh-loss", symbol: "FLOSS", name: "Fresh Loss", exchange: "EGX", signal: "BUY", status: "loss", precision: 0.8, created_at: new Date(Date.now() - 2 * DAY).toISOString(), updated_at: new Date().toISOString(), last_close: 90, stop_loss: 89, profit_loss_pct: -10, is_public: true },
    { id: "large-win", symbol: "LARGE", name: "Large Win", exchange: "EGX", signal: "BUY", status: "win", precision: 0.9, created_at: new Date(Date.now() - 20 * DAY).toISOString(), updated_at: new Date().toISOString(), profit_loss_pct: 51, is_public: true },
    { id: "threshold-win", symbol: "FIFTY", name: "Fifty Win", exchange: "EGX", signal: "BUY", status: "win", precision: 0.7, created_at: new Date(Date.now() - 20 * DAY).toISOString(), updated_at: new Date().toISOString(), profit_loss_pct: 50, is_public: true },
  );
  globalThis.fetch = jest.fn(async () =>
    Response.json(FETCH_ROWS)) as unknown as typeof fetch;
});

afterEach(() => {
  delete (globalThis as any).fetch;
});

function request(userId: string | null = "u-free") {
  const headers = new Headers();
  if (userId) {
    headers.set("x-user-id", userId);
    if (userId.endsWith("pro")) headers.set("x-pro", "true");
  }
  return { url: "https://app.test/api/ai_bot/recommendations?limit=10", headers } as unknown as NextRequest;
}

async function getRows(res: Response) {
  return (await res.json()) as any[];
}

it("removes the safety gate, masks closed identities, and hides wins above 50% for Free", async () => {
  const { GET } = await import("@/app/api/ai_bot/recommendations/route");
  const response = await GET(request("u-free"));
  expect(response.headers.get("cache-control")).toContain("no-store");
  const rows = await getRows(response);
  const fresh = rows.find((r: any) => r.id === "fresh");
  const highSafety = rows.find((r: any) => r.id === "old-high-safety");
  const normal = rows.find((r: any) => r.id === "old-safe");

  expect(fresh.locked).toBe(true);
  expect(highSafety.locked).toBeUndefined();
  expect(normal.locked).toBeUndefined();

  // Locked rows reveal their status and ratings, but never identity or prices.
  expect(fresh.symbol).toBeUndefined();
  expect(fresh.name).toBeUndefined();
  expect(fresh.top_reasons).toBeUndefined();
  expect(fresh.last_close).toBeUndefined();
  expect(fresh).toMatchObject({
    precision: 0.9,
    status: "open",
    signal: "BUY",
    technical_score: 9,
    fundamental_score: 8,
    sentiment_score: 8,
    safety_rate: 5,
  });
  expect(highSafety.symbol).toBe("SAFE");
  expect(normal.symbol).toBe("OLD");
  // An aged open recommendation is now released to Free, including its quote;
  // a still-locked signal above must continue to have no identity or price.
  expect(normal).toMatchObject({ last_close: 100, delayed: false, snapshot_cutoff: null });
  expect(fresh.last_close).toBeUndefined();
  expect(rows.find((r: any) => r.id === "old-loss")).toMatchObject({ status: "loss", precision: 0.8, identity_locked: true, profit_loss_pct: -10, exchange: "EGX" });
  expect(rows.find((r: any) => r.id === "old-loss").symbol).toBeUndefined();
  expect(rows.find((r: any) => r.id === "recent-loss").profit_loss_pct).toBe(-10);
  expect(rows.find((r: any) => r.id === "fresh-loss").profit_loss_pct).toBe(-10);
  expect(rows.find((r: any) => r.id === "large-win")).toBeUndefined();
  expect(rows.find((r: any) => r.id === "threshold-win").identity_locked).toBe(true);
});

it("encrypts every anonymous open signal and hides >50% wins", async () => {
  const { GET } = await import("@/app/api/ai_bot/recommendations/route");
  const rows = await getRows(await GET(request(null)));
  expect(rows.some((r: any) => r.id === "fresh")).toBe(false);
  expect(rows.map((r: any) => r.id)).toEqual(["old-high-safety", "old-safe", "old-loss", "recent-loss", "fresh-loss", "threshold-win"]);
  expect(rows.find((r: any) => r.id === "old-high-safety")).toMatchObject({ locked: true, exchange: "EGX", signal: "BUY", status: "open", precision: 0.8 });
  expect(rows.find((r: any) => r.id === "old-safe")).toMatchObject({ locked: true, exchange: "EGX", signal: "SELL", status: "open" });
  expect(rows.find((r: any) => r.id === "old-safe").symbol).toBeUndefined();
  expect(rows.find((r: any) => r.id === "old-safe").last_close).toBeUndefined();
  expect(rows.find((r: any) => r.id === "old-safe").target_price).toBeUndefined();
  expect(rows.filter((r: any) => r.status === "open").every((r: any) => r.locked && !r.symbol && !r.name)).toBe(true);
  expect(rows.find((r: any) => r.id === "fresh-loss")).toMatchObject({ status: "loss", profit_loss_pct: -10, delayed: false, identity_locked: true });
  expect(rows.find((r: any) => r.id === "fresh-loss").symbol).toBeUndefined();
});

it("returns everything unlocked to a Pro subscriber", async () => {
  const { GET } = await import("@/app/api/ai_bot/recommendations/route");
  const rows = await getRows(await GET(request("u-pro")));
  expect(rows.every((r: any) => !r.locked)).toBe(true);
  expect(rows.find((r: any) => r.id === "fresh").name).toBe("Fresh Co");
  expect(rows.find((r: any) => r.id === "large-win").symbol).toBe("LARGE");
});

it("reads only public datasets and delegates auth to the cached viewer context", async () => {
  const { GET } = await import("@/app/api/ai_bot/recommendations/route");
  await GET(request("u-free"));
  await GET(request("u-free"));

  // Two per-request reads for recommendations + sectors, resolved through the
  // service client (whose market reads are cached upstream in the shared
  // market-query cache).
  expect(calls.filter(call => call === "from:scan_results")).toHaveLength(2);
  expect(calls.filter(call => call === "from:stock_fundamentals")).toHaveLength(2);
  expect(calls.filter(call => call === "viewer:u-free")).toHaveLength(2);
  expect(calls).not.toContain("from:subscriptions");
  expect(calls).not.toContain("from:positions");
});
