const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { runPlanner } = require("../ai/planner");
const { runPipeline } = require("../ai/pipeline");
const { executeStructuredTools } = require("../ai/tools-v2");
const { buildDeterministicResponse } = require("../ai/final-v2");
const { buildExcelTables } = require("../ai/excel-tables");

const QUESTIONS = [
  "جدوى أخباره إيه؟",
  "تحليل السيولة لـ GDWA",
  "إيه السهم أو القطاع المتوقع يرتفع الأسبوع ده؟",
  "أفضل الفرص المتاحة حالياً",
  "معايا سيولة ادخل في اي دلوقتي غير قطاع الادوية والمخابز علشان فيهم وطلعو الحمدالله خلاص",
];
const INITIAL_STATE = () => ({
  current_symbol: null,
  last_symbols: [],
  summary: null,
});
const apiKeys = () =>
  Array.from(
    new Set(
      [
        process.env.NVIDIA_API_KEY,
        process.env.NVIDIA_SECONDARY_API_KEY,
        process.env.NVIDIA_NIM_API_KEY,
      ].filter(Boolean),
    ),
  );

function normalizePlannerResult(raw, state) {
  const entities = raw?.entities || {};
  const sessionUpdate = raw?.session_update || {};
  return {
    intent: raw?.intent || "general_chat",
    confidence: Number(raw?.confidence || 0),
    guidance_intent: raw?.guidance_intent ?? null,
    entities: {
      reference: entities.reference ?? null,
      symbols: Array.isArray(entities.symbols) ? entities.symbols : [],
      sector: entities.sector ?? null,
      timeframe: entities.timeframe || "unspecified",
      requested_date: entities.requested_date ?? null,
      requested_start_date: entities.requested_start_date ?? null,
      requested_end_date: entities.requested_end_date ?? null,
      scan_direction: entities.scan_direction ?? null,
      fair_value_direction: entities.fair_value_direction ?? null,
      require_distribution: entities.require_distribution,
      require_accumulation: entities.require_accumulation,
      min_acc_score: entities.min_acc_score ?? null,
      min_vol_ratio: entities.min_vol_ratio ?? null,
      max_dist_score: entities.max_dist_score ?? null,
      min_consecutive_acc_days: entities.min_consecutive_acc_days ?? null,
      recommendation_order: entities.recommendation_order ?? null,
    },
    needs_vision_context: false,
    needs_history: false,
    needs_live_data: Array.isArray(raw?.tools) && raw.tools.length > 0,
    needs_historical_data:
      Array.isArray(raw?.tools) &&
      raw.tools.some(
        (tool) =>
          tool === "get_price_history" || raw.intent === "historical_recall",
      ),
    tools: Array.isArray(raw?.tools) ? raw.tools : [],
    clarification_needed: false,
    resolved_from: { symbol: null, message_id: null },
    planner_session_update: {
      current_symbol: sessionUpdate.current_symbol ?? state.current_symbol,
      last_symbols: Array.isArray(sessionUpdate.last_symbols)
        ? sessionUpdate.last_symbols
        : state.last_symbols,
      summary: sessionUpdate.summary ?? null,
    },
  };
}

function resultCount(data) {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return data == null ? 0 : 1;
  for (const key of [
    "stocks",
    "rows",
    "scan_rows",
    "articles",
    "sectors",
    "recommendations",
    "signals",
    "prices",
  ]) {
    if (Array.isArray(data[key])) return data[key].length;
  }
  return Object.keys(data).length ? 1 : 0;
}

function toolEvidence(results) {
  return results.map((result) => ({
    tool: result.tool,
    count: resultCount(result.data),
    data_time: result.data_time,
    data_type: result.data_type,
    symbols: Array.isArray(result.symbols) ? result.symbols : [],
    error: result.error || null,
  }));
}

function safeText(value) {
  return String(value || "")
    .replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, "")
    .trim();
}

