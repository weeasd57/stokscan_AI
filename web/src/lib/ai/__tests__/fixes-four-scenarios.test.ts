import { enforceIntentFromMessage, buildDeterministicPlannerResult } from "../pipeline";
import { buildBothAccumulationDistributionResponse, buildDeterministicResponse, buildFastConversationalAdvisorResponse } from "../final-v2";
import { buildComparisonMatrix } from "../comparison-matrix";
import { IntentPlan, ToolResult, SessionState } from "../types";

const emptySession: SessionState = {
    current_symbol: null,
    last_symbols: [],
    summary: "",
    investment_budget: null,
    risk_tolerance: null,
    investment_horizon: null
};

function createMockPlan(partial: Partial<IntentPlan> & { intent: IntentPlan["intent"] }): IntentPlan {
    return {
        confidence: 1,
        needs_live_data: true,
        needs_historical_data: false,
        needs_vision_context: false,
        needs_history: false,
        tools: [],
        clarification_needed: false,
        resolved_from: { symbol: null, message_id: null },
        ...partial,
        entities: {
            symbols: [],
            sector: null,
            timeframe: "current",
            reference: null,
            ...partial.entities
        }
    };
}

function createMockToolResult(partial: Partial<ToolResult> & { tool: string; data: any }): ToolResult {
    return {
        source: "database",
        data_time: "2026-09-19",
        symbols: [],
        data_type: "live",
        ...partial
    };
}

describe("Fix 1: Liquidity comparison between two stocks", () => {
    it("routes direct liquidity comparison to comparison tool for two symbols", () => {
        const route: any = enforceIntentFromMessage("مقارنة السيولة بين COMI و EAST", "comparison", ["COMI", "EAST"]);
        expect(route.intent).toBe("comparison");
        expect(route.tools).toEqual(["get_comparison"]);
        expect(route.entities?.symbols).toEqual(["COMI", "EAST"]);
    });

    it("routes colloquial liquidity comparison to comparison tool", () => {
        const route: any = enforceIntentFromMessage("مين أعلى سيولة COMI ولا EAST", "stock_analysis", ["COMI", "EAST"]);
        expect(route.intent).toBe("comparison");
        expect(route.tools).toEqual(["get_comparison"]);
    });

    it("populates both stocks from session when comparing liquidity without explicit symbols", () => {
        const session: SessionState = { ...emptySession, last_symbols: ["FWRY", "COMI"], current_symbol: "FWRY" };
        const route: any = enforceIntentFromMessage("مقارنة السيولة بين سهمين", "general_chat", [], session);
        expect(route.intent).toBe("comparison");
        expect(route.tools).toEqual(["get_comparison"]);
        expect(route.entities?.symbols).toEqual(["FWRY", "COMI"]);
    });

    it("formats both stocks with liquidity ratio in comparison response", () => {
        const plan = createMockPlan({
            intent: "comparison",
            entities: { symbols: ["COMI", "EAST"], sector: null, wants_table: true, timeframe: "current", reference: null, requested_date: null, scan_direction: null }
        });
        const toolResults: ToolResult[] = [
            createMockToolResult({
                tool: "get_comparison",
                symbols: ["COMI", "EAST"],
                data: {
                    COMI: {
                        info: { symbol: "COMI", name: "التجاري الدولي" },
                        price: { close: 85.5 },
                        tech: { change_pct: 1.5, rsi_14: 55.2, volume: 2000000, vol_sma20: 1000000 }
                    },
                    EAST: {
                        info: { symbol: "EAST", name: "الشرقية للدخان" },
                        price: { close: 32.0 },
                        tech: { change_pct: -0.5, rsi_14: 48.0, volume: 500000, vol_sma20: 1000000 }
                    },
                    sym1: {
                        info: { symbol: "COMI", name: "التجاري الدولي" },
                        price: { close: 85.5 },
                        tech: { change_pct: 1.5, rsi_14: 55.2, volume: 2000000, vol_sma20: 1000000 }
                    },
                    sym2: {
                        info: { symbol: "EAST", name: "الشرقية للدخان" },
                        price: { close: 32.0 },
                        tech: { change_pct: -0.5, rsi_14: 48.0, volume: 500000, vol_sma20: 1000000 }
                    }
                }
            })
        ];
        const resp = buildDeterministicResponse("مقارنة السيولة بين COMI و EAST", plan, toolResults);
        expect(resp).not.toBeNull();
        expect(resp).toContain("COMI");
        expect(resp).toContain("EAST");
        expect(resp).toContain("2.00x من المتوسط");
        expect(resp).toContain("0.50x من المتوسط");
    });

    it("builds comparison matrix for both stocks from get_comparison", () => {
        const toolResults: ToolResult[] = [
            createMockToolResult({
                tool: "get_comparison",
                symbols: ["COMI", "EAST"],
                data: {
                    COMI: {
                        info: { symbol: "COMI", name: "التجاري الدولي" },
                        price: { close: 85.5 },
                        tech: { change_pct: 1.5, rsi_14: 55.2, volume: 2000000, vol_sma20: 1000000 }
                    },
                    EAST: {
                        info: { symbol: "EAST", name: "الشرقية للدخان" },
                        price: { close: 32.0 },
                        tech: { change_pct: -0.5, rsi_14: 48.0, volume: 500000, vol_sma20: 1000000 }
                    }
                }
            })
        ];
        const matrix = buildComparisonMatrix(toolResults);
        expect(matrix).not.toBeNull();
        expect(matrix!.stocks.length).toBe(2);
        expect(matrix!.stocks.map(s => s.symbol)).toEqual(["COMI", "EAST"]);
    });
});

