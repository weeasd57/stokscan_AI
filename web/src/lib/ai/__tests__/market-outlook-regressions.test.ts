import { buildDeterministicPlannerResult, enforceIntentFromMessage, extractSectorFromMessage, runPipelineStream } from "../pipeline";
import { buildV2FinalMessages } from "../final-v2";
import { runAnswerGate } from "../answer-gate";
import { buildFactRecords } from "../facts";
import { evidenceViolations, safeEvidenceResponse } from "../response-evidence";
import { resolveResponseTask } from "../response-task";
import { classificationMatchesSector } from "../sector-taxonomy";
import { executeStructuredTools } from "../tools-v2";

jest.mock("../server-secrets", () => ({ getDeepSeekApiKey: () => null, getNvidiaApiKeys: () => [] }));
jest.mock("../planner", () => ({ ...jest.requireActual("../planner"), getStocksList: jest.fn().mockResolvedValue([]) }));
const state: any = { current_symbol: "AMER", last_symbols: ["AMER"], summary: "تحليل AMER" };
const market: any = { tool: "get_market", source: "database", symbols: [], data_type: "historical", data_time: "2026-10-06",
    data: { egx30: 50000, component_dates: { egx30: "2026-10-06" }, top_gainers: [{ symbol: "ABUK", change: 2 }] } };
const rec: any = { tool: "get_recommendations", source: "database", symbols: [], data_type: "historical", data_time: "2026-10-06", data: [] };
const basePlan = (): any => ({ intent: "market_summary", confidence: 1, entities: { symbols: [], sector: null, timeframe: "current" },
    tools: ["get_market", "get_recommendations"], clarification_needed: false, needs_history: false,
    needs_live_data: true, needs_historical_data: false, resolved_from: { symbol: null, message_id: null } });
const quote = (): any => ({ tool: "get_stock", source: "database", symbols: ["KORA"], data_time: "2026-10-06", data_type: "historical",
    data: { symbol: "KORA", price: 6.13, rsi_14: 48.06, volume: 37380505, vol_sma20: 83849690, vol_ratio: "0.45x", king_ai_score: .51, egx_ai_score: .49 } });
function database(rows: Record<string, any[]> = {}) {
    return { from: (table: string) => {
        const query: any = new Proxy({}, { get: (_target, name) => name === "then"
            ? (resolve: any) => Promise.resolve({ data: rows[table] || [], error: null }).then(resolve) : () => query });
        return query;
    } };
}
async function run(message: string, results: any[], extra: any = {}) {
    const events: any[] = [];
    for await (const event of runPipelineStream(message, [], { ...state }, null,
        [{ role: "user", content: "AMER" }, { role: "assistant", content: "تحليل AMER" }],
        database(), [], "offline", "offline", "offline", undefined,
        { timeoutMs: 15000, mockToolsResults: { results, formattedText: "" }, ...extra })) events.push(event);
    return { plan: events.find(e => e.type === "plan")?.data, done: events.find(e => e.type === "done")?.data };
}

test.each(["توقعات غداً لأسهم البورصة", "الاسهم الاكثر ربحية غدا في البورصه المصريه", "توقعات الأسهم للجلسة القادمة", "أفضل أسهم بكره", "أقوى الأسهم غدا", "أقوى أسهم بكره"])("future market intent survives memory, outage and publication: %s", async message => {
    const initial = buildDeterministicPlannerResult(message, state)!;
    expect(initial.entities.symbols).toEqual([]);
    expect(initial.tools).not.toContain("get_fair_value_scan");
    const { plan, done } = await run(message, [market, rec]);
    expect(plan.entities.symbols).toEqual([]);
    expect(plan.response_task.kind).toBe("market_outlook");
    expect(done.response).toContain("الجلسة القادمة");
    expect(done.response).toContain("لا يمكن");
    expect(done.response).toContain("مشروط");
    expect(done.response).not.toContain("حققت الشرطين");
    expect(done.publication_review.final_passed).toBe(true);
});

test("the reviewer rejects a historical scan substituted for a future outlook", () => {
    const plan = basePlan();
    const message = "الأسهم الأكثر ربحية غداً في البورصة";
    expect(resolveResponseTask(message, plan).kind).toBe("market_outlook");
    expect(runAnswerGate({ reply: "أحدث مسح التجميع بتاريخ 2026-10-06: ABUK درجة التجميع 80/100.",
        userMessage: message, plan, toolResults: [market], facts: [] }).reasons.join(" ")).toContain("جلسة مقبلة");
    const reply = safeEvidenceResponse(message, [market, rec], plan);
    expect(runAnswerGate({ reply, userMessage: message, plan, toolResults: [market, rec], facts: buildFactRecords([market, rec]) }).ok).toBe(true);
    expect(JSON.stringify(buildV2FinalMessages(message, { ...plan, response_task: resolveResponseTask(message, plan) },
        null, [market, rec], [], [], { symbol: null, message_id: null, confidence: 0 }))).toContain("طلب المستخدم توقعات جلسة قادمة");
});

test.each([
    "لا يمكن ضمان التوقع. ABUK سيحقق أعلى ربح غداً. راقب الدعم.",
    "ABUK الأكثر ربحية غداً. لا يمكن ضمان الربح. راقب الدعم.",
    "لا يمكن ضمان التوقع غداً. ABUK مرشح للمراقبة بشرط تحسن الحجم.",
])("a generic disclaimer does not authorize unsupported future picks: %s", reply => {
    expect(runAnswerGate({ reply, userMessage: "أفضل أسهم غدا", plan: basePlan(), toolResults: [], facts: [] }).ok).toBe(false);
});

