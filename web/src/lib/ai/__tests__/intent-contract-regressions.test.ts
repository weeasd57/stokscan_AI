import { buildPlannerDialogueContext } from "../planner";
import {
    getMarketRankingMode,
    parsePortfolioAnswer,
    parsePortfolioSelectionCount,
    resolveGroupReferenceSymbols,
    runPipelineStream,
} from "../pipeline";
import { PlannerResult, SessionState } from "../types";

const session: SessionState = {
    current_symbol: "GTWL",
    last_symbols: ["GTWL", "KWIN", "LUTS", "MCRO", "COSG"],
    summary: "استيراد محفظة من صورة؛ المستخدم اختار أول خمسة أسهم",
    investment_budget: null,
    risk_tolerance: null,
    investment_horizon: null,
};

describe("intent contract regressions", () => {
    it("always gives semantic planning the recent turn needed to resolve 'first five stocks'", () => {
        const context = buildPlannerDialogueContext(session, [
            { role: "assistant", content: "وجدت 7 أسهم في الصورة. اختار الأسهم التي تريد تسجيلها." },
            { role: "user", content: "أول ٥ أسهم" },
        ]);
        expect(context).toContain("Recent Dialogue");
        expect(context).toContain("أول ٥ أسهم");
        expect(context).toContain("GTWL");
    });

    it("recognizes a market liquidity ranking request as unsupported instead of price gainers or Wyckoff", () => {
        const mode = getMarketRankingMode("أقوى الأسهم اللي بتجمع سيولة وأحجام تداول النهاردة؟");
        expect(mode).toBe("liquidity_unavailable");
        expect(mode).not.toBe("price_change");
        expect(mode).not.toBe("accumulation");
    });

    it("keeps explicit Wyckoff scans and price gainers on their own metrics", () => {
        expect(getMarketRankingMode("هات أسهم التجميع المؤسسي Wyckoff")).toBe("accumulation");
        expect(getMarketRankingMode("أعلى الأسهم ارتفاعاً اليوم")).toBe("price_change");
    });

    it("keeps sector and historical liquidity on supported tool paths", () => {
        expect(getMarketRankingMode("أعلى القطاعات سيولة اليوم")).toBeNull();
        expect(getMarketRankingMode("أعلى الأسهم سيولة هذا الشهر")).toBeNull();
        expect(getMarketRankingMode("أعلى الأسهم سيولة النهارده")).toBe("liquidity_unavailable");
    });

    it("does not schedule unrequested market-wide daily liquidity clarification for sector or period rankings", async () => {
        const chain = (): any => new Proxy({}, { get(_target, property) {
            if (property === "then") return (resolve: (value: any) => void) => resolve({ data: [], error: null });
            return () => chain();
        } });
        const supabase = { from: () => chain(), rpc: () => chain() };
        for (const [message, requiredTool] of [
            ["أعلى القطاعات سيولة اليوم", "get_sector_liquidity"],
            ["أعلى الأسهم سيولة هذا الشهر", "get_price_history"],
        ]) {
            const planner: PlannerResult = {
                intent: "market_summary", confidence: 0.95,
                entities: { symbols: [], sector: null, wants_table: true, timeframe: "current" },
                tools: [requiredTool], request: { goal: message, reference: "market", ranking_metric: "unspecified", required_facts: [requiredTool === "get_price_history" ? "historical_prices" : "liquidity"] },
                session_update: { current_symbol: null, last_symbols: [], summary: message },
            };
            const controller = new AbortController();
            const stream = runPipelineStream(message, [], session, null, [], supabase, [], "u", "s", "m", undefined,
                { signal: controller.signal, mockPlannerResult: planner, mockToolsResults: { results: [], formattedText: "" } });
            let planEvent: any;
            for await (const event of stream) if (event.type === "plan") { planEvent = event.data; controller.abort(); break; }
            expect(planEvent.clarification_needed).toBeFalsy();
            expect(planEvent.tools).toContain(requiredTool);
        }
    });

    it("resolves 'best stock among them' to the antecedent group, never the current symbol alone", () => {
        expect(resolveGroupReferenceSymbols("أفضل سهم فيهم", session.last_symbols)).toEqual(session.last_symbols);
        expect(resolveGroupReferenceSymbols("أفضل سهم دلوقتي", session.last_symbols)).toEqual([]);
    });

    it("keeps KWIN and LUTS quantities attached to their own average purchase prices", () => {
        expect(parsePortfolioAnswer("KWIN 1100 سهم بمتوسط 107.01", {
            symbol: "KWIN", quantity: null, price: null,
        })).toMatchObject({ symbol: "KWIN", quantity: 1100, price: 107.01 });
        expect(parsePortfolioAnswer("LUTS 67435 سهم بمتوسط 0.94", {
            symbol: "LUTS", quantity: null, price: null,
        })).toMatchObject({ symbol: "LUTS", quantity: 67435, price: 0.94 });
    });

    it("understands Arabic digits in a pending image-import selection", () => {
        expect(parsePortfolioSelectionCount("أول ٥ أسهم")).toBe(5);
    });

    it("integrates a short follow-up with the preceding multi-stock group before tool execution", async () => {
        const chain = (): any => new Proxy({}, {
            get(_target, property) {
                if (property === "then") return (resolve: (value: any) => void) => resolve({ data: [], error: null });
                return () => chain();
            },
        });
        const supabase = { from: () => chain(), rpc: () => chain() };
        const planner: PlannerResult = {
            intent: "stock_analysis",
            confidence: 0.95,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current" },
            tools: ["get_stock"],
            session_update: { current_symbol: "GTWL", last_symbols: session.last_symbols, summary: "أفضل سهم فيهم" },
        };
        const controller = new AbortController();
        const stream = runPipelineStream(
            "أفضل سهم فيهم", [], session, null,
            [
                { role: "assistant", content: "تم تسجيل الأسهم: GTWL وKWIN وLUTS وMCRO وCOSG." },
                { role: "user", content: "أفضل سهم فيهم" },
            ],
            supabase, [], "user-test", "session-test", "message-test", undefined,
            { signal: controller.signal, mockToolsResults: { results: [], formattedText: "" }, mockPlannerResult: planner },
        );
        let planEvent: any = null;
        for await (const event of stream) {
            if (event.type === "plan") {
                planEvent = event.data;
                controller.abort();
                break;
            }
        }
        expect(planEvent.entities.symbols).toEqual(session.last_symbols);
        expect(planEvent.tools).toContain("get_stock");
    });
});
