import { logAiInteraction } from "../logger";

const event = {
    sessionId: null,
    intent: "general_chat",
    symbols: [],
    plannerModel: "planner",
    responseModel: "responder",
    plannerLatencyMs: 10,
    toolsLatencyMs: 20,
    responseLatencyMs: 30,
    totalLatencyMs: 60,
    dataSizeChars: 100,
    correlationId: "test-correlation",
};

describe("logAiInteraction", () => {
    afterEach(() => jest.restoreAllMocks());

    it("surfaces returned Supabase errors without rejecting the chat flow", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const insert = jest.fn().mockResolvedValue({ error: { code: "PGRST205", message: "table missing" } });
        const supabase = { from: jest.fn(() => ({ insert })) };

        await expect(logAiInteraction(supabase, event)).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("PGRST205"));
    });
});
