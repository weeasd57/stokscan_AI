const { createClient } = require("@supabase/supabase-js");
const { buildCompoundDeterministicPlan } = require("../ai/pipeline");
const { executeStructuredTools } = require("../ai/tools-v2");
const { buildDeterministicResponse } = require("../ai/final-v2");

const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;

describe("Live Supabase chatbot integration", () => {
    const buildPlan = (message, session = { current_symbol: null, last_symbols: [], summary: null }) => {
        const rawPlan = buildCompoundDeterministicPlan(message, session);
        return {
            intent: rawPlan.intent,
            confidence: rawPlan.confidence,
            entities: { reference: null, timeframe: null, requested_date: null, requested_start_date: null, requested_end_date: null, scan_direction: null, ...rawPlan.entities },
            needs_vision_context: false,
            needs_history: false,
            needs_live_data: true,
            needs_historical_data: false,
            tools: rawPlan.tools,
            clarification_needed: false,
            resolved_from: { symbol: null, message_id: null }
        };
    };

    liveTest.each([
        ["ABUK", "66.66"],
        ["ELSH", null]
    ])("answers every command in a compound %s message", async (symbol, expectedSupport) => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const message = `حلل ${symbol} هات أخباره لو كسر الدعم أعمل إيه؟`;
        const plan = buildPlan(message);

        const output = await executeStructuredTools(supabase, plan, [], "live-eval-user", "live-eval-session");
        const resultTools = output.results.map(result => result.tool);
        const response = buildDeterministicResponse(message, plan, output.results);

        expect(plan.tools).toEqual(expect.arrayContaining(["get_stock", "get_stock_levels", "get_news"]));
        expect(resultTools).toContain("get_stock");
        expect(resultTools).toContain("get_stock_levels");
        expect(resultTools).toContain("get_news");
        expect(response).toContain(`${symbol}: السعر`);
        expect(response).toContain("الدعم");
        if (expectedSupport) expect(response).toContain(expectedSupport);
        expect(response).toContain("كسر الدعم");
        expect(response).toContain("الأخبار:");
        expect(response).not.toContain("environment_details");
    }, 30000);

    liveTest("scopes sector news and accumulation to banks, not the previous stock", async () => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const message = "قطاع البنوك أخباره إيه، ومين أسهم التجميع اللي فيه؟";
        const plan = buildPlan(message, { current_symbol: "ELSH", last_symbols: ["ELSH"], summary: "حلل ELSH" });
        const output = await executeStructuredTools(supabase, plan, [], "live-eval-user", "live-eval-sector-session");
        const news = output.results.find(result => result.tool === "get_news");
        const scan = output.results.find(result => result.tool === "get_accumulation_stocks");

        expect(plan.entities.symbols).toEqual([]);
        expect(plan.entities.sector).toBe("بنوك");
        expect(plan.tools).toEqual(expect.arrayContaining(["get_sector", "get_news", "get_accumulation_stocks"]));
        expect(news?.symbols).not.toContain("ELSH");
        expect(scan?.symbols).not.toContain("ELSH");
    }, 30000);
});
