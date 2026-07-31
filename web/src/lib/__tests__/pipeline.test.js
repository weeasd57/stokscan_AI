const { validateVisionOutput } = require("../ai/vision");
const { buildV2FinalMessages, buildDeterministicResponse } = require("../ai/final-v2");
const { retrieveRelevantMemory } = require("../ai/memory");
const { buildExcelTables, tablesToMarkdown } = require("../ai/excel-tables");
const { enforceIntentFromMessage, buildMarketLiquidityResponse, needsLiveDataForTools, needsHistoricalData, extractSectorFromMessage, extractExplicitSymbols, buildDeterministicPlannerResult, extractRequestedDate, extractRequestedDateRange, extractTemporalContext, isMarketWideRequest } = require("../ai/pipeline");
const { sanitizeReply } = require("../ai/sanitizer");
const { parseToolsOutput } = require("../ai/table-builder");

// Simple mock for supabase
const mockSupabase = {
    from: () => ({
        select: () => ({
            eq: () => ({
                eq: () => ({
                    overlaps: () => ({
                        order: () => ({
                            limit: () => Promise.resolve({ data: [] })
                        })
                    })
                })
            })
        })
    })
};

describe("Vision Analyzer Outputs", () => {
    it("handles null or missing technical observation values correctly and puts them in uncertainties", () => {
        const rawVisionResult = {
            image_type: "chart",
            symbols: [
                { symbol: "COMI", name: "Commercial International Bank", visible_values: { price: 80.5, change_pct: 1.2, quantity: null } }
            ],
            technical_observations: [
                { symbol: "COMI", indicator: "RSI", value: "", meaning: "unknown" },
                { symbol: "COMI", indicator: "MACD", value: null, meaning: "neutral" },
                { symbol: "COMI", indicator: "SMA20", value: 78.2, meaning: "bullish" }
            ],
            market_depth: { total_bid: null, total_ask: null, spread: null },
            user_relevant_summary: "A technical chart showing COMI price and SMA20",
            uncertainties: [],
            confidence: 0.95
        };

        const validated = validateVisionOutput(rawVisionResult);

        expect(validated).not.toBeNull();
        expect(validated.technical_observations[0].value).toBeNull();
        expect(validated.technical_observations[1].value).toBeNull();
        expect(validated.technical_observations[2].value).toBe(78.2);
        
        // Assert that the uncertainties list contains notices about unreadable indicators
        expect(validated.uncertainties).toContain("Unreadable value for RSI of symbol COMI");
        expect(validated.uncertainties).toContain("Unreadable value for MACD of symbol COMI");
    });
});

describe("Memory Reference Resolution", () => {
    it("correctly resolves references like 'ده' or 'السهم ده' based on session history", async () => {
        const sessionSummary = {
            current_symbols: ["COMI"],
            last_image_symbols: ["EAST"],
            last_topic: "chart",
            open_references: [],
            last_data_date: "2026-07-30",
            last_vision_context: null,
            updated_at: new Date().toISOString()
        };

        const sessionState = {
            current_symbol: "COMI",
            last_symbols: ["COMI", "EAST"],
            summary: "comparison query"
        };

        const result = await retrieveRelevantMemory(
            "قارن ده مع سهم طلعت مصطفى",
            sessionSummary,
            sessionState,
            [],
            mockSupabase,
            "usr_123",
            "ses_123"
        );

        // 'ده' should map to the last image symbol 'EAST'
        expect(result.resolved_references.symbol).toBe("EAST");
        expect(result.resolved_references.confidence).toBe(0.9);
    });

    it("does not fetch old snapshots for a standalone message", async () => {
        let queried = false;
        const trackingSupabase = { from: () => { queried = true; return mockSupabase.from(); } };
        const result = await retrieveRelevantMemory(
            "ازيك النهارده؟",
            { current_symbols: ["COMI"], last_image_symbols: ["EAST"] },
            { current_symbol: "COMI", last_symbols: ["COMI", "EAST"] },
            [{ role: "assistant", content: "تحليل قديم لـ COMI" }],
            trackingSupabase,
            "usr_123",
            "ses_123"
        );

        expect(queried).toBe(false);
        expect(result.relevant_snapshots).toEqual([]);
        expect(result.resolved_references.symbol).toBeNull();
    });
});

