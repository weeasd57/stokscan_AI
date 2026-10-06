import { runPipelineStream } from "../pipeline";
import { getSupabaseServiceClient } from "../../../lib/supabase/route-data";
import { SessionState } from "../types";

describe("Pro User live tests", () => {
    const supabase = getSupabaseServiceClient();

    it("should handle 'أقوى الأسهم النهارده' with clarification", async () => {
        let sessionState: SessionState = { current_symbol: null, last_symbols: [], current_sector: null, summary: "" };
        const history: any[] = [];
        const keysToTry: any[] = [];

        const stream = runPipelineStream(
            "أقوى الأسهم النهارده",
            [],
            sessionState,
            null,
            history,
            supabase,
            keysToTry,
            "8010a163-6d2f-40df-834f-6ad9cbd1faa5", // testUserId
            "session_pro_1",
            "msg_1",
            undefined,
            { isPro: true } // Pro user tier
        );

        let plannerData: any = null;
        let responseOrigin: string = "unknown";
        let fullResponse = "";

        for await (const event of stream) {
            if (event.type === "plan") {
                plannerData = event.data;
            } else if (event.type === "token") {
                fullResponse += String(event.data || "");
            } else if (event.type === "done") {
                responseOrigin = event.data?.response_origin || "pipeline";
                if (event.data?.response) {
                    fullResponse = event.data.response;
                }
            }
        }

        console.log("Response 1:", fullResponse);
        expect(plannerData?.clarification_needed).toBe(true);
        expect(plannerData?.clarification_options).toContain("أعلى سيولة");
    });

    it("should handle 'الاسهم الاكثر ربحية غدا في البورصه المصريه' with recommendations", async () => {
        let sessionState: SessionState = { current_symbol: null, last_symbols: [], current_sector: null, summary: "" };
        const history: any[] = [];
        const keysToTry: any[] = [];

        const stream = runPipelineStream(
            "الاسهم الاكثر ربحية غدا في البورصه المصريه",
            [],
            sessionState,
            null,
            history,
            supabase,
            keysToTry,
            "8010a163-6d2f-40df-834f-6ad9cbd1faa5", // testUserId
            "session_pro_2",
            "msg_2",
            undefined,
            { isPro: true } // Pro user tier
        );

        let plannerData: any = null;
        let responseOrigin: string = "unknown";
        let fullResponse = "";

        for await (const event of stream) {
            if (event.type === "plan") {
                plannerData = event.data;
            } else if (event.type === "token") {
                fullResponse += String(event.data || "");
            } else if (event.type === "done") {
                responseOrigin = event.data?.response_origin || "pipeline";
                if (event.data?.response) {
                    fullResponse = event.data.response;
                }
            }
        }

        console.log("Response 2:", fullResponse);
        expect(plannerData?.tools).toContain("get_recommendations");
    }, 60000);

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
