const { executeStructuredTools } = require("../ai/tools-v2");

function createSupabase(rowsByTable) {
    return {
        from(table) {
            let rows = [...(rowsByTable[table] || [])];
            const query = {
                select: () => query,
                lte: (field, value) => {
                    rows = rows.filter(row => String(row[field] || "") <= String(value));
                    return query;
                },
                in: () => query,
                eq: (field, value) => {
                    rows = rows.filter(row => String(row[field] || "") === String(value));
                    return query;
                },
                order: (field, options = {}) => {
                    rows.sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || "")) * (options.ascending === false ? -1 : 1));
                    return query;
                },
                limit: () => query,
                maybeSingle: () => Promise.resolve({ data: rows[0] || null }),
                then: (resolve) => resolve({ data: rows })
            };
            return query;
        }
    };
}

describe("fair-value scan filters", () => {
    it("returns only below-midpoint stocks that also have a distribution signal", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const supabase = createSupabase({
            stock_technical_indicators: [
                { symbol: "LOWD", close: 4, rsi_14: 35, change_pct: -2, volume: 200, vol_sma20: 100, date: today },
                { symbol: "HIGD", close: 7, rsi_14: 65, change_pct: 2, volume: 200, vol_sma20: 100, date: today }
            ],
            stock_prices: [
                { symbol: "LOWD", exchange: "EGX", close: 4, low: 2, high: 8, date: today },
                { symbol: "HIGD", exchange: "EGX", close: 7, low: 2, high: 8, date: today }
            ],
            stock_scans_summary: [
                { symbol: "LOWD", signal: "distribution", dist_score: 74, consecutive_dist_days: 2, scan_date: today },
                { symbol: "HIGD", signal: "distribution", dist_score: 80, consecutive_dist_days: 3, scan_date: today }
            ]
        });
        const plan = {
            intent: "market_summary",
            confidence: 1,
            entities: {
                symbols: [], sector: null, timeframe: "current", reference: null,
                fair_value_direction: "below", require_distribution: true, require_accumulation: false
            },
            needs_vision_context: false,
            needs_history: false,
            needs_live_data: true,
            needs_historical_data: false,
            tools: ["get_fair_value_scan"],
            clarification_needed: false,
            resolved_from: { symbol: null, message_id: null }
        };

        const output = await executeStructuredTools(supabase, plan, []);
        const scan = output.results.find(result => result.tool === "get_fair_value_scan");
        expect(scan.data.direction).toBe("below");
        expect(scan.data.require_distribution).toBe(true);
        expect(scan.data.stocks.map(stock => stock.symbol)).toEqual(["LOWD"]);
        expect(scan.data.stocks[0].dist_score).toBe(74);
    });
});
