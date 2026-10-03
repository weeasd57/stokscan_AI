import { assembleContextSafely, EvidenceContextOverflow } from "../context-budget";
import { buildV2FinalMessages, buildDeterministicResponse } from "../final-v2";

test("separate header and stock facts survive pressure as one block", () => {
    const context = assembleContextSafely([
        "=== RESPONSE RULES ===", "optional".repeat(200),
        "=== LIVE DATA ===", "TAQA: close=17.1; date=2026-10-01", "TAQA: bb_lower=16.2",
        "=== STRICT EVIDENCE CONTEXT (FACTS, DERIVED & AVAILABLE EVIDENCE) ===\nREC: entry=16.25; return_basis=open_mark_to_market",
        "=== USER REQUEST ===\nوقف الخسارة كام؟",
    ], 400);
    expect(context).toContain("close=17.1");
    expect(context).toContain("bb_lower=16.2");
    expect(context).toContain("return_basis=open_mark_to_market");
    expect(context).toContain("وقف الخسارة كام؟");
    expect(context).not.toContain("optional");
    expect(context.length).toBeLessThanOrEqual(400);
});

test("facts exceeding budget are never silently sliced", () => {
    expect(() => assembleContextSafely(["=== LIVE DATA ===", "fact".repeat(300)], 100)).toThrow(EvidenceContextOverflow);
});

test("today-news prompt permits absence today alongside older corporate actions", () => {
    const plan: any = { intent: "stock_news", entities: { symbols: ["KORA"] }, tools: ["get_news", "get_corporate_actions"] };
    const messages = buildV2FinalMessages("أخبار KORA اليوم", plan, null,
        [{ tool: "get_corporate_actions", symbols: ["KORA"], data: { corporate_actions: [{ symbol: "KORA", published_at: "2026-09-21", title: "زيادة رأس المال" }] } }] as any,
        [], [], { symbol: null, confidence: 0, message_id: null });
    const combined = messages.map(m => m.content).join("\n");
    expect(combined).toContain("وجود إجراء شركة قديم");
    expect(combined).not.toContain("لم تمكنها من التنفيذ بعد");
    expect(combined).not.toContain("بينما توجد أحداث أو معنويات");
});

test("buy timing fallback does not become a portfolio sale matrix", () => {
    const tools: any[] = [{ tool: "get_stock", symbols: ["SWDY"], data_time: "2026-10-01", data_type: "historical", data: { symbol: "SWDY", price: 120, rsi_14: 41.84, vol_ratio: "1.9x" } },
        { tool: "get_stock_levels", data: { symbol: "SWDY", support: 102.31, resistance: 139.70 } }];
    const plan: any = { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], entities: { symbols: ["SWDY"] } };
    const reply = buildDeterministicResponse("متى اشتري واعمل متوسط اقل؟", plan, tools)!;
    expect(reply).not.toContain("قرار البيع");
    expect(reply).not.toContain("مراجعة البيع");
    expect(reply).toContain("SWDY");
    expect(reply).toContain("102.31");
});
