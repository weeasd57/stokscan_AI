import { NextRequest } from "next/server";
import { GET } from "../route";
import { getViewerContext } from "../../../../lib/supabase/viewer-context";

jest.mock("../../../../lib/supabase/viewer-context", () => ({
  getViewerContext: jest.fn(),
}));

const savedEnv = { ...process.env };
const savedFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...savedEnv,
    ADMIN_SECRET_KEY: "test-admin-secret",
    PYTHON_BACKEND_URL: "https://backend.example",
  };
  global.fetch = jest.fn();
});

afterAll(() => {
  process.env = savedEnv;
  global.fetch = savedFetch;
});

describe("GET /api/short-swings Route", () => {
  const mockBackendPayload = {
    status: "ok",
    kpis: { win_rate_pct: 55.0, profit_factor: 1.8 },
    active_trades: [
      {
        signal_id: "COMI_2026-10-06",
        symbol: "COMI",
        name_ar: "البنك التجاري الدولي",
        name_en: "CIB",
        sector: "بنوك",
        entry_date: "2026-10-06",
        signal_date: "2026-10-06",
        entry_price: 100.0,
        current_price: 105.0,
        reference_close: 100.0,
        trailing_stop: 96.0,
        stop_loss: 96.0,
        return_pct: 5.0,
        is_breakeven_protected: false,
        max_gain_pct: 5.0,
        trigger_type: "اختراق قمة 20 جلسة",
        status: "قيد التداول",
        is_pending_entry: false,
      },
    ],
    closed_trades: [
      {
        symbol: "ETEL",
        entry_date: "2026-09-01",
        exit_date: "2026-09-05",
        entry_price: 40.0,
        exit_price: 42.0,
        return_pct: 5.0,
        sessions: 4,
        holding_days: 4,
        reason: "ema10_break",
        exit_reason: "كسر متوسط EMA10",
      },
    ],
    total_active: 1,
    total_closed: 1,
    as_of: "2026-10-06",
  };

  it("masks fresh active trades for free users even if ?is_pro=true query parameter is supplied", async () => {
    // Free user context
    (getViewerContext as jest.Mock).mockResolvedValue({ pro: false, role: "user" });
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify(mockBackendPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    // Call with malicious ?is_pro=true
    const req = new NextRequest("https://egxbots.example/api/short-swings?is_pro=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    // Must be marked as free user
    expect(body.is_pro).toBe(false);

    // Active trade MUST be masked
    expect(body.active_trades).toHaveLength(1);
    const active = body.active_trades[0];
    expect(active.is_locked).toBe(true);
    expect(active.symbol).toBe("CO**");
    expect(active.entry_price).toBeNull();
    expect(active.current_price).toBeNull();
    expect(active.reference_close).toBeNull();
    expect(body.upgrade_cta).toBeDefined();

    // Closed trades must remain fully visible
    expect(body.closed_trades).toHaveLength(1);
    expect(body.closed_trades[0].symbol).toBe("ETEL");
    expect(body.closed_trades[0].is_locked).toBe(false);
  });

  it("returns unmasked active trades for verified PRO subscribers", async () => {
    // Pro user context
    (getViewerContext as jest.Mock).mockResolvedValue({ pro: true, role: "user" });
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify(mockBackendPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const req = new NextRequest("https://egxbots.example/api/short-swings");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.is_pro).toBe(true);
    expect(body.active_trades[0].is_locked).toBe(false);
    expect(body.active_trades[0].symbol).toBe("COMI");
    expect(body.active_trades[0].entry_price).toBe(100.0);
  });

  it("ignores client refresh=true when called by regular users", async () => {
    (getViewerContext as jest.Mock).mockResolvedValue({ pro: false, role: "user" });
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify(mockBackendPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const req = new NextRequest("https://egxbots.example/api/short-swings?refresh=true");
    await GET(req);

    // Should NOT forward refresh=true to backend
    const [calledUrl] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).not.toContain("refresh=true");
  });

  it("forwards refresh=true to backend when called by an admin", async () => {
    (getViewerContext as jest.Mock).mockResolvedValue({ pro: true, role: "admin" });
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify(mockBackendPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const req = new NextRequest("https://egxbots.example/api/short-swings?refresh=true", {
      headers: { "x-admin-key": "test-admin-secret" },
    });
    await GET(req);

    // Should forward refresh=true to backend
    const [calledUrl, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).toContain("refresh=true");
    expect(options.headers["x-admin-key"]).toBe("test-admin-secret");
  });
});
