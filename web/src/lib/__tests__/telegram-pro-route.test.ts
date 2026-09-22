jest.mock("../supabase/server", () => ({ createSupabaseServerClient: jest.fn() }));
jest.mock("../supabase/route-data", () => ({ getSupabaseServiceClient: jest.fn() }));
jest.mock("../telegramProInvite", () => ({ createProTelegramInvite: jest.fn() }));

import { createSupabaseServerClient } from "../supabase/server";
import { getSupabaseServiceClient } from "../supabase/route-data";
import { createProTelegramInvite } from "../telegramProInvite";
import { GET } from "../../app/api/profile/telegram-pro/route";

const auth = createSupabaseServerClient as jest.Mock;
const serviceClient = getSupabaseServiceClient as jest.Mock;
const createInvite = createProTelegramInvite as jest.Mock;
const userId = "b79005b6-c266-41f1-af8f-e3902e63e574";
const subscriptionEnd = "2030-09-22T00:00:00Z";

function query(data: unknown, error: { code: string } | null = null) {
  const result = { data, error };
  const chain: any = {};
  for (const method of ["select", "eq", "not", "order", "limit", "update"]) chain[method] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => result);
  chain.then = (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve);
  return chain;
}

describe("VIP Telegram invitation route", () => {
  const originalFetch = global.fetch;
  const originalBackendUrl = process.env.PYTHON_BACKEND_URL;
  const originalOtherBackend = process.env.TRADING_SIGNALS_API_URL;
  const originalPublicBackend = process.env.NEXT_PUBLIC_API_BASE_URL;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.PYTHON_BACKEND_URL = "https://backend.example.test";
    delete process.env.TRADING_SIGNALS_API_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    auth.mockReturnValue({ auth: { getUser: jest.fn(async () => ({ data: { user: { id: userId } } })) } });
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalBackendUrl === undefined) delete process.env.PYTHON_BACKEND_URL;
    else process.env.PYTHON_BACKEND_URL = originalBackendUrl;
    if (originalOtherBackend === undefined) delete process.env.TRADING_SIGNALS_API_URL;
    else process.env.TRADING_SIGNALS_API_URL = originalOtherBackend;
    if (originalPublicBackend === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalPublicBackend;
  });

  it("recovers a missing invite through an approved order when web Telegram creation fails", async () => {
    const orders = query([{ id: "approved-order" }]);
    const upsert = jest.fn(async () => ({ error: null }));
    serviceClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "subscriptions") return query({ current_period_end: subscriptionEnd });
        if (table === "pro_telegram_invites") return { ...query(null), upsert };
        if (table === "local_payment_orders") return orders;
        throw new Error(`unexpected table ${table}`);
      }),
    });
    createInvite.mockResolvedValue("");
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ telegram_pro_url: "https://t.me/+private-test-invite" }) }));
    global.fetch = fetchMock as any;

    const response = await GET();
    const body = await response.json();

    expect(body.is_pro).toBe(true);
    expect(body.invite_link).toBe("https://t.me/+private-test-invite");
    expect(body.invite_status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("user_id=" + userId), expect.any(Object));
    expect(upsert).toHaveBeenCalled();
  });

  it("reports missing VIP invitation explicitly for an active subscriber", async () => {
    delete process.env.PYTHON_BACKEND_URL;
    serviceClient.mockReturnValue({
      from: jest.fn((table: string) => table === "subscriptions"
        ? query({ current_period_end: subscriptionEnd })
        : table === "pro_telegram_invites" ? query(null) : query([])),
    });
    createInvite.mockResolvedValue("");
    const response = await GET();
    const body = await response.json();

    expect(body).toMatchObject({ is_pro: true, invite_link: "", invite_status: "unavailable" });
  });

  it("uses the public backend URL when the private backend variable is absent", async () => {
    delete process.env.PYTHON_BACKEND_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://public-backend.example.test";
    const orders = query([{ id: "approved-order" }]);
    const upsert = jest.fn(async () => ({ error: null }));
    serviceClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "subscriptions") return query({ current_period_end: subscriptionEnd });
        if (table === "pro_telegram_invites") return { ...query(null), upsert };
        if (table === "local_payment_orders") return orders;
        throw new Error(`unexpected table ${table}`);
      }),
    });
    createInvite.mockResolvedValue("");
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ telegram_pro_url: "https://t.me/+private-test-invite" }) }));
    global.fetch = fetchMock as any;

    await GET();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("https://public-backend.example.test/payment/local/status"), expect.any(Object));
  });

  it("never displays an expired invite as a working VIP link", async () => {
    delete process.env.PYTHON_BACKEND_URL;
    serviceClient.mockReturnValue({
      from: jest.fn((table: string) => table === "subscriptions"
        ? query({ current_period_end: subscriptionEnd })
        : table === "pro_telegram_invites"
          ? query({ invite_link: "https://t.me/+expired", invite_expires_at: "2020-01-01T00:00:00Z" })
          : query([])),
    });
    createInvite.mockResolvedValue("");

    const response = await GET();
    expect(await response.json()).toMatchObject({ invite_link: "", invite_status: "unavailable" });
  });

  it("does not mislabel a subscriber as free when subscription lookup fails", async () => {
    serviceClient.mockReturnValue({
      from: jest.fn(() => query(null, { code: "PGRST205" })),
    });

    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "subscription_unavailable" });
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("does not disclose VIP invitations to an unauthenticated request", async () => {
    auth.mockReturnValue({ auth: { getUser: jest.fn(async () => ({ data: { user: null } })) } });

    const response = await GET();
    expect(response.status).toBe(401);
    expect(serviceClient).not.toHaveBeenCalled();
  });
});
