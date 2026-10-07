import { correctStockSymbol, extractSymbolsFromText } from "../planner";
import { extractExplicitSymbols, parsePortfolioAnswer, runPipelineStream } from "../pipeline";
import { runAnswerGate } from "../answer-gate";
import { isTermsDefinitionRequest } from "../intent-policy";
import { executeStructuredTools } from "../tools-v2";
import { addPortfolioPosition } from "../portfolio-tools";
import { evidenceViolations } from "../response-evidence";

jest.mock("../server-secrets", () => ({ getDeepSeekApiKey: () => null, getNvidiaApiKeys: () => [] }));
jest.mock("../planner", () => ({ ...jest.requireActual("../planner"), getStocksList: jest.fn().mockResolvedValue([]) }));
jest.mock("../portfolio-tools", () => ({ ...jest.requireActual("../portfolio-tools"), addPortfolioPosition: jest.fn() }));

const state: any = { current_symbol: "ETEL", last_symbols: ["ETEL"], summary: "تحليل ETEL" };
const stockPlan: any = { intent: "stock_analysis", entities: { symbols: ["AMES"] }, tools: ["get_stock"] };
const history = [{ role: "user", content: "حلل ETEL" }, { role: "assistant", content: "ETEL. تحب نحلل السيولة؟" }];
function database() {
    const query: any = new Proxy({}, { get: (_target, name) => name === "then"
        ? (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) : () => query });
    return { from: () => query };
}
async function run(message: string, extra: any = {}) {
    const events: any[] = [];
    for await (const event of runPipelineStream(message, [], { ...state }, null, history, database(), [], "offline", "offline", "offline",
        undefined, { timeoutMs: 15000, mockToolsResults: { results: [], formattedText: "" }, ...extra })) events.push(event);
    return { done: events.find(e => e.type === "done").data, plan: events.find(e => e.type === "plan")?.data, events };
}

test("unknown identifiers never become edit-distance neighbours, and documented aliases still work", () => {
    expect(correctStockSymbol("Adri", ["ADCI", "ADIB", "ARAB"])).toBe("ADRI");
    expect(extractSymbolsFromText("Adri اغلق اليوم 13.69", ["ADCI", "ADIB"])).toEqual([]);
    expect(extractSymbolsFromText("my stock", ["MTIE", "SKPC"])).toEqual([]);
    expect(correctStockSymbol("cib", ["COMI"])).toBe("COMI");
    expect(extractExplicitSymbols("Adri اغلق اليوم 13.69")).toEqual(["ADRI"]);
    expect(extractExplicitSymbols("سهم mmat")).toEqual(["MMAT"]);
    expect(extractExplicitSymbols("Process Industries")).toEqual([]);
});

test.each(["AMES بسعر 45.05 عدد 1115", "AMES عدد1115 بسعر45.05", "AMES بسعر ٤٥.٠٥ عدد ١١١٥"])("holding prices cannot become quantities when price precedes count: %s", message => {
    expect(parsePortfolioAnswer(message, { symbol: "AMES", quantity: null, price: null }))
        .toEqual({ symbol: "AMES", quantity: 1115, price: 45.05 });
});

