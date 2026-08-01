const {
    buildDeterministicPlannerResult,
    buildCompoundDeterministicPlan,
    enforceIntentFromMessage,
    extractExplicitSymbols,
    extractSectorFromMessage,
    extractRequestedDate,
    extractRequestedDateRange,
    isMarketWideRequest
} = require("../ai/pipeline");

const emptySession = { current_symbol: null, last_symbols: [], summary: null };

const cases = [
    ["تحليل سهم", "حلل ABUK", "stock_analysis", ["ABUK"], ["get_stock", "get_stock_levels"]],
    ["رمز فقط", "caed", "stock_analysis", ["CAED"], ["get_stock", "get_stock_levels"]],
    ["دعم بخطأ", "ABUK اى مقواماته ودعمه", "levels_analysis", ["ABUK"], ["get_stock_levels"]],
    ["قرار بيع", "أبيع ABUK ولا استنى", "stock_analysis", ["ABUK"], ["get_stock", "get_stock_levels"]],
    ["تجميع سهم", "هل في تجميع على ELSH", "accumulation_distribution", ["ELSH"], ["get_accumulation_stocks"]],
    ["تصريف سهم", "EITP عليه تصريف؟", "accumulation_distribution", ["EITP"], ["get_distribution_stocks"]],
    ["أخبار سهم", "أخبار COMI اليوم", "stock_news", ["COMI"], ["get_news"]],
    ["مقارنة", "قارن COMI و EAST", "comparison", ["COMI", "EAST"], ["get_comparison"]],
    ["قطاع", "البنوك حالتها ايه", "sector_analysis", [], ["get_sector"]],
    ["قائمة قطاعات", "اعرض القطاعات الموجودة", "sector_analysis", [], ["get_sector_list"]],
    ["قطاع إنجليزي", "Process Industries", "sector_analysis", [], ["get_sector"]],
    ["سيولة قطاع", "هات سيوله قطاع الادويه", "sector_analysis", [], ["get_sector_liquidity"]],
    ["أكبر قطاع", "ايه اكبر قطاع فيه سيوله", "market_summary", [], ["get_sector_liquidity"]],
    ["أقوى أسهم", "أقوى الأسهم لاخر يوم", "market_summary", [], ["get_market"]],
    ["تجميع السوق", "جيب الأسهم اللي عليها تجميع", "accumulation_distribution", [], ["get_accumulation_stocks"]],
    ["تصريف السوق", "والتصريف", "accumulation_distribution", [], ["get_distribution_stocks"]],
    ["هوية", "انتا مين", "general_chat", [], []],
    ["الموديل", "انتا موديل ايه", "general_chat", [], []],
    ["تاريخ", "تحليل AMES يوم 2026-07-10", "stock_analysis", ["AMES"], ["get_stock", "get_stock_levels"]],
    ["سيولة سهم", "حلل سيوله ELSH", "stock_analysis", ["ELSH"], ["get_stock"]],
    ["مخاطر", "ممكن EITP يخسر اكتر من 8%", "risk_analysis", ["EITP"], ["get_stock", "get_distribution_stocks"]],
    ["أخبار سوق", "اخبار السوق ل 5/7", "market_summary", [], ["get_news"]],
];

