const { createClient } = require("@supabase/supabase-js");
const { runPipeline } = require("../ai/pipeline");
const { getNvidiaApiKeys } = require("../ai/server-secrets");
const { evidenceViolations } = require("../ai/response-evidence");

const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;
liveTest.each(["الشاشة اللحظية", "أخبار ORWE اليوم", "تحليل السيولة لـ ORWE"])("publication evidence with real tools: %s", async message => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    // Non-UUID IDs intentionally disable session persistence; never write to a customer's chat.
    const result = await runPipeline(message, [], { current_symbol: null, last_symbols: [], summary: null }, null, [],
        supabase, getNvidiaApiKeys(), "evidence-evaluation", "evidence-evaluation", `evaluation-${Date.now()}`);
    expect(result.tools.results.length).toBeGreaterThan(0);
    expect(result.response).not.toMatch(/تعذر التحقق من إجابة|تعذر إكمال التحليل/);
    expect(evidenceViolations(result.response, message, result.tools.results)).toEqual([]);
    if (message === "الشاشة اللحظية") {
        expect(result.response).toMatch(/ليست.*لحظية|لا تتوفر.*لحظية|غير.*لحظية/);
        expect(result.response).toContain("EGX30");
    }
    if (message.includes("السيولة")) expect(result.response).toContain("ORWE");
}, 120000);
