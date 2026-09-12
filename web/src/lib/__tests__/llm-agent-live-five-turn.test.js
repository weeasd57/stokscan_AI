const fs = require("fs");
const path = require("path");

for (const file of [path.join(__dirname, "../../../.env.local"), path.join(__dirname, "../../.env.local")]) {
  if (!fs.existsSync(file)) continue;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

const { getSupabaseClient } = require("../../lib/supabase/route-data");
const { runPipeline } = require("../ai/pipeline");
const { buildCompoundDeterministicPlan } = require("../ai/pipeline");
const { runPlanner } = require("../ai/planner");
const { executeStructuredTools } = require("../ai/tools-v2");
const { buildDeterministicResponse } = require("../ai/final-v2");
const { getDeepSeekApiKey, getNvidiaApiKeys } = require("../ai/server-secrets");

const QUESTIONS = [
  "جدوى أخباره إيه؟",
  "تحليل السيولة لـ GDWA",
  "إيه السهم أو القطاع المتوقع يرتفع الأسبوع ده؟",
  "أفضل الفرص المتاحة حالياً",
  "معايا سيولة ادخل في اي دلوقتي غير قطاع الادوية والمخابز علشان فيهم وطلعو الحمدالله خلاص",
  "عدد قطاعات البورصة كام؟",
  "السيولة فين؟",
  "إيه السهم أو القطاع المتوقع يرتفع؟",
  "أقوى زخم فني",
];

const HYBRID_SPECIALIZED_TOOLS = new Set([
  "get_sector_list",
  "get_sector_liquidity",
  "get_recommendations",
  "get_fair_value_scan",
  "get_technical_scan",
]);

const prices = { inputMiss: 0.15 / 1e6, output: 0.6 / 1e6 };
const usageLog = [];
const originalFetch = global.fetch;
let activeMode = "current";
let activeTurn = 0;

function safeCount(result) {
  const data = result?.data;
  if (Array.isArray(data?.stocks)) return data.stocks.length;
  if (Array.isArray(data?.market_period_ranking)) return data.market_period_ranking.length;
  if (Array.isArray(data)) return data.length;
  return data ? 1 : 0;
}

function summarizeTools(output) {
  return (output?.results || []).map((r) => ({
    tool: r.tool,
    count: safeCount(r),
    symbols: Array.isArray(r.symbols) ? r.symbols.slice(0, 12) : [],
    error: r.error || null,
  }));
}

async function callAgentDecision(message, plan, toolResults, session) {
  const key = getDeepSeekApiKey();
  if (!key) throw new Error("DEEPSEEK_API_KEY is not configured");
  const available = [
    "get_stock", "get_stock_levels", "get_news", "get_market", "get_sector",
    "get_sector_list", "get_sector_liquidity", "get_accumulation_stocks", "get_technical_scan",
    "get_comparison", "get_recommendations", "get_fair_value_scan",
  ];
  const body = {
    model: "deepseek-chat",
    temperature: 0,
    max_tokens: 220,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: 'أنت مراجع Agent مالي. راجع خطة وأدوات ونتائج موجودة. أعد JSON فقط: {"additional_tools":[],"sufficient":true,"reason":"...","suggested_questions":["..."]}. اقترح 2 أو 3 أسئلة متابعة متنوعة ومفيدة مرتبطة بالسؤال الحالي، ولا تضف أدوات إلا لو الطلب يحتاج بيانات غير موجودة.' },
      { role: "user", content: JSON.stringify({ message, plan: { intent: plan.intent, entities: plan.entities, tools: plan.tools }, results: toolResults, session, available }) },
    ],
  };
  const response = await originalFetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content || "{}";
  let parsed;
  try { parsed = JSON.parse(content); } catch { parsed = {}; }
  return { parsed, usage: json.usage || null };
}

async function callAgentFinal(message, plan, toolResults, session) {
  const key = getDeepSeekApiKey();
  const response = await originalFetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.15,
      max_tokens: 1200,
      messages: [
        { role: "system", content: "أجب بالعربية المصرية باختصار. استخدم نتائج الأدوات فقط. لا تخترع أرقاماً أو أسهماً. لو البيانات ناقصة اذكر ذلك بوضوح. هذه تجربة Agent." },
        { role: "user", content: JSON.stringify({ message, plan: { intent: plan.intent, entities: plan.entities }, tool_results: toolResults, session }) },
      ],
    }),
  });
  const json = await response.json();
  return { response: json.choices?.[0]?.message?.content || "", usage: json.usage || null };
}

