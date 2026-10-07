import { runAnswerGate } from "../answer-gate";
import { buildFactRecords } from "../facts";

const headline = "بلتون تستحوذ على شركة إماراتية تابعة للمساهم الرئيسي بدولار واحد";
const results: any[] = [{ tool: "get_news", source: "database", data_time: "2026-10-07", symbols: ["BTFH"],
    data: [{ symbol: "BTFH", date: "2026-10-02", headlines: [headline] }] }];
const plan: any = { intent: "news", entities: { symbols: ["BTFH"], sector: null }, tools: ["get_news"] };
const review = (reply: string) => runAnswerGate({ reply, plan, toolResults: results,
    userMessage: "أخبار بلتون", facts: buildFactRecords(results) });

test("publication rejects an inverted acquisition even with a disclaimer and the correct source", () => {
    const result = review("بلتون: عرض شراء إجباري من شركة إماراتية للاستحواذ على بلتون بتاريخ 2026-10-02.\nلا يمكن ضمان تأثير الخبر.\nالمصدر: " + headline);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("اتجاه الاستحواذ");
});

test("publication accepts the dated source direction with a separate risk disclaimer", () => {
    const result = review(headline + " بتاريخ 2026-10-02.\nلا يمكن ضمان تأثير الخبر على السعر.");
    expect(result.reasons).not.toEqual(expect.arrayContaining([expect.stringContaining("اتجاه الاستحواذ")]));
    expect(result.ok).toBe(true);
});

test("negation before an Arabic contrast clause cannot hide the inverted positive claim", () => {
    const result = review("بلتون لم تستحوذ على الشركة الإماراتية، بل شركة إماراتية تستحوذ على بلتون بتاريخ 2026-10-02.");
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("اتجاه الاستحواذ");
});
