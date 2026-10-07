import { newsAcquisitionDirectionViolations } from "../news-evidence";

const buyerHeadline = "بلتون تستحوذ على شركة إماراتية تابعة للمساهم الرئيسي بدولار واحد";
const invertedClaim = "أحدث خبر عن بلتون هو عرض شراء إجباري من شركة إماراتية للاستحواذ على بلتون بتاريخ 2026-10-02.";
const datedNews = (headline: string, symbol = "BTFH", date = "2026-10-02") => [{
    tool: "get_news",
    symbols: [symbol],
    data: [{ symbol, date, headlines: [headline] }],
} as any];

describe("news acquisition direction evidence", () => {
    it("flags a dated buyer/target inversion for the same company", () => {
        expect(newsAcquisitionDirectionViolations(invertedClaim, datedNews(buyerHeadline))).toEqual([
            expect.stringContaining("BTFH: اتجاه الاستحواذ"),
        ]);
    });

    it("keeps checking the acquisition claim when a separate disclaimer contains negation", () => {
        expect(newsAcquisitionDirectionViolations(`${invertedClaim}\nلا يمكن ضمان أثر الخبر على السعر.`, datedNews(buyerHeadline))).toEqual([
            expect.stringContaining("BTFH: اتجاه الاستحواذ"),
        ]);
    });

    it("does not let a correctly quoted source headline mask the reversed claim", () => {
        expect(newsAcquisitionDirectionViolations(`${invertedClaim}\nالمصدر: ${buyerHeadline}`, datedNews(buyerHeadline))).toEqual([
            expect.stringContaining("BTFH: اتجاه الاستحواذ"),
        ]);
    });

    it("allows a response that preserves the source headline's direction", () => {
        const reply = "بلتون تستحوذ على شركة إماراتية تابعة للمساهم الرئيسي بدولار واحد بتاريخ 2026-10-02.";
        expect(newsAcquisitionDirectionViolations(reply, datedNews(buyerHeadline))).toEqual([]);
    });

    it("does not infer that Beltone is the buyer from considering or rejecting an offer", () => {
        const considering = "بلتون تدرس عرض استحواذ على شركة إماراتية بتاريخ 2026-10-02.";
        const rejecting = "بلتون ترفض عرض استحواذ على الشركة الإماراتية بتاريخ 2026-10-02.";
        expect(newsAcquisitionDirectionViolations(considering, datedNews(buyerHeadline))).toEqual([]);
        expect(newsAcquisitionDirectionViolations(rejecting, datedNews(buyerHeadline))).toEqual([]);
    });

    it("requires an Arabic company-name boundary instead of matching a longer word", () => {
        const substring = "البلتونية تستحوذ على شركة إماراتية بتاريخ 2026-10-02.";
        expect(newsAcquisitionDirectionViolations(substring, datedNews("شركة إماراتية تستحوذ على بلتون"))).toEqual([]);
    });

    it("does not compare the claim against an article with a different date", () => {
        expect(newsAcquisitionDirectionViolations(invertedClaim, datedNews(buyerHeadline, "BTFH", "2026-10-01"))).toEqual([]);
    });

    it("does not infer an acquisition direction from an unrelated company's article", () => {
        const otherCompany = "شركة أبو قير للأسمدة ترفع كفاءة التشغيل خلال العام المالي";
        expect(newsAcquisitionDirectionViolations(invertedClaim, datedNews(otherCompany, "ABUK"))).toEqual([]);
    });

    it("fails open when there is no dated article evidence", () => {
        expect(newsAcquisitionDirectionViolations(invertedClaim, datedNews(buyerHeadline, "BTFH", ""))).toEqual([]);
        expect(newsAcquisitionDirectionViolations(invertedClaim, [])).toEqual([]);
        const executionDateOnly = [{ tool: "get_corporate_actions", data: { corporate_actions: [
            { symbol: "BTFH", title: buyerHeadline, action_date: "2026-10-02" },
        ] } } as any];
        expect(newsAcquisitionDirectionViolations(invertedClaim, executionDateOnly)).toEqual([]);
    });

    it("does not flag an explicitly negated claim or infer passive direction", () => {
        const negated = "لم تستحوذ شركة إماراتية على بلتون؛ بلتون تستحوذ على شركة إماراتية.";
        expect(newsAcquisitionDirectionViolations(negated, datedNews(buyerHeadline))).toEqual([]);
        const passiveSource = "تم الاستحواذ على بلتون من شركة إماراتية بتاريخ 2026-10-02";
        expect(newsAcquisitionDirectionViolations(invertedClaim, datedNews(passiveSource))).toEqual([]);
    });

    it("abstains for conflicting sources rather than rejecting separate events", () => {
        const conflicting = datedNews(buyerHeadline)[0].data.concat([
            { symbol: "BTFH", date: "2026-10-02", headlines: ["شركة إماراتية تستحوذ على بلتون"] },
        ]);
        expect(newsAcquisitionDirectionViolations(invertedClaim, [{ ...datedNews(buyerHeadline)[0], data: conflicting } as any])).toEqual([]);
    });
});
