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
const { evidenceViolations } = require("../ai/response-evidence");

describe("Comprehensive Multi-Turn Architecture Verification", () => {
    let supabase;
    let apiKeys;
    let userId;
    let sessionId;
    let history;
    let sessionState;
    let sessionSummary;
    let testImageBase64;

    beforeAll(() => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
        supabase = createClient(url, key);
        apiKeys = getNvidiaApiKeys();
        userId = "3e985e18-840d-48e6-b502-51051760bbd0"; // test user
        sessionId = `verify_session_${Date.now()}`;
        history = [];

        const imgPath = path.resolve("C:/Users/MR__CODER__/.gemini/antigravity/brain/d22a5115-9326-4ca5-8efc-7388e3d1a360/.user_uploaded/media_1790624762609.png");
        if (fs.existsSync(imgPath)) {
            const buf = fs.readFileSync(imgPath);
            testImageBase64 = `data:image/png;base64,${buf.toString("base64")}`;
        }
    });

    test("Turn 1: Portfolio image upload & holistic holding analysis", async () => {
        if (!testImageBase64) return;
        const message = "شوف الصورة دي وقولي رأيك في الأسهم ومحفظتي واعمل ايه";
        sessionState = await loadSessionState(supabase, sessionId, userId);
        sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

        const result = await runPipeline(
            message,
            [testImageBase64],
            sessionState,
            sessionSummary,
            history,
            supabase,
            apiKeys,
            userId,
            sessionId,
            `msg_1_${Date.now()}`
        );

        console.log("\n=== [TURN 1: Portfolio Image Response] ===");
        console.log(`Intent: ${result.plan.intent} | Tools: ${result.tools.results.map(r => r.tool).join(", ")}`);
        console.log(result.response);

        expect(result.response).toBeTruthy();
        expect(result.response).not.toContain("تعذر إكمال التحليل");
        
        history.push({ role: "user", content: message });
        history.push({ role: "assistant", content: result.response });
    }, 90000);

    test("Turn 2: Conversational follow-up to bot's choice question", async () => {
        const lastMsg = history.length ? history[history.length - 1].content : "";
        let reply = "مضاربة سريعة";
        if (/قطاع/i.test(lastMsg)) reply = "قطاع العقارات";
        else if (/تجميع/i.test(lastMsg)) reply = "تجميع";

        sessionState = await loadSessionState(supabase, sessionId, userId);
        sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

        const result = await runPipeline(
            reply,
            [],
            sessionState,
            sessionSummary,
            history,
            supabase,
            apiKeys,
            userId,
            sessionId,
            `msg_2_${Date.now()}`
        );

        console.log("\n=== [TURN 2: Conversational Choice Response] ===");
        console.log(`Intent: ${result.plan.intent} | Tools: ${result.tools.results.map(r => r.tool).join(", ")}`);
        console.log(result.response);

        // Verification: Bot MUST NOT claim "سؤالك غير واضح" or "حدد السهم"
        expect(result.response).not.toMatch(/(?:سؤالك|طلبك).*(?:غير واضح|مش واضح|مبهم)/);
        expect(result.response).not.toContain("غير مدرج في قاعدة بيانات الأسهم الرئيسية الـ 236");

        history.push({ role: "user", content: reply });
        history.push({ role: "assistant", content: result.response });
    }, 90000);

    test("Turn 3: Market status & EGX30 index enquiry", async () => {
        const message = "طب قولي حالة السوق ايه النهارده والمؤشر الرئيسي EGX30 اخباره ايه؟";
        sessionState = await loadSessionState(supabase, sessionId, userId);
        sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

        const result = await runPipeline(
            message,
            [],
            sessionState,
            sessionSummary,
            history,
            supabase,
            apiKeys,
            userId,
            sessionId,
            `msg_3_${Date.now()}`
        );

        console.log("\n=== [TURN 3: Market Status Response] ===");
        console.log(`Intent: ${result.plan.intent} | Tools: ${result.tools.results.map(r => r.tool).join(", ")}`);
        console.log(result.response);

        expect(result.response).toContain("EGX30");
        const violations = evidenceViolations(result.response, message, result.tools.results);
        expect(violations).toEqual([]);

        history.push({ role: "user", content: message });
        history.push({ role: "assistant", content: result.response });
    }, 90000);

    test("Turn 4: Liquidity & Wyckoff institutional accumulation/distribution", async () => {
        const message = "مين أكتر الأسهم اللي عليها تجميع وسيولة مؤسسية دلوقتي في السوق؟";
        sessionState = await loadSessionState(supabase, sessionId, userId);
        sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

        const result = await runPipeline(
            message,
            [],
            sessionState,
            sessionSummary,
            history,
            supabase,
            apiKeys,
            userId,
            sessionId,
            `msg_4_${Date.now()}`
        );

        console.log("\n=== [TURN 4: Liquidity & Wyckoff Response] ===");
        console.log(`Intent: ${result.plan.intent} | Tools: ${result.tools.results.map(r => r.tool).join(", ")}`);
        console.log(result.response);

        expect(result.plan.tools).toContain("get_accumulation_stocks");
        expect(result.response).toMatch(/(?:تجميع|وايكوف|Wyckoff|مؤسسية)/i);

        history.push({ role: "user", content: message });
        history.push({ role: "assistant", content: result.response });
    }, 90000);

    test("Turn 5: News validation (verifying honest disclosure when no news is published today)", async () => {
        const message = "هاتلي أخبار سهم ORWE النهارده ايه";
        sessionState = await loadSessionState(supabase, sessionId, userId);
        sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

        const result = await runPipeline(
            message,
            [],
            sessionState,
            sessionSummary,
            history,
            supabase,
            apiKeys,
            userId,
            sessionId,
            `msg_5_${Date.now()}`
        );

        console.log("\n=== [TURN 5: News Verification Response] ===");
        console.log(`Intent: ${result.plan.intent} | Tools: ${result.tools.results.map(r => r.tool).join(", ")}`);
        console.log(result.response);

        expect(result.tools.results.some(r => r.tool === "get_news")).toBe(true);
        // It must NOT invent headlines or present 0 news as 3 records
        expect(result.response).not.toContain("عدد الأخبار 0");
        const violations = evidenceViolations(result.response, message, result.tools.results);
        expect(violations).toEqual([]);

        history.push({ role: "user", content: message });
        history.push({ role: "assistant", content: result.response });
    }, 90000);

    test("Turn 6: Colloquial implicit follow-up to prior stock (ORWE)", async () => {
        const message = "طب وسيولته ومستويات الدعم والمقاومة بتاعته عاملة ايه دلوقتي؟";
        sessionState = await loadSessionState(supabase, sessionId, userId);
        sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

        const result = await runPipeline(
            message,
            [],
            sessionState,
            sessionSummary,
            history,
            supabase,
            apiKeys,
            userId,
            sessionId,
            `msg_6_${Date.now()}`
        );

        console.log("\n=== [TURN 6: Implicit Pronoun Follow-up Response] ===");
        console.log(`Intent: ${result.plan.intent} | Tools: ${result.tools.results.map(r => r.tool).join(", ")}`);
        console.log(`Symbols: ${result.plan.entities.symbols.join(", ")}`);
        console.log(result.response);

        // It must resolve to ORWE from the previous turn without explicit ticker mention
        expect(result.plan.entities.symbols).toContain("ORWE");
        expect(result.response).toMatch(/(?:ORWE|النساجون)/i);
        const violations = evidenceViolations(result.response, message, result.tools.results);
        expect(violations).toEqual([]);
    }, 90000);
});
