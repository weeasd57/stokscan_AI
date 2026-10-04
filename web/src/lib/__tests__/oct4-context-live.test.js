/** Live replays of the October 4 audit, using isolated non-persistent IDs. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { runPipeline } = require("../ai/pipeline");
const { checkContextEvidence } = require("../ai/context-evidence-gate");

const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;
const state = symbol => ({ current_symbol: symbol, last_symbols: symbol ? [symbol] : [], summary: symbol ? `تحليل ${symbol}` : null });
const report = [];
const cases = [
    ["Cib", "ORHD", ["COMI"]],
    ["حلل JUFO باختصار وقولي سعره قريب من الدعم ولا المقاومة", null, ["JUFO"]],
    ["قارن CCAP مع COMI دلوقتي", null, ["CCAP", "COMI"]],
    ["قارن سيولة CCAP معاه", "COMI", ["CCAP", "COMI"]],
    ["ALCN أدخل دلوقتي ولا أستنى؟ رد مختصر", null, ["ALCN"]],
    ["GTWL آخر توصية عليه من إمتى؟", null, ["GTWL"]],
    ["ORHD توزيعات مجانية يعني إيه؟", null, ["ORHD"]],
    ["JUFO ليه KING مختلف عن EGX؟ الفرق له دلالة إحصائية؟", null, ["JUFO"]],
];

describe("Live context and snapshot audit regressions", () => {
    afterAll(() => fs.writeFileSync(path.join(os.tmpdir(), "oct4-context-live-report.json"), JSON.stringify(report, null, 2)));
    async function ask(message, previousSymbol, images = [], options) {
        const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const started = Date.now();
        const result = await runPipeline(message, images, state(previousSymbol), null, [], db, [],
            "oct4-context-eval", "oct4-context-eval", `oct4-eval-${started}`, undefined, options);
        report.push({ message, elapsed_ms: Date.now() - started, response: result.response,
            plan: result.plan, review: result.publication_review, vision: result.vision,
            data: result.tools.results.map(r => ({ tool: r.tool, symbols: r.symbols, data_time: r.data_time, source: r.source, data: r.data })) });
        expect(result.response.length).toBeGreaterThan(30);
        expect(result.response).not.toMatch(/تعذر التحقق من إجابة|تعذر إكمال التحليل|environment_details|position_pct|action_date|platform_recommendation/);
        expect(result.publication_review?.final_passed).toBe(true);
        expect(checkContextEvidence(result.response, result.plan, result.tools.results, result.vision)).toEqual([]);
        return result;
    }

    liveTest.each(cases)("handles %s", async (message, previousSymbol, symbols) => {
        const result = await ask(message, previousSymbol);
        expect(new Set(result.plan.entities.symbols)).toEqual(new Set(symbols));
        if (message === "Cib") {
            expect(result.plan.intent).toBe("stock_analysis");
            expect(result.response).not.toContain("CIEB");
        }
        if (message.includes("أدخل")) expect(result.response.length).toBeLessThan(1800);
        if (message.includes("قارن")) {
            for (const row of result.tools.results.find(r => r.tool === "get_comparison").data.comparisons) {
                expect(result.response).toContain(row.symbol);
                if (row.as_of) expect(result.response).toContain(String(row.as_of).slice(0, 10));
            }
        }
    }, 90000);

    liveTest("replays the already extracted portfolio image with a live LLM and market tools", async () => {
        // Vision extraction succeeded in the original chat. Reuse its structure
        // to isolate the failed context/routing layer; no customer session is used.
        const vision = { image_type: "portfolio", confidence: .9, analyzed_at: new Date().toISOString(), message_id: "oct4-replay",
            symbols: ["EGAL", "ADIB", "MASR", "TALM"].map(symbol => ({ symbol, name: "", visible_values: { price: null, quantity: null, change_pct: null } })),
            technical_observations: [], uncertainties: ["الكميات وأسعار الشراء غير مقروءة"],
            market_depth: { total_bid: null, total_ask: null, spread: null }, user_relevant_summary: "Portfolio value 41217; daily change -1.91%" };
        const result = await ask("رايك ف هذه المحفظة وسهم الاسكندريه لتداول الحاويات", null, ["replay-image"], { mockVisionResult: vision });
        for (const symbol of ["EGAL", "ADIB", "MASR", "TALM", "ALCN"]) expect(result.response).toContain(symbol);
        expect(result.response).toContain("الصورة");
        expect(result.response).not.toMatch(/محفظتك فاضية|قيمة المحفظة.*0\.00/);
        expect(result.plan.tools).not.toContain("manage_portfolio");
    }, 90000);
});
