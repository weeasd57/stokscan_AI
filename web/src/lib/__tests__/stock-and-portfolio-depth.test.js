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

describe("Stock and Portfolio Depth Live Verification", () => {
    let supabase;
    let apiKeys;
    let userId;
    let sessionId;

    beforeAll(() => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
        supabase = createClient(url, key);
        apiKeys = getNvidiaApiKeys();
        userId = "3e985e18-840d-48e6-b502-51051760bbd0";
        sessionId = `depth_test_${Date.now()}`;
    });

    test("Bare ticker query 'afmc' yields full structured analysis path", async () => {
        const message = "afmc";
        const sessionState = await loadSessionState(supabase, sessionId, userId);
        const sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

        const result = await runPipeline(
            message,
            [],
            sessionState,
            sessionSummary,
            [],
            supabase,
            apiKeys,
            userId,
            sessionId,
            `msg_afmc_${Date.now()}`
        );

        console.log("\n=== [BARE TICKER 'afmc' RESPONSE] ===");
        console.log(result.response);

        expect(result.response).toBeTruthy();
        // Must NOT fall back to terse raw bullet template
        expect(result.response).not.toContain("ملخص فني مختصر للبيانات الحالية");
        // Must contain ticker or price and technical details
        expect(result.response).toMatch(/AFMC|147\.05|الإسكندرية|مطاحن/i);
        expect(result.response).toMatch(/RSI|دعم|مقاوم/i);
        // Rich content length — not just 3 lines of 50 chars
        expect(result.response.length).toBeGreaterThan(150);
    }, 60000);

    test("Portfolio analysis 'حلل المحفظة' provides rich analysis", async () => {
        const message = "حلل المحفظة";
        const sessionState = await loadSessionState(supabase, sessionId, userId);
        const sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

        const result = await runPipeline(
            message,
            [],
            sessionState,
            sessionSummary,
            [],
            supabase,
            apiKeys,
            userId,
            sessionId,
            `msg_port_${Date.now()}`
        );

        console.log("\n=== [PORTFOLIO ANALYSIS RESPONSE] ===");
        console.log(result.response);

        expect(result.response).toBeTruthy();
        // Either analyzes the saved portfolio positions or cleanly guides user if empty
        if (result.response.includes("محفظتك فاضية") || result.response.includes("سجّل أسهمك")) {
            expect(result.response).toContain("محفظتك");
        } else {
            // If positions exist, must not be raw unformatted dump
            expect(result.response).not.toContain("ملخص فني مختصر للبيانات الحالية");
            expect(result.response.length).toBeGreaterThan(150);
        }
    }, 60000);
});
