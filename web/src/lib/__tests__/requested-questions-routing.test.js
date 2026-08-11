import { buildCompoundDeterministicPlan } from "../ai/pipeline";

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
});
