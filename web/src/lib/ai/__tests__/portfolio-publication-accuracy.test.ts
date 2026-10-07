import { runAnswerGate } from "../answer-gate";
import { buildFactRecords } from "../facts";

const held: any[] = [{ tool: "manage_portfolio", source: "positions", data_time: "2026-10-07", symbols: ["AMES"],
    data: { ok: true, positions: [{ symbol: "AMES", quantity: 100, entry_price: 10 }] } },
    { tool: "get_stock", source: "database", data_time: "2026-10-07", data_type: "historical", symbols: ["AMES"],
        data: { symbol: "AMES", price: 11, rsi_14: 45 } }];
const plan: any = { intent: "stock_analysis", entities: { symbols: ["AMES"], portfolio_operation: "view" },
    tools: ["manage_portfolio", "get_stock"] };
const forged = "| السهم | الكمية | سعر الشراء | السعر | العائد | وزن المحفظة |\n|---|---|---|---|---|---|\n| AMES | 999 | 77 | 99 | 900% | 99% |";

test("the actual answer gate rejects unsupported portfolio table cells", () => {
    const result = runAnswerGate({ reply: forged, plan, toolResults: held, userMessage: "حلل محفظتي", facts: buildFactRecords(held) });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("جدول المحفظة");
});

test("a general recommendation comparison table is not treated as owned positions", () => {
    const general: any = { intent: "comparison", entities: { symbols: ["AMES"] }, tools: [] };
    const result = runAnswerGate({ reply: "| Symbol | Entry Price | Price | Return |\n|---|---|---|---|\n| AMES | 10 | 11 | 10% |",
        plan: general, toolResults: [], userMessage: "اعرض جدول بيانات التوصية", facts: [] });
    expect(result.reasons.join(" ")).not.toMatch(/لقطة مراكز|مركز محفوظ|جدول المحفظة/);
});
