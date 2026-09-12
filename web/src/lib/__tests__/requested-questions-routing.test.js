import { buildCompoundDeterministicPlan } from "../ai/pipeline";
import { isPortfolioAnalysisRequest } from "../ai/intent-policy";

describe("requested investor question routing", () => {
    const session = { current_symbol: "BIOC", last_symbols: ["BIOC"], summary: "تحليل BIOC" };

    test.each([
        ["معايا سيولة ادخل في اي دلوقتي غير قطاع الادوية والمخابز علشان فيهم وطلعو الحمدالله خلاص", ["get_sector_liquidity"]],
        ["هات القطاعات كلها", ["get_sector_list"]],
        ["المتوقع يرتفع الأسبوع ده", ["get_fair_value_scan"]]
    ])("routes %s", (message, expectedTools) => {
        const plan = buildCompoundDeterministicPlan(message, session);
        expect(plan.tools).toEqual(expectedTools);
        expect(plan.entities.symbols).toEqual([]);
    });

    test("resolves a sector-list follow-up to sector liquidity", () => {
        const plan = buildCompoundDeterministicPlan("اى احسن واحد فيهم احط فيه الايام دى", { ...session, summary: "هات القطاعات كلها" });
        expect(plan.tools).toEqual(["get_sector_liquidity"]);
        expect(plan.entities.symbols).toEqual([]);
    });

    test("does not claim a sharia classification without verified data", () => {
        const plan = buildCompoundDeterministicPlan("ممكن أسهم متوافقة مع الشريعة استثمار كامل مش مضاربة", session);
        expect(plan.tools).toEqual([]);
        expect(plan.entities.symbols).toEqual([]);
    });

    test("routes an AMER portfolio add to the mutation tool with the add operation", () => {
        const plan = buildCompoundDeterministicPlan("ضيف فى محفظتى سهم amer 200 بسعر 45.65", session);
        expect(plan.intent).toBe("portfolio_management");
        expect(plan.tools).toEqual(["manage_portfolio"]);
        expect(plan.entities.symbols).toEqual(["AMER"]);
        expect(plan.entities.portfolio_operation).toBe("add");
    });

    test("routes distribution above fair value to the verified fair-value scan", () => {
        const plan = buildCompoundDeterministicPlan("هات الاسهم اللى عليها تصريف وبتتداول فوق السعر العادل", session);
        expect(plan.intent).toBe("market_summary");
        expect(plan.tools).toContain("get_fair_value_scan");
    });

    test("separates portfolio analysis from a plain portfolio view", () => {
        expect(isPortfolioAnalysisRequest("حلل محفظتي")).toBe(true);
        expect(isPortfolioAnalysisRequest("تحليل محفظتي وقولي أكبر مركز")).toBe(true);
        expect(isPortfolioAnalysisRequest("اعرض محفظتي")).toBe(false);
        expect(isPortfolioAnalysisRequest("حلل COMI")).toBe(false);
    });

    test("resolves a resistance follow-up to the current AMER symbol", () => {
        const plan = buildCompoundDeterministicPlan("طب ممكن يطلع للمقاومة امتى", { ...session, current_symbol: "AMER" });
        expect(plan.intent).toBe("stock_analysis");
        expect(plan.entities.symbols).toEqual(["AMER"]);
        expect(plan.tools).toContain("get_stock_levels");
    });
});
