import { buildDecisionEvidence, buildDecisionFallback, checkDecisionComparatives } from "../decision-evidence";
import { resolveResponseTask, completeDecisionTools } from "../response-task";
import { buildComparisonMatrix } from "../comparison-matrix";
import { buildDeterministicResponse, buildV2FinalMessages } from "../final-v2";
import { runAnswerGate } from "../answer-gate";
import { buildFactRecords } from "../facts";
import { buildExcelTables } from "../excel-tables";
import { safeEvidenceResponse } from "../response-evidence";
import { runPipelineStream } from "../pipeline";
import * as responder from "../final-v2";
import { IntentPlan, ToolResult } from "../types";
import savedResponder from "./fixtures/decision-responder-2026-10-05.json";

jest.mock("../server-secrets", () => ({ getDeepSeekApiKey: () => null, getNvidiaApiKeys: () => [] }));
jest.mock("../planner", () => ({ ...jest.requireActual("../planner"), getStocksList: jest.fn().mockResolvedValue([]) }));
jest.mock("../final-v2", () => ({ __esModule: true, ...jest.requireActual("../final-v2"), generateV2Stream: jest.fn(jest.requireActual("../final-v2").generateV2Stream) }));

const message = "أيهما أفضل للمضاربة يوم الإثنين gbco أو alcn";
const plan = (): IntentPlan => ({ intent: "comparison", confidence: 1,
    entities: { symbols: ["GBCO", "ALCN"], sector: null, timeframe: "current", reference: null },
    tools: ["get_comparison"], clarification_needed: false, needs_history: false, needs_vision_context: false,
    needs_live_data: false, needs_historical_data: false, resolved_from: { symbol: null, message_id: null } });
const quote = (symbol: string, data: any): ToolResult => ({ tool: "get_stock", source: "database",
    data_time: "2026-10-04", data_type: "historical", symbols: [symbol], data: { symbol, ...data } });
const quotes = (): ToolResult[] => [
    quote("GBCO", { price: 32.5, change_pct: 4.84, rsi_14: 71.43, vol_ratio: "1.94x", king_ai_score: .473, egx_ai_score: .586 }),
    quote("ALCN", { price: 35, change_pct: 2.64, rsi_14: 65.94, vol_ratio: "3.12x", king_ai_score: .531, egx_ai_score: .536 }),
];
const gate = (reply: string, results = quotes(), p = plan(), userMessage = message) => runAnswerGate({ reply, plan: p,
    userMessage, toolResults: results, facts: buildFactRecords(results) });

beforeAll(() => { jest.useFakeTimers({ doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "nextTick", "setImmediate", "clearImmediate", "performance"] }); jest.setSystemTime(new Date("2026-10-05T07:00:00Z")); });
afterAll(() => jest.useRealTimers());

test.each([message, "مين أنسب GBCO ولا ALCN؟", "اختارلي واحد فيهم للمضاربة", "Which is better GBCO or ALCN?"])("classifies a selection independently of the tool: %s", text => {
    const p = plan();
    if (text.startsWith("Which")) p.request = { answer_kind: "decision_comparison", goal: text, reference: "explicit", ranking_metric: "unspecified", required_facts: [] };
    completeDecisionTools(text, p);
    expect(p.response_task?.kind).toBe("decision_comparison");
    expect(p.tools).toEqual(expect.arrayContaining(["get_stock", "get_comparison"]));
});

test("the real rejected reply cannot receive publication PASS", () => {
    const reply = "مقارنة مباشرة مع بيان تاريخ ونوع سعر كل سهم:\n- GBCO: إغلاق مسجل 32.50 جنيه بتاريخ 2026-10-04، التغير +4.84%، RSI 71.4، نسبة الحجم 1.94x من المتوسط.\n- ALCN: إغلاق مسجل 35.00 جنيه بتاريخ 2026-10-04، التغير +2.64%، RSI 65.9، نسبة الحجم 3.12x من المتوسط.\nارتفاع RSI يعكس قوة الزخم فقط ولا يكفي منفرداً لاتخاذ قرار.";
    expect(gate(reply).ok).toBe(false);
    expect(gate(reply).reasons.join(" ")).toContain("عرض الأسعار");
});

