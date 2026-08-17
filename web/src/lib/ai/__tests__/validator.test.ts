import { describe, it, expect } from "@jest/globals";
import {
    validateResponse,
    validateDeterministicRules,
    isVerifiableDerivedMetric,
    autoFixNumbers
} from "../validator";
import { buildEvidenceEnginePromptBlock } from "../final-v2";
import type { ToolResult } from "../types";

const aalrToolResults = [
    {
        data: {
            symbol: "AALR",
            price: 310,
            rsi_14: 67.88,
            support: 290,
            resistance: 325.5,
        },
    },
];

describe("validator deterministic rules & semantic verification", () => {
    it("accepts a correct reply with decimal RSI and resistance values", () => {
        const reply =
            "سهم AALR يتداول عند سعر 310 جنيه. مؤشر القوة النسبية RSI يسجل 67.88 مقترباً من مناطق التشبع الشرائي. المقاومة الرئيسية عند 325.5 والدعم عند 290.";
        const errors = validateDeterministicRules(reply, aalrToolResults, "حلل سهم AALR");
        expect(errors).toEqual([]);
    });

    it("accepts Arabic decimal separator in values", () => {
        const reply = "مؤشر RSI لسهم AALR عند 67٫88 والمقاومة عند 325٫5.";
        const errors = validateDeterministicRules(reply, aalrToolResults, "حلل سهم AALR");
        expect(errors).toEqual([]);
    });

    it("accepts rounded RSI and resistance values", () => {
        const reply = "RSI لسهم AALR قرب 68 بينما المقاومة عند 326.";
        const errors = validateDeterministicRules(reply, aalrToolResults, "حلل سهم AALR");
        expect(errors).toEqual([]);
    });

    it("does not flag non-RSI numbers (>100) inside an RSI sentence", () => {
        const reply = "مؤشر RSI يظهر تشبع شرائي لسهم AALR الذي يتداول قرب 310 جنيه.";
        const errors = validateDeterministicRules(reply, aalrToolResults, "حلل سهم AALR");
        expect(errors).toEqual([]);
    });

    it("still detects a genuinely wrong RSI claim", () => {
        const reply = "مؤشر القوة النسبية RSI لسهم AALR يسجل 42 فقط.";
        const errors = validateDeterministicRules(reply, aalrToolResults, "حلل سهم AALR");
        expect(errors.length).toBeGreaterThan(0);
    });

    it("verifies mathematically derived formulas accurately", () => {
        const facts = { price: 120.78, support: 45.15, resistance: 144.94, rsi: 54.31 };
        expect(isVerifiableDerivedMetric(167.51, facts)).toBe(true);
        expect(isVerifiableDerivedMetric(16.67, facts)).toBe(true);
        expect(isVerifiableDerivedMetric(93.45, facts)).toBe(false);
    });

    it("safely auto-fixes exact current price rounding when strictly bound", () => {
        const reply = "السعر الحالي هو 120.7 جنيه لسهم AMES.";
        const amesFacts = [{ data: { symbol: "AMES", price: 120.78 } }];
        const fixed = autoFixNumbers(reply, amesFacts);
        expect(fixed).toContain("120.78");
    });

    it("validateResponse passes a fully correct reply with derived percentages", () => {
        const reply =
            "سهم AALR يتداول حالياً عند سعر 310 جنيه، ومؤشر القوة النسبية يساوي 67.88 مما يشير إلى قوة شرائية واضحة، بينما يقع الدعم الرئيسي عند 290 جنيه وتتمركز المقاومة عند 325.5 جنيه بمسافة 4.76% من السعر.";
        const liveData = JSON.stringify(aalrToolResults[0].data);
        const result = validateResponse(reply, liveData, ["AALR"], aalrToolResults, "حلل سهم AALR");
        expect(result.deterministicErrors).toEqual([]);
        expect(result.suspiciousNumbers).toEqual([]);
        expect(result.isValid).toBe(true);
    });
});

