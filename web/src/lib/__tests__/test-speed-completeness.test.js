import { buildCompoundDeterministicPlan } from "../ai/pipeline";
import { generateV2Response } from "../ai/final-v2";

describe("Verify Response Speed & Completeness", () => {
    const userMsg = "سلام عليكم اشتريت اليوم في سهم لوتس ونزل بيا تنصحوني اعمل ايه ؟";
    const sessionState = { current_symbol: null, last_symbols: [], summary: null };
    const apiKeys = ["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"];

    const modelsToTest = [
        "deepseek-ai/deepseek-v4-flash",
        "deepseek-ai/deepseek-v4-pro",
        "meta/llama-3.1-70b-instruct"
    ];

    test.each(modelsToTest)("Verifies speed and non-truncated full response for %s", async (modelName) => {
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

        const startTime = Date.now();
        const response = await generateV2Response(
            userMsg,
            plan,
            null,
            toolResults,
            [],
            [],
            { symbol: "LUTS", message_id: null, confidence: 1 },
            apiKeys,
            modelName,
            sessionState
        );
        const duration = Date.now() - startTime;

        console.log(`\n================ MODEL: ${modelName} ================`);
        console.log(`DURATION: ${duration} ms (${(duration / 1000).toFixed(2)}s)`);
        console.log(`LENGTH: ${response.length} characters`);
        console.log(`FULL TEXT:\n${response}`);
        console.log("========================================================\n");

        expect(response).toBeTruthy();
        expect(response.length).toBeGreaterThan(200); // Ensures response is complete and rich
        expect(response).not.toContain("[تم اقتطاع");
    }, 25000);
});
