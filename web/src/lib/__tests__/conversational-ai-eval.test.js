import { extractInvestorPreferences, fuzzyArabicIntentMatch, isBestBuyStockQuestion, isTermsDefinitionRequest } from "../ai/intent-policy";
import { buildDeterministicPlannerResult } from "../ai/pipeline";
import { buildV2FinalMessages, buildFastConversationalAdvisorResponse, buildDeterministicResponse } from "../ai/final-v2";
import { sanitizeReply } from "../ai/sanitizer";

describe("Conversational AI & Investor Preference Memory Evaluation", () => {
    describe("1. Investor Preference Extraction (extractInvestorPreferences)", () => {
        test("does not inflate an explicit amount stated in جنيه", () => {
            expect(extractInvestorPreferences("معايا 500 جنيه").budget).toBe(500);
            expect(extractInvestorPreferences("معايا 500 ألف جنيه").budget).toBe(500000);
            expect(extractInvestorPreferences("وزعها على 3 أسهم لمدة 60 يوم").budget).toBeNull();
            expect(extractInvestorPreferences("استثمر 500 ألف جنيه بـ3 أسهم").budget).toBe(500000);
        });
        test("extracts budget, horizon, risk tolerance, and sector accurately from Arabic natural language", () => {
            const msg1 = "معايا 100 ألف جنيه وعايز أستثمرهم على سنة في قطاع العقارات ومخاطرتي متوازنة";
            const res1 = extractInvestorPreferences(msg1);
            expect(res1.budget).toBe(100000);
            expect(res1.horizon).toBe("medium_term");
            expect(res1.risk_tolerance).toBe("medium");
            expect(res1.sector).toBe("العقارات");
        });

        test("handles colloquial phrases like نص مليون & مضاربة سريعة", () => {
            const msg2 = "معايا نص مليون جنيه وعايز مضاربة سريعة مخاطرة عالية في قطاع البنوك";
            const res2 = extractInvestorPreferences(msg2);
            expect(res2.budget).toBe(500000);
            expect(res2.horizon).toBe("short_term");
            expect(res2.risk_tolerance).toBe("high");
            expect(res2.sector).toBe("البنوك");
        });

        test("extracts low risk and long term preferences", () => {
            const msg3 = "عندي 50000 جنيه واستثمرهم على سنتين بدون مخاطرة بعيد عن الريسك";
            const res3 = extractInvestorPreferences(msg3);
            expect(res3.budget).toBe(50000);
            expect(res3.horizon).toBe("long_term");
            expect(res3.risk_tolerance).toBe("low");
        });
    });

    describe("2. Multi-turn Session Preference Accumulation", () => {
        test("progressively accumulates investor attributes over multi-turn conversation", () => {
            let sessionState = {
                current_symbol: null,
                last_symbols: [],
                summary: null,
                investment_budget: null,
                investment_horizon: null,
                risk_tolerance: null,
                preferred_sectors: []
            };

            // Turn 1: User specifies budget and sector
            const turn1Msg = "معايا 200 الف ومستهدف قطاع العقارات";
            const pref1 = extractInvestorPreferences(turn1Msg);
            sessionState = {
                ...sessionState,
                investment_budget: pref1.budget ?? sessionState.investment_budget,
                investment_horizon: pref1.horizon ?? sessionState.investment_horizon,
                risk_tolerance: pref1.risk_tolerance ?? sessionState.risk_tolerance,
                preferred_sectors: pref1.sector ? [...sessionState.preferred_sectors, pref1.sector] : sessionState.preferred_sectors
            };

            expect(sessionState.investment_budget).toBe(200000);
            expect(sessionState.preferred_sectors).toContain("العقارات");

            // Turn 2: User specifies horizon and risk in follow up
            const turn2Msg = "عايزها على سنة وبدون مخاطرة كبيرة";
            const pref2 = extractInvestorPreferences(turn2Msg);
            sessionState = {
                ...sessionState,
                investment_budget: pref2.budget ?? sessionState.investment_budget,
                investment_horizon: pref2.horizon ?? sessionState.investment_horizon,
                risk_tolerance: pref2.risk_tolerance ?? sessionState.risk_tolerance,
                preferred_sectors: pref2.sector ? [...sessionState.preferred_sectors, pref2.sector] : sessionState.preferred_sectors
            };

            expect(sessionState.investment_budget).toBe(200000);
            expect(sessionState.investment_horizon).toBe("medium_term");
            expect(sessionState.risk_tolerance).toBe("low");
            expect(sessionState.preferred_sectors).toContain("العقارات");
        });
    });

    describe("3. Flexible Intent Matching (fuzzyArabicIntentMatch & isBestBuyStockQuestion)", () => {
        test("keeps compliments and finance definitions conversational", () => {
            const emptyState = { current_symbol: "PHAR", last_symbols: ["PHAR", "ELSH"], summary: "comparison" };
            expect(buildDeterministicPlannerResult("جدع", emptyState)).toMatchObject({ intent: "general_chat", tools: [] });
            expect(buildDeterministicPlannerResult("عرف التجميع والجمعية العمومية", emptyState)).toMatchObject({ intent: "general_chat", tools: [] });
        });

        test("does not invent an allocation between previously compared stocks", () => {
            const plan = buildDeterministicPlannerResult("لو معايا 100 ألف احطهم فى مين فيهم", {
                current_symbol: "PHAR", last_symbols: ["PHAR", "ELSH"], summary: "شوف سهم الشمس و ايبكو"
            });
            expect(plan).toMatchObject({ intent: "comparison", guidance_intent: "allocation", tools: ["get_stock", "get_stock_levels"] });
            expect(plan.entities.symbols).toEqual(["PHAR", "ELSH"]);
        });
        test("detects best buy intent across diverse Arabic phrasings", () => {
            expect(isBestBuyStockQuestion("مين ادخله بكره ؟")).toBe(true);
            expect(isBestBuyStockQuestion("ايه افضل سهم للشراء بكره ان شاء الله")).toBe(true);
            expect(isBestBuyStockQuestion("أشتري في مين النهاردة")).toBe(true);
            expect(isBestBuyStockQuestion("ادخل في مين من الأسهم")).toBe(true);
        });

        test("performs fuzzy matching on Arabic finance terms", () => {
            expect(fuzzyArabicIntentMatch("عايز سهم فيه زخم قوي", ["زخم", "سيولة"])).toBe(true);
            expect(fuzzyArabicIntentMatch("هل السهم في منطقة تجميع فنية؟", ["تجميع", "تصريف"])).toBe(true);
        });
    });

    describe("4. Conversational LLM Message Construction (buildV2FinalMessages)", () => {
        test("injects INVESTOR PROFILE & SESSION CONTEXT when sessionState has profile data", () => {
            const mockPlan = {
                intent: "market_summary",
                confidence: 0.95,
                entities: { symbols: [], sector: null, timeframe: "unspecified", reference: null },
                needs_vision_context: false,
                needs_history: false,
                needs_live_data: true,
                needs_historical_data: false,
                tools: ["get_recommendations"],
                clarification_needed: false,
                resolved_from: { symbol: null, message_id: null }
            };

            const mockSessionState = {
                current_symbol: null,
                last_symbols: ["COMI"],
                summary: null,
                investment_budget: 300000,
                investment_horizon: "medium_term",
                risk_tolerance: "medium",
                preferred_sectors: ["العقارات", "البنوك"]
            };

            const messages = buildV2FinalMessages(
                "ايه افضل سهم للشراء بكره ان شاء الله",
                mockPlan,
                null,
                [],
                [],
                [],
                { symbol: null, message_id: null, confidence: 0 },
                mockSessionState
            );

            const userPromptContent = messages.find(m => m.role === "user")?.content || "";
            expect(userPromptContent).toContain("=== INVESTOR PROFILE & SESSION CONTEXT ===");
            expect(userPromptContent).toContain("جنيه مصري");
            expect(userPromptContent).toContain("استثمار متوسط الأجل");
            expect(userPromptContent).toContain("مخاطرة متوازنة");
            expect(userPromptContent).toContain("العقارات، البنوك");
            expect(userPromptContent).toContain("كُن مساعداً حوارياً ذكياً، ودواداً، ومحاوراً حقيقياً");
        });
    });

    describe("5. Exact Telemetry Scenario Verification (Fast Response & No Timeout)", () => {
        test("handles sector purchase follow up and allocation ratio queries instantly without timeouts", () => {
            const mockSession = {
                current_symbol: null,
                last_symbols: [],
                summary: "قطاع العقارات",
                investment_budget: 200000,
                investment_horizon: "medium_term",
                risk_tolerance: "medium",
                preferred_sectors: ["العقارات"]
            };

            const mockToolResults = [{
                tool: "get_sector",
                source: "stock_prices",
                data_time: "2026-08-05",
                symbols: ["UTOP", "AALR", "EMFD"],
                data_type: "live",
                data: {
                    sector: "عقارات",
                    stocks: [
                        { symbol: "UTOP", close: 118.83, change_pct: 10, rsi: 89.75 },
                        { symbol: "AALR", close: 303.07, change_pct: 9.81, rsi: 73.41 },
                        { symbol: "EMFD", close: 12.1, change_pct: 5.31, rsi: 56.02 }
                    ]
                }
            }];

            const mockPlan = {
                intent: "sector_analysis",
                confidence: 1,
                entities: { symbols: [], sector: "العقارات", timeframe: "current" },
                needs_live_data: true,
                tools: ["get_sector"]
            };

            // Query 2: "طيب أشتري إيه من القطاع ده بناءً على الأرقام الحالية؟"
            const res2 = buildFastConversationalAdvisorResponse(
                "طيب أشتري إيه من القطاع ده بناءً على الأرقام الحالية؟",
                mockPlan,
                mockToolResults,
                mockSession
            );
            expect(res2).not.toBeNull();
            expect(res2).toContain("UTOP");
            expect(res2).toContain("AALR");
            expect(res2).toContain("EMFD");
            expect(res2).toContain("إدارة المخاطر");

            // Query 3: "لو هوزع المبلغ ده، تنصحني بأي نسبة بين الأسهم والصناديق؟"
            const res3 = buildFastConversationalAdvisorResponse(
                "لو هوزع المبلغ ده، تنصحني بأي نسبة بين الأسهم والصناديق؟",
                mockPlan,
                mockToolResults,
                mockSession
            );
            expect(res3).not.toBeNull();
            expect(res3).toContain("إطار التوزيع الاسترشادي المقترح");
            expect(res3).toContain("50% أسهم");
            expect(res3).toContain("35% أدوات دخل ثابت");
        });
    });

    describe("6. Financial Terms Definition Intent Verification", () => {
        test("correctly handles multi-concept definition request without triggering stock scans", () => {
            const message = "عرف التجميع والجمعيه العموميه والتصريف و ال macd";
            const mockPlan = {
                intent: "general_chat",
                guidance_intent: "terms_explainer",
                confidence: 1,
                entities: { symbols: [], sector: null, timeframe: "current" },
                tools: []
            };

            const response = buildFastConversationalAdvisorResponse(message, mockPlan, [], null);
            expect(response).not.toBeNull();
            expect(response).toContain("التجميع");
            expect(response).toContain("الجمعية العمومية");
            expect(response).toContain("التصريف");
            expect(response).toContain("مؤشر MACD");
            expect(response).not.toContain("EITP");
        });

        test("correctly identifies short follow-up term request like 'و rsi' as terms definition", () => {
            const message = "و rsi";
            expect(isTermsDefinitionRequest(message)).toBe(true);
        });
    });

    describe("6. Evidence-bound advisor responses", () => {
        test("answers compliments and definitions without repeating the previous analysis", () => {
            const generalPlan = { intent: "general_chat", confidence: 1, entities: { symbols: [], sector: null, timeframe: "current" }, needs_live_data: false, tools: [] };
            expect(buildDeterministicResponse("جدع", generalPlan, [])).toContain("تسلم");
            const definition = buildDeterministicResponse("عرف التجميع والجمعية العمومية", generalPlan, []);
            expect(definition).toContain("التجميع");
            expect(definition).toContain("الجمعية العمومية");
        });
        test("strips image-provider errors and internal prompt headings from model output", () => {
            const dirty = "ERROR: Cannot read image.png (this model does not support image input).\n=== USER REQUEST ===\nحسناً. لا توجد صورة مرفقة في طلبك.\nسأقوم بتحليل البيانات المتاحة.\nالنتيجة الموثقة.";
            const clean = sanitizeReply(dirty);
            expect(clean).toContain("النتيجة الموثقة");
            expect(clean).not.toContain("image.png");
            expect(clean).not.toContain("USER REQUEST");
            expect(clean).not.toContain("لا توجد صورة مرفقة");
        });
        test("does not invent accumulation, liquidity, support, or fixed stop-loss facts", () => {
            const response = buildFastConversationalAdvisorResponse(
                "أشتري إيه من القطاع ده؟",
                { intent: "sector_analysis", guidance_intent: null, confidence: 1, entities: { symbols: [], sector: "العقارات", timeframe: "current" }, needs_live_data: true, tools: ["get_sector"] },
                [{ tool: "get_sector", source: "stock_prices", data_time: "2026-08-05", symbols: ["EMFD"], data_type: "live", data: { stocks: [{ symbol: "EMFD", close: 12.1, change_pct: 1.2, rsi: 55 }] } }],
                null
            );
            expect(response).toContain("RSI عند 55.0");
            expect(response).not.toContain("إشارات تجميع");
            expect(response).not.toContain("وقف الخسارة بنسبة 3%");
            expect(response).not.toContain("فوق مستويات الدعم");
        });

        test("reads the nested tech shape returned by get_sector", () => {
            const response = buildFastConversationalAdvisorResponse(
                "أشتري إيه من القطاع ده؟",
                { intent: "sector_analysis", guidance_intent: null, confidence: 1, entities: { symbols: [], sector: "العقارات", timeframe: "current" }, needs_live_data: true, tools: ["get_sector"] },
                [{ tool: "get_sector", source: "database", data_time: "2026-08-05", symbols: ["EMFD"], data_type: "live", data: { stocks: [{ symbol: "EMFD", tech: { close: 12.1, change_pct: 1.2, rsi_14: 55, volume: 200, vol_sma20: 100 } }] } }],
                null
            );
            expect(response).toContain("السعر 12.10 جنيه");
            expect(response).toContain("RSI عند 55.0");
            expect(response).toContain("حجم التداول 2.00x");
            expect(response).not.toContain("NaN");
        });

        test("reports negative premium as below the midpoint", () => {
            const response = buildDeterministicResponse(
                "أسهم تحت القيمة العادلة",
                { intent: "market_summary", confidence: 1, entities: { symbols: [], sector: null, timeframe: "current", fair_value_direction: "below" }, needs_live_data: true, needs_historical_data: false, tools: ["get_fair_value_scan"] },
                [{ tool: "get_fair_value_scan", source: "stock_prices", data_time: "2026-08-05", symbols: ["EMFD"], data_type: "live", data: { direction: "below", stocks: [{ symbol: "EMFD", close: 9, midpoint: 10, premium_pct: -10 }] } }]
            );
            expect(response).toContain("أقل منها بـ 10.0%");
        });

        test("does not describe a failed fair-value intersection as an empty market result", () => {
            const plan = { intent: "market_summary", confidence: 1, entities: { symbols: [], sector: null, timeframe: "current", fair_value_direction: "below", require_accumulation: true }, needs_live_data: true, needs_historical_data: false, tools: ["get_fair_value_scan"] };
            const failed = buildDeterministicResponse(
                "هات أسهم عليها تجميع وتحت القيمة العادلة",
                plan,
                [{ tool: "get_fair_value_scan", source: "error", data_time: "2026-08-06", symbols: [], data_type: "live", data: { direction: "below", require_accumulation: true, stocks: [] }, error: "timeout" }]
            );
            expect(failed).toContain("تعذر إكمال المسح");
            expect(failed).not.toContain("لا توجد حالياً نتائج موثقة");

            const stale = buildDeterministicResponse(
                "هات أسهم عليها تجميع وتحت القيمة العادلة",
                plan,
                [{ tool: "get_fair_value_scan", source: "validation", data_time: "2026-07-27", symbols: [], data_type: "live", data: { direction: "below", require_accumulation: true, stocks: [], validation: { ok: false, reason: "stale" } } }]
            );
            expect(stale).toContain("لم تجتز فحص الحداثة");
        });
    });
});