test("the saved real responder answer keeps ownership but rejects unsupported timing", () => {
    const checked = gate(savedResponder.response, savedResponder.input as ToolResult[]);
    expect(checked.reasons).toEqual([expect.stringContaining("مدة الانتظار")]);
    expect(gate(savedResponder.response.replace("أو غياب أي تأكيد سعري في أول 15–30 دقيقة", "أو غياب تأكيد الحركة"), savedResponder.input as ToolResult[]).reasons).toEqual([]);
});

test("available model scores cannot be denied, while unavailable scores stay unavailable", () => {
    const valid = buildDecisionFallback(message, plan(), quotes())!;
    const claim = "لا تتوفر درجات نماذج KING AI أو EGX AI لأي من السهمين في البيانات الممررة.";
    expect(gate(`${valid}\n${claim}`).reasons).toContainEqual(expect.stringContaining("ينفي وجود درجات"));
    expect(gate(`${valid}\n${claim}`, savedResponder.input as ToolResult[]).reasons).toEqual([]);
});

test("section ownership still rejects a number assigned to the wrong subject", () => {
    const valid = buildDecisionFallback(message, plan(), quotes())!;
    expect(gate(`${valid}\n**GBCO**\nالتغير المسجل +2.64% أقل من ALCN.`).ok).toBe(false);
    expect(gate(`${valid}\n**ALCN**\nالتغير المسجل +2.64% أقل من GBCO.`).reasons).toEqual([]);
});

test("decision prompts request a short outcome without fabricated statistical layout", () => {
    const prompt = JSON.stringify(buildV2FinalMessages(message, plan(), null, quotes(), [], [], { symbol: null, message_id: null, confidence: 1 }));
    expect(prompt).toContain("120–180");
    expect(prompt).not.toContain("MANDATORY COMPARISON LAYOUT");
    expect(prompt).not.toContain("ML STATISTICAL DELTAS");
    expect(prompt).not.toContain("مجموع البندات الموجبة");
    expect(prompt).not.toContain("<0.8x=سيولة ضعيفة");
});

test("a data-only comparison keeps the ordinary renderer", () => {
    const p = plan();
    expect(resolveResponseTask("قارن بيانات GBCO وALCN في جدول", p).kind).toBe("comparison");
    expect(buildDecisionFallback("قارن بيانات GBCO وALCN في جدول", p, quotes())).toBeNull();
});

test("conditional answer explains the original tradeoffs and passes the same gate", () => {
    const reply = buildDeterministicResponse(message, plan(), quotes())!;
    expect(reply).toContain("أميل لمراقبة ALCN");
    expect(reply).toContain("GBCO أقوى من زاوية التغير");
    expect(reply).toContain("2026-10-04");
    expect(reply).toContain("افتتاح");
    expect(gate(reply).reasons).toEqual([]);
});

test("reversing data/tool order does not change the conclusion", () => {
    expect(buildDecisionFallback(message, plan(), quotes().reverse())).toBe(buildDecisionFallback(message, plan(), quotes()));
});

test("each requested criterion gets its own conclusion", () => {
    expect(buildDecisionFallback("مين أقوى في الزخم GBCO ولا ALCN", plan(), quotes())).toMatch(/^GBCO أقوى/);
    expect(buildDecisionFallback("مين أعلى في نشاط الحجم GBCO ولا ALCN", plan(), quotes())).toMatch(/^ALCN يتقدم/);
    expect(buildDecisionFallback("مين أقل مخاطرة GBCO ولا ALCN", plan(), quotes())).not.toContain("أقل مخاطرة");
});

test("short ambiguous criterion replies preserve the previous decision without assuming a new stock", () => {
    const history = [{ role: "user", content: "مين أفضل GBCO ولا ALCN" }, { role: "assistant", content: "تقصد للمضاربة ولا أقل مخاطرة؟" }];
    const p = plan(); completeDecisionTools("للمضاربة", p, history);
    expect(p.response_task?.criterion).toBe("intraday");
    expect(p.tools).toContain("get_stock_levels");
    expect(buildDecisionFallback("للمضاربة", p, quotes())).toContain("أميل لمراقبة ALCN");
    expect(resolveResponseTask("أخبارهم اليوم", plan(), history).kind).not.toBe("decision_comparison");
});