function groundingConflicts(message, plan, evidence, response) {
  const requested = new Set(
    (plan.entities?.symbols || []).map((s) => String(s).toUpperCase()),
  );
  const returned = new Set(
    evidence
      .flatMap((result) =>
        Array.isArray(result.symbols) ? result.symbols : [],
      )
      .map((s) => String(s).toUpperCase()),
  );
  const mentioned = Array.from(
    new Set(
      (safeText(response).match(/\b[A-Z]{2,6}\b/g) || []).map((s) =>
        s.toUpperCase(),
      ),
    ),
  );
  return {
    requested_missing_from_results: Array.from(requested).filter(
      (symbol) => !returned.has(symbol),
    ),
    result_symbols_not_requested: Array.from(returned).filter(
      (symbol) => requested.size > 0 && !requested.has(symbol),
    ),
    response_symbols_without_result_evidence: mentioned.filter(
      (symbol) => !returned.has(symbol),
    ),
    says_no_data_with_results:
      /لا توجد بيانات|مفيش بيانات|لم أجد بيانات|no data/i.test(
        safeText(response),
      ) && evidence.some((result) => result.count > 0),
    stale_context_risk:
      plan.entities?.symbols?.length === 0 &&
      returned.size > 0 &&
      !/(GDWA|قطاع|سهم|الأسهم|الفرص|السيولة)/i.test(message),
  };
}

function recordBase(
  turn,
  message,
  mode,
  before,
  plan,
  evidence,
  response,
  timings,
  errors,
  tables,
) {
  return {
    turn,
    message,
    mode,
    intent: plan?.intent || null,
    symbols: plan?.entities?.symbols || [],
    entities: plan?.entities || null,
    tools_selected: plan?.tools || [],
    tools_executed: evidence.map((item) => item.tool),
    planner_ms: timings.planner_ms,
    tools_ms: timings.tools_ms,
    finalization_ms: timings.finalization_ms,
    total_ms: timings.total_ms,
    tool_results: evidence,
    response: safeText(response),
    errors,
    warnings: response == null ? ["deterministic_finalizer_returned_null"] : [],
    session_before: before,
    session_after: null,
    summary_before: null,
    summary_after: null,
    grounding: groundingConflicts(
      message,
      plan || { entities: {} },
      evidence,
      response,
    ),
    tables: tables || [],
  };
}

function markdownReport(report) {
  const byTurn = (turn) => report.filter((item) => item.turn === turn);
  const rows = QUESTIONS.map((message, index) => {
    const [llm, current] = byTurn(index + 1);
    return `| ${index + 1} | ${message} | ${llm?.intent || ""} | ${current?.intent || ""} | ${(llm?.tools_selected || []).join(", ")} | ${(current?.tools_selected || []).join(", ")} | ${llm?.total_ms ?? ""} | ${current?.total_ms ?? ""} | ${llm && current ? llm.total_ms - current.total_ms : ""} |`;
  });
  const conflicts = report.flatMap((item) =>
    Object.entries(item.grounding || {})
      .filter(([, value]) => (Array.isArray(value) ? value.length : value))
      .map(
        ([key, value]) =>
          `- Turn ${item.turn} (${item.mode}): ${key}: ${JSON.stringify(value)}`,
      ),
  );
  return `# Planner Comparison Report\n\n| Turn | Question | LLM intent | Current intent | LLM tools | Current tools | LLM ms | Current ms | Delta |\n|---:|---|---|---|---|---|---:|---:|---:|\n${rows.join("\n")}\n\n## Grounding Conflicts\n${conflicts.length ? conflicts.join("\n") : "No recorded conflicts."}\n`;
}

