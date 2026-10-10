import {
    compactHistory,
    fallbackEvidence,
    groundedReviewerIssues,
    removeBogusPortfolioReviewIssues,
    removeDisprovenMissingToolIssues,
    removeSelfRetractedReviewerIssues,
    unsupersededEvidence,
} from "../agentic-runtime";
import { evidenceMemory, toAgenticEvidence } from "../agentic-publication";

const stockEvidence = (symbol: string, close: number, args: Record<string, unknown> = { symbol }) =>
    toAgenticEvidence("get_stock", args, {
        status: "success",
        stocks: [{ symbol, close, date: "2026-10-10" }],
    });

describe("agentic-runtime pure guardrails (offline; no provider or chatbot calls)", () => {
    describe("conversation history", () => {
        test("keeps only the most recent eight user/assistant turns in chronological order", () => {
            const history = Array.from({ length: 10 }, (_, index) => ({
                role: index % 2 ? "assistant" : "user",
                content: `turn-${index}`,
            }));
            const compacted = compactHistory([
                { role: "system", content: "must not be sent as dialogue" },
                ...history,
            ]);

            expect(compacted).toHaveLength(8);
            expect(compacted[0].content).toBe("turn-2");
            expect(compacted.at(-1)?.content).toBe("turn-9");
            expect(compacted.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(5000);
            expect(compacted.every(item => item.role === "user" || item.role === "assistant")).toBe(true);
        });

        test("bounds oversized turns while preserving a marker that earlier content was summarized", () => {
            const compacted = compactHistory([
                { role: "user", content: "أ".repeat(1400) },
                { role: "assistant", content: "ب".repeat(2000) },
            ]);

            expect(compacted[0].content.length).toBeLessThanOrEqual(1000);
            expect(compacted[0].content).toContain("[مختصر؛ الحقائق في سجل الأدلة]");
            expect(compacted[1].content.length).toBeLessThanOrEqual(1600);
            expect(compacted[1].content).toContain("[مختصر؛ الحقائق في سجل الأدلة]");
        });
    });

    describe("evidence freshness and scoping", () => {
        test("a successful refresh supersedes only the same tool call and arguments", () => {
            const previous = [
                stockEvidence("COMI", 124, { symbol: "COMI" }),
                stockEvidence("TMGH", 88, { symbol: "TMGH" }),
            ];
            const current = [stockEvidence("COMI", 126, { symbol: "COMI" })];

            expect(unsupersededEvidence(previous, current).map(item => item.symbols[0])).toEqual(["TMGH"]);
        });

        test("a failed refresh cannot erase a previously verified result", () => {
            const previous = [stockEvidence("COMI", 124, { symbol: "COMI" })];
            const failedRefresh = toAgenticEvidence("get_stock", { symbol: "COMI" }, { status: "error" });

            expect(unsupersededEvidence(previous, [failedRefresh])).toEqual(previous);
        });

        test("a different query shape does not supersede evidence with other arguments", () => {
            const previous = [stockEvidence("COMI", 124, { symbol: "COMI", timeframe: "daily" })];
            const current = [stockEvidence("COMI", 126, { symbol: "COMI", timeframe: "weekly" })];

            expect(unsupersededEvidence(previous, current)).toEqual(previous);
        });

        test("session memory excludes stale, errored, unsupported-source, and non-memory evidence", () => {
            const now = new Date("2026-10-10T12:00:00.000Z");
            const recent = { ...stockEvidence("COMI", 124), captured_at: "2026-10-10T11:00:00.000Z" };
            const stale = { ...stockEvidence("SWDY", 80), captured_at: "2026-10-09T11:00:00.000Z" };
            const errored = { ...stockEvidence("TMGH", 88), availability: "error" as const, captured_at: now.toISOString() };
            const untrustedSource = { ...stockEvidence("EAST", 25), source: "external:fixture", captured_at: now.toISOString() };
            const writeTool = { ...stockEvidence("AFMC", 152), tool: "manage_portfolio", captured_at: now.toISOString() };

            expect(evidenceMemory([recent, stale, errored, untrustedSource, writeTool], now).map(item => item.symbols[0]))
                .toEqual(["COMI"]);
        });

        test("session memory stays within both the six-record and eight-kilobyte limits", () => {
            const now = new Date("2026-10-10T12:00:00.000Z");
            const records = Array.from({ length: 9 }, (_, index) => ({
                ...stockEvidence(`S${index + 1}`, 100 + index),
                captured_at: now.toISOString(),
                data: { status: "success", stocks: [{ symbol: `S${index + 1}`, close: 100 + index, note: "x".repeat(3000) }] },
            }));
            const memory = evidenceMemory(records, now);

            expect(memory.length).toBeLessThanOrEqual(6);
            expect(memory.reduce((total, record) => total + JSON.stringify(record).length, 0)).toBeLessThanOrEqual(8000);
        });
    });

    describe("reviewer output validation", () => {
        test("accepts a quoted draft claim and a well-formed omission", () => {
            expect(groundedReviewerIssues({
                passed: false,
                issues: [
                    { kind: "claim", message: "نسبة غير صحيحة", draft_quote: "COMI يمثل 60% من القطاع" },
                    { kind: "omission", message: "لم يذكر التاريخ", draft_quote: null },
                ],
            }, "COMI يمثل 60% من القطاع.")).toEqual(["نسبة غير صحيحة", "لم يذكر التاريخ"]);
        });

        test.each([
            ["invented quote", { passed: false, issues: [{ kind: "claim", message: "خطأ", draft_quote: "غير موجود" }] }],
            ["quote missing for a claim", { passed: false, issues: [{ kind: "claim", message: "خطأ", draft_quote: null }] }],
            ["quote attached to an omission", { passed: false, issues: [{ kind: "omission", message: "ناقص", draft_quote: "نص" }] }],
            ["invalid verdict shape", { passed: "yes", issues: [] }],
        ])("rejects reviewer payloads with %s", (_label, verdict) => {
            expect(() => groundedReviewerIssues(verdict, "الإجابة الحالية.")).toThrow();
        });

        test("dismisses a false missing-tool objection only when non-error evidence proves the tool ran", () => {
            const issue = "لم يتم استدعاء get_stock";
            const successfulEvidence = [stockEvidence("COMI", 124)];
            const failedEvidence = [toAgenticEvidence("get_stock", { symbol: "COMI" }, { status: "error" })];

            expect(removeDisprovenMissingToolIssues([issue], successfulEvidence)).toEqual([]);
            expect(removeDisprovenMissingToolIssues([issue], failedEvidence)).toEqual([issue]);
            expect(removeDisprovenMissingToolIssues([issue], [])).toEqual([issue]);
        });

        test("removes self-retracted objections without dropping a real reviewer concern", () => {
            const selfRetracted = "20 أقل من 18؟ لا، 20 أعلى قليلاً؛ الوصف مقبول تقريباً";
            const realConcern = "المسودة لم تذكر تاريخ البيانات";

            expect(removeSelfRetractedReviewerIssues([selfRetracted, realConcern])).toEqual([realConcern]);
        });

        test("dismisses false portfolio review objections when manage_portfolio(view) verifies empty positions", () => {
            const emptyEvidence = [
                toAgenticEvidence("manage_portfolio", { operation: "view" }, {
                    status: "success",
                    operation: "view",
                    persisted: false,
                    read_complete: true,
                    empty: true,
                    saved_positions_found: false,
                    positions: [],
                }),
            ];
            const bogusIssues = [
                "حفظ المحفظة يحتاج persisted=true من الدور الحالي",
                "لم يتم إثبات أن المحفظة فارغة لأن persisted=false",
                "المسودة تذكر أن المحفظة فارغة دون حفظ المراكز",
            ];
            const realIssue = "المسودة لم تذكر الإغلاق الأخير لسهم COMI";

            expect(removeBogusPortfolioReviewIssues([...bogusIssues, realIssue], emptyEvidence)).toEqual([realIssue]);
        });

        test("retains legitimate persisted=true objections when a portfolio write operation was attempted", () => {
            const writeAttemptEvidence = [
                toAgenticEvidence("manage_portfolio", { operation: "add", symbol: "COMI", quantity: 100, price: 120 }, {
                    status: "success",
                    operation: "add",
                    persisted: false,
                }),
            ];
            const writeIssue = "حفظ المحفظة يحتاج persisted=true من الدور الحالي";

            expect(removeBogusPortfolioReviewIssues([writeIssue], writeAttemptEvidence)).toEqual([writeIssue]);
        });

        test("scopes fallbackEvidence to active symbols to prevent leaking unrelated past tables", () => {
            const pastComparison = toAgenticEvidence("get_comparison", { symbols: ["EFIC", "HRHO", "SWDY"] }, {
                status: "success",
                stocks: [
                    { symbol: "EFIC", close: 80 },
                    { symbol: "HRHO", close: 27 },
                    { symbol: "SWDY", close: 95 },
                ],
            });
            const activeImageEvidence = toAgenticEvidence("get_stock", { symbol: "TALM" }, {
                status: "success",
                stocks: [{ symbol: "TALM", close: 21 }],
            });

            const allEvidence = [pastComparison, activeImageEvidence];
            // When active symbols are TALM and TMGH (from current vision/turn), past comparison must not leak
            const scoped = fallbackEvidence(allEvidence, ["TALM", "TMGH"]);
            expect(scoped.some(e => e.tool === "get_comparison")).toBe(false);

            // When no active symbols are given, default candidate filtering applies
            const unscoped = fallbackEvidence(allEvidence);
            expect(unscoped.some(e => e.tool === "get_comparison")).toBe(true);
        });
    });
});
