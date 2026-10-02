import { fetchRecommendationPages, recommendationPerformance, summarizeRecommendationEvidence } from "../recommendation-evidence";
import { executeStructuredTools } from "../tools-v2";

describe("recommendation price evidence", () => {
    it.each([
        ["GTHE", 5, 4.25, -2, -15], ["APPC", 1.6, 1.45, -1.88, -9.375],
    ])("recomputes %s open return from the displayed quote", (symbol, entry, current, stored, expected) => {
        const result = recommendationPerformance({ symbol, status: "open", signal: "BUY", entry_price: entry, current_price: current, profit_loss_pct: stored });
        expect(result.return_pct).toBeCloseTo(expected as number);
        expect(result.return_basis).toBe("open_mark_to_market");
    });
    it("values closed trades using exit and applies bearish direction", () => {
        expect(recommendationPerformance({ status: "win", signal: "BUY", entry_price: 10, exit_price: 12, current_price: 7 }).return_pct).toBe(20);
        expect(recommendationPerformance({ status: "win", signal: "SELL", entry_price: 10, exit_price: 8, current_price: 15 }).return_pct).toBe(20);
        expect(recommendationPerformance({ status: "win", signal: "BUY", entry_price: 10, current_price: 12 }).return_basis).toBe("unavailable");
    });
    it.each([null, undefined, "", 0, -1, NaN])("keeps missing or invalid prices (%s) unknown", current_price => {
        expect(recommendationPerformance({ status: "open", entry_price: 5, current_price, profit_loss_pct: 5 }).return_pct).toBeNull();
    });
    it("does not classify an unknown return as flat or losing", () => {
        const summary = summarizeRecommendationEvidence([
            { status: "open", entry_price: 5, current_price: null },
            { status: "open", entry_price: 5, current_price: 5 },
            { status: "open", entry_price: 5, current_price: 4 },
        ]);
        expect(summary).toMatchObject({ count: 3, profit: 0, loss: 1, flat: 1, unknown: 1, evaluated: 2 });
    });
    it("rejects a quote dated before the signal", () => {
        expect(recommendationPerformance({ status: "open", entry_price: 5, current_price: 6, current_date: "2026-09-01", created_at: "2026-09-02" }).return_pct).toBeNull();
    });
});

describe("recommendation pagination contract", () => {
    it("fetches beyond ten and marks exact collection completeness", async () => {
        const input = Array.from({ length: 12 }, (_, id) => ({ id }));
        const fetch = jest.fn(async (from, to) => ({ data: input.slice(from, to + 1), count: input.length }));
        const result = await fetchRecommendationPages(fetch, 10);
        expect(result.rows).toHaveLength(12);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(result.collection).toMatchObject({ matched_total: 12, returned_count: 12, complete: true, capped: false });
    });
    it("discloses the cap and a failed later page", async () => {
        const input = Array.from({ length: 12 }, (_, id) => ({ id }));
        const capped = await fetchRecommendationPages(async (from, to) => ({ data: input.slice(from, to + 1), count: 12 }), 5, 10);
        expect(capped.collection).toMatchObject({ complete: false, capped: true, matched_total: 12, fetched_count: 10 });
        const failed = await fetchRecommendationPages(async from => from ? { data: null, error: "offline" } : { data: input.slice(0, 5), count: 12 }, 5);
        expect(failed.collection).toMatchObject({ complete: false, fetch_failed: true, fetched_count: 5 });
    });
    it("does not treat a server-limited short page as complete", async () => {
        const result = await fetchRecommendationPages(async (from) => ({
            data: from === 0 ? Array.from({ length: 5 }, (_, id) => ({ id })) : [], count: 12,
        }), 100);
        expect(result.collection).toMatchObject({ matched_total: 12, fetched_count: 5, complete: false, capped: false });
    });
});

function mockDatabase(recommendations: any[], quotes: any[], failTable?: string) {
    const queries: any[] = [];
    return {
        queries,
        from: jest.fn((table: string) => {
            const state: any = { table, filters: [], from: 0, to: Infinity, limit: Infinity };
            queries.push(state);
            const query: any = {
                select: () => query,
                eq: (key: string, value: unknown) => { state.filters.push([key, value]); return query; },
                or: () => query,
                order: () => query,
                range: (from: number, to: number) => { state.from = from; state.to = to; return query; },
                limit: (limit: number) => { state.limit = limit; return query; },
                then: (resolve: any) => {
                    if (table === failTable) return Promise.resolve({ data: null, error: new Error("offline") }).then(resolve);
                    const rows = (table === "scan_results" ? recommendations : quotes).filter(row => state.filters.every(([key, value]: any[]) => row[key] === undefined || row[key] === value));
                    return Promise.resolve({ data: rows.slice(state.from, Math.min(state.to + 1, state.limit)), count: rows.length }).then(resolve);
                },
            };
            return query;
        }),
    };
}

describe("recommendation tool contract", () => {
    const plan: any = { tools: ["get_recommendations"], needs_live_data: true, entities: { symbols: [], recommendation_filter: "open" } };
    const rec = (symbol: string, extra: any = {}) => ({ id: symbol, symbol, signal: "BUY", status: "open", entry_price: 5, target_price: 6, stop_loss: 4, created_at: "2026-09-01T10:00:00Z", ...extra });
    it("returns all 12 open recommendations and finds each symbol's quote independently", async () => {
        const rows = Array.from({ length: 12 }, (_, index) => rec(`TEST${index}`));
        const db = mockDatabase(rows, rows.map(row => ({ symbol: row.symbol, close: 4.25, date: "2026-10-01" })));
        const output = await executeStructuredTools(db, plan, [], "", "", "هات كل التوصيات المفتوحه");
        const result = output.results.find(item => item.tool === "get_recommendations")!;
        expect(result.data).toHaveLength(12);
        expect(result.recommendation_collection).toMatchObject({ matched_total: 12, complete: true });
        expect(result.data.every((row: any) => row.return_pct === -15)).toBe(true);
        expect(db.queries.filter(q => q.table === "stock_prices")).toHaveLength(12);
        expect(result.data[11].quote_date).toBe("2026-10-01");
    });
    it("preserves unknown prices and reports excluded records without claiming completeness", async () => {
        const db = mockDatabase([rec("GTHE"), rec("INVALID", { stop_loss: null })], [{ symbol: "GTHE", close: null, date: "2026-10-01" }]);
        const output = await executeStructuredTools(db, plan, []);
        const result = output.results.find(item => item.tool === "get_recommendations")!;
        expect(result.recommendation_collection).toMatchObject({ matched_total: 2, returned_count: 1, excluded_count: 1, complete: false });
        expect(result.data[0]).toMatchObject({ current_price: null, return_pct: null, outcome: "unknown" });
    });
    it("source failures are failed coverage, not an empty list assertion", async () => {
        const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const output = await executeStructuredTools(mockDatabase([], [], "scan_results"), plan, []);
            expect(output.results.find(item => item.tool === "get_recommendations")).toMatchObject({ availability: "failed", recommendation_collection: { complete: false, fetch_failed: true } });
        } finally { spy.mockRestore(); }
    });
});
