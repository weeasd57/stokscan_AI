/**
 * Parity tests for the shared news-relevance filter (web read path).
 * Mirrors api/tests/test_news_sentiment_engine.py::TestRelevanceMatching.
 */
const { isRelevantNews, isUnrelatedNews, normalizeArabicText } = require("../ai/news-relevance");

describe("news relevance (read path parity with the Python engine)", () => {
    it("matches the Latin ticker as a whole token", () => {
        expect(isRelevantNews("COMI reports record profit", "COMI", "")).toBe(true);
        expect(isRelevantNews("EGX:COMI closes higher", "COMI", "")).toBe(true);
        expect(isRelevantNews("COMING soon: new listing", "COMI", "")).toBe(false);
    });

    it("keeps Arabic-only headlines matched by company name", () => {
        const title = "عامر جروب توافق على إعادة هيكلة إيه إن سي للتنمية السياحية بغرض تداولها في البورصة";
        expect(isRelevantNews(title, "AMER", "Amer Group Holding عامر, عامر جروب")).toBe(true);
    });

    it("matches short distinctive Arabic tokens (KORA)", () => {
        const title = "أخبار سهم قرة لمشروعات الطاقة والاستثمار - معلومات مباشر";
        expect(isRelevantNews(title, "KORA", "KORRA ENERGIE قرة للطاقة")).toBe(true);
    });

    it("handles alef/spacing variants", () => {
        expect(isRelevantNews("«أبوظبي الإسلامي» يحصد جائزة أفضل مصرف إسلامي", "ADIB", "Abu Dhabi Islamic Bank-Egypt ابو ظبي")).toBe(true);
    });

    it("never matches on generic name words alone", () => {
        expect(isRelevantNews("طلعت مصطفى جروب تعلن نتائج أعمالها", "AMER", "Amer Group Holding عامر, عامر جروب")).toBe(false);
        expect(isRelevantNews("المصرية للمنتجعات السياحية تعلن نتائجها", "ETEL", "Telecom Egypt المصرية للاتصالات")).toBe(false);
    });

    it("still matches distinctive parts of the name", () => {
        expect(isRelevantNews("المصرية للاتصالات تعلن توزيعات", "ETEL", "Telecom Egypt المصرية للاتصالات")).toBe(true);
    });

    it("ignores an ambiguous sector word used alone", () => {
        expect(isRelevantNews("مؤسس القلعة المصرية: 420 مليون دولار صفقة الاستحواذ على حصة قطر للطاقة", "TAQA", "Taqa Arabia طاقة عربية")).toBe(false);
        expect(isRelevantNews("طاقة عربية تعلن نتائج أعمالها", "TAQA", "Taqa Arabia طاقة عربية")).toBe(true);
    });

    it("does not match a Latin name inside a domain", () => {
        const title = "مؤسس ورئيس القلعة المصرية لـ CNBC عربية: صفقة الاستحواذ على حصة قطر للطاقة - cnbcarabia.com";
        expect(isRelevantNews(title, "TAQA", "TAQA Arabia")).toBe(false);
        expect(isRelevantNews("TAQA Arabia reports higher profit", "TAQA", "TAQA Arabia")).toBe(true);
    });

    it("rejects unrelated market/other-company headlines", () => {
        expect(isRelevantNews("البورصة المصرية تغلق مرتفعة 1%", "AMER", "Amer Group Holding عامر جروب")).toBe(false);
        expect(isRelevantNews("الأهلي يفوز على الزمالك في مباراة كرة القدم", "AMER", "Amer Group Holding عامر جروب")).toBe(false);
    });

    it("normalizes Arabic variants", () => {
        expect(normalizeArabicText("أودن")).toBe(normalizeArabicText("اودن"));
        expect(normalizeArabicText("  شركة   كذا  ")).toBe("شركه كذا");
        expect(isUnrelatedNews("شركة تعلن أرباحاً قياسية")).toBe(false);
        expect(isUnrelatedNews("الأهلي يفوز على الزمالك")).toBe(true);
    });
});
