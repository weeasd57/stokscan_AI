import { runPipelineStream } from "../pipeline";
import { getSupabaseServiceClient } from "../../../lib/supabase/route-data";
import { SessionState } from "../types";

describe("Test user ff0bf531-c120-48bb-b818-65515fa99abe queries", () => {
    const supabase = getSupabaseServiceClient();

    it("should test 'ما هو أنشط قطاع في البورصة المصرية حالياً ولماذا؟'", async () => {
        let sessionState: SessionState = { current_symbol: null, last_symbols: [], current_sector: null, summary: "" };
        const history: any[] = [];
        const keysToTry: any[] = [];

        const stream = runPipelineStream(
            "ما هو أنشط قطاع في البورصة المصرية حالياً ولماذا؟",
            [],
            sessionState,
            null,
            history,
            supabase,
            keysToTry,
            "ff0bf531-c120-48bb-b818-65515fa99abe",
            "test_session_user_1",
            "test_msg_user_1",
            undefined,
            { isPro: false }
        );

        let fullResponse = "";
        for await (const event of stream) {
            if (event.type === "token") fullResponse += String(event.data || "");
            else if (event.type === "done" && event.data?.response) fullResponse = event.data.response;
        }

        console.log("Q1 RESPONSE:\n", fullResponse);
    }, 60000);

    it("should test 'أقوى الأسهم النهارده' for free user", async () => {
        let sessionState: SessionState = { current_symbol: null, last_symbols: [], current_sector: null, summary: "" };
        const history: any[] = [
            { role: "user", content: "ما هو أنشط قطاع في البورصة المصرية حالياً ولماذا؟" },
            { role: "assistant", content: "الخلاصة أولاً: لا يمكنني تحديد أنشط قطاع بمعيار السيولة..." }
        ];
        const keysToTry: any[] = [];

        const stream = runPipelineStream(
            "أقوى الأسهم النهارده",
            [],
            sessionState,
            null,
            history,
            supabase,
            keysToTry,
            "ff0bf531-c120-48bb-b818-65515fa99abe",
            "test_session_user_2",
            "test_msg_user_2",
            undefined,
            { isPro: false }
        );

        let fullResponse = "";
        for await (const event of stream) {
            if (event.type === "token") fullResponse += String(event.data || "");
            else if (event.type === "done" && event.data?.response) fullResponse = event.data.response;
        }

        console.log("Q2 RESPONSE:\n", fullResponse);
    }, 60000);
});
