import {
    buildCompoundDeterministicPlan,
    extractSingleStockFromRecentHistory,
    isImplicitStockFollowUp,
    looksLikeQuestionFragment,
} from "../ai/pipeline";

describe("implicit single-stock follow-ups", () => {
    const session = { current_symbol: "AALR", last_symbols: ["AALR"], summary: "تحليل AALR" };

    test.each([
        "طب ممكن يطلع للمقاومة امتى",
        "هيوصل للهدف امتى",
        "لو كسر الدعم اعمل ايه",
        "الوصول للمقاومة محتاج ايه",
        "هيكمل صعود؟",
        "when will it reach resistance?",
        "is it going to break out?",
    ])("detects stock follow-up: %s", (message) => {
        expect(isImplicitStockFollowUp(message)).toBe(true);
        const plan = buildCompoundDeterministicPlan(message, session);
        expect(["stock_analysis", "levels_analysis"]).toContain(plan.intent);
        expect(plan.entities.symbols).toEqual(["AALR"]);
        expect(plan.tools).toContain("get_stock_levels");
    });

    test.each([
        "امتى السوق يفتح؟",
        "المتوقع يرتفع الأسبوع ده",
        "هات الاسهم اللي عليها تجميع",
        "عايز اسهم استثمار لمدة سنة",
        "ايه اخبار السوق؟",
    ])("does not inherit stock context for market request: %s", (message) => {
        expect(isImplicitStockFollowUp(message)).toBe(false);
        const plan = buildCompoundDeterministicPlan(message, session);
        if (plan) {
            expect(plan.entities.symbols).toEqual([]);
            expect(plan.entities.symbols).not.toContain("AALR");
        }
    });

    test("falls back to the previous symbol list when current_symbol is absent", () => {
        const plan = buildCompoundDeterministicPlan("طب ممكن يطلع للمقاومة امتى", {
            current_symbol: null,
            last_symbols: ["AALR"],
            summary: "تحليل AALR",
        });
        expect(plan.entities.symbols).toEqual(["AALR"]);
        expect(plan.tools).toContain("get_stock_levels");
    });

    test.each([
        "يطلع للمقاومة",
        "الوصول للمقاومة",
        "ممكن يوصل للهدف",
        "بعد كام يوم يوصل",
    ])("recognizes a question fragment: %s", (candidate) => {
        expect(looksLikeQuestionFragment(candidate)).toBe(true);
    });

    test.each([
        "شركة النور للمقاولات",
        "مجموعة النصر للاستثمار",
        "الدلتا للطباعة",
    ])("does not classify a company phrase as a question fragment: %s", (candidate) => {
        expect(looksLikeQuestionFragment(candidate)).toBe(false);
    });

    test("extracts a single symbol from the assistant stock header", () => {
        const history = [{
            role: "assistant",
            content: "**الشركة العامة لاستصلاح الأراضي (AALR)** — السعر الحالي 306.85 جنيه",
        }];
        expect(extractSingleStockFromRecentHistory(history)).toBe("AALR");
    });
});
