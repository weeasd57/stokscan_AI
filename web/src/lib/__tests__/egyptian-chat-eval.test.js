const { buildDeterministicPlannerResult } = require("../ai/pipeline");
const { isFairValueScanRequest } = require("../ai/intent-policy");
const { buildDeterministicResponse } = require("../ai/final-v2");

const session = { current_symbol: null, last_symbols: [], summary: null };

describe("Egyptian chat evaluation set", () => {
    test.each([
        ["انا اول يوم ليا فى البورصة وعايز افهم اعمل ايه", "general_chat", []],
        ["هات الأسهم اللي بتتداول فوق القيمة العادلة", "market_summary", ["get_fair_value_scan"]],
        ["ما سبب هبوط سهم القلعة؟", "stock_news", ["get_stock", "get_news", "get_stock_levels"]],
        ["حلل ABUK هات أخباره لو كسر الدعم أعمل إيه؟", "stock_analysis", ["get_stock", "get_stock_levels", "get_news"]],
    ])("classifies: %s", (message, intent, tools) => {
        const plan = buildDeterministicPlannerResult(message, session);
        expect(plan.intent).toBe(intent);
        expect(plan.tools).toEqual(expect.arrayContaining(tools));
    });

    it("does not classify a savings product as a stock comparison", () => {
        const plan = buildDeterministicPlannerResult("مقارنة CLOUD مع COMI", session);
        const response = buildDeterministicResponse("مقارنة CLOUD مع COMI", {
            intent: plan?.intent || "comparison", confidence: 1, entities: { symbols: ["COMI"], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: false, needs_historical_data: false,
            tools: [], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        }, [{ tool: "get_comparison", source: "validation", symbols: ["COMI"], data_type: "live", data: {} }]);
        expect(response).toContain("ليس رمز سهم EGX");
        expect(response).not.toMatch(/RSI|MACD/);
    });

    it("recognizes typo-heavy fair value scans", () => {
        expect(isFairValueScanRequest("ات الاسهم اللا بتتداول فوق القيمه العادله")).toBe(true);
    });
});
