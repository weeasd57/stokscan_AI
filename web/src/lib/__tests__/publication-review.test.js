const { reviewPublicationResponse } = require("../ai/pipeline");
const { buildFactRecords } = require("../ai/facts");

const positions = [
    { symbol: "AMES", quantity: 10, entry_price: 10, price: 11, profit_pct: 10, profit_value: 10 },
];
const toolResults = [
    { tool: "manage_portfolio", source: "positions", data_time: "2026-10-07", symbols: ["AMES"], data: { ok: true, positions } },
];
const plan = {
    intent: "portfolio_management",
    entities: { symbols: ["AMES"], portfolio_operation: "view", requested_date: null },
    tools: ["manage_portfolio"],
};

function review(reply) {
    return reviewPublicationResponse({
        reply,
        plan,
        toolResults,
        userMessage: "حلل محفظتي",
        facts: buildFactRecords(toolResults, "2026-10-07T12:00:00.000Z"),
    });
}

describe("portfolio publication review", () => {
    test("a polished portfolio heading does not let unsupported figures pass", () => {
        const result = review("📊 تقرير التحليل الفني الشامل وإدارة مخاطر المحفظة\nAMES: السعر الحالي 999 جنيه والربح 99%.");

        expect(result.ok).toBe(false);
        expect(result.reasons.join(" ")).toMatch(/AMES|حقيقة مسجلة|موثقة/);
    });

    test("evidence-backed portfolio calculations pass the same publication gate", () => {
        const result = review([
            "📊 تقرير التحليل الفني الشامل وإدارة مخاطر المحفظة",
            "AMES: السعر الحالي 11 جنيه، ومتوسط الشراء 10 جنيه، والربح 10% بما يعادل 10 جنيه.",
        ].join("\n"));

        expect(result).toMatchObject({ ok: true, reasons: [] });
    });
});
