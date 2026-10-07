import { buildDeterministicPlannerResult, runPipelineStream } from "../pipeline";

jest.mock("../server-secrets", () => ({ getDeepSeekApiKey: () => null, getNvidiaApiKeys: () => [] }));
jest.mock("../planner", () => ({ ...jest.requireActual("../planner"), runPlanner: jest.fn() }));
jest.mock("../tools-v2", () => ({ ...jest.requireActual("../tools-v2"), executeStructuredTools: jest.fn() }));
jest.mock("../final-v2", () => ({ ...jest.requireActual("../final-v2"), generateV2Stream: jest.fn(), generateV2Response: jest.fn() }));

const plannerMock = jest.requireMock("../planner").runPlanner as jest.Mock;
const toolsMock = jest.requireMock("../tools-v2").executeStructuredTools as jest.Mock;
const responderMocks = jest.requireMock("../final-v2") as { generateV2Stream: jest.Mock; generateV2Response: jest.Mock };

const session = (current_symbol: string | null, last_symbols: string[]) => ({
    current_symbol,
    last_symbols,
    current_sector: null,
    summary: current_symbol ? `حلل ${current_symbol}` : "",
} as any);

function database() {
    const query: any = new Proxy({}, { get: (_target, name) => name === "then"
        ? (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
        : () => query });
    return { from: () => query };
}

const stock = (symbol: string): any => ({ tool: "get_stock", source: "database", data_time: "2026-10-06", symbols: [symbol], data_type: "historical",
    data: { symbol, price: 35, rsi_14: 61.59, vol_ratio: "3.51x", change_pct: "2.64%", macd: .7067, macd_signal: .5862 } });

test("an attached pronoun carries the single active stock into an explicit comparison", () => {
    const plan = buildDeterministicPlannerResult("قارنه بسهم أبو قير ABUK", session("HRHO", ["HRHO"]));

    expect(plan?.intent).toBe("comparison");
    expect(plan?.entities.symbols).toEqual(["HRHO", "ABUK"]);
    expect(plan?.tools).toContain("get_comparison");
});

test("a semantic planner that only returns the new ticker cannot erase the deterministic comparison pair", async () => {
    const events: any[] = [];
    for await (const event of runPipelineStream("قارنه بسهم أبو قير ABUK", [], session("HRHO", ["HRHO"]), null, [], database(), [],
        "offline-test", "offline-test", "offline", undefined, {
            timeoutMs: 15000,
            mockPlannerResult: { intent: "comparison", confidence: 1, entities: { symbols: ["ABUK"], sector: null, wants_table: true }, tools: ["get_comparison"], session_update: { current_symbol: "ABUK", last_symbols: ["ABUK"], summary: "" } },
            mockToolsResults: { results: [stock("HRHO"), stock("ABUK")], formattedText: "" },
        })) events.push(event);

    const plan = events.find(event => event.type === "plan")?.data;
    expect(plan.intent).toBe("comparison");
    expect(plan.entities.symbols).toEqual(expect.arrayContaining(["HRHO", "ABUK"]));
    expect(plan.entities.symbols).toHaveLength(2);
    expect(plan.tools).toContain("get_comparison");
});

test("the production semantic-planner path keeps an explicitly named pair as a comparison", async () => {
    plannerMock.mockResolvedValue({
        intent: "stock_analysis", confidence: 1,
        entities: { symbols: ["ABUK"], sector: null, wants_table: false }, tools: ["get_stock"],
        request: { goal: "قارن ABUK مع COMI", reference: "explicit", ranking_metric: "unspecified", required_facts: [], answer_kind: "decision_comparison" },
    } as any);
    toolsMock.mockResolvedValue({ results: [stock("ABUK"), stock("COMI")], formattedText: "" });
    responderMocks.generateV2Stream.mockImplementation(async function* () {
        yield "أقارن ABUK وCOMI حسب البيانات المتاحة، والاختيار يتوقف على المعيار المطلوب.";
    });
    responderMocks.generateV2Response.mockResolvedValue("أقارن ABUK وCOMI حسب البيانات المتاحة، والاختيار يتوقف على المعيار المطلوب.");
    const events: any[] = [];
    try {
        for await (const event of runPipelineStream("قارن ABUK مع COMI", [], session(null, []), null, [], database(), ["offline-planner-key"],
            "offline-test", "offline-test", "offline", undefined, { timeoutMs: 15000 })) events.push(event);

        const plan = events.find(event => event.type === "plan")?.data;
        expect(plannerMock).toHaveBeenCalled();
        expect(toolsMock).toHaveBeenCalled();
        expect(plan.intent).toBe("comparison");
        expect(plan.entities.symbols).toEqual(["ABUK", "COMI"]);
        expect(plan.tools).toContain("get_comparison");
        expect(plan.request.answer_kind).toBe("decision_comparison");
        expect(plan.response_task.kind).toBe("decision_comparison");
    } finally {
        jest.clearAllMocks();
    }
});

test.each([
    { message: "اخبار السهمين ABUK وCOMI", intent: "stock_news", expectedIntent: "stock_analysis", tools: ["get_news"] },
    { message: "حلل الاتنين ABUK COMI بدون مقارنة", intent: "stock_analysis", expectedIntent: "stock_analysis", tools: ["get_stock"] },
])("the semantic planner can keep a two-stock non-comparison request: $message", async ({ message, intent, expectedIntent, tools }) => {
    plannerMock.mockResolvedValue({
        intent, confidence: 1,
        entities: { symbols: ["ABUK", "COMI"], sector: null, wants_table: false }, tools,
    } as any);
    toolsMock.mockResolvedValue({ results: [stock("ABUK"), stock("COMI")], formattedText: "" });
    responderMocks.generateV2Stream.mockImplementation(async function* () {
        yield "بيانات السهمين متاحة حسب الطلب.";
    });
    responderMocks.generateV2Response.mockResolvedValue("بيانات السهمين متاحة حسب الطلب.");
    const events: any[] = [];
    try {
        for await (const event of runPipelineStream(message, [], session(null, []), null, [], database(), ["offline-planner-key"],
            "offline-test", "offline-test", "offline", undefined, { timeoutMs: 15000 })) events.push(event);

        const plan = events.find(event => event.type === "plan")?.data;
        expect(plannerMock).toHaveBeenCalled();
        expect(plan.entities.symbols).toEqual(["ABUK", "COMI"]);
        expect(plan.tools).not.toContain("get_comparison");
        expect(plan.intent).toBe(expectedIntent);
        expect(plan.response_task.kind).not.toBe("decision_comparison");
    } finally {
        jest.clearAllMocks();
    }
});

test.each([
    "حلل سهم ABUK",
    "حلل قطاع البنوك",
    "اخبار السوق النهارده",
])("does not attach a stale stock to a new stock, sector, or market request: %s", message => {
    const plan = buildDeterministicPlannerResult(message, session("HRHO", ["HRHO"]));

    expect(plan?.entities.symbols).not.toContain("HRHO");
});

test.each([
    session("HRHO", ["HRHO", "COMI"]),
    session("HRHO", ["COMI"]),
])("an authoritative semantic plan cannot guess an ambiguous or conflicting pronoun reference", async priorState => {
    const events: any[] = [];
    for await (const event of runPipelineStream("قارنه بسهم أبو قير ABUK", [], priorState, null, [], database(), [],
        "offline-test", "offline-test", "offline", undefined, {
            timeoutMs: 15000,
            mockPlannerResult: { intent: "stock_analysis", confidence: 1, entities: { symbols: ["ABUK"], sector: null, wants_table: true }, tools: ["get_stock"], session_update: { current_symbol: "ABUK", last_symbols: ["ABUK"], summary: "" } },
            mockToolsResults: { results: [stock("ABUK")], formattedText: "" },
        })) events.push(event);

    const plan = events.find(event => event.type === "plan")?.data;
    expect(plan.clarification_needed).toBe(true);
    expect(plan.tools).toEqual([]);
    expect(plan.entities.symbols).toEqual([]);
});

test("an explicit named comparison keeps its named pair and does not add the prior stock", () => {
    const plan = buildDeterministicPlannerResult("قارن ABUK مع COMI", session("HRHO", ["HRHO"]));

    expect(plan?.entities.symbols).toEqual(["ABUK", "COMI"]);
});

test("ordinary stock follow-ups still use current_symbol when last_symbols contains multiple older candidates", () => {
    const plan = buildDeterministicPlannerResult("دعمه ومقاومته كام؟", session("HRHO", ["COMI", "ABUK"]));

    expect(plan?.entities.symbols).toContain("HRHO");
});

test.each([
    session("HRHO", ["HRHO", "COMI"]),
    session(null, []),
    session("HRHO", ["COMI"]),
])("asks for the missing comparison reference when an attached pronoun has no unique antecedent", state => {
    const plan = buildDeterministicPlannerResult("قارنه بسهم أبو قير ABUK", state);

    expect(plan?.intent).toBe("clarification");
    expect(plan?.clarification_needed).toBe(true);
    expect(plan?.tools).toEqual([]);
    expect(plan?.entities.symbols).toEqual([]);
});

test("a demonstrative comparison asks when prior candidates are ambiguous", () => {
    const plan = buildDeterministicPlannerResult("قارن ده بسهم أبو قير ABUK", session("HRHO", ["HRHO", "COMI"]));

    expect(plan?.intent).toBe("clarification");
    expect(plan?.clarification_needed).toBe(true);
    expect(plan?.tools).toEqual([]);
    expect(plan?.entities.symbols).toEqual([]);
});

test("the production semantic-planner path cannot guess a demonstrative comparison reference", async () => {
    plannerMock.mockResolvedValue({
        intent: "stock_analysis", confidence: 1,
        entities: { symbols: ["ABUK"], sector: null, wants_table: true }, tools: ["get_stock"],
    } as any);
    toolsMock.mockResolvedValue({ results: [stock("ABUK")], formattedText: "" });
    const events: any[] = [];
    try {
        for await (const event of runPipelineStream("قارن ده بسهم أبو قير ABUK", [], session("HRHO", ["HRHO", "COMI"]), null, [], database(), ["offline-planner-key"],
            "offline-test", "offline-test", "offline", undefined, { timeoutMs: 15000 })) events.push(event);

        const plan = events.find(event => event.type === "plan")?.data;
        expect(plannerMock).toHaveBeenCalled();
        expect(plan.clarification_needed).toBe(true);
        expect(plan.entities.symbols).toEqual([]);
        expect(plan.tools).toEqual([]);
        expect(toolsMock).not.toHaveBeenCalled();
    } finally {
        jest.clearAllMocks();
    }
});
