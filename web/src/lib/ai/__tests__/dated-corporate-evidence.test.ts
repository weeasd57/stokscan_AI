import { evidenceViolations, safeEvidenceResponse } from "../response-evidence";
import { summarizeToolNewsEvidence } from "../news-evidence";
import { runAnswerGate } from "../answer-gate";

describe("dated news independent of planner selection", () => {
    beforeAll(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-10-03T10:00:00Z")); });
    afterAll(() => jest.useRealTimers());
    const actions: any = { tool: "get_corporate_actions", data_time: "2026-10-03T09:00:00Z", symbols: ["KORA"], data: { corporate_actions: [
        { symbol: "KORA", title: "قرة تعلن زيادة رأس المال", published_at: "2026-09-29T12:00:00Z", action_date: "2026-10-05", action_type: "capital_increase" },
    ] } };
    test("corporate-only plan cannot bypass the user's today news contract", () => {
        const result = runAnswerGate({ reply: "قرة تعلن زيادة رأس المال", userMessage: "أخبار KORA اليوم", toolResults: [actions], facts: [],
            plan: { intent: "stock_news", tools: ["get_corporate_actions"], entities: { symbols: ["KORA"] } } } as any);
        expect(result.ok).toBe(false);
        expect(result.checked.coverage).toBe(true);
        expect(evidenceViolations("لا توجد بيانات أخرى", "أخبار KORA اليوم", [])).not.toEqual([]);
    });
    test("safe fallback separates publication and action dates and labels older news", () => {
        const reply = safeEvidenceResponse("أخبار KORA اليوم", [actions]);
        expect(reply).toContain("لم أجد خبراً موثقاً اليوم");
        expect(reply).toContain("تاريخ نشر الخبر 2026-09-29");
        expect(reply).toContain("تاريخ تنفيذ الإجراء 2026-10-05");
        expect(reply).toContain("أحدث أخبار أقدم من اليوم");
        expect(evidenceViolations(reply, "أخبار KORA اليوم", [actions])).toEqual([]);
    });
    test("retrieval timestamp never becomes an action date, including unknown dates", () => {
        const noDates = { ...actions, data: { corporate_actions: [{ symbol: "KORA", title: "إعلان زيادة رأس المال" }] } };
        const reply = safeEvidenceResponse("حدث KORA", [noDates]);
        expect(reply).toContain("تاريخ نشر الخبر غير موثق");
        expect(reply).toContain("تاريخ تنفيذ الإجراء غير موثق");
        expect(reply).not.toContain("2026-10-03");
        expect(evidenceViolations("KORA: إعلان زيادة رأس المال بتاريخ 2026-10-03", "حدث KORA", [actions])).not.toEqual([]);
    });
    test("an execution today is not a publication today, Cairo publication is", () => {
        expect(summarizeToolNewsEvidence([{ ...actions, data: { corporate_actions: [{ title: "اكتتاب", action_date: "2026-10-03" }] } }]).today_count).toBe(0);
        expect(summarizeToolNewsEvidence([{ ...actions, data: { corporate_actions: [{ title: "اكتتاب", published_at: "2026-10-02T22:30:00Z", action_date: "2026-10-05" }] } }]).today_count).toBe(1);
    });
    test("rejects claimed price/volume causation while retaining general mechanisms", () => {
        expect(evidenceViolations("ارتفاع حجم التداول بسبب زيادة رأس المال", "حدث KORA", [actions])).not.toEqual([]);
        expect(evidenceViolations("بشكل عام قد يؤدي الاكتتاب إلى تغير السعر النظري", "حدث KORA", [actions])).toEqual([]);
        expect(evidenceViolations("وجود الخبر لا يثبت أنه سبب ارتفاع حجم التداول", "حدث KORA", [actions])).toEqual([]);
    });
});

describe("Bollinger scan publication evidence", () => {
    const message = "هات كل الاسهم اللي لمست قاع البولينجر";
    const scan: any = { tool: "get_technical_scan", data_time: "2026-10-01", data: { preset: "bollinger_lower_touch", stocks: [
        { symbol: "KORA", date: "2026-10-01", bollinger_evidence: { available: true, matches: true, band: 5, low: 4.9, high: 5.1 } },
    ] } };
    test("wrong preset or invalid evidence yields unavailable disclosure", () => {
        for (const result of [{ ...scan, data: { ...scan.data, preset: "rsi_oversold" } },
            { ...scan, data: { ...scan.data, stocks: [{ symbol: "KORA", bollinger_evidence: { available: true, matches: false } }] } }]) {
            expect(evidenceViolations("KORA من الأسهم التي لمست البولينجر", message, [result])).not.toEqual([]);
            const safe = safeEvidenceResponse(message, [result]);
            expect(safe).toContain("تعذر التحقق");
            expect(evidenceViolations(safe, message, [result])).toEqual([]);
        }
    });
    test("verified scan fallback preserves all matching rows", () => {
        const result = { ...scan, data: { ...scan.data, stocks: Array.from({ length: 16 }, (_, n) => ({ ...scan.data.stocks[0], symbol: `STOCK${n}` })) } };
        const safe = safeEvidenceResponse(message, [result]);
        expect(safe).toContain("STOCK15");
        expect(evidenceViolations(safe, message, [result])).toEqual([]);
    });
    test("partial scan needs disclosure and cannot claim completeness elsewhere", () => {
        const partial = { ...scan, data: { ...scan.data, scan_collection: { complete: false, missing_evidence_count: 2 } } };
        expect(evidenceViolations("KORA لمس الحد السفلي", message, [partial])).not.toEqual([]);
        expect(evidenceViolations("هذه قائمة كاملة للأسهم المطابقة. تغطية الفحص جزئية", message, [partial])).not.toEqual([]);
        const safe = safeEvidenceResponse(message, [partial]);
        expect(safe).toContain("تغطية الفحص جزئية");
        expect(evidenceViolations(safe, message, [partial])).toEqual([]);
    });
});

test("entry/target conditions do not become observed quotes, real quote dates remain mandatory", () => {
    const stock: any = { tool: "get_stock", symbols: ["ORWE"], data_time: "2026-10-01", data: { symbol: "ORWE", price: 27 } };
    expect(evidenceViolations("ORWE سعر الدخول 26 جنيه، ولو السعر كسر المقاومة 28 جنيه نراجع الموقف", "تحليل", [stock])).toEqual([]);
    expect(evidenceViolations("ORWE إذا أغلق أعلى 28 جنيه تتأكد الإشارة", "تحليل", [stock])).toEqual([]);
    expect(evidenceViolations("ORWE آخر إغلاق مسجل 27 جنيه", "تحليل", [stock])).not.toEqual([]);
    expect(evidenceViolations("ORWE آخر إغلاق مسجل 27 جنيه بتاريخ 2026-10-01", "تحليل", [stock])).toEqual([]);
    expect(evidenceViolations("ORWE آخر إغلاق مسجل 27 جنيه، بتاريخ 2026-10-01، ولو كسر الدعم نراجع الموقف", "تحليل", [stock])).toEqual([]);
});
