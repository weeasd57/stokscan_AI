const { runPlanner } = require("../ai/planner");

describe("Planner failure handling", () => {
    it("does not reuse the previous stock after every planner provider fails", async () => {
        const originalFetch = global.fetch;
        const originalWarn = console.warn;
        global.fetch = jest.fn().mockRejectedValue(new Error("provider unavailable"));
        console.warn = jest.fn();

        try {
            const result = await runPlanner(
                "ولي رايك في اداء المؤشر النهارده",
                [],
                { current_symbol: "KWIN", last_symbols: ["KWIN"], summary: "تحليل KWIN" },
                [],
                ["test-key-1", "test-key-2"],
                null
            );
            expect(result.service_degraded_message).toMatch(/ضغط مؤقت/);
            expect(result.entities.symbols).toEqual([]);
            expect(result.tools).toEqual([]);
            expect(result.session_update.current_symbol).toBe("KWIN");
            expect(global.fetch).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
            console.warn = originalWarn;
        }
    });
});