test.each(["mixed_date", "stale", "missing_date", "missing_quote", "failed"])("incomparable evidence is explicit, never silently ranked: %s", mode => {
    const results = quotes();
    if (mode === "mixed_date") results[1].data_time = "2026-10-01";
    if (mode === "stale") results.forEach(r => r.data_time = "2026-09-01");
    if (mode === "missing_date") results[1].data_time = "";
    if (mode === "missing_quote") results[1].data.price = null;
    if (mode === "failed") results[1].error = "network";
    const evidence = buildDecisionEvidence(resolveResponseTask(message, plan()), results);
    expect(evidence.comparable).toBe(false);
    expect(evidence.leaders.relative_volume).toBeNull();
    const reply = buildDecisionFallback(message, plan(), results)!;
    expect(reply).toContain("لا أستطيع ترجيح");
    expect(reply).not.toContain("أميل لمراقبة");
    expect(gate(reply, results).reasons).toEqual([]);
});

test("null is unknown while real zero remains observed; ties do not choose by ordering", () => {
    const results = quotes();
    results.forEach(r => { r.data.vol_ratio = 0; r.data.rsi_14 = null; r.data.change_pct = null; });
    const evidence = buildDecisionEvidence(resolveResponseTask(message, plan()), results);
    expect(evidence.stocks[0].vol_ratio).toBe(0);
    expect(evidence.stocks[0].rsi).toBeNull();
    expect(evidence.leaders.relative_volume).toBeNull();
    const reply = buildDecisionFallback(message, plan(), results)!;
    expect(reply).toContain("0.00x");
    expect(reply).not.toContain("أميل لمراقبة");
    expect(gate(reply, results).reasons).toEqual([]);
});

test("an explicit unknown or stale metric date blocks that metric alone", () => {
    const results = quotes();
    results[1].data.metric_dates = { vol_ratio: null, rsi_14: "2026-09-20" };
    const evidence = buildDecisionEvidence(resolveResponseTask(message, plan()), results);
    expect(evidence.leaders.relative_volume).toBeNull();
    expect(evidence.leaders.less_rsi_extension).toBeNull();
    expect(evidence.leaders.recorded_price_change).toBe("GBCO");
    expect(buildDecisionFallback(message, plan(), results)).toContain("بتاريخ 2026-09-20");
});

test("intraday and closing observations do not become a synchronized decision", () => {
    const results = quotes(); results[1].data.is_live_intraday = true;
    expect(buildDecisionEvidence(resolveResponseTask(message, plan()), results).comparable).toBe(false);
    expect(buildDecisionFallback(message, plan(), results)).toContain("مختلطة");
});

test("comparison-only observations work and cannot introduce invented statistical significance", () => {
    const results: ToolResult[] = [{ ...quotes()[0], tool: "get_comparison", symbols: ["GBCO", "ALCN"],
        data: { comparisons: quotes().map(r => ({ ...r.data, as_of: r.data_time })) } }];
    expect(buildDecisionFallback(message, plan(), results)).toContain("أميل لمراقبة ALCN");
    expect(gate("ALCN أفضل؛ الفرق دال إحصائياً مقارنة GBCO، لو ثبت عند الافتتاح.", results).ok).toBe(false);
    const matrix = buildComparisonMatrix(results)!;
    expect(matrix.formatted_prompt_block).not.toContain("Technical Score:");
    expect(matrix.formatted_prompt_block).not.toContain("فرق إحصائي ملحوظ");
});

test("historical task uses exactly its requested date and does not forecast opening", () => {
    const p = plan(); p.entities.requested_date = "2026-08-01";
    const results = quotes(); results.forEach(r => r.data_time = "2026-08-01");
    expect(buildDecisionEvidence(resolveResponseTask(message, p), results).comparable).toBe(true);
    expect(buildDecisionFallback("أيهما كان أقوى يوم 2026-08-01 GBCO أو ALCN", p, results)).not.toContain("فجوة سعرية");
    results[1].data_time = "2026-08-02";
    expect(buildDecisionEvidence(resolveResponseTask(message, p), results).comparable).toBe(false);
});

test("a wrong leader is not excused by a later conditional or caution", () => {
    const task = resolveResponseTask(message, plan());
    expect(checkDecisionComparatives("GBCO حجم نسبي أعلى من ALCN لو ثبت فوق الدعم", task, quotes())).not.toEqual([]);
    expect(checkDecisionComparatives("GBCO حجم أعلى من ALCN، ولا يعني ذلك الصعود", task, quotes())).not.toEqual([]);
    expect(checkDecisionComparatives("لو GBCO حجم أعلى في الجلسة الجديدة راقبه", task, quotes())).toEqual([]);
    expect(checkDecisionComparatives("حجم GBCO أعلى من ALCN", task, quotes())).not.toEqual([]);
    expect(checkDecisionComparatives("GBCO أقوى من زاوية التغير، بينما ALCN أقل امتدادًا في RSI", task, quotes())).toEqual([]);
    expect(checkDecisionComparatives("ALCN أعلى حجم نسبي لكن GBCO أقوى في التغير", task, quotes())).toEqual([]);
});

