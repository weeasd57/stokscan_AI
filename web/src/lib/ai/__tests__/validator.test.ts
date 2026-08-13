import { describe, it, expect } from "@jest/globals";
import { validateResponse, validateDeterministicRules } from "../validator";

// Regression test for the false "تضارب" errors seen in production logs:
// AALR RSI 67.88 / resistance 325.5 were flagged because sentence splitting
// on "." broke decimal numbers into fragments (67 / 88, 325 / 5).
describe("validator deterministic rules", () => {
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

    it("validateResponse passes a fully correct reply", () => {
        const reply =
            "سهم AALR يتداول حالياً عند سعر 310 جنيه، ومؤشر القوة النسبية يساوي 67.88 مما يشير إلى قوة شرائية واضحة، بينما يقع الدعم الرئيسي عند 290 جنيه وتتمركز المقاومة عند 325.5 جنيه.";
        const liveData = JSON.stringify(aalrToolResults[0].data);
        const result = validateResponse(reply, liveData, ["AALR"], aalrToolResults, "حلل سهم AALR");
        expect(result.deterministicErrors).toEqual([]);
        expect(result.suspiciousNumbers).toEqual([]);
        expect(result.isValid).toBe(true);
    });
});
