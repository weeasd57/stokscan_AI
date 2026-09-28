import { detectPortfolioIntent, isPortfolioAnalysisRequest, isNileExchangeQuestion } from "../intent-policy";
import { runAnswerGate } from "../answer-gate";
import { IntentPlan, ToolResult } from "../types";
import { formatPortfolioSnapshotResponse, formatPortfolioRankingResponse, shouldClarifySingularGroupReference } from "../pipeline";

const plan = { intent: "stock_analysis", entities: { portfolio_operation: "view" }, tools: ["manage_portfolio", "get_stock"], ranking_metric: "unspecified" } as IntentPlan;
const portfolio = (positions: unknown[]): ToolResult => ({
    tool: "manage_portfolio", source: "positions", data_time: "2026-09-28", symbols: ["ABUK"],
    data_type: "cached", data: { ok: true, positions },
});
const gate = (reply: string, results: ToolResult[]) => runAnswerGate({
    reply, plan, toolResults: results, userMessage: "حلل محفظتي", facts: [],
});

describe("answer grounding to conversation and verified ownership", () => {
    test("colloquial owned-stock questions enter portfolio analysis", () => {
        for (const message of ["إيه وضع الأسهم اللي عندي؟", "أسهمي عاملة إيه؟", "أداء مراكزي إيه؟"]) {
            expect(detectPortfolioIntent(message)).toBe("view");
            expect(isPortfolioAnalysisRequest(message)).toBe(true);
        }
    });

    test("a missing portfolio result cannot prove an empty portfolio", () => {
        expect(gate("لا توجد بيانات محفظة مسجلة لك.", []).ok).toBe(false);
    });

    test("an empty claim contradicting held positions is rejected", () => {
        expect(gate("محفظتك فاضية، ما عندكش أسهم.", [portfolio([{ symbol: "ABUK", quantity: 100 }])]).ok).toBe(false);
        expect(gate("عندك 100 سهم ABUK في محفظتك.", [portfolio([{ symbol: "ABUK", quantity: 100 }])]).ok).toBe(true);
    });

    test("a whole-portfolio analysis cannot silently skip a held stock", () => {
        const result = gate("سهم ABUK وضعه مستقر.", [portfolio([{ symbol: "ABUK" }, { symbol: "ACAMD" }])]);
        expect(result.ok).toBe(false);
        expect(result.reasons.join(" ")).toContain("ACAMD");
    });

    test("a verified empty portfolio permits an empty statement", () => {
        expect(gate("محفظتك فاضية حالياً.", [portfolio([])]).ok).toBe(true);
    });

    test("failed portfolio reads never become an empty portfolio in either direct view formatter", () => {
        const failed = { ok: false, message: "حصل خطأ مؤقت في إدارة المحفظة." };
        expect(formatPortfolioSnapshotResponse(failed)).toContain("تعذر قراءة");
        expect(formatPortfolioSnapshotResponse(failed)).not.toContain("فاضية حالياً");
        expect(formatPortfolioRankingResponse(failed, "مين أضعفهم؟")).toContain("تعذر قراءة");
    });

    test("portfolio ranking does not turn a missing return into zero percent", () => {
        const reply = formatPortfolioRankingResponse({ ok: true, positions: [{ symbol: "ABUK", profit_pct: null }] }, "مين أضعفهم؟");
        expect(reply).toContain("لا أقدر أحدد");
        expect(reply).not.toContain("0.0%");
    });

    test("weakest holding is not called a loss when it is still profitable", () => {
        const reply = formatPortfolioRankingResponse({ ok: true, positions: [
            { symbol: "ABUK", profit_pct: 5, quantity: 10, entry_price: 50, last_price: 52.5 },
            { symbol: "ACAMD", profit_pct: null },
        ] }, "مين أضعفهم؟");
        expect(reply).toContain("أضعف أداء");
        expect(reply).not.toContain("أكبر خسارة");
        expect(reply).toContain("لم أدخل 1 مركز");
    });

    test("a small percentage belonging to another stock fails attribution", () => {
        const result = runAnswerGate({
            reply: "ABUK ارتفع 20%.", plan: { ...plan, entities: { symbols: ["ABUK"] }, tools: ["get_stock"] } as IntentPlan,
            toolResults: [], userMessage: "حلل ABUK",
            facts: [
                { symbol: "ABUK", field: "change_pct", value: 2, unit: "percent" },
                { symbol: "ACAMD", field: "change_pct", value: 20, unit: "percent" },
            ] as any,
        });
        expect(result.ok).toBe(false);
        expect(result.reasons.join(" ")).toContain("20%");
    });

    test("price claims bind to price facts rather than entry price", () => {
        const result = runAnswerGate({
            reply: "ABUK الآن عند 50 جنيه.", plan: { ...plan, entities: { symbols: ["ABUK"] }, tools: ["get_stock"] } as IntentPlan,
            toolResults: [], userMessage: "سعر ABUK كام؟",
            facts: [
                { symbol: "ABUK", field: "entry_price", value: 50, unit: "egp" },
                { symbol: "ABUK", field: "close", value: 60, unit: "egp" },
            ] as any,
        });
        expect(result.ok).toBe(false);
    });

    test("singular pronouns after several stocks require a clear antecedent", () => {
        expect(shouldClarifySingularGroupReference("أبيع السهم ده؟", ["ABUK", "ACAMD"], "ABUK وACAMD في محفظتك")).toBe(true);
        expect(shouldClarifySingularGroupReference("أبيع السهم ده؟", ["ABUK", "ACAMD"], "ABUK وحده في الرد الأخير")).toBe(false);
        expect(shouldClarifySingularGroupReference("أبيع السهم ده؟", ["ABUK", "ACAMD"], "ACAMD وحده في الرد الأخير", "ABUK")).toBe(true);
        expect(shouldClarifySingularGroupReference("أبيع ACAMD؟", ["ABUK", "ACAMD"], "ABUK وACAMD")).toBe(false);
    });

    test("Nile exchange referents stay distinct from Nile Pharma", () => {
        expect(isNileExchangeQuestion("بورصة النيل")).toBe(true);
        expect(isNileExchangeQuestion("النيل مثلاً", [{ role: "assistant", content: "الشركات الصغيرة والمتوسطة في السوق" }])).toBe(true);
        expect(isNileExchangeQuestion("واللي فيه أحسنهم إيه؟", [{ role: "user", content: "بورصة النيل" }])).toBe(true);
        expect(isNileExchangeQuestion("حلل النيل للأدوية NIPH")).toBe(false);
    });
});
