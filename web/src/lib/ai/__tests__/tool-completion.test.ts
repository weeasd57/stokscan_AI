import { completeToolsByFacets } from "../tool-completion";
import { isDifferenceOfSameResultValues, extractSentenceClaims } from "../validator";

const Q1 = "هات تحليل فني متكامل لسهم التجاري الدولي (COMI) والسويدي (SWDY) وطلعت مصطفى، مع عرض آخر الأخبار وحالة السوق";

describe("facet-based tool completion", () => {
    test("compound request keeps stock, levels, news and market evidence (not market only)", () => {
        const r = completeToolsByFacets({ message: Q1, symbols: ["COMI", "SWDY", "TMGH"], tools: ["get_market"] });
        expect(r.tools).toEqual(expect.arrayContaining(["get_market", "get_stock", "get_stock_levels", "get_news"]));
        expect(r.stockFacetAdded).toBe(true);
    });
    test("pure market question stays market-only", () => {
        const r = completeToolsByFacets({ message: "حالة السوق النهاردة", symbols: [], tools: ["get_market"] });
        expect(r.added).toEqual([]);
    });
    test("does not widen portfolio or comparison plans", () => {
        expect(completeToolsByFacets({ message: "حلل محفظتي وحالة السوق", symbols: [], tools: ["manage_portfolio"] }).added).toEqual([]);
        expect(completeToolsByFacets({ message: "قارن COMI و SWDY تحليل", symbols: ["COMI", "SWDY"], tools: ["get_comparison"] }).added).toEqual([]);
    });
    test("news word alone adds only news", () => {
        const r = completeToolsByFacets({ message: "اخبار COMI", symbols: ["COMI"], tools: ["get_stock"] });
        expect(r.added).toEqual(["get_news"]);
    });
    test("sector facet is added when a sector is named", () => {
        const r = completeToolsByFacets({ message: "تجميع في قطاع الاغذية وجهينة", symbols: ["JUFO"], tools: ["get_stock"], sector: "food" });
        expect(r.added).toContain("get_sector");
    });
});

describe("validator false positives", () => {
    test("gap between price and band from the same result is verifiable", () => {
        const results: any[] = [{ tool: "get_stock", data: { price: 17.1, bb_upper: "17.52", bb_lower: "14.81" } }];
        expect(isDifferenceOfSameResultValues(0.42, results)).toBe(true);
        expect(isDifferenceOfSameResultValues(2.29, results)).toBe(true);
        expect(isDifferenceOfSameResultValues(5.55, results)).toBe(false);
    });
    test("'RSI 14' names the period and is not an RSI claim", () => {
        const claims = extractSentenceClaims("مؤشر RSI 14 عند 25.97 في منطقة تشبع بيعي", "JUFO", { rsi: 25.97 });
        expect(claims.some(c => c.type === "rsi" && c.value === 14)).toBe(false);
    });
});
