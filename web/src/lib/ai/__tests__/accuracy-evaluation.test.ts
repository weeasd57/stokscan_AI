import { runPipelineStream } from "../pipeline";

jest.mock("../server-secrets", () => ({ getDeepSeekApiKey: () => null, getNvidiaApiKeys: () => [] }));
jest.mock("../planner", () => ({ ...jest.requireActual("../planner"), getStocksList: jest.fn().mockResolvedValue([]) }));

type Fixture = { positions: any[]; stocks: any[] };

const portfolioCase: Fixture = {
    positions: [
        { symbol: "EVLA", name: "Fixture A", quantity: 100, entry_price: 10, entry_at: "2026-10-01", last_price: 12,
            last_price_as_of: "2026-10-06", price_updated_at: "2026-10-06", price_source: "stock_prices" },
        { symbol: "EVLB", name: "Fixture B", quantity: 100, entry_price: 10, entry_at: "2026-10-01", last_price: 18,
            last_price_as_of: "2026-10-06", price_updated_at: "2026-10-06", price_source: "stock_prices" },
    ],
    stocks: [
        { tool: "get_stock", source: "database", data_type: "historical", data_time: "2026-10-06", symbols: ["EVLA"],
            data: { symbol: "EVLA", name: "Fixture A", price: 12, rsi_14: 30.9, vol_ratio: 0.4, king_ai_score: 0.62, egx_ai_score: 0.34 } },
        { tool: "get_stock", source: "database", data_type: "historical", data_time: "2026-10-06", symbols: ["EVLB"],
            data: { symbol: "EVLB", name: "Fixture B", price: 18, rsi_14: 55, vol_ratio: 0.7, king_ai_score: 0.52, egx_ai_score: 0.51 } },
    ],
};

function offlineDatabase(positions: any[]) {
    return {
        from: (table: string) => {
            const query: any = new Proxy({}, {
                get: (_target, property) => property === "then"
                    ? (resolve: any) => Promise.resolve({ data: table === "positions" ? positions : [], error: null }).then(resolve)
                    : () => query,
            });
            return query;
        },
    };
}

async function runPortfolioFixture(fixture: Fixture) {
    const events: any[] = [];
    const results = [
        { tool: "manage_portfolio", source: "positions", data_type: "cached", data_time: "2026-10-06",
            symbols: fixture.positions.map(position => position.symbol), data: { ok: true, positions: fixture.positions } },
        ...fixture.stocks,
    ];
    for await (const event of runPipelineStream(
        "حلل محفظتي", [], { current_symbol: null, last_symbols: [], summary: null } as any, null, [],
        offlineDatabase(fixture.positions), [], "fixture-user", "fixture-session", "fixture-message", undefined,
        { timeoutMs: 15000, isPro: true, mockToolsResults: { results, formattedText: "" } as any },
    )) events.push(event);
    return {
        done: events.find(event => event.type === "done")?.data,
        streamed: events.filter(event => event.type === "token").map(event => event.data).join(""),
        events,
    };
}

describe("offline accuracy evaluation through the production stream entry point", () => {
    test("publishes a portfolio calculation only with aligned source dates and checked arithmetic", async () => {
        const result = await runPortfolioFixture(portfolioCase);
        const { done, streamed } = result;

        expect(done.response).toBe(streamed);
        expect(done.publication_review).toMatchObject({ final_passed: true });
        expect(done.response).toContain("التقييم الإجمالي للمراكز");
        expect(done.response).toContain("3,000.00 ج.م"); // 100×12 + 100×18
        expect(done.response).toContain("2,000.00 ج.م"); // 100×10 + 100×10
        expect(done.response).toContain("+1,000.00 ج.م");
        expect(done.response).toContain("+50.00%");
        expect(done.response).toContain("2026-10-06");
        expect(done.response).toContain("محايد (30–أقل من 70؛ 30.9)");
        expect(done.response).not.toContain("تشبع بيعي");
        expect(done.response).not.toMatch(/الركيزة الأساسية|المركز الأقوى|اجعل.+أساس/);
    });

    test("refuses portfolio totals and weights when marked prices are from different dates", async () => {
        const fixture: Fixture = {
            positions: portfolioCase.positions.map((position, index) => ({
                ...position,
                last_price_as_of: index === 0 ? "2026-10-06" : "2026-10-05",
                price_updated_at: index === 0 ? "2026-10-06" : "2026-10-05",
            })),
            stocks: portfolioCase.stocks.map((stock, index) => ({
                ...stock, data_time: index === 0 ? "2026-10-06" : "2026-10-05",
            })),
        };
        const { done } = await runPortfolioFixture(fixture);

        expect(done.publication_review).toMatchObject({ final_passed: true });
        expect(done.response).toMatch(/لم أعرض إجمالي القيمة أو الأوزان.*التقييم المؤرخ الكامل والمتزامن غير متاح/);
        expect(done.response).not.toContain("القيمة السوقية 3,000.00");
    });
});
