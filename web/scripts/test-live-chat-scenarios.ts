import fs from "fs";
import path from "path";

// Simple manual env parser
function loadEnv(filePath: string) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            if (!process.env[key]) process.env[key] = val;
        }
    }
}

loadEnv(path.resolve(__dirname, "../.env.local"));
loadEnv(path.resolve(__dirname, "../../.env"));

import { getSupabaseClient } from "../src/lib/supabase/route-data";
import { runPipelineStream } from "../src/lib/ai/pipeline";
import { SessionState, SessionSummary } from "../src/lib/ai/types";
import { getNvidiaApiKeys, getDeepSeekApiKey } from "../src/lib/ai/server-secrets";

interface TurnResult {
    turn: number;
    message: string;
    hasImage: boolean;
    plan: {
        intent: string;
        ranking_metric?: string;
        tools: string[];
        symbols: string[];
    };
    toolsExecuted: string[];
    responseSnippet: string;
    fullResponse: string;
    durationMs: number;
}

interface SessionResult {
    sessionName: string;
    description: string;
    turns: TurnResult[];
}

async function fetchImageAsBase64(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function runSessionTurns(
    sessionName: string,
    description: string,
    turnsData: Array<{ message: string; imageUrl?: string }>,
    supabase: any,
    apiKeys: string[]
): Promise<SessionResult> {
    console.log(`\n======================================================`);
    console.log(`🚀 Starting ${sessionName}`);
    console.log(`📝 Description: ${description}`);
    console.log(`======================================================`);

    const sessionId = crypto.randomUUID();
    const userId = "00000000-0000-0000-0000-000000000001";
    let sessionState: SessionState = {
        current_symbol: null,
        last_symbols: [],
        summary: null,
    };
    let sessionSummary: SessionSummary = {
        current_symbols: [],
        last_image_symbols: [],
        last_topic: null,
        open_references: [],
        last_data_date: null,
        last_vision_context: null,
        updated_at: new Date().toISOString(),
    };
    const history: Array<{ role: string; content: string }> = [];

    const turnsResults: TurnResult[] = [];

    for (let i = 0; i < turnsData.length; i++) {
        const turn = turnsData[i];
        console.log(`\n--- Turn ${i + 1}/${turnsData.length}: "${turn.message}" ${turn.imageUrl ? "[+IMAGE]" : ""} ---`);
        const startTime = Date.now();
        const images: string[] = [];
        if (turn.imageUrl) {
            try {
                const b64 = await fetchImageAsBase64(turn.imageUrl);
                images.push(b64);
                console.log(`✓ Image fetched from Supabase storage (${b64.length} chars)`);
            } catch (err: any) {
                console.warn(`⚠️ Failed to download image: ${err.message}`);
            }
        }

        const messageId = `msg_${Date.now()}_${i}`;
        let capturedPlan: any = null;
        let capturedTools: any[] = [];
        let finalReply = "";

        try {
            const stream = runPipelineStream(
                turn.message,
                images,
                sessionState,
                sessionSummary,
                history,
                supabase,
                apiKeys,
                userId,
                sessionId,
                messageId
            );

            for await (const event of stream) {
                if (event.type === "plan") {
                    capturedPlan = event.data;
                } else if (event.type === "tools") {
                    capturedTools = event.data?.results || [];
                } else if (event.type === "done") {
                    finalReply = event.data?.response || "";
                    if (event.data?.session_update) {
                        sessionState = { ...sessionState, ...event.data.session_update };
                    }
                }
            }
        } catch (err: any) {
            console.error(`❌ Error in turn ${i + 1}:`, err);
            finalReply = `ERROR: ${err.message}`;
        }

        const durationMs = Date.now() - startTime;

        // Record history for the session
        history.push({ role: "user", content: turn.message });
        history.push({ role: "assistant", content: finalReply });

        // Update session state
        if (capturedPlan?.entities?.symbols?.length) {
            sessionState.current_symbol = capturedPlan.entities.symbols[0];
            sessionState.last_symbols = Array.from(new Set([...capturedPlan.entities.symbols, ...(sessionState.last_symbols || [])])).slice(0, 15);
        }

        const toolNames = capturedTools.map(t => t.tool);
        console.log(`Intent: ${capturedPlan?.intent || "unknown"} | Metric: ${capturedPlan?.ranking_metric || "none"}`);
        console.log(`Tools Executed: [${toolNames.join(", ")}]`);
        console.log(`Latency: ${durationMs}ms`);
        console.log(`Reply Preview: ${finalReply.slice(0, 150).replace(/\n/g, " ")}...`);

        turnsResults.push({
            turn: i + 1,
            message: turn.message,
            hasImage: images.length > 0,
            plan: {
                intent: capturedPlan?.intent || "unknown",
                ranking_metric: capturedPlan?.ranking_metric,
                tools: toolNames,
                symbols: capturedPlan?.entities?.symbols || [],
            },
            toolsExecuted: toolNames,
            responseSnippet: finalReply.slice(0, 250).replace(/\n/g, " "),
            fullResponse: finalReply,
            durationMs,
        });
    }

    return {
        sessionName,
        description,
        turns: turnsResults,
    };
}

async function runAllTests() {
    console.log("=== Initializing Live Chat Real-World Scenarios ===");
    const supabase = getSupabaseClient();
    const nvidiaKeys = getNvidiaApiKeys();
    const deepseekKey = getDeepSeekApiKey();
    console.log(`API Keys available: DeepSeek=${Boolean(deepseekKey)}, NVIDIA count=${nvidiaKeys.length}`);

    const apiKeys = deepseekKey ? [deepseekKey, ...nvidiaKeys] : nvidiaKeys;

    const allSessionResults: SessionResult[] = [];

    // Session 1: Real User Multi-turn Portfolio & Stock Comparison (Actual questions from Sep 22)
    const session1 = await runSessionTurns(
        "Session 1: تجربة محفظة حقيقية متعددة الأدوار (Multi-turn Portfolio Flow)",
        "أسئلة عميل حقيقي: إدخال أرقام المحفظة سهم تلو الآخر، تحليل المحفظة، والمقارنة بمرجع 'فيهم'",
        [
            { message: "KWIN 1100 بمتوسط 107.01" },
            { message: "LUTS 67435 سهم بمتوسط 0.94" },
            { message: "حلل محفظتي" },
            { message: "افضل سهم فيهم" },
            { message: "هل سهم فوري وضعه ايه" },
            { message: "مستويات دعمه ومقاومته" },
        ],
        supabase,
        apiKeys
    );
    allSessionResults.push(session1);

    // Session 2: Wyckoff Accumulation & Sector Liquidity (Actual questions from Sep 23-24)
    const session2 = await runSessionTurns(
        "Session 2: التجميع المؤسسي ومسح السيولة والوايكوف",
        "أسئلة تجميع وسيولة قطاعات: التأكد من معيار التجميع، وعدم استبداله بالأعلى ارتفاعاً",
        [
            { message: "إيه أقوى الأسهم اللي بتجمع سيولة وأحجام تداول النهاردة؟" },
            { message: "هل في تجميع مؤسسي؟" },
            { message: "حركة السيولة في القطاعات" },
        ],
        supabase,
        apiKeys
    );
    allSessionResults.push(session2);

    // Session 3: Real Questions on Specific Stocks, News & Recommendations (Actual questions from Sep 26-27)
    const session3 = await runSessionTurns(
        "Session 3: اتخاذ القرار، تاريخ الأخبار، والتوصيات المفتوحة",
        "أسئلة مباشرة: لوتس، شارم دريمز، اشتري ولا مشتريش، أخبار اليوم لـ GGRN، وتوصيات المنصة",
        [
            { message: "لوتس" },
            { message: "شارم دريمز" },
            { message: "يعني اشتري ولا مشتريش" },
            { message: "أخبار GGRN اليوم" },
            { message: "هات كل التوصيات المفتوحه" },
        ],
        supabase,
        apiKeys
    );
    allSessionResults.push(session3);

    // Session 4: Real Customer Image Upload from Supabase
    const session4 = await runSessionTurns(
        "Session 4: تحليل صورة محفظة حقيقية مرفوعة من عميل على Supabase",
        "تحليل صورة محفظة فعلية للعميل من storage ومتابعة الأسئلة في نفس الجلسة",
        [
            {
                message: "حلل محفظتي",
                imageUrl: "https://gfcmaxbtscmizsakarvc.supabase.co/storage/v1/object/public/chat-images/05fb7f96-f694-4305-b11d-07d1316572e7/9049535e-9a9e-45d1-9f5d-a5b018c7e47e/5e466024-26dc-4970-8a18-7ba2c9f475ad.jpg",
            },
            { message: "إيه أكبر مركز فيهم بناءً على الصورة والأسعار؟" },
        ],
        supabase,
        apiKeys
    );
    allSessionResults.push(session4);

    // Save final report to disk
    const reportPath = path.resolve(__dirname, "../../chat_live_test_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(allSessionResults, null, 2), "utf-8");
    console.log(`\n🎉 Full test complete! Report saved to ${reportPath}`);
}

runAllTests().catch(err => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
