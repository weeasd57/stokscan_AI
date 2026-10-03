let mockSubscriptionRows: Array<{ plan_id: string; status: string; current_period_end: string }> = [];
let mockSubscriptionError: unknown = null;
let mockSubscriptionLookups = 0;

jest.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: any) => {
    if (options?.global?.headers?.Authorization) {
      return { auth: { getUser: async () => ({ data: { user: { id: "test-user" } }, error: null }) } };
    }
    return {
      from: () => ({
        select: () => ({
          eq: async () => {
            mockSubscriptionLookups += 1;
            return { data: mockSubscriptionRows, error: mockSubscriptionError };
          },
        }),
      }),
    };
  },
}));

const sessionCookie = "base64-" + Buffer.from(
  JSON.stringify({ access_token: "test-token", refresh_token: "refresh-token" }),
).toString("base64url");
const request = {
  cookies: {
    getAll: () => [{ name: "sb-example-auth-token", value: sessionCookie }],
  },
} as any;

describe("viewer plan freshness", () => {
  const oldEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(new Date("2026-09-27T12:00:00Z"));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
    process.env.NEXT_PUBLIC_PAYMENTS_ENABLED = "true";
    mockSubscriptionRows = [];
    mockSubscriptionError = null;
    mockSubscriptionLookups = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...oldEnv };
  });

  it("refreshes a previously Free user within one minute after activation", async () => {
    const { getViewerContext } = await import("../viewer-context");
    expect((await getViewerContext(request)).pro).toBe(false);
    mockSubscriptionRows = [{ plan_id: "pro", status: "active", current_period_end: "2026-10-27T00:00:00Z" }];
    expect((await getViewerContext(request)).pro).toBe(false);
    expect(mockSubscriptionLookups).toBe(1);

    jest.advanceTimersByTime(61_000);
    expect((await getViewerContext(request)).pro).toBe(true);
    expect(mockSubscriptionLookups).toBe(2);
  });

  it("does not cache Free when the subscription lookup failed", async () => {
    const { getViewerContext } = await import("../viewer-context");
    mockSubscriptionError = { code: "PGRST000" };
    expect((await getViewerContext(request)).pro).toBe(false);
    mockSubscriptionError = null;
    mockSubscriptionRows = [{ plan_id: "pro", status: "active", current_period_end: "2026-10-27T00:00:00Z" }];
    expect((await getViewerContext(request)).pro).toBe(true);
    expect(mockSubscriptionLookups).toBe(2);
  });
});