async function createFixture(supabase, label) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `planner-compare-${label}-${Date.now()}@example.invalid`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(error?.message || "Unable to create comparison user");
  const sessionId = crypto.randomUUID();
  const session = await supabase.from("ai_chat_sessions").insert({
    id: sessionId,
    user_id: data.user.id,
    title: `planner comparison ${label}`,
  });
  if (session.error) throw new Error(session.error.message);
  return { userId: data.user.id, sessionId };
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const keys = apiKeys();
  if (!keys.length && !process.env.DEEPSEEK_OFFICIAL_API_KEY)
    throw new Error("No planner API key configured");
  const fixtures = await Promise.all([
    createFixture(supabase, "llm"),
    createFixture(supabase, "current"),
  ]);
  const report = [];
  const arms = [
    { mode: "llm_planner_first", fixture: fixtures[0] },
    { mode: "current_pipeline", fixture: fixtures[1] },
  ];
  try {
    for (const arm of arms) {
      let state = INITIAL_STATE();
      let summary = null;
      const history = [];
      for (let index = 0; index < QUESTIONS.length; index++) {
        const message = QUESTIONS[index];
        const before = { ...state, last_symbols: [...state.last_symbols] };
        const summaryBefore = summary;
        const started = Date.now();
        let plan;
        let evidence = [];
        let response = null;
        let timings = {
          planner_ms: null,
          tools_ms: null,
          finalization_ms: null,
          total_ms: 0,
        };
        let errors = [];
        try {
          if (arm.mode === "llm_planner_first") {
            const plannerStarted = Date.now();
            const raw = await runPlanner(
              message,
              [],
              state,
              history,
              keys,
              null,
            );
            timings.planner_ms = Date.now() - plannerStarted;
            plan = normalizePlannerResult(raw, state);
            const toolsStarted = Date.now();
            const tools = await executeStructuredTools(
              supabase,
              plan,
              keys,
              arm.fixture.userId,
              arm.fixture.sessionId,
              message,
            );
            timings.tools_ms = Date.now() - toolsStarted;
            evidence = toolEvidence(tools.results);
            const finalStarted = Date.now();
            response = buildDeterministicResponse(
              message,
              plan,
              tools.results,
              state,
            );
            timings.finalization_ms = Date.now() - finalStarted;
            const tables = buildExcelTables(tools.results, null);
            plan.comparison_tables = tables.map((table) => ({
              id: table.id,
              title: table.title,
              row_count: table.rows.length,
            }));
            const resultSymbols = Array.from(
              new Set([
                ...(plan.entities.symbols || []),
                ...tools.results.flatMap((result) =>
                  Array.isArray(result.symbols) ? result.symbols : [],
                ),
              ]),
            );
            state = {
              ...state,
              current_symbol:
                resultSymbols[0] || plan.planner_session_update.current_symbol,
              last_symbols: Array.from(
                new Set([...resultSymbols, ...state.last_symbols]),
              ).slice(0, 15),
              summary: message,
            };
          } else {
            const result = await runPipeline(
              message,
              [],
              state,
              summary,
              history,
              supabase,
              keys,
              arm.fixture.userId,
              arm.fixture.sessionId,
              `planner-compare-${index}-${Date.now()}`,
            );
            plan = result.plan;
            evidence = toolEvidence(result.tools.results);
            response = result.response;
            state = { ...state, ...result.session_update };
            timings.total_ms = Date.now() - started;
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
        timings.total_ms = Date.now() - started;
        const tables = plan?.comparison_tables || [];
        if (plan?.comparison_tables) delete plan.comparison_tables;
        const record = recordBase(
          index + 1,
          message,
          arm.mode,
          before,
          plan || { entities: {}, tools: [] },
          evidence,
          response,
          timings,
          errors,
          tables,
        );
        record.session_after = {
          ...state,
          last_symbols: [...state.last_symbols],
        };
        record.summary_before = summaryBefore;
        summary = {
          current_symbols: [...state.last_symbols],
          last_image_symbols: [],
          last_topic: null,
          open_references: [],
          last_data_date: new Date().toISOString().slice(0, 10),
          last_vision_context: null,
          updated_at: new Date().toISOString(),
        };
        record.summary_after = summary;
        report.push(record);
        history.push(
          { role: "user", content: message },
          { role: "assistant", content: safeText(response) },
        );
      }
    }
  } finally {
    for (const fixture of fixtures) {
      await supabase
        .from("ai_chat_sessions")
        .delete()
        .eq("id", fixture.sessionId);
      await supabase.auth.admin.deleteUser(fixture.userId);
    }
  }
  if (report.length !== 10)
    throw new Error(`Expected 10 records, got ${report.length}`);
  const jsonPath = path.join(__dirname, "../../../planner_compare_report.json");
  const markdownPath = path.join(
    __dirname,
    "../../../planner_compare_report.md",
  );
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        turns: QUESTIONS.length,
        records: report,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(markdownPath, markdownReport(report));
  console.log(
    `Planner comparison wrote ${report.length} records to ${jsonPath}`,
  );
}

test("compares the approved five-turn sequence", async () => {
  await main();
}, 1200000);