describe("LLM Final Context Segment Splitting", () => {
    it("segregates fact snapshots in the final messages by their data_type", () => {
        const userMessage = "وريني البيانات القديمة والجديدة";
        const plan = {
            intent: "comparison",
            confidence: 0.95,
            entities: { symbols: ["COMI"], sector: null, timeframe: "unspecified", reference: null },
            needs_vision_context: false,
            needs_history: true,
            needs_live_data: true,
            needs_historical_data: true,
            tools: [],
            clarification_needed: false,
            resolved_from: { symbol: null, message_id: null }
        };

        const relevantFacts = [
            {
                context_id: "msg_1",
                source: "vision_analysis",
                symbols: ["COMI"],
                as_of: "2026-07-29",
                facts: { portfolio_value: 12000 },
                data_type: "image-derived"
            },
            {
                context_id: "msg_2",
                source: "stock_prices",
                symbols: ["COMI"],
                as_of: "2026-07-30",
                facts: { price: 81.5 },
                data_type: "live"
            },
            {
                context_id: "msg_3",
                source: "historical_database",
                symbols: ["COMI"],
                as_of: "2026-06-30",
                facts: { price: 72.0 },
                data_type: "historical"
            }
        ];

        const messages = buildV2FinalMessages(
            userMessage,
            plan,
            null,
            [],
            relevantFacts,
            [],
            { symbol: null, message_id: null, confidence: 0 }
        );

        const contextContent = messages[1].content;

        expect(contextContent).toContain("=== IMAGE-DERIVED MEMORY ===");
        expect(contextContent).toContain("=== LIVE DATA MEMORY ===");
        expect(contextContent).toContain("=== HISTORICAL DATA ===");
        
        // Assert they show correct sources and properties
        expect(contextContent).toContain("portfolio_value: 12000");
        expect(contextContent).toContain("price: 81.5");
        expect(contextContent).toContain("price: 72");
    });

    it("excludes history and stale facts when the current request does not need memory", () => {
        const plan = {
            intent: "general_chat",
            confidence: 0.95,
            entities: { symbols: [], sector: null, timeframe: "unspecified", reference: null },
            needs_vision_context: false,
            needs_history: false,
            needs_live_data: false,
            needs_historical_data: false,
            tools: [],
            clarification_needed: false,
            resolved_from: { symbol: null, message_id: null }
        };
        const messages = buildV2FinalMessages(
            "ازيك؟",
            plan,
            null,
            [],
            [{ context_id: "old", source: "stock_prices", symbols: ["COMI"], as_of: "2026-01-01", facts: { price: 50 }, data_type: "live" }],
            [{ role: "assistant", content: "سعر COMI القديم 50" }],
            { symbol: null, message_id: null, confidence: 0 }
        );

        expect(messages[1].content).not.toContain("RECENT MESSAGES");
        expect(messages[1].content).not.toContain("LIVE DATA MEMORY");
        expect(messages[1].content).not.toContain("سعر COMI القديم");
    });
});

