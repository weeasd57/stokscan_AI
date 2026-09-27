const { buildDeterministicNewsResponse, normalizeStockFreshnessLanguage, buildV2FinalMessages } = require("../ai/final-v2");
const { runPipelineStream } = require("../ai/pipeline");

const newsPlan = {
    intent: "stock_news",
    entities: { symbols: ["GGRN"], requested_date: "2026-09-27", requested_start_date: null, requested_end_date: null },
    tools: ["get_news", "search_web"],
};

describe("today's chatbot response regressions", () => {
    test("empty news is uncertainty, not a categorical no-news claim", () => {
        const response = buildDeterministicNewsResponse("أخبار GGRN اليوم", newsPlan, [
            { tool: "get_news", data: [], symbols: ["GGRN"] },
            { tool: "search_web", data: { results: [] }, symbols: ["GGRN"] },
        ]);
        expect(response).toContain("لم أجد خبراً موثّقاً");
        expect(response).toContain("2026-09-27");
        expect(response).toContain("هذا لا يؤكد عدم صدور أخبار");
        expect(response).not.toContain("لا توجد أخبار");
    });

    test("sourced web news is not discarded by an empty database result", () => {
        expect(buildDeterministicNewsResponse("أخبار GGRN اليوم", newsPlan, [
            { tool: "get_news", data: [], symbols: ["GGRN"] },
            { tool: "search_web", data: { results: [{ title: "Announcement", url: "https://example.com" }] }, symbols: ["GGRN"] },
        ])).toBeNull();
    });

    test("historical stock wording cannot claim an intraday quote", () => {
        const result = normalizeStockFreshnessLanguage("السعر الحالي 2.5 في تداولات حية ويقف الآن عند 2.5", [
            { tool: "get_stock", data_type: "historical", data: { symbol: "MPCO", price: 2.5 }, symbols: ["MPCO"], data_time: "2026-09-24" },
        ]);
        expect(result).toContain("آخر إغلاق مسجل");
        expect(result).not.toMatch(/السعر الحالي|تداولات حية|يقف الآن/);
    });

    test("bare stock queries get a concise answer instruction", () => {
        const messages = buildV2FinalMessages("لوتس", { ...newsPlan, intent: "stock_analysis", tools: ["get_stock"] }, null, [], [], [], { symbol: null, message_id: null, confidence: 0 });
        expect(JSON.stringify(messages)).toContain("3 إلى 5 أسطر");
    });

    test("asking to analyse an unfinished screenshot does not reuse a previous ticker", async () => {
        const summary = {
            pending_portfolio_import: { items: [{ symbol: "BWS", quantity: null, price: null }], current_index: 0 },
            last_topic: "portfolio_import_pending",
        };
        const session = { current_symbol: "FWRY", last_symbols: ["FWRY"], summary: null };
        let done;
        for await (const event of runPipelineStream("حلل محفظتي", [], session, summary, [], {}, [], "test-user", "test-session", "test-message")) {
            if (event.type === "done") done = event.data;
        }
        expect(done.response).toContain("الصورة لسه ما اتسجلتش");
        expect(done.response).toContain("BWS");
        expect(done.response).not.toContain("FWRY");
    });

    test("an empty saved portfolio never becomes analysis of a previous ticker", async () => {
        const supabase = {
            from: jest.fn(() => ({
                select: () => ({
                    eq: () => ({ eq: async () => ({ data: [], error: null }) }),
                }),
            })),
        };
        const session = { current_symbol: "FWRY", last_symbols: ["FWRY"], summary: null };
        let done;
        for await (const event of runPipelineStream("حلل محفظتي", [], session, null, [], supabase, [], "test-user", "test-session", "test-message")) {
            if (event.type === "done") done = event.data;
        }
        expect(done.response).toContain("محفظتك فاضية");
        expect(done.response).not.toContain("FWRY");
        expect(supabase.from).toHaveBeenCalledWith("positions");
    });
});
