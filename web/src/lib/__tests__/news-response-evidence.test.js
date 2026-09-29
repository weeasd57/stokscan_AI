const { buildDeterministicNewsResponse, buildDeterministicResponse } = require("../ai/final-v2");
const { checkCoverage } = require("../ai/coverage");

const plan = { intent: "stock_news", tools: ["get_news"], entities: { symbols: ["ORWE"], requested_date: "2026-09-29" } };
const tool = data => ({ tool: "get_news", source: "database", symbols: ["ORWE"], data_type: "cached", data_time: "2026-09-29", data });

describe("news responses share article evidence with coverage", () => {
    test("a request verb before news is one request and retains its date range", () => {
        const result = buildDeterministicNewsResponse("هات اخبار ORWE الاسبوع اللى فات", {
            ...plan, entities: { symbols: ["ORWE"], requested_start_date: "2026-09-20", requested_end_date: "2026-09-24" },
        }, [tool([])]);
        expect(result).toContain("2026-09-20");
        expect(result).toContain("2026-09-24");
    });
    test("compound fallback counts titles rather than sentiment rows", () => {
        const result = buildDeterministicResponse("اعرض اخبار ORWE\nهات سعر ORWE", plan, [tool([
            { symbol: "ORWE", date: "2026-09-29", news_count: 4, sentiment_score: .8, headlines: [] },
            { symbol: "ORWE", date: "2026-09-29", headlines: ["عنوان أول", "عنوان ثان"] },
        ])]);
        expect(result).toContain("2 عنوان");
        expect(result).not.toContain("سجل");
        expect(result).toContain("عنوان أول");
    });
    test("older headlines are never presented as today's headlines", () => {
        const result = tool([{ symbol: "ORWE", date: "2026-09-23", headlines: ["النساجون الشرقيون تعلن نتائج الأعمال"] }]);
        const response = buildDeterministicNewsResponse("أخبار ORWE اليوم", plan, [result]);
        expect(response).toContain("لم أجد خبراً موثّقاً");
        expect(response).not.toContain("تعلن نتائج الأعمال");
        expect(checkCoverage(["news"], [result], { newsMustBeToday: true, today: "2026-09-29" }).facts[0].status).toBe("stale");
    });
    test("sentiment-only rows cannot cover a news request even with a current row date", () => {
        const result = tool([{ symbol: "ORWE", date: "2026-09-29", sentiment_score: .8, news_count: 3, headlines: [] }]);
        expect(checkCoverage(["news"], [result]).complete).toBe(false);
        expect(buildDeterministicNewsResponse("أخبار ORWE اليوم", plan, [result])).toContain("لم أجد خبراً موثّقاً");
    });
    test("Cairo publication date covers today and renders real titles", () => {
        const result = tool([{ symbol: "ORWE", published_at: "2026-09-28T22:30:00Z", title: "النساجون الشرقيون تعلن نتائج الأعمال" }]);
        expect(checkCoverage(["news"], [result], { newsMustBeToday: true, today: "2026-09-29" }).complete).toBe(true);
        const response = buildDeterministicNewsResponse("أخبار ORWE اليوم", plan, [result]);
        expect(response).toContain("تعلن نتائج الأعمال");
        expect(response).toContain("2026-09-29");
    });
    test("retains corporate actions and defers compound requests", () => {
        const news = tool([{ date: "2026-09-23", headlines: ["عنوان قديم"] }]);
        const ca = { tool: "get_corporate_actions", data: { corporate_actions: [{ symbol: "ORWE", action_type_ar: "توزيعات", title: "موعد توزيع الكوبون" }] } };
        expect(buildDeterministicNewsResponse("أخبار ORWE اليوم", plan, [news, ca])).toContain("موعد توزيع الكوبون");
        expect(buildDeterministicNewsResponse("سعر ORWE كام واخبار ORWE ايه", plan, [news])).toBeNull();
    });
});
