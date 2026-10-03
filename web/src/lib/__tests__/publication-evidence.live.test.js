const { createClient } = require("@supabase/supabase-js");
const { runPipeline } = require("../ai/pipeline");
const { getNvidiaApiKeys } = require("../ai/server-secrets");
const { evidenceViolations } = require("../ai/response-evidence");
const { safeEvidenceResponse } = require("../ai/response-evidence");
const { runAnswerGate } = require("../ai/answer-gate");
const { buildFactRecords } = require("../ai/facts");

const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;
liveTest.each(["الشاشة اللحظية", "أخبار ORWE اليوم", "تحليل السيولة لـ ORWE"])("publication evidence with real tools: %s", async message => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    // Non-UUID IDs intentionally disable session persistence; never write to a customer's chat.
    const result = await runPipeline(message, [], { current_symbol: null, last_symbols: [], summary: null }, null, [],
        supabase, getNvidiaApiKeys(), "evidence-evaluation", "evidence-evaluation", `evaluation-${Date.now()}`);
    expect(result.tools.results.length).toBeGreaterThan(0);
    if (/تعذر التحقق من إجابة/.test(result.response)) {
        const reply = safeEvidenceResponse(message, result.tools.results);
        console.log("Fallback diagnostic", { message, reply, review: result.publication_review, gate: runAnswerGate({ reply, plan: result.plan, toolResults: result.tools.results, userMessage: message, facts: buildFactRecords(result.tools.results) }) });
    }
    expect(result.response).not.toMatch(/تعذر التحقق من إجابة|تعذر إكمال التحليل/);
    expect(evidenceViolations(result.response, message, result.tools.results)).toEqual([]);
    if (message === "الشاشة اللحظية") {
        expect(result.response).toMatch(/ليست.*لحظية|لا تتوفر.*لحظية|غير.*لحظية/);
        expect(result.response).toContain("EGX30");
    }
    if (message.includes("السيولة")) expect(result.response).toMatch(/ORWE|النساجون الشرقيون/);
}, 120000);
