import { newsEventDate, sanitizeNewsRows, summarizeNewsEvidence } from "../news-evidence";
import { isRelevantNews } from "../news-relevance";

describe("news evidence boundary", () => {
    const names = new Map([["ORWE", "Oriental Weavers"]]);
    it("retains Arabic company news when database names are English", () => {
        expect(isRelevantNews("النساجون الشرقيون تعلن نتائج الأعمال", "ORWE", "Oriental Weavers")).toBe(true);
    });
    it("does not count sentiment rows with irrelevant or missing headlines as news", () => {
        const rows = sanitizeNewsRows([
            { symbol: "ORWE", date: "2026-09-23", sentiment_score: .8, news_count: 2, headlines: ["البورصة تغلق مرتفعة"] },
            { symbol: "ORWE", date: "2026-09-29", sentiment_score: .9, news_count: 2, headlines: [] },
        ], names);
        expect(rows).toEqual([]);
        expect(summarizeNewsEvidence(rows, "2026-09-29").today_status).toBe("no_verified_news");
    });
    it("invalidates aggregate sentiment after filtering while retaining supported titles", () => {
        const input = { symbol: "ORWE", date: "2026-09-29", sentiment_score: .8, news_count: 2, headlines: ["النساجون الشرقيون تعلن نتائج الأعمال", "خبر شركة أخرى"] };
        const [row] = sanitizeNewsRows([input], names);
        expect(row.news_count).toBe(1);
        expect(row.sentiment_score).toBeNull();
        expect(input.headlines).toHaveLength(2);
    });
    it("uses the Cairo publication day, never retrieval time or counts", () => {
        expect(newsEventDate({ published_at: "2026-09-28T22:30:00Z" })).toBe("2026-09-29");
        const result = summarizeNewsEvidence([
            { date: "2026-09-23", fetched_at: "2026-09-29T09:00:00Z", headlines: ["ORWE reports earnings"] },
            { fetched_at: "2026-09-29T09:00:00Z", news_count: 3 },
        ], "2026-09-29");
        expect(result.headline_count).toBe(1);
        expect(result.today_count).toBe(0);
        expect(result.latest_event_date).toBe("2026-09-23");
        expect(newsEventDate({ date: "2026-02-31" })).toBeNull();
        expect(newsEventDate({ fetched_at: "2026-09-29T09:00:00Z" })).toBeNull();
    });
});