test("the next-week horizon survives fallback and its publication check", async () => {
    const result = await run("أفضل أسهم الأسبوع الجاي", [market, rec]);
    expect(result.plan.response_task.target).toBe("الأسبوع القادم");
    expect(result.done.response).toContain("الأسبوع القادم");
    expect(result.done.response).not.toContain("غداً");
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("a supported ticker cannot become a future winner through comma-separated disclaimer", () => {
    const input = { userMessage: "أفضل أسهم غدا", plan: basePlan(), toolResults: [market], facts: buildFactRecords([market]) };
    expect(runAnswerGate({ ...input, reply: "لا يمكن ضمان التوقع غداً. ABUK الأكثر ربحية غداً، ولا يمكن الجزم. راقب الدعم." }).ok).toBe(false);
    expect(runAnswerGate({ ...input, reply: "لا يمكن تحديد الأسهم الأكثر ربحاً غداً؛ ABUK مرشح للمراقبة بشرط تأكيد الحركة." }).ok).toBe(true);
});

test("single-stock forecasts and explicit fair-value scans retain their own tasks", () => {
    expect(resolveResponseTask("توقعات KORA غدا", { ...basePlan(), intent: "stock_analysis", entities: { symbols: ["KORA"] } }).kind).not.toBe("market_outlook");
    expect(resolveResponseTask("هات الأسهم فوق القيمة الوسطية", basePlan()).kind).not.toBe("market_outlook");
});

test.each(["MMAT", "Mmat", "سهم مرسي مرسي علم للتنمية السياحية", "تحليل سهم مرسي مرسي علم للتنمية السياحية"])("unsupported identifiers request company evidence instead of a strength criterion: %s", async message => {
    const result = await run(message, []);
    expect(result.done.response).not.toMatch(/بأي معيار|الارتفاع، السيولة|تحليل AMER/);
    expect(result.done.response).toMatch(/تغطية|اسم الشركة|الرمز اللاتيني/);
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("fertilizer analysis selects the supported agricultural-chemicals classification", async () => {
    expect(extractSectorFromMessage("تحليل شركات الأسمدة")).toBe("أسمدة");
    expect(classificationMatchesSector("Process Industries Chemicals: Agricultural", "أسمدة")).toBe(true);
    expect(classificationMatchesSector("Process Industries Textiles", "أسمدة")).toBe(false);
    const tools = await executeStructuredTools(database({
        stock_fundamentals: [
            { symbol: "ABUK", data: { sector: "Process Industries", industry: "Chemicals: Agricultural" } },
            { symbol: "FAKE", data: { sector: "Process Industries", industry: "Textiles" } },
        ],
        stock_technical_indicators: [{ symbol: "ABUK", close: 86.54, change_pct: -0.39, date: "2026-10-06", rsi_14: 44.11, volume: 26, vol_sma20: 100 }],
    }), { ...basePlan(), intent: "sector_analysis", entities: { symbols: [], sector: "أسمدة" }, tools: ["get_sector"] },
    [], "offline", "offline", "تحليل شركات الأسمدة", [], true);
    const sector = tools.results.find(r => r.tool === "get_sector")!;
    expect(sector.symbols).toEqual(["ABUK"]);
    const result = await run("تحليل شركات الأسمدة", [sector]);
    expect(result.plan.entities.symbols).toEqual([]);
    expect(result.plan.tools).toContain("get_sector");
    expect(result.done.response).toContain("ABUK");
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("a named fertilizer company remains stock analysis rather than a whole-sector request", () => {
    expect(enforceIntentFromMessage("تحليل أسهم ABUK في قطاع الأسمدة", "stock_analysis", ["ABUK"]).tools).not.toContain("get_sector");
});

test("daily quotes without a ticker in every line still require a date and reject live labeling", () => {
    const stock = quote();
    expect(evidenceViolations("آخر إغلاق مسجل: **6.13 جنيه**.", "تحليل السيولة لـ KORA", [stock]).join(" ")).toContain("2026-10-06");
    expect(evidenceViolations("السعر اللحظي 6.13 جنيه بتاريخ 2026-10-06", "KORA", [stock]).join(" ")).toContain("لحظي");
    expect(evidenceViolations("آخر إغلاق مسجل: **6.13 جنيه** بتاريخ 2026-10-06.", "KORA", [stock])).toEqual([]);
});

test("relative volume cannot be described as absolute liquidity, including in outage output", async () => {
    const stock = quote();
    expect(evidenceViolations("السيولة أقل من متوسط 20 جلسة.", "تحليل السيولة لـ KORA", [stock]).join(" ")).toContain("النشاط النسبي");
    const result = await run("تحليل السيولة لـ KORA", [stock]);
    expect(result.done.response).toContain("نشاط التداول");
    expect(result.done.response).toContain("2026-10-06");
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("neutral model scores do not establish opposite market directions", () => {
    const stock = quote();
    expect(evidenceViolations("KING وEGX في النطاق المحايد لكن باتجاهين متباينين.", "KORA", [stock]).join(" ")).toContain("النطاق المحايد");
    expect(evidenceViolations("KING وEGX في النطاق المحايد؛ فرق الدرجات وحده لا يثبت اتجاهين متعاكسين.", "KORA", [stock])).toEqual([]);
});