test.each(["Adri", "ADRI", "Adri اغلق اليوم 13.69", "Mmat", "MMAT", "تحليل سهم mmat"])("unavailable ticker keeps its identity and bypasses unrelated tools: %s", async message => {
    const result = await run(message, { mockPlannerResult: { intent: "stock_analysis", confidence: 1,
        entities: { symbols: ["ADCI"] }, tools: ["get_stock"] } });
    expect(result.plan.entities.symbols).toEqual([message.toLowerCase().includes("mmat") ? "MMAT" : "ADRI"]);
    expect(result.plan.tools).toEqual([]);
    expect(result.done.response).toContain("تغطية النظام");
    expect(result.done.response).not.toMatch(/ADCI|ETEL|270\.94|بأي معيار/);
    expect(result.done.session_update.current_symbol).toBeNull();
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("unresolved company names request an identifier instead of ranking criteria or the previous stock", async () => {
    const result = await run("آراب للتنميه", { mockPlannerResult: { intent: "stock_analysis", confidence: 1,
        entities: { symbols: [] }, tools: ["get_stock"], clarification_needed: true } });
    expect(result.done.response).toContain("آراب للتنميه");
    expect(result.done.response).toContain("الرمز اللاتيني");
    expect(result.done.response).not.toMatch(/ETEL|بأي معيار|تحليل السوق كله/);
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("a new order-book explanation cannot inherit the previous stock or require a market tool", async () => {
    const message = "شرح كيفية الاستفادة من عمق السعر في تحليل الاسهم";
    expect(isTermsDefinitionRequest(message)).toBe(true);
    expect(isTermsDefinitionRequest("تحليل سهم KORA من خلال عمق السعر في تطبيق ثاندر")).toBe(false);
    const result = await run(message, { mockPlannerResult: { intent: "stock_analysis", confidence: 1,
        entities: { symbols: ["ETEL"] }, tools: ["get_stock"], clarification_needed: true } });
    expect(result.plan.entities.symbols).toEqual([]);
    expect(result.plan.tools).toEqual([]);
    expect(result.done.response).toContain("دفتر الأوامر");
    expect(result.done.response).toContain("تُلغى");
    expect(result.done.response).not.toContain("ETEL");
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("a stock-specific order-book request discloses the unavailable source instead of substituting closing indicators", async () => {
    const result = await run("تحليل سهم KORA من خلال عمق السعر في تطبيق ثاندر");
    expect(result.plan.tools).toEqual([]);
    expect(result.done.response).toContain("دفتر الأوامر لسهم KORA");
    expect(result.done.response).toContain("صورة واضحة ومؤرخة");
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("an unused daily market tool does not invalidate stock indicator prose, while actual index quotes still require a close label", () => {
    const market: any = { tool: "get_market", data: { egx30: 50000, quote_kind: "daily_close" }, data_time: "2026-10-06" };
    expect(evidenceViolations("مؤشر القوة النسبية والمؤشرات الفنية للأسهم في مسح التجميع المؤرخ 2026-10-06", "أسهم التجميع", [market])).toEqual([]);
    expect(evidenceViolations("EGX30 عند 50000", "حالة السوق", [market]).join(" ")).toContain("إغلاق يومي");
    expect(evidenceViolations("EGX30 إغلاق يومي عند 50000 بتاريخ 2026-10-06", "حالة السوق", [market])).toEqual([]);
});

const gate = (reply: string, results: any[] = []) => runAnswerGate({ reply, plan: stockPlan,
    toolResults: results, userMessage: "AMES بسعر 45.05 عدد 1115", facts: [] });
const write = (symbol = "AMES", ok = true): any => ({ tool: "manage_portfolio", symbols: [symbol],
    data: { ok, operation: "add", persisted: ok } });

test.each(["تم تسجيل مركزك في AMES كما ذكرت في رسالتك.", "تم حفظ محفظتك.", "سجلت الكميات ومتوسطات الشراء."])("unverified persistence claims are rejected: %s", reply => {
    expect(gate(reply).ok).toBe(false);
    expect(gate(reply, [{ tool: "manage_portfolio", data: { ok: true, positions: [] } }]).ok).toBe(false);
    expect(gate(reply, [write("AMES", false)]).ok).toBe(false);
    expect(gate(reply, [write("ETEL")]).ok).toBe(false);
    expect(gate(reply, [write()]).ok).toBe(true);
});

test.each(["بناءً على الكمية وسعر الشراء اللذين ذكرتهما؛ لم يتم حفظ مركزك في الحساب.", "يمكنك حفظ مركزك من صفحة المحفظة.", "لم يتم تسجيل مركزك بعد."])("analysis, instructions and explicit non-saving statements remain allowed: %s", reply => {
    expect(gate(reply).ok).toBe(true);
});

test("a declared purchase cost is entry evidence, never evidence for a current closing quote", () => {
    const input: any = { plan: stockPlan, toolResults: [], userMessage: "AMES بسعر 45.05 عدد 1115",
        facts: [{ symbol: "AMES", field: "close", value: 47.44, unit: "egp" }] };
    expect(runAnswerGate({ ...input, reply: "AMES متوسط سعر الشراء 45.05 جنيه بحسب ما ذكرته." }).ok).toBe(true);
    expect(runAnswerGate({ ...input, reply: "AMES سعر السهم الحالي 45.05 جنيه." }).ok).toBe(false);
});

test.each([true, false])("portfolio tools expose persistence evidence only after a confirmed write (ok=%s)", async ok => {
    jest.mocked(addPortfolioPosition).mockResolvedValueOnce({ ok, message: ok ? "تم تسجيل مركزك في AMES" : "تعذر الحفظ" });
    const result = await executeStructuredTools(database(), { ...stockPlan, intent: "portfolio_management",
        entities: { symbols: ["AMES"], portfolio_operation: "add" }, tools: ["manage_portfolio"] }, [], "offline", "offline", "ضيف AMES 100 سهم بمتوسط 45");
    expect(result.results[0].data).toMatchObject({ ok, operation: "add", persisted: ok });
    expect(gate("تم تسجيل مركزك في AMES", result.results).ok).toBe(ok);
});
