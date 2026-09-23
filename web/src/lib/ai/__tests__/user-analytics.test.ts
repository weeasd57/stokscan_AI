import { buildUserAnalytics, buildUserUsage } from "../../admin/user-analytics";

describe("admin user analytics", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");

  it("separates active Pro page users from Pro chatbot users", () => {
    const result = buildUserAnalytics({
      now,
      profiles: [{ id: "pro-1" }, { id: "pro-2" }, { id: "free-1" }],
      subscriptions: [
        { user_id: "pro-1", plan_id: "pro", status: "active" },
        { user_id: "pro-2", plan_id: "pro", status: "active" },
      ],
      events: [
        { user_id: "pro-1", event_name: "page_view", path: "/scanner/backtests", created_at: "2026-09-22T10:00:00Z" },
        { user_id: "free-1", event_name: "page_view", path: "/scanner/technical", created_at: "2026-09-22T10:00:00Z" },
      ],
      chatMessages: [
        { user_id: "pro-2", role: "user", created_at: "2026-09-22T11:00:00Z" },
        { user_id: "pro-1", role: "assistant", created_at: "2026-09-22T11:01:00Z" },
      ],
      chatSessions: [{ id: "session-1", user_id: "pro-2" }],
    });
    expect(result.activeProUsers).toBe(2);
    expect(result.proPageUsers).toBe(1);
    expect(result.proChatUsers).toBe(1);
    expect(result.proPageOnlyUsers).toBe(1);
    expect(result.proChatOnlyUsers).toBe(1);
    expect(result.paidConversionRate).toBe(67);
  });

  it("builds a useful per-user usage summary", () => {
    const result = buildUserUsage({
      events: [
        { user_id: "u1", event_name: "page_view", path: "/scanner/ai", created_at: "2026-09-23T10:00:00Z" },
        { user_id: "u1", event_name: "page_view", path: "/scanner/ai", created_at: "2026-09-23T10:01:00Z" },
      ],
      chatMessages: [{ user_id: "u1", role: "user", created_at: "2026-09-23T10:02:00Z" }],
      chatSessions: [{ id: "s1", user_id: "u1" }],
      analytics: [{ intent: "stock_analysis", total_latency_ms: 1000, created_at: "2026-09-23T10:02:01Z" }],
    });
    expect(result.pageViews).toBe(2);
    expect(result.chatMessages).toBe(1);
    expect(result.topPages[0]).toMatchObject({ path: "/scanner/ai", views: 2, users: 1 });
    expect(result.topIntents[0]).toEqual({ intent: "stock_analysis", count: 1 });
  });
});
