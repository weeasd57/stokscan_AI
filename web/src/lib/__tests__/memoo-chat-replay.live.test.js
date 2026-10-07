const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load .env.local
const envPath = path.join(__dirname, "../../../.env.local");
if (fs.existsSync(envPath)) {
    for (const rawLine of fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.replace(/^\s*export\s+/, "");
        const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) continue;
        let value = match[2].trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        else value = value.replace(/\s+#.*$/, "").trim();
        process.env[match[1]] = value;
    }
}

const { runPipeline } = require("../ai/pipeline");
const { getNvidiaApiKeys, getDeepSeekApiKey } = require("../ai/server-secrets");
const { loadSessionState, loadSessionSummary } = require("../ai/session");

const describeLive = process.env.RUN_LIVE_CHAT_TESTS === "1" ? describe : describe.skip;
describeLive("Memoo User Chat Replay & Analysis", () => {
    let supabase;
    let apiKeys;
    const userId = "ba79856a-c6d9-48f7-a923-d2ccf6279dc6";
    // We use a fresh test session for clean replay, while testing the exact user account and portfolio
    const testSessionId = `replay_memoo_${Date.now()}`;

    beforeAll(() => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
        supabase = createClient(url, key);
        apiKeys = getNvidiaApiKeys();
    });

    test("Replay Question 1: 'الشاشة اللحظية' on current pipeline", async () => {
        const message = "الشاشة اللحظية";
        const sessionState = await loadSessionState(supabase, testSessionId, userId);
        const sessionSummary = await loadSessionSummary(supabase, testSessionId, userId);

        const result = await runPipeline(
            message,
            [],
            sessionState,
            sessionSummary,
            [],
            supabase,
            apiKeys,
            userId,
            testSessionId,
            `msg_q1_${Date.now()}`
        );

        console.log("\n=======================================================");
        console.log("=== [REPLAY RESULT: 'الشاشة اللحظية' (NEW PIPELINE)] ===");
        console.log("=======================================================");
        console.log(result.response);
        console.log("\nMetadata/Tools Used:", Object.keys(result.toolResults || {}));

        expect(result.response).toBeTruthy();
        expect(result.response.length).toBeGreaterThan(100);
    }, 60000);

    test("Replay Question 2: 'حلل محفظتي' on current pipeline with user's 10 positions", async () => {
        const message = "حلل محفظتي";
        const sessionState = await loadSessionState(supabase, testSessionId, userId);
        const sessionSummary = await loadSessionSummary(supabase, testSessionId, userId);

        const result = await runPipeline(
            message,
            [],
            sessionState,
            sessionSummary,
            [],
            supabase,
            apiKeys,
            userId,
            testSessionId,
            `msg_q2_${Date.now()}`
        );

        console.log("\n=======================================================");
        console.log("=== [REPLAY RESULT: 'حلل محفظتي' (NEW PIPELINE)] ===");
        console.log("=======================================================");
        console.log(result.response);
        console.log("\nLength:", result.response.length);

        expect(result.response).toBeTruthy();
        // Must NOT be the old terse bullet dump: "ملخص فني مختصر للبيانات الحالية:"
        expect(result.response).not.toContain("ملخص فني مختصر للبيانات الحالية");
    }, 90000);
});
