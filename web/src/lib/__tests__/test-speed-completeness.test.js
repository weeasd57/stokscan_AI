import { buildCompoundDeterministicPlan } from "../ai/pipeline";
import { generateV2Response } from "../ai/final-v2";

describe("Verify Response Speed & Completeness", () => {
    const userMsg = "سلام عليكم اشتريت اليوم في سهم لوتس ونزل بيا تنصحوني اعمل ايه ؟";
    const sessionState = { current_symbol: null, last_symbols: [], summary: null };
    const apiKeys = [
        process.env.NVIDIA_API_KEY,
        process.env.NVIDIA_SECONDARY_API_KEY,
        "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"
    ].filter(Boolean) as string[];

    const modelsToTest = [
        "deepseek-ai/deepseek-v4-pro",
        "deepseek-ai/deepseek-v4-flash"
    ];

    test.each(modelsToTest)("Verifies response generation for %s", async (modelName) => {
        const plan = buildCompoundDeterministicPlan(userMsg, sessionState);

        const toolResults = [{
            tool: "get_stock",
            source: "stocks",
            data_time: "2026-08-06",
            data_type: "live",
            symbols: ["LUTS"],
            data: {
                symbol: "LUTS",
                name: "Lotus for Agricultural Development",
                price: 0.742,
                change_pct: -0.67,
                volume_ratio: 2.78,
                rsi: 77.74,
                macd: 0.0165,
                support: 0.65,
                resistance: 0.82
            }
        }];

        const response = await generateV2Response(
            userMsg,
            plan!,
            null,
            toolResults,
            [],
            [],
            { symbol: "LUTS", message_id: null, confidence: 1 },
            apiKeys,
            modelName,
            sessionState
        );

        expect(response).toBeTruthy();
        expect(response).not.toContain("بناءً على البيانات الحية المتاحة، هذه مقارنة فنية بين أبرز الأسهم");
    }, 45000);
});