function applyHybridGuard(message, llmPlan, session) {
  const deterministic = buildCompoundDeterministicPlan(message, session);
  const hasSpecializedRoute = (deterministic?.tools || []).some((tool) => HYBRID_SPECIALIZED_TOOLS.has(tool));
  if (deterministic?.clarification_needed) {
    return {
      ...llmPlan,
      ...deterministic,
      entities: { ...(llmPlan.entities || {}), ...(deterministic.entities || {}) },
      tools: [],
    };
  }
  if (!hasSpecializedRoute) return llmPlan;
  return {
    ...llmPlan,
    intent: deterministic.intent || llmPlan.intent,
    entities: { ...(llmPlan.entities || {}), ...(deterministic.entities || {}) },
    tools: deterministic.tools,
    needs_live_data: deterministic.needs_live_data !== false,
    needs_historical_data: Boolean(deterministic.needs_historical_data),
  };
}

function addUsage(mode, turn, stage, usage) {
  if (!usage) return;
  usageLog.push({ mode, turn, stage, usage });
}

function costFor(mode) {
  const rows = usageLog.filter((x) => x.mode === mode);
  const input = rows.reduce((n, x) => n + Number(x.usage.prompt_tokens || x.usage.input_tokens || 0), 0);
  const output = rows.reduce((n, x) => n + Number(x.usage.completion_tokens || x.usage.output_tokens || 0), 0);
  return { calls: rows.length, input_tokens: input, output_tokens: output, usd_offpeak: input * prices.inputMiss + output * prices.output };
}

