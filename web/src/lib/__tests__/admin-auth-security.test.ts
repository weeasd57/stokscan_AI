import { requireAdmin } from "../admin-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { isAllowedAdminEmail } from "../admin-auth-client";

jest.mock("../supabase/server", () => ({ createSupabaseServerClient: jest.fn() }));
const savedEnv = { ...process.env };
const getUser = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...savedEnv };
  delete process.env.ADMIN_SECRET_PASSWORD;
  delete process.env.NEXT_PUBLIC_ADMIN_EMAILS;
  delete process.env.ADMIN_EMAILS;
  (createSupabaseServerClient as jest.Mock).mockResolvedValue({ auth: { getUser } });
});
afterAll(() => { process.env = savedEnv; });

it.each(["weeasd57@attacker.example", "evil-weeeenew@gmail.com", "weeeessd57@gmail.com.attacker.example"])(
  "rejects admin-like addresses instead of matching handle substrings: %s", async (email) => {
    expect(isAllowedAdminEmail(email)).toBe(false);
    getUser.mockResolvedValue({ data: { user: { id: "ordinary", email } }, error: null });
    const result = await requireAdmin(new Request("https://egxbots.example/api/admin/config"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  }
);

it("preserves exact configured admin accounts", async () => {
  process.env.ADMIN_EMAILS = "trusted@example.com";
  getUser.mockResolvedValue({ data: { user: { id: "trusted", email: "trusted@example.com" } }, error: null });
  await expect(requireAdmin(new Request("https://egxbots.example/api/admin/config"))).resolves.toEqual({ user: { id: "trusted", email: "trusted@example.com" } });
});

it("does not trust a role returned with a failed authentication result", async () => {
  getUser.mockResolvedValue({ data: { user: { app_metadata: { role: "admin" } } }, error: { message: "invalid token" } });
  const result = await requireAdmin(new Request("https://egxbots.example/api/admin/config"));
  expect((result as Response).status).toBe(401);
});
