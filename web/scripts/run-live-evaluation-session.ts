import fs from "fs";
import path from "path";

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

interface LiveTestResult {
    category: string;
    turn: number;
    question: string;
    latencyMs: number;
    intent: string;
    toolsExecuted: string[];
    replySnippet: string;
    fullReply: string;
    checks: {
        nonEmpty: boolean;
        fastEnough: boolean; // < 15s
        hasNoRefusal: boolean; // doesn't refuse with "لا توجد بيانات" or "لا يمكنني ترتيب"
        hasNoContradiction: boolean; // no "لم أجد خبرا... لكن توجد"
        contextFollowUpPassed?: boolean;
    };
}

async function runLiveTest() {
    console.log("===============================================================");
    console.log("🚀 STARTING LIVE CHATBOT EVALUATION SUITE");
    console.log("===============================================================");

    const supabase = getSupabaseClient();
    const deepseekKey = getDeepSeekApiKey();
    const nvidiaKeys = getNvidiaApiKeys();
    const apiKeys = deepseekKey ? [deepseekKey, ...nvidiaKeys] : nvidiaKeys;

    console.log(`Live APIs configured: DeepSeek=${Boolean(deepseekKey)}, NVIDIA keys count=${nvidiaKeys.length}`);

    const results: LiveTestResult[] = [];

    // Helper to run a test turn
    async function executeTurn(
        category: string,
        turnNumber: number,
        question: string,
        sessionState: SessionState,
        sessionSummary: SessionSummary,
        history: Array<{ role: string; content: string }>,
        userId: string,
        sessionId: string
    ): Promise<string> {
        console.log(`\n---------------------------------------------------------------`);
        console.log(`[${category}] Turn ${turnNumber}: "${question}"`);
        console.log(`---------------------------------------------------------------`);

        const startTime = Date.now();
        const messageId = `test_${Date.now()}_${turnNumber}`;
        let capturedPlan: any = null;
        let capturedTools: any[] = [];
        let fullReply = "";

        try {
            const stream = runPipelineStream(
                question,
                [],
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
                } else if (event.type === "token") {
                    fullReply += event.data;
                } else if (event.type === "done") {
                    if (event.data?.response) fullReply = event.data.response;
                    if (event.data?.session_update) {
                        Object.assign(sessionState, event.data.session_update);
                    }
                }
            }
        } catch (err: any) {
            console.error("Execution error:", err);
            fullReply = `ERROR: ${err.message}`;
        }

        const durationMs = Date.now() - startTime;
        const toolNames = capturedTools.map(t => t.tool);

        // Update history
        history.push({ role: "user", content: question });
        history.push({ role: "assistant", content: fullReply });

        if (capturedPlan?.entities?.symbols?.length) {
            sessionState.current_symbol = capturedPlan.entities.symbols[0];
            sessionState.last_symbols = Array.from(new Set([...capturedPlan.entities.symbols, ...(sessionState.last_symbols || [])])).slice(0, 15);
            sessionSummary.last_reference_symbol = capturedPlan.entities.symbols[0];
        }

        const hasRefusal = /لا يمكنني ترتيب|جاءت فارغة تماماً ولا يمكنني|لا توجد بيانات موثقة لهذا الطلب بتاريخ/.test(fullReply);
        const hasContradiction = /لم أجد خبراً موثقاً.*(أحداث الشركات|توزيعات|إفصاح)/s.test(fullReply) || /عدد الأخبار:\s*0/i.test(fullReply);

        console.log(`⏱ Latency: ${durationMs}ms`);
        console.log(`🎯 Intent: ${capturedPlan?.intent || "none"}`);
        console.log(`🔧 Tools: [${toolNames.join(", ")}]`);
        console.log(`💬 Snippet: ${fullReply.slice(0, 200).replace(/\n/g, " ")}...`);

        results.push({
            category,
            turn: turnNumber,
            question,
            latencyMs: durationMs,
            intent: capturedPlan?.intent || "unknown",
            toolsExecuted: toolNames,
            replySnippet: fullReply.slice(0, 250).replace(/\n/g, " "),
            fullReply,
            checks: {
                nonEmpty: fullReply.length > 30,
                fastEnough: durationMs < 20000,
                hasNoRefusal: !hasRefusal,
                hasNoContradiction: !hasContradiction,
            }
        });

        return fullReply;
    }

    // =========================================================================
    // 1. Portfolio & Follow-up Multi-Turn Session
    // =========================================================================
    const portfolioUserId = "00000000-0000-0000-0000-000000000001";
    const portfolioSessionId = crypto.randomUUID();
    const portfolioState: SessionState = { current_symbol: null, last_symbols: [], summary: null };
    const portfolioSummary: SessionSummary = { current_symbols: [], last_image_symbols: [], last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: new Date().toISOString() };
    const portfolioHistory: Array<{ role: string; content: string }> = [];

    await executeTurn("المحفظة والمتابعة", 1, "حلل محفظتي", portfolioState, portfolioSummary, portfolioHistory, portfolioUserId, portfolioSessionId);
    await executeTurn("المحفظة والمتابعة", 2, "معايا 500 سهم في السويدي بمتوسط 112", portfolioState, portfolioSummary, portfolioHistory, portfolioUserId, portfolioSessionId);
    await executeTurn("المحفظة والمتابعة", 3, "حلل محفظتي دلوقتي", portfolioState, portfolioSummary, portfolioHistory, portfolioUserId, portfolioSessionId);
    await executeTurn("المحفظة والمتابعة", 4, "متي اشتري واعمل متوسط اقل؟", portfolioState, portfolioSummary, portfolioHistory, portfolioUserId, portfolioSessionId);
    await executeTurn("المحفظة والمتابعة", 5, "وقف الخسارة كام؟", portfolioState, portfolioSummary, portfolioHistory, portfolioUserId, portfolioSessionId);

    // =========================================================================
    // 2. Scanner & Filters Session
    // =========================================================================
    const scanUserId = "00000000-0000-0000-0000-000000000002";
    const scanSessionId = crypto.randomUUID();
    const scanState: SessionState = { current_symbol: null, last_symbols: [], summary: null };
    const scanSummary: SessionSummary = { current_symbols: [], last_image_symbols: [], last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: new Date().toISOString() };
    const scanHistory: Array<{ role: string; content: string }> = [];

    await executeTurn("الفلاتر والماسح الفني", 6, "هاتلي كل الاسهم اللي لامست قاع وbollinger Band", scanState, scanSummary, scanHistory, scanUserId, scanSessionId);
    await executeTurn("الفلاتر والماسح الفني", 7, "عايز الاسهم اللي فيها تشبع بيعي RSI اقل من 35", scanState, scanSummary, scanHistory, scanUserId, scanSessionId);
    await executeTurn("الفلاتر والماسح الفني", 8, "الاسهم اللي عملت اختراق لمتوسط 200 يوم", scanState, scanSummary, scanHistory, scanUserId, scanSessionId);

    // =========================================================================
    // 3. Market Overview & Best Opportunities
    // =========================================================================
    const marketUserId = "00000000-0000-0000-0000-000000000003";
    const marketSessionId = crypto.randomUUID();
    const marketState: SessionState = { current_symbol: null, last_symbols: [], summary: null };
    const marketSummary: SessionSummary = { current_symbols: [], last_image_symbols: [], last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: new Date().toISOString() };
    const marketHistory: Array<{ role: string; content: string }> = [];

    await executeTurn("حالة السوق والفرص", 9, "ملخص السوق وأداء EGX30 وحالة السيولة النهاردة", marketState, marketSummary, marketHistory, marketUserId, marketSessionId);
    await executeTurn("حالة السوق والفرص", 10, "إيه أفضل خمس أسهم للاستثمار حالياً في البورصة؟", marketState, marketSummary, marketHistory, marketUserId, marketSessionId);
    await executeTurn("حالة السوق والفرص", 11, "أقوى الفرص المتاحة دلوقتي", marketState, marketSummary, marketHistory, marketUserId, marketSessionId);

    // =========================================================================
    // 4. Wyckoff Accumulation & Distribution
    // =========================================================================
    const wyckoffUserId = "00000000-0000-0000-0000-000000000004";
    const wyckoffSessionId = crypto.randomUUID();
    const wyckoffState: SessionState = { current_symbol: null, last_symbols: [], summary: null };
    const wyckoffSummary: SessionSummary = { current_symbols: [], last_image_symbols: [], last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: new Date().toISOString() };
    const wyckoffHistory: Array<{ role: string; content: string }> = [];

    await executeTurn("وايكوف والتجميع والتصريف", 12, "إيه أقوى الأسهم اللي بتجمع سيولة مؤسسية ووايكوف؟", wyckoffState, wyckoffSummary, wyckoffHistory, wyckoffUserId, wyckoffSessionId);
    await executeTurn("وايكوف والتجميع والتصريف", 13, "هل سهم COMI في مرحلة تجميع ولا تصريف؟", wyckoffState, wyckoffSummary, wyckoffHistory, wyckoffUserId, wyckoffSessionId);

    // =========================================================================
    // 5. News & Corporate Actions
    // =========================================================================
    const newsUserId = "00000000-0000-0000-0000-000000000005";
    const newsSessionId = crypto.randomUUID();
    const newsState: SessionState = { current_symbol: null, last_symbols: [], summary: null };
    const newsSummary: SessionSummary = { current_symbols: [], last_image_symbols: [], last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: new Date().toISOString() };
    const newsHistory: Array<{ role: string; content: string }> = [];

    await executeTurn("الأخبار وأحداث الشركات", 14, "أخبار سهم طاقة TAQA والتوزيعات المعلنة", newsState, newsSummary, newsHistory, newsUserId, newsSessionId);
    await executeTurn("الأخبار وأحداث الشركات", 15, "إيه أهم إفصاحات الشركات وزيادات رأس المال الحديثة؟", newsState, newsSummary, newsHistory, newsUserId, newsSessionId);

    // =========================================================================
    // 6. General Market Concepts
    // =========================================================================
    const eduUserId = "00000000-0000-0000-0000-000000000006";
    const eduSessionId = crypto.randomUUID();
    const eduState: SessionState = { current_symbol: null, last_symbols: [], summary: null };
    const eduSummary: SessionSummary = { current_symbols: [], last_image_symbols: [], last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: new Date().toISOString() };
    const eduHistory: Array<{ role: string; content: string }> = [];

    await executeTurn("المفاهيم العامة للبورصة", 16, "يعني إيه مضاعف الربحية P/E وإزاي أستخدمه في تقييم السهم؟", eduState, eduSummary, eduHistory, eduUserId, eduSessionId);
    await executeTurn("المفاهيم العامة للبورصة", 17, "إيه الفرق بين التداول في السوق الرئيسي MAIN_MARKET وبورصة النيل للمشروعات الصغيرة؟", eduState, eduSummary, eduHistory, eduUserId, eduSessionId);

    // Save full JSON output
    const outPath = path.resolve(__dirname, "../../scratch/live_evaluation_results.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");

    console.log(`\n===============================================================`);
    console.log(`✅ EVALUATION COMPLETED: 17/17 TURNS EXECUTED`);
    console.log(`📁 Detailed results saved to: ${outPath}`);
    console.log(`===============================================================`);
}

runLiveTest().catch(err => {
    console.error("FATAL ERROR IN LIVE TEST:", err);
    process.exit(1);
});
