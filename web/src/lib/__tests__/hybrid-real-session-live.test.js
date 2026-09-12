const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const envPath = path.join(__dirname, "../../../.env.local");
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = raw.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

const { createClient } = require("@supabase/supabase-js");
const { runPipeline } = require("../ai/pipeline");
const { getDeepSeekApiKey, getNvidiaApiKeys } = require("../ai/server-secrets");

const live = process.env.RUN_LIVE_CHAT_TESTS === "1" ? test : test.skip;
const QUESTIONS = [
  "عدد قطاعات البورصة المصرية بتاريخ 2026-09-10؟",
  "فين السيولة بين القطاعات بتاريخ 2026-09-10؟",
  "هات أسهم تجميع في قطاع البنوك بتاريخ 2026-09-10 بدرجة تجميع أعلى من 70 ونسبة حجم أعلى من 1.2",
  "قارن COMI وEAST بتاريخ 2026-09-10، واذكر أخبار السهمين في نفس الفترة",
  "هات الأسهم فوق القيمة الفنية بتاريخ 2026-09-10 مع تجميع ونسبة حجم أعلى من 1.5، واستبعد الأدوية والعقارات",
  "إيه السهم أو القطاع المتوقع يرتفع؟",
];

describe("Hybrid production pipeline with real Supabase session", () => {
  live("runs dated sectors, filters, compound requests, and clarification in one session", async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const email = `hybrid-live-${Date.now()}@example.invalid`;
    const password = crypto.randomUUID();
    const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError || !auth.user) throw new Error(authError?.message || "Unable to create test user");
    const userId = auth.user.id;
    const sessionId = crypto.randomUUID();
    const { error: sessionError } = await supabase.from("ai_chat_sessions").insert({ id: sessionId, user_id: userId, title: "hybrid production live test" });
    if (sessionError) throw new Error(sessionError.message);

    const apiKeys = [...getNvidiaApiKeys(), getDeepSeekApiKey()].filter(Boolean);
    const state = { current_symbol: null, last_symbols: [], summary: null, current_sector: null };
    const history = [];
    const records = [];
    try {
      for (const message of QUESTIONS) {
        const started = Date.now();
        const result = await runPipeline(message, [], state, null, history.slice(-8), supabase, apiKeys, userId, sessionId, crypto.randomUUID());
        const record = {
          message,
          latency_ms: Date.now() - started,
          intent: result.plan.intent,
          clarification_needed: result.plan.clarification_needed,
          clarification_options: result.plan.clarification_options || [],
          tools: result.plan.tools,
          executed_tools: (result.tools?.results || []).map((item) => item.tool),
          result_counts: (result.tools?.results || []).map((item) => ({ tool: item.tool, symbols: item.symbols || [], count: Array.isArray(item.data?.stocks) ? item.data.stocks.length : Array.isArray(item.data?.sectors) ? item.data.sectors.length : Array.isArray(item.data) ? item.data.length : item.data ? 1 : 0, error: item.error || null })),
          response: result.response,
        };
        records.push(record);
        if (result.session_update) Object.assign(state, result.session_update);
        history.push({ role: "user", content: message }, { role: "assistant", content: String(result.response || "").slice(0, 600) });
      }
    } finally {
      await supabase.from("ai_chat_messages").delete().eq("session_id", sessionId);
      await supabase.from("ai_chat_facts").delete().eq("session_id", sessionId);
      await supabase.from("ai_chat_sessions").delete().eq("id", sessionId);
      await supabase.auth.admin.deleteUser(userId);
    }

    fs.writeFileSync(path.join(__dirname, "../../../hybrid_real_session_report.json"), JSON.stringify({ generated_at: new Date().toISOString(), user_id: userId, session_id: sessionId, records }, null, 2));
    expect(records).toHaveLength(QUESTIONS.length);
    const bankScan = records.find((record) => record.message.includes("قطاع البنوك"));
    expect(bankScan?.executed_tools).toContain("get_accumulation_stocks");
    expect(bankScan?.response).not.toMatch(/\b(?:ISMA|NCCW|EPCO|MPCO|POUL|TANM|TWSA)\b/);
    const fairScan = records.find((record) => record.message.includes("فوق القيمة الفنية"));
    if (fairScan) {
      const fair = fairScan.result_counts.find((item) => item.tool === "get_fair_value_scan");
      const accumulation = fairScan.result_counts.find((item) => item.tool === "get_accumulation_stocks");
      if (fair && accumulation) expect(accumulation.symbols.every((symbol) => fair.symbols.includes(symbol))).toBe(true);
    }
    const clarification = records.find((record) => record.message === "إيه السهم أو القطاع المتوقع يرتفع؟");
    expect(clarification?.clarification_needed).toBe(true);
    expect(clarification?.executed_tools || []).toEqual([]);
  }, 360000);
});
