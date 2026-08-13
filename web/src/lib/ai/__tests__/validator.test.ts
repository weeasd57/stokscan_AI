import { describe, it, expect } from "@jest/globals";
import { validateResponse, validateDeterministicRules, isVerifiableDerivedMetric, autoFixNumbers } from "../validator";

describe("validator deterministic rules & semantic verification", () => {
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
        // ((120.78 - 45.15) / 45.15) * 100 = 167.508% ≈ 167.51%
        expect(isVerifiableDerivedMetric(167.51, facts)).toBe(true);
        // ((144.94 - 120.78) / 144.94) * 100 = 16.668% ≈ 16.67%
        expect(isVerifiableDerivedMetric(16.67, facts)).toBe(true);
        // Fake uncalculated random number should fail
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