describe("validator: Evidence Verifier Checks 1-4", () => {
    const scanToolResults = [
        {
            tool: "get_distribution_stocks",
            data: {
                stocks: [
                    { symbol: "AALR", dist_score: 0, acc_score: 0, wyckoff_phase: "neutral", signal: "neutral" }
                ]
            }
        }
    ];

    const accScanToolResults = [
        {
            tool: "get_accumulation_stocks",
            data: {
                stocks: [
                    { symbol: "AALR", dist_score: 0, acc_score: 80, wyckoff_phase: "accumulation", signal: "accumulation" }
                ]
            }
        }
    ];

    const distScanToolResults = [
        {
            tool: "get_distribution_stocks",
            data: {
                stocks: [
                    { symbol: "AALR", dist_score: 75, acc_score: 10, wyckoff_phase: "distribution", signal: "distribution" }
                ]
            }
        }
    ];

    it("CHECK 1: rejects MACD signal line claim when macd_signal is null", () => {
        const reply = "سهم AALR فوق خط الإشارة لأن MACD إيجابي.";
        const errors = validateDeterministicRules(reply, aalrToolResults);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.includes("خط الإشارة"))).toBe(true);
    });

    it("CHECK 2: rejects distribution claim when no evidence exists", () => {
        const reply = "سهم AALR في مرحلة تصريف.";
        const errors = validateDeterministicRules(reply, [...aalrToolResults, ...scanToolResults]);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.includes("توزيعية"))).toBe(true);
    });

    it("CHECK 2: rejects distribution claim when dist_score=0 and phase=neutral", () => {
        const reply = "سيولة توزيعية لسهم AALR.";
        const errors = validateDeterministicRules(reply, [...aalrToolResults, ...scanToolResults]);
        expect(errors.length).toBeGreaterThan(0);
    });

    it("CHECK 3: rejects accumulation claim when no evidence exists", () => {
        const reply = "سيولة تجميعية لسهم AALR.";
        const errors = validateDeterministicRules(reply, [...aalrToolResults, ...scanToolResults]);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.includes("تجميعية"))).toBe(true);
    });

    it("CHECK 3: accepts accumulation claim when acc_score>0 and phase=accumulation", () => {
        const reply = "سهم AALR في مرحلة تجميع.";
        const errors = validateDeterministicRules(reply, [...aalrToolResults, ...accScanToolResults]);
        expect(errors.filter(e => e.includes("تجميعية")).length).toBe(0);
    });

    it("CHECK 4: rejects phase conflict - claiming distribution when data shows accumulation", () => {
        const reply = "سهم AALR في مرحلة تصريف.";
        const errors = validateDeterministicRules(reply, [...aalrToolResults, ...accScanToolResults]);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.includes("تعارض"))).toBe(true);
    });

    it("CHECK 4: rejects phase conflict - claiming accumulation when data shows distribution", () => {
        const reply = "سهم AALR في مرحلة تجميع.";
        const errors = validateDeterministicRules(reply, [...aalrToolResults, ...distScanToolResults]);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.includes("تعارض"))).toBe(true);
    });

    it("accepts correct distribution claim when evidence is present", () => {
        const reply = "سهم AALR في مرحلة تصريف.";
        const errors = validateDeterministicRules(reply, [...aalrToolResults, ...distScanToolResults]);
        expect(errors.filter(e => e.includes("توزيعية") || e.includes("تعارض")).length).toBe(0);
    });

    it("rejects implicit inference 'ضغط بيعي' without evidence", () => {
        const reply = "حجم تداول سهم AALR أعلى من المتوسط مما يشير إلى ضغط بيعي.";
        const errors = validateDeterministicRules(reply, aalrToolResults);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.includes("توزيعية"))).toBe(true);
    });

    it("rejects implicit inference 'نشاط شرائي' without evidence", () => {
        const reply = "حجم تداول سهم AALR أعلى من المتوسط مما يشير إلى نشاط شرائي.";
        const errors = validateDeterministicRules(reply, aalrToolResults);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.includes("تجميعية"))).toBe(true);
    });

    it("handles multi-symbol replies correctly", () => {
        const multiToolResults = [
            { data: { symbol: "AALR", price: 310, rsi_14: 67.88, support: 290, resistance: 325.5 } },
            { data: { symbol: "AMES", price: 120.78, rsi_14: 54.31, support: 100, resistance: 140 } }
        ];
        const reply = "سهم AALR يتداول عند 310، وسهم AMES يتداول عند 120.78.";
        const errors = validateDeterministicRules(reply, multiToolResults);
        expect(errors).toEqual([]);
    });
});