describe("Deterministic response fallback", () => {
    const basePlan = {
        intent: "stock_analysis",
        confidence: 0.95,
        entities: { symbols: ["CAED"], sector: null, timeframe: "current", reference: null },
        needs_vision_context: false,
        needs_history: false,
        needs_live_data: true,
        needs_historical_data: false,
        tools: ["get_stock"],
        clarification_needed: false,
        resolved_from: { symbol: null, message_id: null }
    };

    it("answers stock data without depending on an LLM", () => {
        const response = buildDeterministicResponse("تحليل السيولة لـ CAED", basePlan, [{
            tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["CAED"], data_type: "live",
            data: { symbol: "CAED", name: "Cairo Educational Services", price: 125.11, change_pct: "-2.64%", rsi_14: "75.25", macd_signal: "12.5232", vol_ratio: "0.29x" }
        }]);
        expect(response).toContain("CAED");
        expect(response).toContain("125.11");
        expect(response).not.toContain("لم أتمكن");
    });

    it("answers greetings without inheriting stock context", () => {
        const response = buildDeterministicResponse("ازيك النهارده؟", { ...basePlan, intent: "general_chat", entities: { ...basePlan.entities, symbols: [] } }, []);
        expect(response).toContain("أهلاً");
        expect(response).not.toContain("CAED");
    });

    it("prefers current stock data over an old response snapshot", () => {
        const response = buildDeterministicResponse("حلل CAED النهارده", { ...basePlan, intent: "stock_analysis" }, [
            { tool: "get_historical_facts", source: "prior_assistant_message", data_time: "2026-07-20", symbols: ["CAED"], data_type: "historical", data: { prior_response: "CAED السعر 99" } },
            { tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["CAED"], data_type: "live", data: { symbol: "CAED", name: "Cairo Educational Services", price: 125.11, change_pct: "-2.64%", rsi_14: "75.25", macd_signal: "12.5232", vol_ratio: "0.29x" } }
        ]);
        expect(response).toContain("125.11");
        expect(response).not.toContain("99");
    });

    it("recognizes a historical follow-up even when the planner says general chat", () => {
        expect(needsHistoricalData("general_chat", "طب السهم ده كان سعره كام قبل كده؟")).toBe(true);
    });

    it("extracts a historical price only from a prior recorded response", () => {
        const response = buildDeterministicResponse("السعر السابق", {
            ...basePlan,
            intent: "historical_recall",
            needs_historical_data: true,
            tools: ["get_historical_facts"]
        }, [{
            tool: "get_historical_facts", source: "prior_assistant_message", data_time: "2026-07-30",
            symbols: ["CAED"], data_type: "historical", data: { prior_response: "CAED: السعر = 125.11 جنيه" }
        }]);
        expect(response).toContain("125.11");
        expect(response).toContain("تاريخية");
    });

    it("does not invent a sell price", () => {
        const response = buildDeterministicResponse("معايا سهم CAED ابيعه على كام", basePlan, [{
            tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["CAED"], data_type: "live",
            data: { symbol: "CAED", name: "Cairo Educational Services", price: 125.11, change_pct: "-2.64%", rsi_14: "75.25", macd_signal: "12.5232", vol_ratio: "0.29x" }
        }]);
        expect(response).toContain("لا أستطيع تحديد سعر بيع");
        expect(response).not.toContain("سعر مستهدف 130");
    });

    it("calculates and labels recorded-signal performance", () => {
        const response = buildDeterministicResponse("التوصيات دي محققة ربح كام؟", basePlan, [{
            tool: "get_recommendations", source: "scan_results", data_time: "2026-07-31", symbols: ["TEST"], data_type: "live",
            data: [{ symbol: "TEST", entry_price: 100, current_price: 110, return_pct: 10, status: "ربح غير محقق" }]
        }]);
        expect(response).toContain("+10.00%");
        expect(response).toContain("إشارات فنية تاريخية");
        expect(response).toContain("غير محقق");
    });

    it("explains which symbols are missing in a dated comparison", () => {
        const response = buildDeterministicResponse("قارن CAED وCOMI بتاريخ 2026-07-10", {
            ...basePlan,
            intent: "comparison",
            entities: { ...basePlan.entities, symbols: ["CAED", "COMI"], requested_date: "2026-07-10" }
        }, [{
            tool: "get_comparison", source: "database", data_time: "2026-07-10", symbols: ["CAED", "COMI"], data_type: "historical",
            data: {
                sym1: { price: null, tech: null, info: { symbol: "CAED" } },
                sym2: { price: null, tech: null, info: { symbol: "COMI" } }
            }
        }]);
        expect(response).toContain("2026-07-10");
        expect(response).toContain("CAED");
        expect(response).toContain("COMI");
        expect(response).toContain("لم أستخدم تاريخاً آخر");
    });

    it("labels previous-week news with its exact date range", () => {
        const response = buildDeterministicResponse("هات اخبار AMER الاسبوع اللى فات", {
            ...basePlan,
            entities: { ...basePlan.entities, symbols: ["AMER"], requested_start_date: "2026-07-20", requested_end_date: "2026-07-26" }
        }, [{
            tool: "get_news", source: "database", data_time: "2026-07-26", symbols: ["AMER"], data_type: "historical",
            data: []
        }]);
        expect(response).toContain("2026-07-20");
        expect(response).toContain("2026-07-26");
        expect(response).not.toContain("الفترة الحالية");
    });

    it("gives a direct evidence-based accumulation verdict for one stock", () => {
        const response = buildDeterministicResponse("ABCD عليه تجميع؟", {
            ...basePlan,
            intent: "accumulation_distribution",
            entities: { ...basePlan.entities, symbols: ["ABCD"], scan_direction: "accumulation" }
        }, [{
            tool: "get_accumulation_stocks", source: "stock_scans_summary", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live",
            data: { direction: "accumulation", stocks: [{ symbol: "ABCD", signal: "accumulation", acc_score: 72, dist_score: 8, vol_ratio: 1.9, consecutive_acc_days: 3, wyckoff_phase: "accumulation" }], scan_rows: [{ symbol: "ABCD", signal: "accumulation", acc_score: 72, dist_score: 8, vol_ratio: 1.9, consecutive_acc_days: 3, wyckoff_phase: "accumulation" }] }
        }]);
        expect(response).toContain("نعم، توجد إشارة التجميع");
        expect(response).toContain("72/100");
        expect(response).not.toContain("ملخص السوق");
    });

    it("does not infer accumulation from technical indicators without a scan row", () => {
        const response = buildDeterministicResponse("ABCD عليه تجميع؟", {
            ...basePlan,
            intent: "accumulation_distribution",
            entities: { ...basePlan.entities, symbols: ["ABCD"], scan_direction: "accumulation" }
        }, [{
            tool: "get_accumulation_stocks", source: "stock_technical_indicators", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live",
            data: { direction: "accumulation", stocks: [], scan_rows: [], technical_rows: [{ symbol: "ABCD", vol_ratio: 1.8, rsi_14: 61, macd_signal: 0.3 }] }
        }]);
        expect(response).toContain("لا توجد بيانات مسح التجميع كافية");
        expect(response).toContain("لا تثبت التجميع وحدها");
    });

    it("explains when a stock scan points to distribution instead of accumulation", () => {
        const response = buildDeterministicResponse("ABCD عليه تجميع؟", {
            ...basePlan,
            intent: "accumulation_distribution",
            entities: { ...basePlan.entities, symbols: ["ABCD"], scan_direction: "accumulation" }
        }, [{
            tool: "get_accumulation_stocks", source: "stock_scans_summary", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live",
            data: { direction: "accumulation", stocks: [], scan_rows: [{ symbol: "ABCD", signal: "distribution", acc_score: 10, dist_score: 74, vol_ratio: 2.1, consecutive_dist_days: 2 }] }
        }]);
        expect(response).toContain("لا، أحدث مسح لا يسجل التجميع");
        expect(response).toContain("التصريف");
        expect(response).toContain("74/100");
    });

    it("keeps a dated scan response tied to the requested date", () => {
        const response = buildDeterministicResponse("ABCD عليه تجميع بتاريخ 2026-07-10", {
            ...basePlan,
            intent: "accumulation_distribution",
            entities: { ...basePlan.entities, symbols: ["ABCD"], scan_direction: "accumulation", requested_date: "2026-07-10" }
        }, [{
            tool: "get_accumulation_stocks", source: "empty", data_time: "2026-07-10", symbols: ["ABCD"], data_type: "historical",
            data: { direction: "accumulation", stocks: [], scan_rows: [], technical_rows: [] }
        }]);
        expect(response).toContain("2026-07-10");
        expect(response).not.toContain("2026-07-30");
    });

    it("does not leak environment metadata", () => {
        const { sanitizeReply } = require("../ai/sanitizer");
        const cleaned = sanitizeReply("رد آمن\n<environment_details>Current time: secret\nWorkspace root folder: secret");
        expect(cleaned).not.toContain("environment_details");
        expect(cleaned).not.toContain("Workspace root folder");
        expect(cleaned).not.toContain("Current time");
        expect(sanitizeReply("رد آمن\nenvironment_details>Current time: secret")).not.toContain("environment_details");
    });

    it("does not trust low-confidence vision symbols for market tools", () => {
        const { extractExplicitSymbols } = require("../ai/pipeline");
        expect(extractExplicitSymbols("شايف الصورة دي؟")).toEqual([]);
    });

    it("plans historical references without waiting for an external model", () => {
        const plan = buildDeterministicPlannerResult("طب السهم ده كان سعره كام قبل كده؟", { current_symbol: "CAED", last_symbols: ["CAED"], summary: null });
        expect(plan.intent).toBe("historical_recall");
        expect(plan.tools).toEqual([]);
    });

    it("normalizes dates with or without an explicit year", () => {
        expect(extractRequestedDate("هات السيولة بتاريخ 10/7")).toBe(`${new Date().getFullYear()}-07-10`);
        expect(extractTemporalContext("أخبار CAED يوم 2026-07-10")).toEqual({ date: "2026-07-10", timeframe: "historical" });
        expect(extractTemporalContext("سعر CAED النهارده").timeframe).toBe("current");
    });

    it("extracts the previous calendar week as an explicit range", () => {
        expect(extractRequestedDateRange("هات اخبار AMER الاسبوع اللى فات", new Date("2026-07-31T12:00:00Z"))).toEqual({
            start: "2026-07-20",
            end: "2026-07-26"
        });
    });

    it("extracts an explicit Arabic date range and does not reduce it to one day", () => {
        const message = "هات اخبار amer مابين 5/7 ل 30/7";
        expect(extractRequestedDateRange(message, new Date("2026-07-31T12:00:00Z"))).toEqual({
            start: "2026-07-05",
            end: "2026-07-30"
        });
        expect(extractTemporalContext(message)).toEqual({ date: null, timeframe: "historical" });
        expect(extractExplicitSymbols(message)).toEqual(["AMER"]);
    });

    it("recognizes dated market news and misspelled liquidity as market-wide", () => {
        expect(isMarketWideRequest("اخبار السوق ل 5/7")).toBe(true);
        expect(isMarketWideRequest("السيوله لبوم 5/7")).toBe(true);
        const plan = buildDeterministicPlannerResult("اخبار السوق ل 5/7", { current_symbol: "CAED", last_symbols: ["CAED"], summary: null });
        expect(plan.entities.symbols).toEqual([]);
        expect(enforceIntentFromMessage("السيوله لبوم 5/7", "historical_recall", [])).toEqual({
            intent: "market_summary",
            tools: ["get_market", "get_accumulation_stocks"],
            replaceTools: true
        });
    });

    it("scopes institutional accumulation to any resolved stock symbol", () => {
        expect(enforceIntentFromMessage("شوف التجميع المؤسسي على السهم", "market_summary", ["ABCD"])).toEqual({
            intent: "accumulation_distribution",
            tools: ["get_accumulation_stocks"],
            replaceTools: true,
            scan_direction: "accumulation"
        });
    });

    it("routes a short distribution follow-up as a market-wide distribution scan", () => {
        expect(isMarketWideRequest("والتصريف")).toBe(true);
        expect(enforceIntentFromMessage("والتصريف", "accumulation_distribution", [])).toEqual({
            intent: "accumulation_distribution",
            tools: ["get_distribution_stocks"],
            replaceTools: true,
            scan_direction: "distribution"
        });
    });

    it("routes a single-stock liquidity request to stock data only", () => {
        expect(enforceIntentFromMessage("حلل سيوله ABCD", "sector_analysis", ["ABCD"]).tools).toEqual(["get_stock"]);
    });

    it("routes top movers to market data instead of the previous stock", () => {
        const plan = buildDeterministicPlannerResult("أقوى الأسهم النهارده", { current_symbol: "ELSH", last_symbols: ["ELSH"], summary: null });
        expect(plan.entities.symbols).toEqual([]);
        expect(plan.tools).toEqual(["get_market"]);
    });

    it("keeps a generic stock lookup separate from accumulation scans", () => {
        expect(enforceIntentFromMessage("شوف ABCD", "stock_analysis", ["ABCD"])).toEqual({ intent: "stock_analysis", tools: [] });
        expect(enforceIntentFromMessage("ABCD عليه تجميع؟", "stock_analysis", ["ABCD"]).tools).toEqual(["get_accumulation_stocks"]);
    });

    it("routes a dated stock analysis to stock data and preserves the date", () => {
        const plan = buildDeterministicPlannerResult("تحليل AMES يوم 2026-07-10", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({
            intent: "stock_analysis",
            tools: ["get_stock"],
            entities: { symbols: ["AMES"], requested_date: "2026-07-10", timeframe: "historical" }
        });
    });

    it("resolves a dated follow-up to the active stock", () => {
        const plan = buildDeterministicPlannerResult("هاته بتاريخ 10/7", { current_symbol: "AALR", last_symbols: ["AALR"], summary: null });
        expect(plan.entities.symbols).toEqual(["AALR"]);
        expect(plan.entities.requested_date).toBe(`${new Date().getFullYear()}-07-10`);
        expect(plan.tools).toEqual(["get_stock"]);
    });
});

describe("Excel-ready structured tables", () => {
    it("builds an exportable comparison table from tool data", () => {
        const tables = buildExcelTables([
            {
                tool: "get_comparison",
                source: "database",
                data_time: "2026-07-30",
                symbols: ["COMI", "EAST"],
                data_type: "live",
                data: {
                    sym1: { price: { close: 81.5 }, tech: { change_pct: 1.2, rsi_14: 61, macd_signal: 0.4 }, info: { symbol: "COMI", name: "CIB" } },
                    sym2: { price: { close: 36.4 }, tech: { change_pct: -0.5, rsi_14: 44, macd_signal: -0.2 }, info: { symbol: "EAST", name: "Eastern" } }
                }
            }
        ], null);

        expect(tables).toHaveLength(1);
        expect(tables[0].headers).toContain("RSI");
        expect(tables[0].rows[0]).toContain("COMI");
        expect(tablesToMarkdown(tables)).toContain("| COMI |");
    });

    it("builds an exportable table from visible image values", () => {
        const tables = buildExcelTables([], {
            image_type: "chart",
            symbols: [{ symbol: "COMI", name: "CIB", visible_values: { price: 81.5, change_pct: 1.2, quantity: null } }],
            technical_observations: [{ symbol: "COMI", indicator: "RSI", value: 61, meaning: "neutral" }],
            market_depth: { total_bid: null, total_ask: null, spread: null },
            user_relevant_summary: "chart",
            uncertainties: [],
            confidence: 0.9,
            analyzed_at: "2026-07-30T10:00:00Z",
            message_id: "msg_1"
        });

        expect(tables[0].rows[0]).toEqual(["COMI", "CIB", "81.5", "1.2", "", "61", ""]);
    });

    it("preserves accumulation fields and news rows for Excel", () => {
        const tables = buildExcelTables([
            {
                tool: "get_accumulation_stocks",
                source: "stock_scans_summary",
                data_time: "2026-07-30",
                symbols: ["COMI"],
                data_type: "live",
                data: { stocks: [{ symbol: "COMI", name: "CIB", acc_score: 82, vol_ratio: 1.6, wyckoff_phase: "B" }] }
            },
            {
                tool: "get_news",
                source: "database",
                data_time: "2026-07-30",
                symbols: ["COMI"],
                data_type: "live",
                data: [{ symbol: "COMI", date: "2026-07-30", sentiment_label: "إيجابي", sentiment_score: 0.4, news_count: 2, title: "خبر" }]
            }
        ], null);

        expect(tables).toHaveLength(2);
        expect(tables[0].headers).toContain("درجة التجميع");
        expect(tables[0].rows[0]).toContain("82");
        expect(tables[1].headers).toContain("العنوان");
        expect(tables[1].rows[0]).toContain("خبر");
    });

    it("uses distribution labels and consecutive distribution days", () => {
        const tables = buildExcelTables([{
            tool: "get_distribution_stocks", source: "stock_scans_summary", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live",
            data: { direction: "distribution", stocks: [{ symbol: "ABCD", dist_score: 79, consecutive_dist_days: 4 }] }
        }], null);
        expect(tables[0].title).toContain("التصريف");
        expect(tables[0].headers).toContain("أيام التصريف");
        expect(tables[0].rows[0]).toContain("4");
    });
});

describe("Deterministic intent guards", () => {
    it("derives live-data need from tools instead of image presence", () => {
        expect(needsLiveDataForTools([])).toBe(false);
        expect(needsLiveDataForTools(["get_stock"])).toBe(true);
        expect(needsLiveDataForTools(["get_historical_facts"])).toBe(false);
    });

    it("enables historical retrieval for planner intent and Arabic recall phrases", () => {
        expect(needsHistoricalData("historical_recall", "السعر اللي قولته")).toBe(true);
        expect(needsHistoricalData("stock_analysis", "كان السعر كام من شوية؟")).toBe(true);
        expect(needsHistoricalData("general_chat", "ازيك النهارده؟")).toBe(false);
    });
    it("routes a market liquidity question to market and accumulation tools", () => {
        const result = enforceIntentFromMessage("السيولة فين النهارده؟", "comparison", []);
        expect(result.intent).toBe("market_summary");
        expect(result.tools).toEqual(["get_market", "get_accumulation_stocks"]);
    });

    it("routes single-stock liquidity analysis to current stock data", () => {
        const symbols = extractExplicitSymbols("تحليل السيولة لـ CAED");
        const result = enforceIntentFromMessage("تحليل السيولة لـ CAED", "accumulation", symbols);
        expect(symbols).toEqual(["CAED"]);
        expect(result).toEqual({ intent: "stock_analysis", tools: ["get_stock"], replaceTools: true });
    });

    it("keeps an explicit symbol scoped to a stock-news request without planner help", () => {
        const symbols = extractExplicitSymbols("أخبار CAED اليوم");
        const result = enforceIntentFromMessage("أخبار CAED اليوم", "general_chat", symbols);
        expect(symbols).toEqual(["CAED"]);
        expect(result).toEqual({ intent: "stock_news", tools: ["get_news"], replaceTools: true });
    });

    it("plans clear lowercase ticker lists without an external model", () => {
        expect(extractExplicitSymbols("caed, amer")).toEqual(["CAED", "AMER"]);
        const plan = buildDeterministicPlannerResult("caed, amer", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan.entities.symbols).toEqual(["CAED", "AMER"]);
        expect(plan.tools).toEqual(["get_stock"]);
    });

    it("keeps the previous stock when a follow-up says compare this with another", () => {
        const plan = buildDeterministicPlannerResult("قارن ده مع AMER", { current_symbol: "CAED", last_symbols: ["CAED"], summary: null });
        expect(plan.entities.symbols).toEqual(["CAED", "AMER"]);
    });

    it("routes top-ten questions to the market tool only", () => {
        const result = enforceIntentFromMessage("هات أعلى 10 أسهم النهارده", "general_chat", []);
        expect(result.intent).toBe("market_summary");
        expect(result.tools).toEqual(["get_market"]);
        expect(result.replaceTools).toBe(true);
    });

    it("routes bank sector questions to sector data", () => {
        const result = enforceIntentFromMessage("بنوك حالتها إيه؟", "general_chat", []);
        expect(result.intent).toBe("sector_analysis");
        expect(result.tools).toEqual(["get_sector"]);
    });

    it("routes a typo-prefixed real-estate request and preserves its sector", () => {
        const result = enforceIntentFromMessage("ات قطاع العقارات", "general_chat", []);
        expect(result).toMatchObject({ intent: "sector_analysis", tools: ["get_sector"], sector: "عقارات" });
        expect(extractSectorFromMessage("حلل القطاع العقاري")).toBe("عقارات");
    });

    it("removes historical recommendations from sell questions", () => {
        const result = enforceIntentFromMessage("لو معايا AMES أبيع؟", "recommendation", ["AMES"]);
        expect(result.intent).toBe("stock_analysis");
        expect(result.tools).toEqual(["get_stock"]);
        expect(result.replaceTools).toBe(true);
    });

    it("builds a non-repetitive market liquidity response without inventing a market vol ratio", () => {
        const response = buildMarketLiquidityResponse({
            results: [
                { tool: "get_market", data_time: "2026-07-30", data_type: "live", source: "database", symbols: ["EGX30"], data: { regime: "sideways", egx30: 53442.2, usd: 50.69 } },
                { tool: "get_accumulation_stocks", data_time: "2026-07-30", data_type: "live", source: "database", symbols: ["COMI"], data: { stocks: [{ symbol: "COMI", acc_score: 82, vol_ratio: 1.6, change_pct: 0.5 }] } }
            ],
            formattedText: ""
        });

        expect(response).toContain("COMI");
        expect(response).toContain("EGX30");
        expect(response).not.toContain("Vol Ratio");
        expect(response.match(/حالة السوق/g)).toHaveLength(1);
    });
});

describe("Structured table sanitization", () => {
    it("does not create fake LIVE or HISTORICAL rows from a real table", () => {
        const reply = [
            "### بيانات الأسهم",
            "| السهم | السعر | RSI |",
            "| --- | --- | --- |",
            "| AMER | 4.5 | 82.38 |",
            "تحليل موضوعي للسهم."
        ].join("\n");

        const sanitized = sanitizeReply(reply);
        expect(sanitized).toContain("| AMER | 4.5 | 82.38 |");
        expect(sanitized).not.toContain("| LIVE |");
        expect(sanitized).not.toContain("| HISTORICAL |");
    });

    it("removes an unclosed environment details leak", () => {
        const sanitized = sanitizeReply("رد صالح\n<environment_details>\nWorkspace root folder: secret");
        expect(sanitized).toContain("رد صالح");
        expect(sanitized).not.toContain("environment_details");
        expect(sanitized).not.toContain("Workspace root folder");
    });
});

describe("Legacy table parser safety", () => {
    it("does not treat context labels as stock symbols", () => {
        const parsed = parseToolsOutput([
            "بيانات الأسهم الحية:",
            "• STOCK (placeholder): السعر = 1, التغير = 1%, RSI = 50, MACD = 0.1, نسبة السيولة = 1x",
            "• AMER (Amer Group): السعر = 4.5, التغير = -1%, RSI = 82, MACD = 0.4, نسبة السيولة = 0.46x"
        ].join("\n"));

        expect(parsed.stocks.map(stock => stock.symbol)).toEqual(["AMER"]);
    });

    it("does not parse a normal stock table as accumulation data", () => {
        const parsed = parseToolsOutput([
            "بيانات الأسهم الحية:",
            "• CAED (Cairo Educational Services): السعر = 10.2 ج.م, التغير = +1.2%, RSI = 75.25, MACD = 12.5232, نسبة السيولة = 0.29x",
            "• AMER (Amer Group Holding): السعر = 4.5 ج.م, التغير = -1%, RSI = 82.38, MACD = 0.4338, نسبة السيولة = 0.46x"
        ].join("\n"));

        expect(parsed.stocks.map(stock => stock.symbol)).toEqual(["CAED", "AMER"]);
        expect(parsed.accumulationStocks).toEqual([]);
    });
});
