import { NextRequest } from "next/server";
import { GET } from "../../app/api/portfolio/performance/route";
import { getViewerIdentity } from "../supabase/viewer-context";
import { loadPortfolioPerformance } from "../portfolio-performance-data";
import { getPublicMarketClient, getSupabaseServiceClient } from "../supabase/route-data";

jest.mock("../supabase/viewer-context", () => ({ getViewerIdentity: jest.fn() }));
jest.mock("../portfolio-performance-data", () => ({ loadPortfolioPerformance: jest.fn() }));
jest.mock("../supabase/route-data", () => ({\n  getPublicMarketClient: jest.fn(() => ({ public: true })),\n  getSupabaseServiceClient: jest.fn(() => ({ private: true })),\n}));

beforeEach(() => jest.clearAllMocks());
it("rejects guests before querying prices or private holdings", async () => {
  (getViewerIdentity as jest.Mock).mockResolvedValue({ userId: null });
  const response = await GET(new NextRequest("http://localhost/api/portfolio/performance?user_id=victim"));
  expect(response.status).toBe(401);
  expect(loadPortfolioPerformance).not.toHaveBeenCalled();
  expect(getPublicMarketClient).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toContain("private");
  expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("no-store");
});
it("uses the verified owner, ignoring any user_id parameter; never publicly caches the assembled report", async () => {
  (getViewerIdentity as jest.Mock).mockResolvedValue({ userId: "owner-A" });
  (loadPortfolioPerformance as jest.Mock).mockResolvedValue({ realized: 123 });
  const response = await GET(new NextRequest("http://localhost/api/portfolio/performance?user_id=victim"));
  expect(loadPortfolioPerformance).toHaveBeenCalledWith({ private: true }, { public: true }, "owner-A");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
  expect(response.headers.get("Vary")).toBe("Cookie");
});
it("fails closed and preserves private cache policy on upstream errors", async () => {
  (getViewerIdentity as jest.Mock).mockResolvedValue({ userId: "owner-A" });
  (loadPortfolioPerformance as jest.Mock).mockRejectedValue(new Error("unavailable"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const response = await GET(new NextRequest("http://localhost/api/portfolio/performance"));
  expect(response.status).toBe(503);
  expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "Portfolio performance unavailable" });
  log.mockRestore();
});