describe("validator: autoFixNumbers derived metrics", () => {
    it("fixes derived percentage from support", () => {
        const reply = "السهم ارتفع حوالي 7.59% من مستوى الدعم.";
        const facts = [{ data: { symbol: "TEST", price: 310, support: 288.54 } }];
        const fixed = autoFixNumbers(reply, facts);
        // ((310 - 288.54) / 288.54) * 100 = 7.4376% ≈ 7.44%
        expect(fixed).toContain("7.44");
    });

    it("fixes derived percentage from resistance", () => {
        const reply = "السهم انخفض حوالي 5.00% من مستوى المقاومة.";
        const facts = [{ data: { symbol: "TEST", price: 310, resistance: 326.32 } }];
        const fixed = autoFixNumbers(reply, facts);
        expect(fixed).toContain("5.00");
    });
});

describe("validator: buildEvidenceEnginePromptBlock", () => {
    it("generates evidence block for stock+scan results", () => {
        const toolResults: ToolResult[] = [
            { tool: "get_stock", source: "database", data_time: "2026-08-17", symbols: ["AALR"], data_type: "live", data: { symbol: "AALR", price: 310, rsi_14: 67.88, macd: 2.32, macd_signal: null, vol_ratio: 1.19 } },
            { tool: "get_accumulation_stocks", source: "database", data_time: "2026-08-17", symbols: ["AALR"], data_type: "live", data: { stocks: [{ symbol: "AALR", acc_score: 80, dist_score: 10, wyckoff_phase: "accumulation", consecutive_acc_days: 3 }] } }
        ];
        const block = buildEvidenceEnginePromptBlock(toolResults);
        expect(block).toContain("=== STRICT EVIDENCE CONTEXT");
        expect(block).toContain("STOCK: AALR");
        expect(block).toContain("macd_signal: NOT_PROVIDED");
        expect(block).toContain("macd_signal_line_status: UNKNOWN");
        expect(block).toContain("accumulation_score (acc_score): 80");
        expect(block).toContain("distribution_score (dist_score): 10");
        expect(block).toContain("consecutive_days: 3");
        expect(block).toContain("STRICT BOUNDARIES");
    });

    it("generates evidence block for scan-only results (no get_stock)", () => {
        const toolResults: ToolResult[] = [
            { tool: "get_distribution_stocks", source: "database", data_time: "2026-08-17", symbols: ["AALR"], data_type: "live", data: { stocks: [{ symbol: "AALR", dist_score: 75, acc_score: 5, wyckoff_phase: "distribution", consecutive_dist_days: 2 }] } }
        ];
        const block = buildEvidenceEnginePromptBlock(toolResults);
        expect(block).toContain("STOCK: AALR");
        expect(block).toContain("price: NOT_PROVIDED");
        expect(block).toContain("macd_signal: NOT_PROVIDED");
        expect(block).toContain("distribution_score (dist_score): 75");
        expect(block).toContain("accumulation_score (acc_score): 5");
        expect(block).toContain("STRICT BOUNDARIES");
    });

    it("returns empty string when no relevant results", () => {
        const toolResults: ToolResult[] = [{ tool: "search_web", source: "web", data_time: "2026-08-17", symbols: [], data_type: "live", data: { results: [] } }];
        const block = buildEvidenceEnginePromptBlock(toolResults);
        expect(block).toBe("");
    });

    it("includes all STRICT BOUNDARIES rules", () => {
        const toolResults: ToolResult[] = [
            { tool: "get_stock", source: "database", data_time: "2026-08-17", symbols: ["AALR"], data_type: "live", data: { symbol: "AALR", price: 310, rsi_14: 67.88, macd: 2.32, macd_signal: null } }
        ];
        const block = buildEvidenceEnginePromptBlock(toolResults);
        expect(block).toContain("NEVER claim 'فوق خط الإشارة'");
        expect(block).toContain("NEVER classify volume as 'سيولة توزيعية'");
        expect(block).toContain("NEVER classify volume as 'سيولة تجميعية'");
        expect(block).toContain("NEVER make implicit inferences");
    });

    it("handles OTC market flag correctly", () => {
        const toolResults: ToolResult[] = [
            { tool: "get_stock", source: "database", data_time: "2026-08-17", symbols: ["AFDI"], data_type: "live", data: { symbol: "AFDI", price: null, rsi_14: null, macd: null, macd_signal: null } }
        ];
        const block = buildEvidenceEnginePromptBlock(toolResults);
        expect(block).toContain("OTC_MARKET");
    });

});
