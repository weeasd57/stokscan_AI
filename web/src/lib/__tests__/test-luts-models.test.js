import { buildCompoundDeterministicPlan } from "../ai/pipeline";
import { generateV2Response } from "../ai/final-v2";

describe("Test 3 UI Models with 'سهم لوتس' Query", () => {
    const userMsg = "سلام عليكم اشتريت اليوم في سهم لوتس ونزل بيا تنصحوني اعمل ايه ؟";
    const sessionState = { current_symbol: null, last_symbols: [], summary: null };
    const apiKeys = ["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"];

    const modelsToTest = [
        "nvidia/nemotron-3.5-lightning-30b-a3b",
        "meta/muse-glimmer-30b",
    ];

    test.each(modelsToTest)("Generates response using model %s", async (modelName) => {
        const plan = buildCompoundDeterministicPlan(userMsg, sessionState);
        expect(plan).not.toBeNull();
        expect(plan.entities.symbols).toContain("LUTS");

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

        console.log(`\n================ MODEL: ${modelName} ================`);
        console.log(response);
        console.log("========================================================\n");

        expect(response).toBeTruthy();
        expect(response).not.toContain("بناءً على البيانات الحية المتاحة، هذه مقارنة فنية بين أبرز الأسهم");
    }, 60000);
});
