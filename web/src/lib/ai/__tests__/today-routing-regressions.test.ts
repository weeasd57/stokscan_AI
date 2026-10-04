import { runPipelineStream } from "../pipeline";
import { buildFactRecords } from "../facts";
import { runAnswerGate } from "../answer-gate";

jest.mock("../server-secrets", () => ({ getDeepSeekApiKey: () => null, getNvidiaApiKeys: () => [] }));
jest.mock("../planner", () => ({ ...jest.requireActual("../planner"), getStocksList: jest.fn().mockResolvedValue([]) }));

function database() {
    const query: any = new Proxy({}, { get: (_target, name) => name === "then"
        ? (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
        : () => query });
    return { from: () => query };
}
const stock = (symbol: string): any => ({ tool: "get_stock", source: "database", data_time: "2026-10-04", symbols: [symbol], data_type: "historical",
    data: { symbol, price: 35, rsi_14: 61.59, vol_ratio: "3.51x", change_pct: "2.64%", macd: .7067, macd_signal: .5862 } });
const state: any = { current_symbol: "COMI", last_symbols: [], summary: "حلل COMI" };

async function run(message: string, options: any, images: string[] = []) {
    const events: any[] = [];
    for await (const event of runPipelineStream(message, images, { ...state }, null, [], database(), [], "offline-eval", "offline-eval", "offline",
        undefined, { timeoutMs: 15000, ...options })) events.push(event);
    const done = events.find(e => e.type === "done").data;
    expect(done.publication_review).toBeDefined();
    expect(events.filter(e => e.type === "token").map(e => e.data).join("")).toBe(done.response);
    return { done, plan: events.find(e => e.type === "plan")?.data, events };
}

test("CIB cannot become an unsolicited second-stock comparison even if planner suggests one", async () => {
    const result = await run("Cib", { mockPlannerResult: { intent: "comparison", confidence: 1,
        entities: { symbols: ["COMI", "CIEB"], sector: null }, tools: ["get_stock", "get_comparison"] },
        mockToolsResults: { results: [stock("COMI")], formattedText: "" } });
    expect(result.plan.entities.symbols).toEqual(["COMI"]);
    expect(result.plan.intent).toBe("stock_analysis");
    expect(result.plan.tools).not.toContain("get_comparison");
    expect(result.done.response).not.toContain("CIEB");
});

test("model and indicator names cannot become stock entities", async () => {
    const result = await run("JUFO ليه KING مختلف عن EGX؟", {
        mockPlannerResult: { intent: "stock_analysis", confidence: 1, entities: { symbols: ["JUFO", "KING"], sector: null }, tools: ["get_stock"] },
        mockToolsResults: { results: [stock("JUFO")], formattedText: "" } });
    expect(result.plan.entities.symbols).toEqual(["JUFO"]);
});

test("a market forecast without a selected criterion asks a useful clarification", async () => {
    const result = await run("متوقع يرتفع الأسبوع ده", {
        mockPlannerResult: { intent: "stock_analysis", confidence: .8, entities: { symbols: [], sector: null }, tools: ["get_stock"] } });
    expect(result.plan.intent).toBe("clarification");
    expect(result.plan.tools).toEqual([]);
    expect(result.done.response).toMatch(/أسبوع|زخم/);
});

test("a documented current stock remains a comparison reference with empty last_symbols", async () => {
    const result = await run("قارن CCAP معاه", { mockPlannerResult: { intent: "comparison", confidence: 1,
        entities: { symbols: ["CCAP", "COMI"], sector: null }, tools: ["get_comparison"] },
        mockToolsResults: { results: [stock("CCAP"), stock("COMI")], formattedText: "" } });
    expect(result.plan.entities.symbols).toEqual(["CCAP", "COMI"]);
    expect(result.plan.tools).toContain("get_stock");
});

const vision: any = { image_type: "portfolio", confidence: .9, analyzed_at: "2026-10-04T13:44:57.016Z", message_id: "offline",
    symbols: ["EGAL", "ADIB", "MASR", "TALM"].map(symbol => ({ symbol, name: "", visible_values: { price: null, quantity: null, change_pct: null } })),
    technical_observations: [], uncertainties: [], market_depth: {}, user_relevant_summary: "Portfolio value 41217; daily change -1.91%" };

test.each(["رايك ف هذه المحفظة وسهم الاسكندريه لتداول الحاويات", "اشتريت السهم النهارده ونزل، رايك في الصورة"])("fresh multi-stock image stays separate from account: %s", async message => {
    const syms = ["EGAL", "ADIB", "MASR", "TALM", ...(message.includes("الحاويات") ? ["ALCN"] : [])];
    const result = await run(message, { mockVisionResult: vision,
        mockToolsResults: { results: syms.map(stock), formattedText: "" } }, ["offline-image"]);
    expect(result.plan.intent).toBe("stock_analysis");
    expect(result.plan.tools).not.toContain("manage_portfolio");
    expect(new Set(result.plan.entities.symbols)).toEqual(new Set(syms));
    expect(result.done.response).toContain("الصورة");
    for (const symbol of syms) expect(result.done.response).toContain(symbol);
    expect(result.done.response).not.toContain("محفظتك فاضية");
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("empty saved account path still emits a publication review", async () => {
    const result = await run("حلل محفظتي", {});
    expect(result.done.response).toContain("فاضية");
    expect(result.done.publication_review.final_passed).toBe(true);
});

test("an outer deadline produces one factual-free response with an explicit review", async () => {
    const pending: any = new Proxy({}, { get: (_target, key) => key === "then"
        ? () => new Promise(() => {}) : () => pending });
    const events: any[] = [];
    for await (const event of runPipelineStream("حلل JUFO", [], state, null, [], { from: () => pending }, [],
        "deadline-eval", "deadline-eval", "deadline-eval", undefined, { timeoutMs: 30 })) events.push(event);
    const done = events.find(e => e.type === "done").data;
    expect(done.response).toContain("تعذر إكمال التحليل في الوقت المتاح");
    expect(done.publication_review).toBeDefined();
    expect(events.filter(e => e.type === "token").map(e => e.data).join("")).toBe(done.response);
});

test("image holdings plus a separately requested stock are all required by the reviewer", () => {
    const syms = ["EGAL", "ADIB", "MASR", "TALM", "ALCN"];
    const tools = syms.map(stock);
    const gate = runAnswerGate({ reply: "الصورة فيها EGAL وADIB وMASR وTALM", plan: { intent: "stock_analysis", entities: { symbols: syms }, tools: [] } as any,
        toolResults: tools, userMessage: "الصورة وسهم ALCN", facts: buildFactRecords(tools), vision });
    expect(gate.ok).toBe(false);
    expect(gate.reasons.some(r => r.includes("ALCN"))).toBe(true);
});