test.each(["أرشح GBCO وخلاص، ALCN لا.", "القرار ليك بين GBCO وALCN.", "GBCO مضمون هيطلع وALCN أقل."])("rejects empty or guaranteed conclusions: %s", reply => {
    expect(gate(reply).ok).toBe(false);
});

test("the responder receives the same goal and evidence used by the gate", () => {
    const messages = buildV2FinalMessages(message, plan(), null, quotes(), [], [], { symbol: null, message_id: null, confidence: 1 });
    const text = JSON.stringify(messages);
    expect(text).toContain("ANSWER COMPLETION CONTRACT");
    expect(text).toContain("decision_comparison");
    expect(text).toContain("less_rsi_extension");
    expect(text).not.toContain("Technical Score:");
});

test("comparison tables use canonical ratios and keep unknown distinct from zero", () => {
    const comparison: ToolResult = { ...quotes()[0], tool: "get_comparison", symbols: ["GBCO", "ALCN"],
        data: { comparisons: [ { symbol: "GBCO", price: 32.5, vol_ratio: 1.94 }, { symbol: "ALCN", price: 35, vol_ratio: null } ] } };
    const table = buildExcelTables([comparison], null).find(t => t.id === "get_comparison")!;
    expect(table.rows[0][4]).toBe("1.94");
    expect(table.rows[1][4]).toBe("");
    expect(table.rows[1][5]).toBe("");
});

test("safe repair keeps the job instead of reverting to a generic stock list", () => {
    const reply = safeEvidenceResponse(message, quotes(), plan());
    expect(reply).toContain("أميل لمراقبة ALCN");
    expect(gate(reply).ok).toBe(true);
});

test("provider outage publishes one coherent reviewed answer and labels the origin", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => { throw new Error("offline test must not call remote services"); });
    const events: any[] = [];
    try {
        for await (const event of runPipelineStream(message, [], { current_symbol: null, last_symbols: [], summary: null }, null, [], {}, [], "", "", "", undefined,
            { mockPlannerResult: { ...plan(), session_update: { current_symbol: null, last_symbols: [], summary: null } } as any,
                mockToolsResults: { results: quotes(), formattedText: "" }, timeoutMs: 15000 })) events.push(event);
        const done = events.find(e => e.type === "done").data;
        expect(done.response).toContain("أميل لمراقبة ALCN");
        expect(done.publication_review.final_passed).toBe(true);
        expect(done.response_origin).toBe("fallback");
        expect(events.filter(e => e.type === "token").map(e => e.data).join("")).toBe(done.response);
        expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
});

test("an unhelpful LLM answer is rejected before publication and repaired from the same facts", async () => {
    const generatorSpy = jest.spyOn(responder, "generateV2Stream").mockImplementation(async function* (...args: any[]) {
        const meta = args[11]; if (meta) meta.source = "llm";
        yield "GBCO: إغلاق مسجل 32.50 جنيه بتاريخ 2026-10-04.\nALCN: إغلاق مسجل 35.00 جنيه بتاريخ 2026-10-04.\nارتفاع RSI لا يكفي لاتخاذ قرار.";
    });
    generatorSpy.mockClear();
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => { throw new Error("offline test must not call remote services"); });
    const events: any[] = [];
    try {
        for await (const event of runPipelineStream(message, [], { current_symbol: null, last_symbols: [], summary: null }, null, [], {}, [], "", "", "", undefined,
            { mockPlannerResult: { ...plan(), session_update: { current_symbol: null, last_symbols: [], summary: null } } as any,
                mockToolsResults: { results: quotes(), formattedText: "" }, timeoutMs: 15000 })) events.push(event);
        const done = events.find(e => e.type === "done").data;
        expect(generatorSpy.mock.calls.length).toBe(2);
        expect(done.response).toContain("أميل لمراقبة ALCN");
        expect(done.response_origin).toBe("fallback");
        expect(done.publication_review.final_passed).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
    } finally { generatorSpy.mockRestore(); fetchSpy.mockRestore(); }
});
