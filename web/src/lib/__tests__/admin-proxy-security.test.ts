import { NextRequest } from "next/server";
import { requireAdmin } from "../admin-auth";
import { getSupabaseClient } from "../supabase/route-data";
import * as proxy from "../../app/api/admin/[...path]/route";
import * as articles from "../../app/api/admin/articles/route";
import * as article from "../../app/api/admin/articles/[id]/route";
import * as deleteChats from "../../app/api/admin/ai-chatbot/delete-user-chats/route";
import * as schedule from "../../app/api/admin/daily-jobs/schedule/route";
import * as history from "../../app/api/admin/daily-jobs/history/route";
import * as growth from "../../app/api/admin/data-growth/route";
import * as state from "../../app/api/admin/alert-scheduler/state/route";
import * as reconciliation from "../../app/api/admin/recommendations/reconciliation/route";
import * as similarity from "../../app/api/admin/similarity/published/route";
import * as telegram from "../../app/api/admin/telegram/test/route";
import * as accessLog from "../../app/api/admin-access-log/route";
import { config } from "../../middleware";

jest.mock("../admin-auth", () => ({ requireAdmin: jest.fn() }));
jest.mock("../supabase/route-data", () => ({ getSupabaseClient: jest.fn() }));
jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn(() => ({})) }));
const savedEnv = { ...process.env };
const savedFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...savedEnv, ADMIN_SECRET_KEY: "server-backend-key", PYTHON_BACKEND_URL: "https://backend.example" };
  global.fetch = jest.fn();
});
afterAll(() => { process.env = savedEnv; global.fetch = savedFetch; });

const cases: [string, string, any][] = [
  ...["GET", "POST", "PUT", "PATCH", "DELETE"].map(method => ["proxy", method, (proxy as any)[method]] as [string, string, any]),
  ["articles", "GET", articles.GET], ["articles", "POST", articles.POST],
  ["articles/id", "GET", article.GET], ["articles/id", "PUT", article.PUT], ["articles/id", "DELETE", article.DELETE],
  ["ai-chatbot/delete-user-chats", "POST", deleteChats.POST],
  ["daily-jobs/schedule", "GET", schedule.GET], ["daily-jobs/schedule", "POST", schedule.POST],
  ["daily-jobs/history", "GET", history.GET], ["data-growth", "GET", growth.GET],
  ["alert-scheduler/state", "GET", state.GET], ["recommendations/reconciliation", "GET", reconciliation.GET],
  ["similarity/published", "GET", similarity.GET],
  ["telegram/test", "GET", telegram.GET], ["telegram/test", "POST", telegram.POST],
  ["access-log", "GET", accessLog.GET],
];
it.each(cases)("denies %s %s before reading bodies, resolving params or accessing privileged services", async (path, method, handler) => {
  (requireAdmin as jest.Mock).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
  const req = new NextRequest(`https://egxbots.example/api/admin/${path}`, {
    method, headers: { "x-admin-key": "forged-key" },
    ...(method === "GET" ? {} : { body: "invalid JSON" }),
  });
  const response = await handler(req, { params: new Promise(() => {}) });
  expect(response.status).toBe(401);
  expect(requireAdmin).toHaveBeenCalledWith(req);
  expect(getSupabaseClient).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

it("forwards an authorized proxy request with promised params and the server backend key", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue({ user: { id: "admin" } });
  (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));
  const response = await proxy.GET(new NextRequest("https://egxbots.example/api/admin/config?mode=current", { headers: { "x-admin-key": "forged-key" } }), { params: Promise.resolve({ path: ["config"] }) });
  expect(response.status).toBe(200);
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe("https://backend.example/admin/config?mode=current");
  expect(options.headers.get("x-admin-key")).toBe("server-backend-key");
});

it("keeps middleware disabled as required by the deployment cost policy", () => {
  expect(config.matcher).toEqual([]);
});
