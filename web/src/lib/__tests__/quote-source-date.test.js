jest.mock("../ai/live-stock-updater", () => ({
    isEgxSessionOpen: () => false,
    fetchLiveStockIndicators: jest.fn(async () => ({ success: false, error: "offline fixture" })),
}));

const { executeStructuredTools } = require("../ai/tools-v2");
const { fetchLiveStockIndicators } = require("../ai/live-stock-updater");

function createSupabase(rowsByTable) {
    return {
        from(table) {
            let rows = [...(rowsByTable[table] || [])];
            const query = {
                select: () => query,
                eq: (field, value) => {
                    rows = rows.filter(row => String(row[field] ?? "").toLowerCase() === String(value).toLowerCase());
                    return query;
                },
                ilike: (field, value) => {
                    rows = rows.filter(row => String(row[field] ?? "").toLowerCase() === String(value).toLowerCase());
                    return query;
                },
                in: (field, values) => {
                    rows = rows.filter(row => values.includes(row[field]));
                    return query;
                },
                or: () => query,
                order: (field, options = {}) => {
                    rows.sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")) * (options.ascending === false ? -1 : 1));
                    return query;
                },
                limit: () => query,
                maybeSingle: () => Promise.resolve({ data: rows[0] || null }),
                then: resolve => resolve({ data: rows, count: rows.length }),
            };
            return query;
        },
    };
}

function plan() {
    return {
        intent: "stock_analysis",
        confidence: 1,
        entities: { symbols: ["TEST"], requested_date: null },
        needs_vision_context: false,
        needs_history: false,
        needs_live_data: true,
        needs_historical_data: false,
        tools: ["get_stock"],
        clarification_needed: false,
        resolved_from: { symbol: null, message_id: null },
    };
}

async function getQuote(rowsByTable) {
    const output = await executeStructuredTools(createSupabase(rowsByTable), plan(), []);
    return output.results.find(result => result.tool === "get_stock");
}

describe("get_stock quote observation dates", () => {
    beforeEach(() => fetchLiveStockIndicators.mockReset().mockResolvedValue({ success: false, error: "offline fixture" }));

    it("dates a technical close from its own observation row", async () => {
        const quote = await getQuote({
            stock_technical_indicators: [{ symbol: "TEST", exchange: "EGX", close: 12, date: "2026-10-02", rsi_14: 52 }],
            stock_prices: [{ symbol: "TEST", exchange: "EGX", close: 11, date: "2026-10-01" }],
        });

        expect(quote.data.price).toBe(12);
        expect(quote.data_time).toBe("2026-10-02");
        expect(quote.data.metric_dates).toMatchObject({ price: "2026-10-02", close: "2026-10-02", rsi_14: "2026-10-02" });
    });

    it("uses stock_prices date when that row supplies the fallback close", async () => {
        const quote = await getQuote({
            stock_technical_indicators: [{ symbol: "TEST", exchange: "EGX", close: null, date: "2026-10-06", rsi_14: 52 }],
            stock_prices: [{ symbol: "TEST", exchange: "EGX", close: 11, date: "2026-10-01" }],
        });

        expect(quote.data.price).toBe(11);
        expect(quote.data_time).toBe("2026-10-01");
        expect(quote.data.metric_dates).toMatchObject({ price: "2026-10-01", close: "2026-10-01", rsi_14: "2026-10-06" });
    });

    it("leaves an undated cached quote unknown instead of assigning fetch time or another metric date", async () => {
        const quote = await getQuote({
            stock_technical_indicators: [{ symbol: "TEST", exchange: "EGX", close: null, date: "2026-10-06", rsi_14: 52 }],
            stock_prices: [{ symbol: "TEST", exchange: "EGX", close: 11, date: null }],
        });

        expect(quote.data.price).toBe(11);
        expect(quote.data_time).toBe("");
        expect(quote.data.metric_dates).toMatchObject({ price: null, close: null, rsi_14: "2026-10-06" });
    });

    it("uses the live quote updated_at as the observation time", async () => {
        fetchLiveStockIndicators.mockResolvedValue({
            success: true,
            data: { close: 13, updated_at: "2026-10-07T11:04:00Z", cairo_time_str: "13:04" },
        });
        const quote = await getQuote({});

        expect(quote.data.is_live_intraday).toBe(true);
        expect(quote.data_time).toBe("2026-10-07T11:04:00Z");
        expect(quote.data.metric_dates).toMatchObject({ price: "2026-10-07T11:04:00Z", close: "2026-10-07T11:04:00Z" });
    });
});