describe("Live LLM Agent comparison", () => {
  const live = process.env.RUN_LIVE_CHAT_TESTS === "1" ? test : test.skip;

  live("runs current and LLM-tool-review-final flows and writes a cost report", async () => {
    const supabase = getSupabaseClient();
    const apiKeys = [...getNvidiaApiKeys(), getDeepSeekApiKey()].filter(Boolean);
    const records = [];
    const currentState = { current_symbol: null, last_symbols: [], summary: null, current_sector: null };
    const hybridState = { current_symbol: null, last_symbols: [], summary: null, current_sector: null };
    const currentHistory = [];
    const hybridHistory = [];

    global.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = String(args[0]);
      if (url.includes("api.deepseek.com")) {
        const copy = response.clone();
        try {
          const json = await copy.json();
          addUsage(activeMode, activeTurn, activeMode === "agent" ? "planner" : "pipeline", json.usage);
        } catch {}
      }
      return response;
    };

    try {
      for (let i = 0; i < QUESTIONS.length; i++) {
        const message = QUESTIONS[i];
        const currentStart = Date.now();
        activeMode = "current";
        activeTurn = i + 1;
        const current = await runPipeline(message, [], currentState, null, currentHistory.slice(-8), supabase, apiKeys, "agent-cost-test-current", "", `agent-current-${i}`);
        const currentMs = Date.now() - currentStart;
        if (current.session_update) Object.assign(currentState, current.session_update);
        currentHistory.push({ role: "user", content: message }, { role: "assistant", content: String(current.response || "").slice(0, 400) });

        const agentStart = Date.now();
        activeMode = "hybrid";
        activeTurn = i + 1;
        const planner = await runPlanner(message, [], hybridState, hybridHistory.slice(-8), apiKeys, null);
        const plannerMs = Date.now() - agentStart;
        const normalizedPlan = {
          ...planner,
          tools: Array.isArray(planner.tools) ? planner.tools : [],
          entities: { symbols: [], sector: null, timeframe: "current", ...(planner.entities || {}) },
          needs_live_data: planner.needs_live_data !== false,
          needs_historical_data: Boolean(planner.needs_historical_data),
          needs_vision_context: false,
          needs_history: false,
          clarification_needed: false,
          resolved_from: { symbol: null, message_id: null },
        };
        const hybridPlan = applyHybridGuard(message, normalizedPlan, hybridState);
        if (hybridPlan.clarification_needed) {
          const clarification = buildDeterministicResponse(message, hybridPlan, []);
          records.push({
            turn: i + 1,
            message,
            current: { intent: current.plan?.intent, tools: current.plan?.tools, ms: currentMs, response: current.response },
            hybrid: {
              intent: hybridPlan.intent,
              tools: [],
              guard_applied: true,
              clarification_needed: true,
              clarification_options: hybridPlan.clarification_options || [],
              extra_tools: [],
              planner_ms: plannerMs,
              response: clarification,
              suggested_questions: [],
              review: null,
              results: [],
            },
          });
          if (hybridPlan.session_update) Object.assign(hybridState, hybridPlan.session_update);
          hybridHistory.push({ role: "user", content: message }, { role: "assistant", content: String(clarification || "").slice(0, 400) });
          continue;
        }
        const firstTools = await executeStructuredTools(supabase, hybridPlan, apiKeys, "", `hybrid-${i}`, message, hybridHistory.slice(-8));
        const review = await callAgentDecision(message, hybridPlan, firstTools.results, hybridState);
        addUsage("hybrid", i + 1, "review", review.usage);
        const extra = Array.isArray(review.parsed?.additional_tools) ? review.parsed.additional_tools.filter((x) => typeof x === "string") : [];
        const extraTools = extra.filter((x) => !hybridPlan.tools.includes(x));
        const agentPlan = { ...hybridPlan, tools: [...new Set([...(hybridPlan.tools || []), ...extraTools])] };
        const secondTools = extraTools.length
          ? await executeStructuredTools(supabase, {
              ...agentPlan,
              tools: extraTools,
              entities: { symbols: [], sector: null, timeframe: "current", ...(agentPlan.entities || {}) },
              needs_live_data: true,
              needs_historical_data: Boolean(agentPlan.needs_historical_data),
            }, apiKeys, "", `hybrid-${i}`, message, hybridHistory.slice(-8))
          : { results: [] };
        const mergedResults = [...firstTools.results, ...secondTools.results.filter((r) => !firstTools.results.some((x) => x.tool === r.tool))];
        const final = await callAgentFinal(message, agentPlan, mergedResults, hybridState);
        addUsage("hybrid", i + 1, "final", final.usage);
        if (agentPlan.session_update) Object.assign(hybridState, agentPlan.session_update);
        hybridHistory.push({ role: "user", content: message }, { role: "assistant", content: final.response.slice(0, 400) });
        records.push({ turn: i + 1, message, current: { intent: current.plan?.intent, tools: current.plan?.tools, clarification_needed: Boolean(current.plan?.clarification_needed), clarification_options: current.plan?.clarification_options || [], ms: currentMs, response: current.response }, hybrid: { intent: agentPlan.intent, tools: agentPlan.tools, guard_applied: (buildCompoundDeterministicPlan(message, hybridState)?.tools || []).some((tool) => HYBRID_SPECIALIZED_TOOLS.has(tool)), clarification_needed: Boolean(agentPlan.clarification_needed), clarification_options: agentPlan.clarification_options || [], extra_tools: extraTools, planner_ms: plannerMs, response: final.response, suggested_questions: Array.isArray(review.parsed?.suggested_questions) ? review.parsed.suggested_questions.slice(0, 3) : [], review: review.parsed, results: summarizeTools({ results: mergedResults }) } });
      }
    } finally {
      global.fetch = originalFetch;
    }


    const currentCost = costFor("current");
    const hybridCost = costFor("hybrid");
    const ambiguousRecords = records.filter((record) => record.message === "إيه السهم أو القطاع المتوقع يرتفع؟");
    for (const record of ambiguousRecords) {
      expect(record.hybrid.clarification_needed).toBe(true);
      expect(record.hybrid.tools).toEqual([]);
      expect(record.hybrid.clarification_options.length).toBeGreaterThan(2);
      expect(record.hybrid.results).toEqual([]);
    }
    const report = { generated_at: new Date().toISOString(), pricing: prices, current: currentCost, hybrid: hybridCost, increase_percent: currentCost.usd_offpeak ? ((hybridCost.usd_offpeak / currentCost.usd_offpeak) - 1) * 100 : null, records };
    fs.writeFileSync(path.join(__dirname, "../../../llm_agent_live_report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ current: currentCost, hybrid: hybridCost, increase_percent: report.increase_percent, report: "llm_agent_live_report.json" }, null, 2));
    expect(records).toHaveLength(QUESTIONS.length);
  }, 300000);
});
