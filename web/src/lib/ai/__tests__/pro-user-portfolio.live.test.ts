import { runPipelineStream } from "../pipeline";
import { getSupabaseServiceClient } from "../../../lib/supabase/route-data";
import { SessionState } from "../types";

describe("Pro User live tests", () => {
    const supabase = getSupabaseServiceClient();

    it("should handle 'ايه اخبار محفظتي' with wealth management analysis", async () => {
        let sessionState: SessionState = { current_symbol: null, last_symbols: [], current_sector: null, summary: "" };
        const history: any[] = [];
        const keysToTry: any[] = [];

        const stream = runPipelineStream(
            "ايه اخبار محفظتي",
            [],
            sessionState,
            null,
            history,
            supabase,
            keysToTry,
            "8010a163-6d2f-40df-834f-6ad9cbd1faa5", // testUserId
            "session_pro_3",
            "msg_3",
            undefined,
            { isPro: true } // Pro user tier
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

        console.log("Response 3 (Portfolio):", fullResponse);
        expect(fullResponse.length).toBeGreaterThan(100);
    }, 60000);
});
