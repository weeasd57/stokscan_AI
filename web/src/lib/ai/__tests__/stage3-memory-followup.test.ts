import { retrieveRelevantMemory } from "../memory";
import { isStockFollowUpQuestion, buildV2FinalMessages } from "../final-v2";

describe("Stage 3: Memory Reference Resolution and Follow-up Anti-Repetition", () => {
    const mockSessionSummary = {
        current_symbols: ["FWRY"],
        last_image_symbols: [],
        last_topic: "analysis",
        open_references: [],
        last_data_date: "2026-10-02",
        last_vision_context: null,
        last_reference_symbol: "FWRY",
        updated_at: new Date().toISOString()
    };

    const mockSessionState = {
        current_symbol: "FWRY",
        last_symbols: ["FWRY"],
        summary: "Analyzed FWRY technical indicators"
    };

    const followUpQueries = [
        "متي اشتري",
        "متى اشتري",
        "امتى اشتري",
        "هل ادخل",
        "ادخل دلوقتي",
        "وقف الخسارة كام",
        "وقف خسارة",
        "ستوب لوس",
        "الهدف كام",
        "مستهدفه كام",
        "تارجت",
        "رايك ايه فيه",
        "توقعاتك ليه",
        "اشتريه ولا ابيعه",
        "ابيع ولا استنى",
        "اعمل متوسط"
    ];

    it.each(followUpQueries)("resolves '%s' to the single active stock FWRY", async (query) => {
        const result = await retrieveRelevantMemory(
            query,
            mockSessionSummary,
            mockSessionState,
            [],
            null,
            "user_1",
            "session_1"
        );

        expect(result.resolved_references.symbol).toBe("FWRY");
        expect(result.resolved_references.confidence).toBeGreaterThan(0);
    });

    it("resolves from sessionState.current_symbol when sessionSummary has no reference", async () => {
        const result = await retrieveRelevantMemory(
            "وقف الخسارة كام",
            null,
            { current_symbol: "COMI", last_symbols: ["COMI"], summary: null },
            [],
            null,
            "user_1",
            "session_1"
        );

        expect(result.resolved_references.symbol).toBe("COMI");
        expect(result.resolved_references.confidence).toBe(0.85);
    });

    it("resolves from sessionState.last_symbols when current_symbol is null", async () => {
        const result = await retrieveRelevantMemory(
            "تارجت",
            null,
            { current_symbol: null, last_symbols: ["EKHO"], summary: null },
            [],
            null,
            "user_1",
            "session_1"
        );

        expect(result.resolved_references.symbol).toBe("EKHO");
        expect(result.resolved_references.confidence).toBe(0.75);
    });

    it("does not resolve reference for generic non-stock queries", async () => {
        const result = await retrieveRelevantMemory(
            "صباح الخير اخبار السوق ايه",
            mockSessionSummary,
            mockSessionState,
            [],
            null,
            "user_1",
            "session_1"
        );

        expect(result.resolved_references.symbol).toBeNull();
        expect(result.resolved_references.confidence).toBe(0);
    });

    it("detects follow-up questions in isStockFollowUpQuestion and builds anti-repetition guidance", () => {
        const history = [
            { role: "user", content: "حلل لي سهم فوري" },
            { role: "assistant", content: "تحليل سهم فوري: السعر الحالي 8.50 ج.م، RSI عند 55..." }
        ];

        const plan: any = {
            intent: "stock_analysis",
            confidence: 0.9,
            entities: { symbols: ["FWRY"], timeframe: "current" },
            needs_history: true
        };

        const isFollowUp = isStockFollowUpQuestion("متى اشتري", plan, history, { symbol: "FWRY", confidence: 0.9 });
        expect(isFollowUp).toBe(true);

        const messages = buildV2FinalMessages(
            "متى اشتري",
            plan,
            null,
            [{ tool: "get_stock", data: { symbol: "FWRY", price: 8.5, rsi_14: 55 } } as any],
            [],
            history,
            { symbol: "FWRY", message_id: null, confidence: 0.9 },
            mockSessionState
        );

        const systemMessage = messages.find(m => m.role === "system");
        expect(systemMessage?.content).toContain("توجيهات منع التكرار لأسئلة المتابعة");

        const lastUserMessage = messages[messages.length - 1];
        expect(lastUserMessage?.role).toBe("user");
        expect(lastUserMessage?.content).toContain("=== FOLLOW-UP QUESTION & ANTI-REPETITION GUIDANCE ===");
        expect(lastUserMessage?.content).toContain("ANSWER THE SPECIFIC QUESTION DIRECTLY");
    });
});
