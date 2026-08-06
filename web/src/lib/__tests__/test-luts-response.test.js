import { buildCompoundDeterministicPlan } from "../ai/pipeline";
import { buildV2FinalMessages } from "../ai/final-v2";

describe("Live User Query Simulation Test", () => {
    test("Simulates user query 'سلام عليكم اشتريت اليوم في سهم لوتس ونزل بيا تنصحوني اعمل ايه ؟'", () => {
        const userMsg = "سلام عليكم اشتريت اليوم في سهم لوتس ونزل بيا تنصحوني اعمل ايه ؟";
        const sessionState = { current_symbol: null, last_symbols: [], summary: null };
        
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

        const messages = buildV2FinalMessages(
            userMsg,
            plan,
            null,
            toolResults,
            [],
            [],
            { symbol: "LUTS", message_id: null, confidence: 1 },
            sessionState
        );

        const promptContent = messages[1].content;
        
        // Assert instructions for single stock queries are injected
        expect(promptContent).toContain("عند سؤال المستخدم عن قرار البيع أو الشراء أو الاحتفاظ بسهم معين");
        expect(promptContent).toContain("يمنع منعاً باتاً استخدام القوالب الجافة أو عبارات المسح العامة");
        
        console.log("=== VERIFIED SIMULATED PROMPT FOR LUTS ===");
        console.log(promptContent);
    });
});
