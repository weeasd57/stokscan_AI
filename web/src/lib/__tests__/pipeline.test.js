const { validateVisionOutput } = require("../ai/vision");
const { buildV2FinalMessages, buildDeterministicResponse } = require("../ai/final-v2");
const { retrieveRelevantMemory } = require("../ai/memory");
const { buildExcelTables, tablesToMarkdown } = require("../ai/excel-tables");
const { enforceIntentFromMessage, buildMarketLiquidityResponse, buildTopMoversResponse, needsLiveDataForTools, needsHistoricalData, extractSectorFromMessage, extractExcludedSectors, extractExplicitSymbols, buildDeterministicPlannerResult, extractRequestedDate, extractRequestedDateRange, extractTemporalContext, isMarketWideRequest, isFairValueScanRequest, getFairValueFilters, isEarningsDataRequest, isUsageLimitQuestion, extractSingleStockFromRecentHistory, isEgxWeekend, describeDatedFallback, getInvestorGuidanceIntent, isBeginnerPortfolioQuestion, isNonEquityProductComparison, sanitizePlannerTools, scopeImplicitSingleStockRequest } = require("../ai/pipeline");
const { sanitizeReply } = require("../ai/sanitizer");
const { sanitizeUiLabel } = require("../ai/sanitizer");
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

describe("Vision timeout configuration", () => {
    it("keeps the total vision budget consistent with the model timeout", () => {
        const fs = require("fs");
        const source = fs.readFileSync(require.resolve("../ai/vision"), "utf8");
        expect(source).not.toContain("13s cap");
        expect(source).toContain("MAX_VISION_TOTAL_TIME_MS = 25000");
        expect(source).toContain("for (const model of visionModels)");
    });
});

