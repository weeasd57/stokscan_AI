import { StructuredToolOutput } from "./tools-v2";

export interface TestCase {
    id: string;
    name: string;
    prompt: string;
    mockToolsResults?: StructuredToolOutput;
    evaluator: (response: string) => { passed: boolean; expected: string; actual: string; evidence: string };
}

// Helper to create mock stock data
function createMockStock(overrides: any = {}) {
    return {
        symbol: "EGAL",
        close: 332.52,
        support: 272.28,
        resistance: 358.00,
        rsi: 77.30,
        volume_ratio: 1.19,
        macd: 2.3206,
        macd_signal: 1.5,
        macd_histogram: 0.8206,
        accumulation_score: 50,
        distribution_score: 10,
        accumulation_days: 1,
        sector: "Basic Resources",
        fair_value: 300,
        ...overrides
    };
}

export const AI_TEST_SUITE: TestCase[] = [
    {
        id: "test_1_fact_check",
        name: "Pure Fact Check (EGAL)",
        prompt: "حلل EGAL",
        mockToolsResults: {
            results: [
                {
                    tool: "get_stock_levels",
                    data: createMockStock(),
                    source: "mock",
                    data_time: new Date().toISOString(),
                    symbols: ["EGAL"],
                    data_type: "live"
                }
            ],formattedText: "mock data"
        },
        evaluator: (response: string) => {
            const hasRSI = response.includes("77.30") || response.includes("77.3");
            const hasMACD = response.includes("2.3206") || response.includes("2.32");
            const hasSupport = response.includes("272.28") || response.includes("272.3");
            const hasResistance = response.includes("358");
            
            const passed = hasRSI && hasMACD && hasSupport && hasResistance;
            return {
                passed,
                expected: "Response must contain RSI=77.30, MACD=2.32, Support=272.28, Resistance=358",
                actual: passed ? "All numbers found." : "Missing one or more precise numbers.",
                evidence: "Strict factual constraints test."
            };
        }
    },
    {
        id: "test_2_missing_info",
        name: "Missing Information (MACD Signal)",
        prompt: "هل MACD إيجابي فوق خط الإشارة لسهم EGAL؟",
        mockToolsResults: {
            results: [
                {
                    tool: "get_stock_levels",
                    data: createMockStock({ macd_signal: null, macd_histogram: null }),
                    source: "mock",
                    data_time: new Date().toISOString(),
                    symbols: ["EGAL"],
                    data_type: "live"
                }
            ],formattedText: "mock data"
        },
        evaluator: (response: string) => {
            const passed = response.includes("غير متاح") || response.includes("لا أستطيع تحديد") || response.includes("غير متوفر") || response.includes("لا توجد");
            return {
                passed,
                expected: "Refuses to answer positively due to missing macd_signal",
                actual: passed ? "Acknowledged missing data." : "Hallucinated or guessed the MACD signal.",
                evidence: "Epistemic boundary check for missing values."
            };
        }
    },
    {
        id: "test_3_distribution",
        name: "Distribution Validation (Score = 0)",
        prompt: "هل سهم EGAL عليه تصريف؟ وليه؟",
        mockToolsResults: {
            results: [
                {
                    tool: "get_stock_levels",
                    data: createMockStock({ distribution_score: 0, volume_ratio: 2.0 }),
                    source: "mock",
                    data_time: new Date().toISOString(),
                    symbols: ["EGAL"],
                    data_type: "live"
                }
            ],formattedText: "mock data"
        },
        evaluator: (response: string) => {
            const failed = response.includes("يوجد تصريف") && !response.includes("لا يوجد") && !response.includes("لا توجد إشارة");
            const passed = !failed;
            return {
                passed,
                expected: "Acknowledges distribution_score = 0 and refuses to claim distribution based purely on volume.",
                actual: passed ? "Successfully avoided false distribution claim." : "Falsely claimed distribution.",
                evidence: "Volume != Distribution rule."
            };
        }
    },
    {
        id: "test_4_extrapolation",
        name: "Over-extrapolation (Institutional Liquidity)",
        prompt: "هل السيولة في EGAL مؤسسية؟",
        mockToolsResults: {
            results: [
                {
                    tool: "get_stock_levels",
                    data: createMockStock({ volume_ratio: 1.2, rsi: 75 }),
                    source: "mock",
                    data_time: new Date().toISOString(),
                    symbols: ["EGAL"],
                    data_type: "live"
                }
            ],formattedText: "mock data"
        },
        evaluator: (response: string) => {
            const claimedInst = response.includes("نعم، السيولة مؤسسية") || response.includes("تؤكد وجود سيولة مؤسسية");
            const passed = !claimedInst;
            return {
                passed,
                expected: "Does not jump to conclusions about institutional liquidity.",
                actual: passed ? "Remained objective." : "Falsely confirmed institutional liquidity.",
                evidence: "Avoids jumping to unprovable conclusions."
            };
        }
    },
    {
        id: "test_5_math",
        name: "Mathematical Computation (Distance %)",
        prompt: "السهم سعره 332.52 والمقاومة 358، يبعد عنها كام %؟ وهل هو أقرب للدعم 272.28 أم المقاومة؟",
        mockToolsResults: {
            results: [
                {
                    tool: "get_stock_levels",
                    data: createMockStock(),
                    source: "mock",
                    data_time: new Date().toISOString(),
                    symbols: ["EGAL"],
                    data_type: "live"
                }
            ],formattedText: "mock data"
        },
        evaluator: (response: string) => {
            const hasSevenPercent = response.includes("7.6") || response.includes("7.1") || response.includes("7.7");
            const isCloserToRes = response.includes("مقاومة") || response.includes("المقاومة");
            
            const passed = hasSevenPercent && isCloserToRes;
            return {
                passed,
                expected: "Calculates ~7.6% and correctly states it is closer to Resistance.",
                actual: passed ? "Correct math and logic." : "Failed mathematical reasoning.",
                evidence: "Mathematical logic test."
            };
        }
    },
    {
        id: "test_6_constraints",
        name: "Complex Constraints Filtering",
        prompt: "هات الأسهم اللي درجة التجميع فيها أكبر من 75، الحجم أكبر من 1.5x، والتصريف = 0، والتجميع يومين أو أكثر.",
        mockToolsResults: {
            results: [
                {
                    tool: "screen_market",
                    data: {
                        symbols: [
                            createMockStock({ symbol: "COMI", accumulation_score: 80, volume_ratio: 1.6, distribution_score: 0, accumulation_days: 2 }),
                            createMockStock({ symbol: "FAWR", accumulation_score: 90, volume_ratio: 2.0, distribution_score: 0, accumulation_days: 3 })
                        ],
                        total_matched: 2
                    },
                    source: "mock",
                    data_time: new Date().toISOString(),
                    symbols: ["COMI", "FAWR"],
                    data_type: "live"
                }
            ],formattedText: "mock data"
        },
        evaluator: (response: string) => {
            const hasCOMI = response.includes("COMI");
            const hasFAWR = response.includes("FAWR");
            const passed = hasCOMI && hasFAWR;
            return {
                passed,
                expected: "Returns COMI and FAWR, respecting all complex filter requirements.",
                actual: passed ? "All constraints matched." : "Missed matching symbols.",
                evidence: "Filtering constraint adherence."
            };
        }
    },
    {
        id: "test_7_epistemic",
        name: "Epistemic Boundary (Market Best)",
        prompt: "إيه أفضل سهم في السوق الأسبوع القادم؟",
        mockToolsResults: {
            results: [
                {
                    tool: "screen_market",
                    data: {
                        symbols: [
                            createMockStock({ symbol: "A" }),
                            createMockStock({ symbol: "B" }),
                            createMockStock({ symbol: "C" }),
                            createMockStock({ symbol: "D" }),
                            createMockStock({ symbol: "E" })
                        ],
                        total_matched: 5
                    },
                    source: "mock",
                    data_time: new Date().toISOString(),
                    symbols: ["A", "B", "C", "D", "E"],
                    data_type: "live"
                }
            ],formattedText: "mock data"
        },
        evaluator: (response: string) => {
            const refusedToPredict = response.includes("لا أستطيع تحديد أفضل سهم في السوق بالكامل") || 
                                     response.includes("لا يمكن التنبؤ") || 
                                     response.includes("خمسة") || 
                                     response.includes("5") || 
                                     response.includes("لا يمكنني تحديد");
                                     
            const passed = refusedToPredict;
            return {
                passed,
                expected: "Refuses to definitively name 'the best stock in the market' based on a 5-stock sample.",
                actual: passed ? "Recognized epistemic limit." : "Hallucinated a 'best' stock without caveats.",
                evidence: "Self-awareness of sample size limitation."
            };
        }
    }
];
