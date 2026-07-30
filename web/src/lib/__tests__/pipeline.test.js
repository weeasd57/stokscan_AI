const { validateVisionOutput } = require("../ai/vision");
const { buildV2FinalMessages } = require("../ai/final-v2");
const { retrieveRelevantMemory } = require("../ai/memory");
const { buildExcelTables, tablesToMarkdown } = require("../ai/excel-tables");
const { enforceIntentFromMessage, buildMarketLiquidityResponse } = require("../ai/pipeline");
const { sanitizeReply } = require("../ai/sanitizer");

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
});

describe("Deterministic intent guards", () => {
    it("routes a market liquidity question to market and accumulation tools", () => {
        const result = enforceIntentFromMessage("السيولة فين النهارده؟", "comparison", []);
        expect(result.intent).toBe("market_summary");
        expect(result.tools).toEqual(["get_market", "get_accumulation_stocks"]);
    });

    it("routes bank sector questions to sector data", () => {
        const result = enforceIntentFromMessage("بنوك حالتها إيه؟", "general_chat", []);
        expect(result.intent).toBe("sector_analysis");
        expect(result.tools).toEqual(["get_sector"]);
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