describe("Image failure response safety", () => {
    it("returns a deterministic clarification without leaking internal prompt markers", () => {
        const response = buildDeterministicResponse("", {
            intent: "clarification",
            confidence: 1,
            entities: { symbols: [], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false,
            needs_history: false,
            needs_live_data: false,
            needs_historical_data: false,
            tools: [],
            clarification_needed: false,
            service_degraded_message: "Cannot read image.png",
            resolved_from: { symbol: null, message_id: null }
        }, []);
        expect(response).toContain("تعذر قراءة الصورة");
        expect(response).not.toContain("USER REQUEST");
        expect(response).not.toContain("image.png");
    });
});

describe("Standalone recommendation routing", () => {
    it("does not inherit the previous fair-value scan for a new recommendation request", () => {
        const plan = buildDeterministicPlannerResult("هات توصيه", {
            current_symbol: null,
            last_symbols: [],
            summary: "هات الأسهم اللي عليها تجميع وتحت القيمة العادلة"
        });
        expect(plan).toMatchObject({
            intent: "market_summary",
            tools: ["get_recommendations"],
            entities: { recommendation_order: "newest" }
        });
        expect(plan.tools).not.toContain("get_fair_value_scan");
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
        expect(response).not.toContain("ملخص أحدث البيانات المتاحة");
        expect(response).not.toContain("رأيي الفني:");
    });

    it("classifies a stock location without article boilerplate", () => {
        const response = buildDeterministicResponse("سهم جدوى حاليا فى اي منطقة", { ...basePlan, entities: { ...basePlan.entities, symbols: ["GDWA"] } }, [
            { tool: "get_stock", source: "database", data_time: "2026-08-06", symbols: ["GDWA"], data_type: "live", data: { symbol: "GDWA", name: "Gadwa", price: 0.816, change_pct: "-0.24%", rsi_14: "38.24", macd_signal: "0.0089", vol_ratio: "0.53x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-06", symbols: ["GDWA"], data_type: "live", data: { symbol: "GDWA", support: 0.756, resistance: 0.893, lookback_sessions: 60 } }
        ]);
        expect(response).toContain("منطقة حيادية للمراقبة");
        expect(response).not.toContain("مرحباً بكم في هذا المقال");
        expect(response).not.toContain("RSI عند 38.24");
    });

    it("routes a broad accumulation request to the accumulation scan", () => {
        const plan = buildDeterministicPlannerResult("اية الاسهم اللى عليها تجميع كبير الفترة الحالية وفرصتهم فالصعود عالية خلال فترة قريبه", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({ intent: "accumulation_distribution", tools: ["get_accumulation_stocks"], entities: { scan_direction: "accumulation" } });
        expect(plan.entities.min_acc_score).toBeUndefined();
    });

    it("keeps stock analysis when a compound request also has an empty scan", () => {
        const response = buildDeterministicResponse("انا شاري سهم RAYA ب 8.14 وهو قعد ينزل ابيعه بكام؟ واية الاسهم اللى عليها تجميع", { ...basePlan, entities: { ...basePlan.entities, symbols: ["RAYA"] }, tools: ["get_stock", "get_stock_levels", "get_accumulation_stocks"] }, [
            { tool: "get_stock", source: "database", data_time: "2026-08-06", symbols: ["RAYA"], data_type: "live", data: { symbol: "RAYA", name: "Raya", price: 7.42, change_pct: "-1.07%", rsi_14: "34.01", macd_signal: "0.0179", vol_ratio: "0.41x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-06", symbols: ["RAYA"], data_type: "live", data: { symbol: "RAYA", support: 7, resistance: 9, lookback_sessions: 60 } },
            { tool: "get_accumulation_stocks", source: "stock_scans_summary", data_time: "2026-07-27", symbols: [], data_type: "live", data: { stocks: [], scan_rows: [], direction: "accumulation" } }
        ]);
        expect(response).toContain("RAYA");
        expect(response).toContain("الدعم الحسابي (لسهم RAYA) 7.00");
        expect(response).not.toContain("لم أجد أي أسهم تطابق");
    });

    it("routes a five-session forecast to structured stock history", () => {
        const plan = buildDeterministicPlannerResult("توقعاتك ليه في ال5 جلسات القادمة جلاسكو", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({ intent: "stock_analysis", tools: ["get_stock", "get_stock_levels", "get_price_history"], entities: { symbols: ["BIOC"] } });
    });

    it("resolves a five-session forecast follow-up from session context", () => {
        const plan = buildDeterministicPlannerResult("ايوه تقعاته ايه ال5 جلسات الجاية", { current_symbol: "BIOC", last_symbols: ["BIOC"], summary: "تحليل جلاسكو" });
        expect(plan).toMatchObject({ intent: "stock_analysis", tools: ["get_stock", "get_stock_levels", "get_price_history"], entities: { symbols: ["BIOC"] } });
    });

    it("routes fifteen-session and year-end forecasts to structured price history", () => {
        const fifteen = buildDeterministicPlannerResult("توقعاتك ليه في ال15 يوم القادمة الشمس والمطاحن", { current_symbol: null, last_symbols: [], summary: null });
        expect(fifteen).toMatchObject({ intent: "stock_analysis", tools: ["get_stock", "get_stock_levels", "get_price_history"] });
        expect(fifteen.entities.symbols).toEqual(expect.arrayContaining(["ELSH", "AFMC"]));
        const yearEnd = buildDeterministicPlannerResult("elka متوقع يكون سعره كام اخر السنة", { current_symbol: null, last_symbols: [], summary: null });
        expect(yearEnd).toMatchObject({ intent: "stock_analysis", tools: ["get_stock", "get_stock_levels", "get_price_history"], entities: { symbols: ["ELKA"] } });
    });

    it("does not inherit a prior symbol for a broad accumulation scan", () => {
        const plan = buildDeterministicPlannerResult("ابعتلى الاسهم اللى ينطبق عليها الشروط دى درجة التجميع أعلى من 75", { current_symbol: "ELSH", last_symbols: ["ELSH"], summary: "تحليل ELSH" });
        expect(plan.entities.symbols).toEqual([]);
        expect(plan.tools).toEqual(["get_accumulation_stocks"]);
    });

    it("summarizes five-session expectations without inventing a future price", () => {
        const response = buildDeterministicResponse("توقعاتك ليه في ال5 جلسات القادمة جلاسكو", { ...basePlan, entities: { ...basePlan.entities, symbols: ["BIOC"] }, tools: ["get_stock", "get_stock_levels", "get_price_history"] }, [
            { tool: "get_stock", source: "database", data_time: "2026-08-06", symbols: ["BIOC"], data_type: "live", data: { symbol: "BIOC", price: 383, rsi_14: "60", vol_ratio: "1.20x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-06", symbols: ["BIOC"], data_type: "live", data: { symbol: "BIOC", support: 350, resistance: 410 } },
            { tool: "get_price_history", source: "stock_prices", data_time: "2026-08-06", symbols: ["BIOC"], data_type: "historical", data: { symbol: "BIOC", latest: { close: 383 }, recent_5_sessions: [{ close: 383 }, { close: 378 }, { close: 374 }, { close: 370 }, { close: 365 }] } }
        ]);
        expect(response).toContain("BIOC");
        expect(response).toContain("آخر 5 جلسات");
        expect(response).toContain("دعم 350.00");
        expect(response).toContain("لا يمكن تحديد سعر مؤكد");
    });

    it("answers an owned-stock sell question deterministically", () => {
        const response = buildDeterministicResponse("انا شاري سهم راية ب 8.14 وهو قعد ينزل ابيعه بكام ؟", { ...basePlan, entities: { ...basePlan.entities, symbols: ["RAYA"] }, tools: ["get_stock", "get_stock_levels"] }, [
            { tool: "get_stock", source: "database", data_time: "2026-08-06", symbols: ["RAYA"], data_type: "live", data: { symbol: "RAYA", price: 7.42, change_pct: "-1.07%", rsi_14: "34.01", macd_signal: "0.0179", vol_ratio: "0.41x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-06", symbols: ["RAYA"], data_type: "live", data: { symbol: "RAYA", support: 7, resistance: 9, lookback_sessions: 60 } }
        ]);
        expect(response).toContain("لا أستطيع اتخاذ قرار البيع");
        expect(response).toContain("الدعم الحسابي (لسهم RAYA) 7.00");
    });

    it("answers two Arabic stock names with compact ordered facts", () => {
        const response = buildDeterministicResponse("اى رائيك فى سهم المطاحن و الاسكندريه", { ...basePlan, entities: { ...basePlan.entities, symbols: ["AFMC", "ALCN"] }, tools: ["get_stock", "get_stock_levels"] }, [
            { tool: "get_stock", source: "database", data_time: "2026-08-06", symbols: ["AFMC"], data_type: "live", data: { symbol: "AFMC", name: "Alexandria Flour Mills", price: 224, change_pct: "-3.44%", rsi_14: "76.66", macd_signal: "25.8315", vol_ratio: "0.80x" } },
            { tool: "get_stock", source: "database", data_time: "2026-08-06", symbols: ["ALCN"], data_type: "live", data: { symbol: "ALCN", name: "Alexandria Containers", price: 30.7, change_pct: "-1.54%", rsi_14: "64.97", macd_signal: "0.2835", vol_ratio: "1.05x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-06", symbols: ["AFMC"], data_type: "live", data: { symbol: "AFMC", support: 66, resistance: 250, lookback_sessions: 60 } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-06", symbols: ["ALCN"], data_type: "live", data: { symbol: "ALCN", support: 25.51, resistance: 33.2, lookback_sessions: 60 } }
        ]);
        expect(response).toContain("AFMC");
        expect(response).toContain("ALCN");
        expect(response).not.toContain("عذراً، واجهنا صعوبة");
        expect(response).not.toContain("المستويات الفنية لـ");
    });

    it("answers greetings without inheriting stock context", () => {
        const response = buildDeterministicResponse("ازيك النهارده؟", { ...basePlan, intent: "general_chat", entities: { ...basePlan.entities, symbols: [] } }, []);
        expect(response).toContain("أهلاً");
        expect(response).not.toContain("CAED");
    });

    it("answers identity and model questions deterministically", () => {
        const plan = buildDeterministicPlannerResult("انتا موديل ايه", { current_symbol: "ABCD", last_symbols: ["ABCD"], summary: null });
        expect(plan.intent).toBe("general_chat");
        const response = buildDeterministicResponse("انتا مين", { ...basePlan, intent: "general_chat", entities: { ...basePlan.entities, symbols: [] } }, []);
        expect(response).toContain("مساعد EGX Bots");
        expect(response).not.toContain("لم أتمكن من إنشاء الرد");
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
        expect(response).toContain("لن أحدد سعراً للبيع");
        expect(response).not.toContain("سعر مستهدف 130");
    });

    it("includes support and resistance in a general stock answer", () => {
        const response = buildDeterministicResponse("شوف ABCD", { ...basePlan, entities: { ...basePlan.entities, symbols: ["ABCD"] } }, [
            { tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", price: 10, change_pct: "+1%", rsi_14: 50, macd_signal: 0, vol_ratio: "1x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", support: 8, resistance: 12, lookback_sessions: 60 } }
        ]);
        expect(response).toContain("الدعم 8.00");
        expect(response).toContain("المقاومة 12.00");
    });

    it("shows a bounded technical valuation without calling it intrinsic fair value", () => {
        const response = buildDeterministicResponse("ايه القيمة العادلة لـ ABCD؟", { ...basePlan, entities: { ...basePlan.entities, symbols: ["ABCD"] } }, [
            { tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", price: 10, rsi_14: 50 } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", support: 8, resistance: 12 } }
        ]);
        expect(response).toContain("نطاق التقييم الفني المرجعي 8.00 إلى 12.00 جنيه");
        expect(response).toContain("القيمة الوسطية الحسابية 10.00 جنيه");
        expect(response).toContain("ليس قيمة عادلة مالية");
    });

    it("keeps the fair-value scan market-wide and avoids previous stock context", () => {
        const message = "هات الاسهم اللي بتتداول فوق القيمة العادلة";
        expect(isMarketWideRequest(message)).toBe(true);
        expect(isFairValueScanRequest(message)).toBe(true);
        expect(enforceIntentFromMessage(message, "stock_analysis", ["ELSH"]).tools).toEqual(["get_fair_value_scan"]);
        const plan = buildDeterministicPlannerResult("ات الأسهم اللي بتتداول فوق القيمة العادلة", { current_symbol: "ELKA", last_symbols: ["ELKA"], summary: "تحليل ELKA" });
        expect(plan).toMatchObject({
            intent: "market_summary",
            entities: { symbols: [] },
            tools: ["get_fair_value_scan"]
        });
        expect(isFairValueScanRequest("هات الأسهم اللي بتتداول فوق القيمة العادلة ل")).toBe(true);
        expect(buildDeterministicPlannerResult("ات الأسهم اللي بتتداول فوق القيمة العادلة", { current_symbol: "ELKA", last_symbols: ["ELKA"], summary: "market" })?.tools).toEqual(["get_fair_value_scan"]);
    });

    it("treats broad weekly forecast questions as market-wide", () => {
        const message = "إيه السهم أو القطاع المتوقع يرتفع الأسبوع ده؟";
        expect(isMarketWideRequest(message)).toBe(true);
        const plan = buildDeterministicPlannerResult(message, {
            current_symbol: "ELKA",
            last_symbols: ["ELKA"],
            summary: "تحليل ELKA"
        });
        expect(plan.entities.symbols).toEqual([]);
    });

    it("preserves below-value and distribution filters instead of reversing them", () => {
        const message = "هات الأسهم اللي تحت القيمة العادلة وفيها تصريف";
        expect(isFairValueScanRequest(message)).toBe(true);
        expect(getFairValueFilters(message)).toEqual({ fair_value_direction: "below", require_distribution: true, require_accumulation: false });
        expect(enforceIntentFromMessage(message, "stock_analysis", ["KWIN"])).toMatchObject({
            tools: ["get_fair_value_scan"],
            fair_value_direction: "below",
            require_distribution: true
        });
        expect(buildDeterministicPlannerResult(message, { current_symbol: "KWIN", last_symbols: ["KWIN"], summary: "تحليل KWIN" })).toMatchObject({
            entities: { symbols: [], fair_value_direction: "below", require_distribution: true },
            tools: ["get_fair_value_scan"]
        });
    });

    it.each([
        ["عايز اشتري في سهم بعيد عن قطاع الادويه والبنوك ويكون في تجميع وتحت القيمه العادله", ["أدوية", "بنوك"], "below", true, false],
        ["هات سهم خارج العقارات أو الاتصالات وفيه تصريف وفوق القيمة الفنية", ["عقارات", "اتصالات"], "above", false, true],
        ["ابعد قطاع السياحة و النقل و الشحن، وعايز تجميع أقل من التقييم العادل", ["سياحة وخدمات استهلاكية", "نقل وشحن"], "below", true, false]
    ])("keeps dynamic fair-value constraints for: %s", (message, sectors, valueDirection, accumulation, distribution) => {
        expect(isFairValueScanRequest(message)).toBe(true);
        expect(extractExcludedSectors(message)).toEqual(sectors);
        const plan = buildDeterministicPlannerResult(message, { current_symbol: "COMI", last_symbols: ["COMI"], summary: "تحليل COMI" });
        expect(plan).toMatchObject({
            tools: ["get_fair_value_scan"],
            entities: {
                excluded_sectors: sectors,
                fair_value_direction: valueDirection,
                require_accumulation: accumulation,
                require_distribution: distribution
            }
        });
    });

    it("keeps an explicit stock as the scope of a fair-value scan", () => {
        const plan = buildDeterministicPlannerResult("هل COMI عليه تجميع وتحت القيمة العادلة؟", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan.tools).toEqual(["get_fair_value_scan"]);
        expect(plan.entities.symbols).toEqual(["COMI"]);
    });

    it("does not substitute price data for an unavailable earnings request", () => {
        const message = "قد إيه أرباح COMI الشهر اللي فات؟";
        expect(isEarningsDataRequest(message)).toBe(true);
        const plan = buildDeterministicPlannerResult(message, { current_symbol: "KWIN", last_symbols: ["KWIN"], summary: "تحليل KWIN" });
        expect(plan).toMatchObject({ entities: { symbols: ["COMI"] }, tools: [] });
        const response = buildDeterministicResponse(message, {
            ...basePlan,
            entities: { ...basePlan.entities, symbols: ["COMI"] }
        }, []);
        expect(response).toContain("لن أستبدل سؤال الأرباح بالسعر أو RSI");
    });

    it("distinguishes account quota from a stock daily price limit", () => {
        const message = "فاضل كام رسالة من الحد اليومي للشات؟";
        expect(isUsageLimitQuestion(message)).toBe(true);
        const plan = buildDeterministicPlannerResult(message, { current_symbol: "KWIN", last_symbols: ["KWIN"], summary: "تحليل KWIN" });
        expect(plan).toMatchObject({ intent: "general_chat", entities: { symbols: [] }, tools: [] });
        const response = buildDeterministicResponse(message, { ...basePlan, entities: { ...basePlan.entities, symbols: [] } }, []);
        expect(response).toContain("لن أستخدم بيانات سهم");
        const priceLimitPlan = buildDeterministicPlannerResult("طيب ده قريب من الحد اليومي؟", { current_symbol: "KWIN", last_symbols: ["KWIN"], summary: "تحليل KWIN" });
        expect(priceLimitPlan.entities.symbols).toContain("KWIN");
        expect(priceLimitPlan.tools).toContain("get_price_history");
        const missingPrevious = buildDeterministicResponse("ده قريب من الحد اليومي؟", {
            intent: "levels_analysis", confidence: 1, entities: { symbols: ["KWIN"], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_price_history"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        }, [{ tool: "get_price_history", source: "stock_prices", data_time: "2026-08-04", symbols: ["KWIN"], data_type: "historical", data: { symbol: "KWIN", latest: { close: 87.2 }, previous_close: null, upper_limit_20pct: null, lower_limit_20pct: null } }]);
        expect(missingPrevious).toContain("لا تحتوي بيانات الأسعار المتاحة على الحد السعري الفعلي");
        expect(missingPrevious).not.toContain("20%");
    });

    it("uses levels to frame a sell decision without deciding for the user", () => {
        const response = buildDeterministicResponse("أبيع ABCD ولا لا", { ...basePlan, entities: { ...basePlan.entities, symbols: ["ABCD"] } }, [
            { tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", price: 10, change_pct: "+1%", rsi_14: 50, macd_signal: 0, vol_ratio: "1x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", support: 8, resistance: 12, lookback_sessions: 60 } }
        ]);
        expect(response).toContain("كسر الدعم");
        expect(response).toContain("الاقتراب من المقاومة");
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
        expect(response).not.toContain("تم العثور على");
        expect(response).not.toContain("✅");
    });

    it("resolves alsh to ELSH in compound forecast and scan questions", () => {
        expect(extractExplicitSymbols("alsh")).toEqual(["ELSH"]);
        const plan = buildDeterministicPlannerResult("توقعاتك ليه في ال5 جلسات القادمة alsh", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan.entities.symbols).toEqual(["ELSH"]);
        expect(plan.tools).toEqual(["get_stock", "get_stock_levels", "get_price_history"]);
    });

    it("gives accumulation verdicts for all requested symbols in a multi-symbol comparison", () => {
        const response = buildDeterministicResponse("RAYA و COMI أيهما عليه تجميع أكبر؟", {
            ...basePlan,
            intent: "accumulation_distribution",
            entities: { ...basePlan.entities, symbols: ["RAYA", "COMI"], scan_direction: "accumulation" }
        }, [{
            tool: "get_accumulation_stocks", source: "stock_scans_summary", data_time: "2026-07-30", symbols: ["RAYA", "COMI"], data_type: "live",
            data: {
                direction: "accumulation",
                stocks: [
                    { symbol: "RAYA", signal: "accumulation", acc_score: 85, dist_score: 5, vol_ratio: 2.1, consecutive_acc_days: 4, wyckoff_phase: "strong_accumulation" },
                    { symbol: "COMI", signal: "accumulation", acc_score: 60, dist_score: 20, vol_ratio: 1.3, consecutive_acc_days: 2, wyckoff_phase: "accumulation" }
                ],
                scan_rows: [
                    { symbol: "RAYA", signal: "accumulation", acc_score: 85, dist_score: 5, vol_ratio: 2.1, consecutive_acc_days: 4, wyckoff_phase: "strong_accumulation" },
                    { symbol: "COMI", signal: "accumulation", acc_score: 60, dist_score: 20, vol_ratio: 1.3, consecutive_acc_days: 2, wyckoff_phase: "accumulation" }
                ]
            }
        }]);
        expect(response).toContain("RAYA");
        expect(response).toContain("COMI");
        expect(response).toContain("85/100");
        expect(response).toContain("60/100");
    });

    it("strips environment_details from compound and streamed responses", () => {
        const { sanitizeReply } = require("../ai/sanitizer");
        const leaked = "رد طبيعي\n<environment_details>\nCurrent time: 2026-08-08T21:59:15+03:00\nWorking directory: C:\\Users\\MR__CODER__\\Desktop\\stokscan_AI\nWorkspace root folder: C:\\Users\\MR__CODER__\\Desktop\\stokscan_AI\n</environment_details>";
        const cleaned = sanitizeReply(leaked);
        expect(cleaned).toContain("رد طبيعي");
        expect(cleaned).not.toContain("environment_details");
        expect(cleaned).not.toContain("Current time");
        expect(cleaned).not.toContain("Working directory");
        expect(cleaned).not.toContain("Workspace root folder");
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

    it("answers downside-risk follow-ups for the only stock in the previous scan", () => {
        expect(extractSingleStockFromRecentHistory([{ role: "assistant", content: "التصريف\n- EITP: درجة التصريف 66.5/100" }])).toBe("EITP");
        const response = buildDeterministicResponse("ممكن يخسر تاني اكتر من 8 EITP", {
            ...basePlan,
            intent: "risk_analysis",
            entities: { ...basePlan.entities, symbols: ["EITP"], scan_direction: "distribution" }
        }, [{
            tool: "get_stock", source: "database", data_time: "2026-07-29", symbols: ["EITP"], data_type: "live",
            data: { symbol: "EITP", price: 9, change_pct: 4.05, vol_ratio: 0.84, rsi_14: 53 }
        }, {
            tool: "get_distribution_stocks", source: "stock_scans_summary", data_time: "2026-07-27", symbols: ["EITP"], data_type: "live",
            data: { direction: "distribution", scan_rows: [{ symbol: "EITP", dist_score: 66.5, consecutive_dist_days: 1 }] }
        }]);
        expect(response).toContain("يمكن أن يخسر EITP أكثر من 8%");
        expect(response).toContain("66.5/100");
    });

    it("does not hardcode 8 percent or duplicate units in generic risk answers", () => {
        const response = buildDeterministicResponse("ممكن يخسر أكتر؟", { ...basePlan, intent: "risk_analysis", entities: { ...basePlan.entities, symbols: ["ABCD"] } }, [{ tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", change_pct: "+2.36%", vol_ratio: "1.01x", rsi_14: 59 } }]);
        expect(response).not.toContain("8%");
        expect(response).not.toContain("%%");
        expect(response).not.toContain("xx");
    });

    it("answers a broken-support follow-up from the stock level", () => {
        const response = buildDeterministicResponse("لو كسر الدعم أعمل ايه؟", { ...basePlan, intent: "levels_analysis", entities: { ...basePlan.entities, symbols: ["ABCD"] } }, [{ tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", support: 8, resistance: 12 } }]);
        expect(response).toContain("أسفل الدعم الحسابي 8.00");
        expect(response).not.toContain("أسهم التجميع");
    });

    it("routes and answers a sector-liquidity ranking with a defined metric", () => {
        expect(enforceIntentFromMessage("ايه اكبر قطاع فيه سيوله", "market_summary", [])).toEqual({ intent: "market_summary", tools: ["get_sector_liquidity"], replaceTools: true });
        const response = buildDeterministicResponse("ايه اكبر قطاع فيه سيوله", basePlan, [{
            tool: "get_sector_liquidity", source: "database", data_time: "2026-07-30", symbols: [], data_type: "live",
            data: { metric: "estimated_traded_value", sectors: [{ sector: "قطاع ألف", traded_value: 250000000, stock_count: 8 }, { sector: "قطاع باء", traded_value: 100000000, stock_count: 5 }] }
        }]);
        expect(response).toContain("قطاع ألف");
        expect(response).toContain("لا أستطيع اختيار سهم بعينه من ترتيب القطاعات وحده");
        expect(response).not.toContain("أسهم التجميع");
    });

    it("routes liquidity for a named sector without market-wide tools", () => {
        const plan = buildDeterministicPlannerResult("هات سيوله قطاع الادويه", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan.intent).toBe("sector_analysis");
        expect(plan.entities.sector).toBe("أدوية");
        expect(plan.tools).toEqual(["get_sector_liquidity"]);
        expect(plan.tools).not.toContain("get_market");
        expect(plan.tools).not.toContain("get_accumulation_stocks");
    });

    it("identifies EGX weekend dates and explains the fallback session", () => {
        expect(isEgxWeekend("2026-07-31")).toBe(true);
        expect(isEgxWeekend("2026-08-01")).toBe(true);
        expect(isEgxWeekend("2026-07-30")).toBe(false);
        expect(describeDatedFallback("2026-07-31", "2026-07-30")).toContain("عطلة أسبوعية");
    });

    it("routes a finance sector follow-up to sector analysis", () => {
        const plan = buildDeterministicPlannerResult("اى اكبر سهم في القطاع ده", { current_symbol: null, last_symbols: [], summary: "Finance" });
        expect(plan).toMatchObject({ intent: "sector_analysis", entities: { sector: "Finance", symbols: [] }, tools: ["get_sector"] });
    });

    it("routes and answers a request for all recorded sectors", () => {
        const plan = buildDeterministicPlannerResult("هات قايمه بالقطاعات كلها", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan.tools).toEqual(["get_sector_list"]);
        const response = buildDeterministicResponse("هات قايمه بالقطاعات كلها", { ...basePlan, intent: "sector_analysis" }, [{ tool: "get_sector_list", source: "stock_fundamentals", data_time: "2026-08-01", symbols: [], data_type: "live", data: { sectors: [{ sector: "Finance", stock_count: 12 }, { sector: "Healthcare", stock_count: 8 }] } }]);
        expect(response).toContain("بنوك وخدمات مالية (12 سهم)");
        expect(response).toContain("Healthcare (8 سهم)");
    });

    it("treats a listed English sector as a follow-up sector analysis", () => {
        const plan = buildDeterministicPlannerResult("Process Industries", { current_symbol: null, last_symbols: [], summary: "قائمة القطاعات" });
        expect(plan.intent).toBe("sector_analysis");
        expect(plan.entities.sector).toBe("Process Industries");
        expect(plan.tools).toEqual(["get_sector"]);
    });

    it("routes support and resistance questions to levels data", () => {
        const plan = buildDeterministicPlannerResult("ABCD اى مقواماته ودعمه", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan.intent).toBe("levels_analysis");
        expect(plan.tools).toEqual(["get_stock_levels"]);
    });

    it("answers support and resistance for every requested stock", () => {
        const response = buildDeterministicResponse("ABCD مقاومته ودعمه؟ EFGH مقاومته كام؟", { ...basePlan, intent: "levels_analysis", entities: { ...basePlan.entities, symbols: ["ABCD", "EFGH"] } }, [
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", close: 10, support: 8, resistance: 12, lookback_sessions: 60 } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["EFGH"], data_type: "live", data: { symbol: "EFGH", close: 20, support: 18, resistance: 24, lookback_sessions: 60 } }
        ]);
        expect(response).toContain("ABCD: الدعم الحسابي 8.00");
        expect(response).toContain("EFGH: الدعم الحسابي 18.00");
        expect(response).toContain("المقاومة الحسابية 24.00");
    });

    it("combines deterministic results for several questions in one message", () => {
        const response = buildDeterministicResponse("حلل ABCD\nهات أخباره\nلو كسر الدعم أعمل إيه؟", { ...basePlan, entities: { ...basePlan.entities, symbols: ["ABCD"] } }, [
            { tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", price: 10, change_pct: 1, rsi_14: 50, vol_ratio: 1 } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", support: 8, resistance: 12 } },
            { tool: "get_news", source: "database", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: [] }
        ]);
        expect(response).toContain("ABCD: السعر 10");
        expect(response).toContain("الدعم 8.00");
        expect(response).toContain("الأخبار: لا توجد أخبار");
    });

    it("includes the broken-support action in a compound response", () => {
        const response = buildDeterministicResponse("حلل ABCD\nلو كسر الدعم أعمل إيه؟", { ...basePlan, entities: { ...basePlan.entities, symbols: ["ABCD"] } }, [
            { tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", price: 10 } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["ABCD"], data_type: "live", data: { symbol: "ABCD", support: 8, resistance: 12 } }
        ]);
        expect(response).toContain("كسر الدعم عند 8.00");
    });

    it("resolves a stock-news follow-up to the active stock", () => {
        const plan = buildDeterministicPlannerResult("هات اخباره", { current_symbol: "ABCD", last_symbols: ["ABCD"], summary: "ABCD اى مقواماته ودعمه" });
        expect(plan.entities.symbols).toEqual(["ABCD"]);
        expect(plan.tools).toEqual(["get_news"]);
        expect(plan.session_update.current_symbol).toBe("ABCD");
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

    it("answers top movers from gainers instead of the liquidity summary", () => {
        const tools = { formattedText: "", results: [{ tool: "get_market", source: "database", data_time: "2026-07-30", symbols: [], data_type: "live", data: { top_gainers: [{ symbol: "ABCD", name: "Example", change: 7.5 }] } }] };
        const response = buildTopMoversResponse(tools);
        expect(response).toContain("ABCD");
        expect(response).toContain("+7.50%");
        expect(response).not.toContain("أسهم التجميع");
    });

    it("returns a deterministic no-data answer when market cache has no gainers", () => {
        const response = buildTopMoversResponse({ formattedText: "", results: [{ tool: "get_market", source: "database", data_time: "2026-07-30", symbols: [], data_type: "live", data: { egx30: 123, top_gainers: [] } }] });
        expect(response).toContain("لا توجد بيانات تغير يومي كافية");
        expect(response).not.toContain("لم أتمكن من إنشاء الرد");
    });

    it("routes the last-session top-movers wording", () => {
        const plan = buildDeterministicPlannerResult("أقوى الأسهم لاخر يوم", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan.tools).toEqual(["get_market"]);
    });

    it("sanitizes suggested-button labels without adding the disclaimer", () => {
        expect(sanitizeUiLabel("أقوى الأسهم النهارده ✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار")).toBe("أقوى الأسهم النهارده");
        expect(sanitizeUiLabel("مقارنة\n<environment_details>Current time: secret")).toBe("مقارنة");
        expect(sanitizeUiLabel("أقوى\n<environment_details\nCurrent time: secret")).toBe("أقوى");
        expect(sanitizeUiLabel("رد سليم\nenvironment_details\nWorking directory: secret")).toBe("رد سليم");
    });

    it("keeps a generic stock lookup separate from accumulation scans", () => {
        expect(enforceIntentFromMessage("شوف ABCD", "stock_analysis", ["ABCD"])).toEqual({ intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true });
        expect(enforceIntentFromMessage("ABCD عليه تجميع؟", "stock_analysis", ["ABCD"]).tools).toEqual(["get_accumulation_stocks"]);
    });

    it("routes a dated stock analysis to stock data and preserves the date", () => {
        const plan = buildDeterministicPlannerResult("تحليل AMES يوم 2026-07-10", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({
            intent: "stock_analysis",
            tools: ["get_stock", "get_stock_levels"],
            entities: { symbols: ["AMES"], requested_date: "2026-07-10", timeframe: "historical" }
        });
    });

    it("resolves a dated follow-up to the active stock", () => {
        const plan = buildDeterministicPlannerResult("هاته بتاريخ 10/7", { current_symbol: "AALR", last_symbols: ["AALR"], summary: null });
        expect(plan.entities.symbols).toEqual(["AALR"]);
        expect(plan.entities.requested_date).toBe(`${new Date().getFullYear()}-07-10`);
        expect(plan.tools).toEqual(["get_stock", "get_stock_levels"]);
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

    it("builds an exportable sector-liquidity table", () => {
        const tables = buildExcelTables([{
            tool: "get_sector_liquidity", source: "database", data_time: "2026-07-30", symbols: [], data_type: "live",
            data: { sectors: [{ sector: "قطاع ألف", traded_value: 250000000, stock_count: 8, average_volume_ratio: 1.4 }] }
        }], null);
        expect(tables[0].title).toBe("سيولة القطاعات");
        expect(tables[0].rows[0]).toContain("قطاع ألف");
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
        expect(plan.tools).toEqual(["get_stock", "get_stock_levels"]);
    });

    it("resolves the requested Arabic stock names without inheriting BIOC", () => {
        expect(extractExplicitSymbols("ممكن العبور للاستثمار وجنوب الوادى وفوري")).toEqual(expect.arrayContaining(["FWRY", "OBRI", "SVCE"]));
        expect(extractExplicitSymbols("سهم جلاكسو ينصح الدخول فيه بكرة ولا قرب يصحح ومستهدف كام")).toEqual(["BIOC"]);
        const plan = buildDeterministicPlannerResult("سهم جلاكسو ينصح الدخول فيه بكرة ولا قرب يصحح ومستهدف كام", { current_symbol: "AALR", last_symbols: ["AALR"], summary: "توصيات سابقة" });
        expect(plan).toMatchObject({
            intent: "stock_analysis",
            entities: { symbols: ["BIOC"] },
            tools: ["get_stock", "get_stock_levels"]
        });
        expect(plan.tools).not.toContain("get_recommendations");
    });

    it("keeps a multi-stock Arabic request out of stale sector context", () => {
        const plan = buildDeterministicPlannerResult("ممكن العبور للاستثمار وجنوب الوادى وفوري", { current_symbol: "ELSH", last_symbols: ["ELSH"], summary: "Finance" });
        expect(plan).toMatchObject({
            intent: "stock_analysis",
            tools: ["get_stock", "get_stock_levels"]
        });
        expect(plan.entities.symbols).toEqual(expect.arrayContaining(["FWRY", "OBRI", "SVCE"]));
        expect(plan.intent).not.toBe("sector_analysis");
        expect(extractExplicitSymbols("ممكن العبور للاستثمار وجنوب الوادى وفوري")).toEqual(expect.arrayContaining(["FWRY", "OBRI", "SVCE"]));
    });

    it("does not turn an explicit pharma stock question into a sector scan", () => {
        const plan = buildDeterministicPlannerResult("ما رايكم في ابن سينا فارما للادويه", { current_symbol: "ETEL", last_symbols: ["ETEL"], summary: "قطاع أدوية" });
        expect(plan.entities.symbols).toEqual(["ISPH"]);
        expect(plan.entities.sector).toBeNull();
        expect(plan.intent).toBe("stock_analysis");
        expect(plan.tools).not.toContain("get_sector");
    });

    it("does not reduce a beginner portfolio question to a greeting", () => {
        const message = "السلام عليكم، معنديش أي خبرة مع الأسهم ولا عارف ابني محفظة قوية ازاي؟";
        const plan = buildDeterministicPlannerResult(message, { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({ intent: "general_chat", tools: [] });
        const response = buildDeterministicResponse(message, {
            intent: "general_chat", confidence: 1, entities: { symbols: [], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: false, needs_historical_data: false,
            tools: [], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        }, []);
        expect(response).toContain("صندوق طوارئ");
        expect(response).toContain("ابدأ بنسبة صغيرة");
    });

    it("guides a first-day market beginner deterministically", () => {
        const message = "انا اول يوم ليا فى البورصه وعايز افهم اعمل اى";
        const plan = buildDeterministicPlannerResult(message, { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({ intent: "general_chat", tools: [] });
        const response = buildDeterministicResponse(message, {
            intent: "general_chat", confidence: 1, entities: { symbols: [], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: false, needs_historical_data: false,
            tools: [], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        }, []);
        expect(response).toContain("ابدأ بنسبة صغيرة");
    });

    it("explains that Thndr CLOUD is not an EGX stock", () => {
        const response = buildDeterministicResponse("مقارنة CLOUD مع COMI", {
            intent: "comparison", confidence: 1, entities: { symbols: ["COMI"], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_comparison"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        }, []);
        expect(response).toContain("ليس رمز سهم EGX");
        expect(response).not.toContain("لم أتمكن");
    });

    it("explains a stock drop from available data without inventing news", () => {
        const response = buildDeterministicResponse("ما سبب هبوط سهم القلعة", {
            intent: "stock_news", confidence: 1, entities: { symbols: ["CCAP"], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_stock", "get_stock_levels"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        }, [
            { tool: "get_stock", source: "database", data_time: "2026-08-03", symbols: ["CCAP"], data_type: "live", data: { symbol: "CCAP", price: 5.23, change_pct: "-2.61%", rsi_14: 44.63, vol_ratio: "0.51x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-03", symbols: ["CCAP"], data_type: "live", data: { symbol: "CCAP", support: 4.47, resistance: 5.78 } }
        ]);
        expect(response).toContain("لا توجد في البيانات الحالية أخبار مؤكدة");
        expect(response).toContain("انخفاض حجم التداول");
        expect(response).not.toContain("environment_details");
    });

    it("keeps CLOUD comparison from falling through to a model failure", () => {
        const response = buildDeterministicResponse("مقارنة CLOUD مع COMI", {
            intent: "comparison", confidence: 1, entities: { symbols: ["COMI"], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_comparison"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        }, []);
        expect(response).toContain("ليس رمز سهم EGX");
    });

    it("answers target and correction questions from actual levels", () => {
        const response = buildDeterministicResponse("سهم جلاكسو ينصح الدخول فيه بكرة ولا قرب يصحح ومستهدف كام", {
            intent: "stock_analysis", confidence: 1, entities: { symbols: ["BIOC"], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_stock", "get_stock_levels"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        }, [
            { tool: "get_stock", source: "database", data_time: "2026-07-30", symbols: ["BIOC"], data_type: "live", data: { symbol: "BIOC", price: 239.76, change_pct: "+20.00%", rsi_14: "90.39", vol_ratio: "2.16x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-07-30", symbols: ["BIOC"], data_type: "live", data: { symbol: "BIOC", support: 66.48, resistance: 239.76 } }
        ]);
        expect(response).toContain("تشبع شرائي مرتفع");
        expect(response).toContain("المقاومة الحسابية الحالية 239.76");
        expect(response).toContain("ليست مستهدفاً جديداً مضموناً");
        expect(response).not.toContain("ربح غير محقق");
    });

    it("resolves a three-stock portfolio question and refuses an invented week-end value", () => {
        expect(extractExplicitSymbols("داخل بكرة في جلاكسو وايبكو ومطاحن اسكندرية باتنين مليون")).toEqual(expect.arrayContaining(["BIOC", "PHAR", "AFMC"]));
        const plan = {
            intent: "stock_analysis", confidence: 1, entities: { symbols: ["BIOC", "PHAR", "AFMC"], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_stock", "get_stock_levels"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };
        const response = buildDeterministicResponse("داخل بكرة في جلاكسو وايبكو ومطاحن اسكندرية باتنين مليون ممكن يبقوا على كام اخر الاسبوع", plan, [
            { tool: "get_stock", source: "database", data_time: "2026-08-02", symbols: ["BIOC"], data_type: "live", data: { symbol: "BIOC", price: 287.71, change_pct: "+20%", rsi_14: 92.2, vol_ratio: "1.88x" } },
            { tool: "get_stock", source: "database", data_time: "2026-08-02", symbols: ["PHAR"], data_type: "live", data: { symbol: "PHAR", price: 50, change_pct: "+2%", rsi_14: 60, vol_ratio: "1.1x" } },
            { tool: "get_stock", source: "database", data_time: "2026-08-02", symbols: ["AFMC"], data_type: "live", data: { symbol: "AFMC", price: 184.78, change_pct: "+19.99%", rsi_14: 89.41, vol_ratio: "2.88x" } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-02", symbols: ["BIOC"], data_type: "live", data: { symbol: "BIOC", support: 100, resistance: 287.71 } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-02", symbols: ["PHAR"], data_type: "live", data: { symbol: "PHAR", support: 45, resistance: 55 } },
            { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-08-02", symbols: ["AFMC"], data_type: "live", data: { symbol: "AFMC", support: 120, resistance: 184.78 } }
        ]);
        expect(response).toContain("BIOC:");
        expect(response).toContain("PHAR:");
        expect(response).toContain("AFMC:");
        expect(response).toContain("لا توجد بيانات مستقبلية موثقة");
        expect(response).not.toMatch(/2[.,]?[0-9]+ مليون/);
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
        expect(result.tools).toEqual(["get_stock", "get_stock_levels"]);
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

    it("strips environment details appended directly to normal text", () => {
        const response = sanitizeReply("كمل<environment_details>\nCurrent time: secret");
        expect(response).toContain("كمل");
        expect(response).not.toContain("environment_details");
        expect(response).not.toContain("\\.");
    });

    it("resolves NINH and strips pasted development logs", () => {
        expect(extractExplicitSymbols("رأيك في سهم مستشفى النزهة")).toContain("NINH");
        expect(sanitizeReply("سؤال طبيعي\nSignals Backend URL: http://127.0.0.1:8000\n✓ Compiled /admin")).not.toContain("Backend URL");
    });

    it("routes advanced follow-ups without leaking stale stock context", () => {
        expect(extractExplicitSymbols("جدوى ماشية ازاي")).toContain("GDWA");
        expect(isFairValueScanRequest("هات الاسهم اللي تحت القيمة الفنية وفيها تصريف")).toBe(true);
        expect(getFairValueFilters("هات الاسهم اللي تحت القيمة الفنية وفيها تصريف")).toEqual({ fair_value_direction: "below", require_distribution: true, require_accumulation: false });
        expect(getFairValueFilters("تحت القيمة مع تجميع")).toEqual({ fair_value_direction: "below", require_distribution: false, require_accumulation: true });
        expect(getFairValueFilters("هات الاسهم اللى عليها تجميع وتبقى تحدت القيمه العادله")).toEqual({ fair_value_direction: "below", require_distribution: false, require_accumulation: true });
        expect(buildDeterministicPlannerResult("هات الاسهم اللى عليها تجميع وتبقى تحدت القيمه العادله", { current_symbol: null, last_symbols: [], summary: null })).toMatchObject({
            intent: "market_summary",
            tools: ["get_fair_value_scan"],
            entities: { fair_value_direction: "below", require_accumulation: true }
        });
        const sectorPlan = buildDeterministicPlannerResult("البنوك حالتها ايه", { current_symbol: "COMI", last_symbols: ["COMI"], summary: "COMI" });
        expect(sectorPlan.session_update.current_symbol).toBeNull();
        const limitPlan = buildDeterministicPlannerResult("طيب ده قريب من الحد اليومي؟", { current_symbol: "KWIN", last_symbols: ["KWIN"], summary: "KWIN" });
        expect(limitPlan.tools).toEqual(expect.arrayContaining(["get_price_history"]));
        expect(limitPlan.entities.symbols).toContain("KWIN");
        const oldestPlan = buildDeterministicPlannerResult("هات أقدم توصية عندك", { current_symbol: "KWIN", last_symbols: ["KWIN"], summary: "KWIN" });
        expect(oldestPlan.tools).toEqual(["get_recommendations"]);
        expect(oldestPlan.entities.symbols).toEqual([]);
        expect(oldestPlan.entities.recommendation_order).toBe("oldest");
    });

    it("scopes a singular owned-stock follow-up to the current stock", () => {
        expect(scopeImplicitSingleStockRequest(
            "شريت انهارده ونزل هل في امل انو يطلع حد يفيدني",
            [],
            ["BIOC", "ETEL"],
            "BIOC",
            "ETEL"
        )).toEqual(["BIOC"]);
        expect(scopeImplicitSingleStockRequest("حللهم", [], ["BIOC", "ETEL"], "BIOC", null)).toEqual(["BIOC", "ETEL"]);
    });

    it("routes a sector comparison to market-wide sector liquidity only", () => {
        const message = "إيه رأيك في قطاع العقارات هل أحسن من الأدوية أو الاتصالات";
        const enforced = enforceIntentFromMessage(message, "sector_analysis", []);
        expect(enforced).toEqual({ intent: "sector_analysis", tools: ["get_sector_liquidity"], replaceTools: true, sector: null, requested_sectors: ["أدوية", "عقارات", "اتصالات"] });
        const plan = buildDeterministicPlannerResult(message, { current_symbol: "BIOC", last_symbols: ["BIOC", "ETEL"], summary: "BIOC" });
        expect(plan.tools).toEqual(["get_sector_liquidity"]);
        expect(plan.entities.symbols).toEqual([]);
        expect(plan.entities.sector).toBeNull();
        expect(plan.entities.requested_sectors).toEqual(["أدوية", "عقارات", "اتصالات"]);
    });

    it("does not inherit the previous stock for a sector-liquidity question", () => {
        const message = "السيوله فى انهو قطاع";
        expect(isMarketWideRequest(message)).toBe(true);
        const enforced = enforceIntentFromMessage(message, "stock_analysis", ["ATQA"]);
        expect(enforced).toEqual({ intent: "market_summary", tools: ["get_sector_liquidity"], replaceTools: true });
        const plan = buildDeterministicPlannerResult(message, { current_symbol: "ATQA", last_symbols: ["ATQA"], summary: "حلل عتاقه" });
        expect(plan).toMatchObject({ intent: "market_summary", tools: ["get_sector_liquidity"], entities: { symbols: [], sector: null } });
    });

    it("summarizes only the sectors explicitly requested for comparison", () => {
        const plan = {
            intent: "sector_analysis", confidence: 1,
            entities: { symbols: [], sector: null, timeframe: "current", reference: null, requested_sectors: ["عقارات", "أدوية", "اتصالات"] },
            needs_live_data: true, needs_historical_data: false, needs_vision_context: false, needs_history: false,
            tools: ["get_sector_liquidity"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };
        const response = buildDeterministicResponse("هل العقارات أحسن من الأدوية أو الاتصالات؟", plan, [{
            tool: "get_sector_liquidity", source: "database", data_time: "2026-08-11", symbols: [], data_type: "live",
            data: {
                requested_sectors: ["عقارات", "أدوية", "اتصالات"],
                sectors: [
                    { sector: "Health Technology", traded_value: 3000000000, stock_count: 11, average_volume_ratio: 1.74 },
                    { sector: "Consumer Durables", traded_value: 400000000, stock_count: 7, average_volume_ratio: 0.69 },
                    { sector: "Communications", traded_value: 300000000, stock_count: 2, average_volume_ratio: 1.32 }
                ]
            }
        }]);
        expect(response).toContain("مقارنة السيولة بين عقارات وأدوية واتصالات");
        expect(response).toContain("الأفضل هنا يعني الأقوى سيولة");
        expect(response).not.toContain("البنوك والخدمات المالية");
    });

    it("routes construction liquidity and refuses unsupported causal claims", () => {
        const plan = buildDeterministicPlannerResult("هى ليه السيوله عاليه فى قطاع الانشاءات", { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({ intent: "sector_analysis", tools: ["get_sector_liquidity"], entities: { sector: "مواد بناء وتعدين" } });
        const response = buildDeterministicResponse("هى ليه السيوله عاليه فى قطاع الانشاءات", plan, [{
            tool: "get_sector_liquidity", source: "database", data_time: "2026-08-11", symbols: [], data_type: "live",
            data: { sectors: [{ sector: "Non-Energy Minerals", traded_value: 3000000000, stock_count: 10, average_volume_ratio: 4.72 }], requested_sector: "مواد بناء وتعدين" }
        }]);
        expect(response).toContain("لا يثبت سبب الارتفاع وحده");
        expect(response).not.toContain("نتائج أعمال قوية");
        expect(response).not.toContain("عقود حكومية");
    });

    it("finishes a multi-stock analysis instead of repeating a fallback", () => {
        const plan = {
            intent: "stock_analysis", confidence: 1,
            entities: { symbols: ["ALCN", "ABUK", "ATQA"], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_stock", "get_stock_levels"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };
        const results = ["ALCN", "ABUK", "ATQA"].map((symbol, index) => ({
            tool: "get_stock", source: "database", data_time: "2026-08-11", symbols: [symbol], data_type: "live",
            data: { symbol, price: [31.1, 74.6, 10.97][index], change_pct: ["+1.30%", "+1.29%", "+2.52%"][index], rsi_14: [65.24, 57.25, 79.2][index], macd_signal: [0.37, -0.05, 0.13][index], vol_ratio: [0.71, 0.65, 4.22][index] }
        }));
        const response = buildDeterministicResponse("حلل ابو قير وعتاقه والاسكندريه", plan, results);
        expect(response).toContain("ملخص فني مختصر");
        expect(response).toContain("ALCN:");
        expect(response).toContain("ABUK:");
        expect(response).toContain("ATQA:");
        expect(response.split("\n").length).toBeLessThanOrEqual(6);
    });

    it("does not repeat an incomplete stock fallback after continue", () => {
        const plan = buildDeterministicPlannerResult("كمل", { current_symbol: "ALCN", last_symbols: ["ALCN", "ABUK", "ATQA"], summary: "تحليل عدة أسهم" });
        expect(plan.intent).toBe("general_chat");
        expect(buildDeterministicResponse("كمل", plan, [])).toContain("التحليل السابق مكتمل");
    });

    it("keeps the last sector for liquidity and news follow-ups", () => {
        const state = { current_symbol: null, last_symbols: [], current_sector: "أدوية", summary: "هات سيولة قطاع الأدوية" };
        const why = buildDeterministicPlannerResult("ليه السيولة عالية؟", state);
        expect(why).toMatchObject({ intent: "sector_analysis", tools: ["get_sector_liquidity"], entities: { sector: "أدوية" } });

        const news = buildDeterministicPlannerResult("هات قائمة بالأخبار المتعلقة بالقطاع", state);
        expect(news).toMatchObject({ intent: "sector_analysis", tools: ["get_news"], entities: { sector: "أدوية" } });
        expect(news.entities.symbols).toEqual([]);
    });

    it("does not treat a stock or market mover list as sector news", () => {
        const plan = buildDeterministicPlannerResult("هات قائمة بالأخبار المتعلقة بالقطاع", {
            current_symbol: "ATQA", last_symbols: ["ATQA"], current_sector: null, summary: "أقوى الأسهم النهارده"
        });
        expect(plan).toBeNull();
    });

    it("sanitizes an environment block even when it is the whole response", () => {
        const { sanitizeReply } = require("../ai/sanitizer");
        const cleaned = sanitizeReply("<environment_details>\nCurrent time: secret\nWorking directory: secret\nWorkspace root folder: secret\n</environment_details>");
        expect(cleaned).not.toMatch(/environment_details|Current time:|Working directory:|Workspace root folder:/i);
    });

    it("rejects stale accumulation scans as a current verdict", () => {
        const plan = {
            intent: "accumulation_distribution", confidence: 1,
            entities: { symbols: ["CPME"], sector: null, timeframe: "current", reference: null, scan_direction: "accumulation" },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_accumulation_stocks"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };
        const response = buildDeterministicResponse(
            "هل سهم CPME في مرحلة تجميع أم تصريف؟",
            plan,
            [{
                tool: "get_accumulation_stocks", source: "validation", data_time: "2026-07-27", symbols: ["CPME"], data_type: "live",
                data: { direction: "accumulation", stocks: [], scan_rows: [], validation: { ok: false, reason: "stale", ageDays: 15 } }
            }]
        );
        expect(response).toContain("قديم ولا يصلح لوصف الحالة الحالية");
        expect(response).toContain("2026-07-27");
        expect(response).not.toContain("توجد إشارة التجميع");
    });

    it("asks for the strength criterion and treats Thndr as a platform", () => {
        const strongest = buildDeterministicPlannerResult("أقوى الأسهم", { current_symbol: null, last_symbols: [], summary: null });
        expect(strongest.intent).toBe("clarification");
        expect(buildDeterministicResponse("أقوى الأسهم", {
            intent: "clarification",
            confidence: 1,
            entities: { symbols: [], sector: null, timeframe: "current", reference: null },
            needs_vision_context: false,
            needs_history: false,
            needs_live_data: false,
            needs_historical_data: false,
            tools: [],
            clarification_needed: true,
            resolved_from: { symbol: null, message_id: null }
        }, [])).toContain("بأي معيار");
        expect(getInvestorGuidanceIntent("إيه فرص الاستثمار لمدخراتي النهارده على ثندر؟")).toBe("allocation");
        expect(sanitizePlannerTools("إيه فرص الاستثمار النهارده؟", ["get_market", "get_recommendations", "get_signals"])).toEqual(["get_market"]);
        expect(sanitizePlannerTools("هات أقدم توصية", ["get_recommendations"])).toEqual(["get_recommendations"]);
    });
});

describe("Beginner investing guidance", () => {
    const emptyPlan = {
        intent: "general_chat",
        confidence: 1,
        entities: { symbols: [], sector: null, timeframe: "current", reference: null },
        needs_vision_context: false,
        needs_history: false,
        needs_live_data: false,
        needs_historical_data: false,
        tools: [],
        clarification_needed: false,
        resolved_from: { symbol: null, message_id: null }
    };

    it("routes a novice portfolio question to educational guidance without market tools", () => {
        const message = "السلام عليكم، عندي فلوس في صناديق دخل ثابت على ثاندر ومعنديش خبرة بالأسهم، أبني محفظة ازاي؟";
        expect(isBeginnerPortfolioQuestion(message)).toBe(true);
        const plan = buildDeterministicPlannerResult(message, { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({ intent: "general_chat", tools: [] });
        const messages = buildV2FinalMessages(message, { ...emptyPlan, guidance_intent: "allocation" }, null, [], [], [], { symbol: null, message_id: null, confidence: 0 });
        expect(messages[1].content).toContain("RESPONSE MODE: INVESTOR EDUCATION");
        expect(messages[1].content).toContain("لا تحوّل الإشارات أو البيانات التاريخية إلى توصية شخصية");
    });

    it("does not interpret CLOUD as an EGX ticker in a product-versus-stock comparison", () => {
        const message = "مقارنة CLOUD مع COMI";
        expect(isNonEquityProductComparison(message)).toBe(true);
        expect(extractExplicitSymbols(message)).toEqual(["COMI"]);
        const plan = buildDeterministicPlannerResult(message, { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({ intent: "general_chat", tools: [] });
        const messages = buildV2FinalMessages(message, { ...emptyPlan, guidance_intent: "product_comparison" }, null, [], [], [], { symbol: null, message_id: null, confidence: 0 });
        expect(messages[1].content).toContain("لا تقارن بينهما بسعر السهم أو RSI");
    });

    it.each([
        ["عايز أبدأ استثمار ومش فاهم الأسهم", "onboarding"],
        ["معايا 20 ألف أوزعهم على إيه؟", "allocation"],
        ["أسيب فلوسي في صندوق دخل ثابت ولا أشتري سهم COMI؟", "product_comparison"],
        ["صندوق الدخل الثابت بيشتغل إزاي ومخاطره إيه؟", "product_explainer"]
    ])("classifies related investor question: %s", (message, intent) => {
        expect(getInvestorGuidanceIntent(message)).toBe(intent);
        const plan = buildDeterministicPlannerResult(message, { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({ intent: "general_chat", tools: [] });
        expect(buildDeterministicResponse(message, emptyPlan, [])).toBeNull();
    });

    it("prioritizes portfolio allocation over a plain accumulation scan when allocating large capital to end of year", () => {
        const message = "عندي نصف مليون أوزعها في أسهم فيها تجميع لنهاية السنة";
        expect(getInvestorGuidanceIntent(message)).toBe("allocation");
        const plan = buildDeterministicPlannerResult(message, { current_symbol: null, last_symbols: [], summary: null });
        expect(plan).toMatchObject({
            intent: "general_chat",
            tools: ["get_accumulation_stocks"],
            entities: { scan_direction: "accumulation" }
        });
        const messages = buildV2FinalMessages(message, { ...emptyPlan, guidance_intent: "allocation" }, null, [], [], [], { symbol: null, message_id: null, confidence: 0 });
        expect(messages[1].content).toContain("RESPONSE MODE: INVESTOR EDUCATION");
        expect(messages[1].content).toContain("نصف مليون أو 500 ألف");
    });

    it("resolves group reference pronouns (فيهم/منهم) to last_symbols instead of treating allocation as generic", () => {
        const message = "أي أحسن واحد فيهم الأيام دي أحط فيه 100 ألف؟";
        const session = { current_symbol: "ZEOT", last_symbols: ["AFMC", "AALR", "TAQA", "ATQA", "ZEOT"], summary: null };
        const plan = buildDeterministicPlannerResult(message, session);
        expect(plan.entities.symbols).toEqual(["AFMC", "AALR", "TAQA", "ATQA", "ZEOT"]);
        expect(plan.intent).not.toBe("general_chat");
    });

    it("routes 'best stock to buy tomorrow' queries deterministically without stalling planner models", () => {
        const message = "ايه افضل سهم للشراء بكره ان شاء الله";
        const session = { current_symbol: null, last_symbols: [], summary: null };
        const plan = buildDeterministicPlannerResult(message, session);
        expect(plan).toMatchObject({
            intent: "market_summary",
            tools: expect.arrayContaining(["get_recommendations", "get_fair_value_scan"])
        });
    });

    it("explains missing top-mover data and suggests a safe next step", () => {
        const response = buildTopMoversResponse({
            results: [{ tool: "get_market", data_time: "2026-08-03", data_type: "live", source: "database", symbols: ["EGX30"], data: { egx30: 54094.3 } }],
            formattedText: ""
        });
        expect(response).toContain("لن أضع أسماء أو نسباً مخمّنة");
        expect(response).toContain("إعادة الطلب بعد تحديث بيانات الجلسة");
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