describe("Fix 2: Accumulation and Distribution together", () => {
    it("renders both accumulation and distribution tables", () => {
        const plan = createMockPlan({
            intent: "accumulation_distribution",
            needs_live_data: false,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", reference: null, requested_date: null, scan_direction: null }
        });
        const toolResults: ToolResult[] = [
            createMockToolResult({
                tool: "get_accumulation_stocks",
                data: {
                    stocks: [
                        { symbol: "COMI", name: "التجاري الدولي", acc_score: 85, vol_ratio: 2.1, wyckoff_phase: "Phase C" }
                    ]
                }
            }),
            createMockToolResult({
                tool: "get_distribution_stocks",
                data: {
                    stocks: [
                        { symbol: "EAST", name: "الشرقية للدخان", dist_score: 78, vol_ratio: 0.6, wyckoff_phase: "Phase B" }
                    ]
                }
            })
        ];
        const resp = buildBothAccumulationDistributionResponse("التجميع والتصريف في السوق", plan, toolResults);
        expect(resp).not.toBeNull();
        expect(resp).toContain("التجميع");
        expect(resp).toContain("التصريف");
        expect(resp).toContain("COMI");
        expect(resp).toContain("EAST");
    });
});

describe("Fix 3: Null/missing values do NOT appear as 0 or 0.00", () => {
    it("does not format missing price as 0.00 in comparison", () => {
        const plan = createMockPlan({
            intent: "comparison",
            entities: { symbols: ["COMI", "EAST"], sector: null, wants_table: true, timeframe: "current", reference: null, requested_date: null, scan_direction: null }
        });
        const toolResults: ToolResult[] = [
            createMockToolResult({
                tool: "get_comparison",
                symbols: ["COMI", "EAST"],
                data: {
                    sym1: {
                        info: { symbol: "COMI" },
                        price: { close: null },
                        tech: { change_pct: null, rsi_14: null, volume: null }
                    },
                    sym2: {
                        info: { symbol: "EAST" },
                        price: { close: 32.0 },
                        tech: { change_pct: 1.0, rsi_14: 50, volume: 1000 }
                    }
                }
            })
        ];
        const resp = buildDeterministicResponse("قارن COMI و EAST", plan, toolResults);
        expect(resp).not.toBeNull();
        expect(resp).not.toContain("السعر 0 جنيه");
        expect(resp).not.toContain("السعر 0.00 جنيه");
        expect(resp).toContain("غير متاح");
    });
});

describe("Fix 4: Monthly return phrasings do NOT fall into general rejection", () => {
    it("routes 'العائد الشهري' to get_price_history (mtd)", () => {
        const plan = buildDeterministicPlannerResult("العائد الشهري", emptySession);
        expect(plan).not.toBeNull();
        expect(plan!.intent).toBe("market_summary");
        expect(plan!.tools).toEqual(["get_price_history"]);
        expect(plan!.entities.requested_date).toBe("mtd");
    });

    it("routes 'عائد الشهر ده' to get_price_history (mtd)", () => {
        const plan = buildDeterministicPlannerResult("عائد الشهر ده", emptySession);
        expect(plan).not.toBeNull();
        expect(plan!.intent).toBe("market_summary");
        expect(plan!.tools).toEqual(["get_price_history"]);
        expect(plan!.entities.requested_date).toBe("mtd");
    });

    it("provides educational guidance for 'عايز عائد شهري'", () => {
        const plan = createMockPlan({
            intent: "general_chat",
            needs_live_data: false,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", reference: null, requested_date: null, scan_direction: null }
        });
        const resp = buildFastConversationalAdvisorResponse("عايز عائد شهري", plan, [], null);
        expect(resp).not.toBeNull();
        expect(resp).toContain("العائد والدخل الشهري");
        expect(resp).toContain("صناديق استثمار الدخل الثابت");
        expect(resp).not.toContain("عذراً، لم تتوفر بيانات موثقة");
    });

    it("provides guidance for 'هل في عائد شهري في البورصة؟'", () => {
        const plan = createMockPlan({
            intent: "general_chat",
            needs_live_data: false,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", reference: null, requested_date: null, scan_direction: null }
        });
        const resp = buildFastConversationalAdvisorResponse("هل في عائد شهري في البورصة؟", plan, [], null);
        expect(resp).not.toBeNull();
        expect(resp).toContain("طبيعة الأسهم");
        expect(resp).not.toContain("عذراً، لم تتوفر بيانات موثقة");
    });
});