describe("Chat intent evaluation matrix", () => {
    test.each(cases)("%s", (_name, message, intent, symbols, tools) => {
        const plan = buildDeterministicPlannerResult(message, emptySession);
        expect(plan).not.toBeNull();
        expect(plan.intent).toBe(intent);
        expect(plan.entities.symbols).toEqual(symbols);
        expect(plan.tools).toEqual(tools);
    });

    it("keeps stock context for a news follow-up", () => {
        const plan = buildDeterministicPlannerResult("هات اخباره", { current_symbol: "ABUK", last_symbols: ["ABUK"], summary: "حلل ABUK" });
        expect(plan.intent).toBe("stock_news");
        expect(plan.entities.symbols).toEqual(["ABUK"]);
        expect(plan.tools).toEqual(["get_news"]);
    });

    it("keeps stock context for a broken-support follow-up", () => {
        const plan = buildDeterministicPlannerResult("لو كسر الدعم أعمل ايه؟", { current_symbol: "ABUK", last_symbols: ["ABUK"], summary: "حلل ABUK" });
        expect(plan.entities.symbols).toEqual(["ABUK"]);
        expect(plan.tools).toEqual(["get_stock_levels"]);
    });

    it("keeps a distribution follow-up market-wide", () => {
        const plan = buildDeterministicPlannerResult("والتصريف", { current_symbol: "ABUK", last_symbols: ["ABUK"], summary: "أسهم التجميع" });
        expect(plan.entities.symbols).toEqual([]);
        expect(plan.tools).toEqual(["get_distribution_stocks"]);
    });

    it("resolves a dated pronoun follow-up", () => {
        const plan = buildDeterministicPlannerResult("هاتها بتاريخ 10/7", { current_symbol: "AALR", last_symbols: ["AALR"], summary: "حلل AALR" });
        expect(plan.entities.symbols).toEqual(["AALR"]);
        expect(plan.entities.requested_date).toMatch(/-07-10$/);
    });

    it("extracts explicit ranges and market scope safely", () => {
        expect(extractRequestedDateRange("اخبار AMER مابين 5/7 ل 30/7")).not.toBeNull();
        expect(isMarketWideRequest("اخبار السوق ل 5/7")).toBe(true);
        expect(extractExplicitSymbols("اخبار السوق ل 5/7")).toEqual([]);
        expect(extractSectorFromMessage("سيوله قطاع الادويه")).toBe("أدوية");
        expect(extractRequestedDate("يوم 2026-07-10")).toBe("2026-07-10");
    });

    it("does not let generic liquidity override a named sector", () => {
        const result = enforceIntentFromMessage("هات سيوله قطاع الادويه", "market_summary", []);
        expect(result.tools).toEqual(["get_sector_liquidity"]);
        expect(result.sector).toBe("أدوية");
    });

    it("extracts every symbol when one message contains two level questions", () => {
        const plan = buildCompoundDeterministicPlan("ABUK ايه مقاوماته ودعمه؟\nEAST عنده مقاومة عند كام؟", emptySession);
        expect(plan.entities.symbols).toEqual(["ABUK", "EAST"]);
        expect(plan.tools).toEqual(["get_stock_levels"]);
    });

    it("combines several commands in one message while preserving context", () => {
        const plan = buildCompoundDeterministicPlan("حلل ABUK\nهات أخباره\nلو كسر الدعم أعمل إيه؟", emptySession);
        expect(plan.entities.symbols).toEqual(["ABUK"]);
        expect(plan.tools).toEqual(expect.arrayContaining(["get_stock", "get_stock_levels", "get_news"]));
    });

    it("splits several commands written on one line", () => {
        const plan = buildCompoundDeterministicPlan("حلل ABUK هات أخباره لو كسر الدعم أعمل إيه؟", emptySession);
        expect(plan.entities.symbols).toEqual(["ABUK"]);
        expect(plan.tools).toEqual(expect.arrayContaining(["get_stock", "get_stock_levels", "get_news"]));
    });

    it("combines sector news and accumulation in one request", () => {
        const plan = buildCompoundDeterministicPlan("قطاع البنوك اخباره ايه، و مين اسهم التجميع اللي فيه؟", emptySession);
        expect(plan.entities.sector).toBe("بنوك");
        expect(plan.tools).toEqual(expect.arrayContaining(["get_sector", "get_news", "get_accumulation_stocks"]));
    });

    it("does not carry the previous stock into a sector compound request", () => {
        const plan = buildCompoundDeterministicPlan("قطاع البنوك اخباره ايه، و مين اسهم التجميع اللي فيه؟", { current_symbol: "ELSH", last_symbols: ["ELSH"], summary: "حلل ELSH" });
        expect(plan.entities.symbols).toEqual([]);
        expect(plan.entities.sector).toBe("بنوك");
    });

    it("does not collapse a compound tool plan to the last support question", () => {
        const plan = buildCompoundDeterministicPlan("حلل ABUK\nهات أخباره\nلو كسر الدعم أعمل إيه؟", emptySession);
        const commands = require("../ai/pipeline").splitChatCommands("حلل ABUK\nهات أخباره\nلو كسر الدعم أعمل إيه؟");
        expect(commands).toHaveLength(3);
        expect(plan.tools.sort()).toEqual(["get_news", "get_stock", "get_stock_levels"].sort());
    });

    it("keeps session context across several consecutive questions", () => {
        const session = { current_symbol: null, last_symbols: [], summary: null };
        const first = buildDeterministicPlannerResult("حلل ABUK", session);
        Object.assign(session, first.session_update);
        const second = buildDeterministicPlannerResult("هات اخباره", session);
        Object.assign(session, second.session_update);
        const third = buildDeterministicPlannerResult("لو كسر الدعم أعمل ايه؟", session);
        expect(second.entities.symbols).toEqual(["ABUK"]);
        expect(third.entities.symbols).toEqual(["ABUK"]);
        expect(third.tools).toEqual(["get_stock_levels"]);
    });
});
