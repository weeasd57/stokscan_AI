import { runPipelineStream } from "../pipeline";
import { getSupabaseServiceClient } from "../../../lib/supabase/route-data";
import { SessionState } from "../types";

describe("Pro User live tests", () => {
    const supabase = getSupabaseServiceClient();

    it("should handle 'حلل محفظتى' with instant comprehensive portfolio analysis", async () => {
        let sessionState: SessionState = { current_symbol: null, last_symbols: [], current_sector: null, summary: "" };
        const history: any[] = [];
        const keysToTry: any[] = [];

        const startTime = Date.now();
        const stream = runPipelineStream(
            "حلل محفظتى",
            [],
            sessionState,
            null,
            history,
            supabase,
            keysToTry,
            "8010a163-6d2f-40df-834f-6ad9cbd1faa5", // real user id from previous chat
            "session_test_analysis",
            "msg_test_analysis",
            undefined,
            { isPro: true }
        );

        let fullResponse = "";

        for await (const event of stream) {
            if (event.type === "token") {
                fullResponse += String(event.data || "");
            } else if (event.type === "done") {
                if (event.data?.response) {
                    fullResponse = event.data.response;
                }
            }
        }

        const elapsedMs = Date.now() - startTime;
        console.log(`Response time: ${elapsedMs} ms`);
        console.log("Full Analysis Response:\n", fullResponse);

        expect(fullResponse).not.toContain("تعذر التحقق من إجابة متسقة");
        expect(fullResponse).toContain("تقرير التحليل الفني الشامل وإدارة مخاطر المحفظة");
        expect(elapsedMs).toBeLessThan(10000); // must be faster than 10 seconds (was 28s)
    }, 60000);
});
