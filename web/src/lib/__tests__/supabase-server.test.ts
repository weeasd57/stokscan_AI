import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../supabase/server";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@supabase/ssr", () => ({ createServerClient: jest.fn(() => ({ sessionClient: true })) }));
jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn(() => ({ bearerClient: true })) }));

const savedEnv = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...savedEnv, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-public" };
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
});
afterAll(() => { process.env = savedEnv; });

it("awaits Next 15 cookies and preserves cookie reads/writes", async () => {
  const store = { get: jest.fn(() => ({ value: "session" })), set: jest.fn(), delete: jest.fn() };
  (cookies as jest.Mock).mockResolvedValue(store);
  await createSupabaseServerClient();
  const options = (createServerClient as jest.Mock).mock.calls[0][2];
  expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false });
  const adapter = options.cookies;
  expect(adapter.get("session-cookie")).toBe("session");
  adapter.set("session-cookie", "refreshed", { httpOnly: true });
  expect(store.set).toHaveBeenCalledWith({ name: "session-cookie", value: "refreshed", httpOnly: true });
  adapter.remove("session-cookie", {});
  expect(store.delete).toHaveBeenCalledWith({ name: "session-cookie" });
});

it("uses request cookies without accessing the ambient cookie store", async () => {
  const request = new NextRequest("https://egxbots.example/api/user/quota", { headers: { cookie: "session-cookie=request-session" } });
  await createSupabaseServerClient(request);
  expect(cookies).not.toHaveBeenCalled();
  expect((createServerClient as jest.Mock).mock.calls[0][2].cookies.get("session-cookie")).toBe("request-session");
});

it("uses the user's bearer token and public key, never a privileged credential", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-new";
  process.env.SUPABASE_SECRET_KEY = "private-test-value";
  await createSupabaseServerClient(new NextRequest("https://egxbots.example/api/user/quota", { headers: { authorization: "Bearer user-token" } }));
  expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "public-new", {
    global: { headers: { Authorization: "Bearer user-token" } },
  });
  expect(cookies).not.toHaveBeenCalled();
  expect(createServerClient).not.toHaveBeenCalled();
});

it("fails closed when only a service credential is configured", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  process.env.SUPABASE_SECRET_KEY = "private-test-value";
  await expect(createSupabaseServerClient()).rejects.toThrow("Missing Supabase environment variables");
  expect(createClient).not.toHaveBeenCalled();
});
