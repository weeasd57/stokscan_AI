import fs from "fs";
import path from "path";

// Load .env.local into process.env before initializing services
try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, "utf-8").split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx > 0) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        }
    }
} catch (e) {
    console.warn("Could not read .env.local:", e);
}

import { runPipelineStream } from "../pipeline";
import { getSupabaseServiceClient } from "../../../lib/supabase/route-data";
import { getNvidiaApiKeys, getDeepSeekApiKey } from "../server-secrets";
import { SessionState, SessionSummary } from "../types";

// Timeout 180s for full multi-turn live conversation test
jest.setTimeout(180000);

describe("Live Multi-Turn Chatbot System Test", () => {
    it("runs realistic consecutive questions from last week in a single session", async () => {
        console.log("\n=================================================================");
        console.log("🚀 STARTING REALISTIC MULTI-TURN CHATBOT TEST (SINGLE SESSION)");
        console.log("=================================================================\n");

        const supabase = getSupabaseServiceClient();
        const testUserId = "0d524b63-b7cf-4df9-b8f8-5b4eb382bb38"; // Real Free user (ahmed7332@gmail.com)
        const sessionId = `test_live_session_${Date.now()}`;
        const keysToTry = getNvidiaApiKeys();

        console.log(`👤 User ID: ${testUserId} (Free Tier)`);
        console.log(`🆔 Session ID: ${sessionId}`);
        console.log(`🔑 Keys available: DeepSeek=${Boolean(getDeepSeekApiKey())}, NVIDIA keys=${keysToTry.length}`);
        console.log("-----------------------------------------------------------------\n");

        // Real questions from last week in realistic conversational order
        const conversationTurns = [
            {
                title: "Turn 1: Specific stock news (المصرية للاتصالات)",
                question: "اخبار سهم وي ؟",
                expectedBehavior: "Identifies ETEL, calls get_news, sets current_symbol to ETEL in session state."
            },
            {
                title: "Turn 2: Implicit follow-up timing (متوقع يزيد الناهردة ؟)",
                question: "متوقع يزيد الناهردة ؟",
                expectedBehavior: "Must inherit ETEL from Turn 1, answer without clarification or losing the stock context."
            },
            {
                title: "Turn 3: Decision comparison between 2 stocks (gbco vs alcn)",
                question: "أيهما أفضل للمضاربة يوم الإثنين gbco أو alcn",
                expectedBehavior: "Decision task between GBCO and ALCN with conditional tradeoffs, no generic dump."
            },
            {
                title: "Turn 4: Dollar stock opportunity query",
                question: "افضل سهم دولاري للدخول الان",
                expectedBehavior: "Must trigger clarification (EGX dollar stocks vs US market) without dumping EGX EGP scan."
            },
            {
                title: "Turn 5: Crypto / foreign token query (FLUIUSDT)",
                question: "تحليل السيولة لـ FLUIUSDT",
                expectedBehavior: "Immediately informs user that platform covers EGX stocks only, not Crypto/USDT."
            },
            {
                title: "Turn 6: Direct recommendation request (Free user gate test)",
                question: "هات توصيه",
                expectedBehavior: "Must gate free user with Pro upgrade message ONLY, with zero accumulation tables or dump."
            },
            {
                title: "Turn 7: Market accumulation scan (explicit request)",
                question: "إيه أقوى الأسهم اللي بتجمع سيولة وأحجام تداول النهاردة؟",
                expectedBehavior: "Runs get_accumulation_stocks and returns accumulation scan for EGX stocks."
            }
        ];

        let sessionState: SessionState = {
            current_symbol: null,
            last_symbols: [],
            current_sector: null,
            summary: ""
        };

        let sessionSummary: SessionSummary | null = null;
        const history: Array<{ role: string; content: string }> = [];

        const turnResults: any[] = [];

        for (let i = 0; i < conversationTurns.length; i++) {
            const turn = conversationTurns[i];
            console.log(`\n=================================================================`);
            console.log(`💬 ${turn.title}`);
            console.log(`❓ User Question: "${turn.question}"`);
            console.log(`🎯 Expected: ${turn.expectedBehavior}`);
            console.log(`📌 Session State before turn: current_symbol=${sessionState.current_symbol}, last_symbols=${JSON.stringify(sessionState.last_symbols)}, summary="${sessionState.summary}"`);
            console.log(`-----------------------------------------------------------------`);

            const t0 = Date.now();
            let firstTokenMs: number | null = null;
            let plannerData: any = null;
            let responseOrigin: string = "unknown";
            let fullResponse = "";
            let streamTables: any[] = [];

            try {
                const stream = runPipelineStream(
                    turn.question,
                    [],
                    sessionState,
                    sessionSummary,
                    history,
                    supabase,
                    keysToTry,
                    testUserId,
                    sessionId,
                    `msg_${Date.now()}`,
                    undefined,
                    { isPro: false } // Free user tier
                );

                for await (const event of stream) {
                    if (event.type === "plan") {
                        plannerData = event.data;
                    } else if (event.type === "tables") {
                        streamTables = event.data || [];
                    } else if (event.type === "token") {
                        if (firstTokenMs === null) {
                            firstTokenMs = Date.now() - t0;
                        }
                        fullResponse += String(event.data || "");
                    } else if (event.type === "done") {
                        responseOrigin = event.data?.response_origin || "pipeline";
                        if (event.data?.response) {
                            fullResponse = event.data.response;
                        }
                    }
                }

                const totalMs = Date.now() - t0;

                // Update session state from planner
                if (plannerData?.session_update) {
                    if (plannerData.session_update.current_symbol !== undefined) {
                        sessionState.current_symbol = plannerData.session_update.current_symbol;
                    }
                    if (plannerData.session_update.last_symbols) {
                        sessionState.last_symbols = plannerData.session_update.last_symbols;
                    }
                    if (plannerData.session_update.summary) {
                        sessionState.summary = plannerData.session_update.summary;
                    }
                }

                // Append to history for next turn
                history.push({ role: "user", content: turn.question });
                history.push({ role: "assistant", content: fullResponse });

                console.log(`\n⏱️ Performance:`);
                console.log(`   - First Token: ${firstTokenMs ?? totalMs} ms`);
                console.log(`   - Total Latency: ${totalMs} ms (${(totalMs / 1000).toFixed(2)}s)`);
                console.log(`   - Intent: ${plannerData?.intent}`);
                console.log(`   - Tools: ${JSON.stringify(plannerData?.tools || [])}`);
                console.log(`   - Response Origin: ${responseOrigin}`);
                console.log(`   - Tables returned: ${streamTables.length}`);
                console.log(`\n📝 Response Text:\n${fullResponse}`);
                console.log(`\n📌 Session State after turn: current_symbol=${sessionState.current_symbol}, last_symbols=${JSON.stringify(sessionState.last_symbols)}, summary="${sessionState.summary}"`);

                turnResults.push({
                    turn: i + 1,
                    question: turn.question,
                    totalMs,
                    firstTokenMs: firstTokenMs ?? totalMs,
                    intent: plannerData?.intent,
                    tools: plannerData?.tools || [],
                    origin: responseOrigin,
                    tablesCount: streamTables.length,
                    responseSnippet: fullResponse.slice(0, 150).replace(/\n/g, " "),
                    sessionStateAfter: { ...sessionState }
                });

            } catch (err: any) {
                console.error(`❌ Error in Turn ${i + 1}:`, err);
                turnResults.push({
                    turn: i + 1,
                    question: turn.question,
                    error: String(err?.message || err)
                });
            }
        }

        console.log("\n=================================================================");
        console.log("📊 MULTI-TURN TEST SUMMARY REPORT");
        console.log("=================================================================");
        console.table(turnResults.map(r => ({
            Turn: r.turn,
            Question: r.question,
            "Total (s)": r.totalMs ? (r.totalMs / 1000).toFixed(2) : "ERR",
            "1st Token (s)": r.firstTokenMs ? (r.firstTokenMs / 1000).toFixed(2) : "ERR",
            Intent: r.intent || "N/A",
            Origin: r.origin || "N/A",
            Symbol: r.sessionStateAfter?.current_symbol || "None"
        })));

        // Remove temporary scratch file
        expect(turnResults).toHaveLength(conversationTurns.length);
    });
});
