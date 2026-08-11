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

    it("keeps only below-midpoint stocks with a recent accumulation signal", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const stale = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
        const supabase = createSupabase({
            stock_technical_indicators: [
                { symbol: "FRESH", close: 4, volume: 200, vol_sma20: 100, date: today },
                { symbol: "STALE", close: 4, volume: 200, vol_sma20: 100, date: today },
                { symbol: "ABOVE", close: 7, volume: 200, vol_sma20: 100, date: today }
            ],
            stock_prices: [
                { symbol: "FRESH", exchange: "EGX", close: 4, low: 2, high: 8, date: today },
                { symbol: "STALE", exchange: "EGX", close: 4, low: 2, high: 8, date: today },
                { symbol: "ABOVE", exchange: "EGX", close: 7, low: 2, high: 8, date: today }
            ],
            stock_scans_summary: [
                { symbol: "FRESH", signal: "strong_accumulation", acc_score: 82, consecutive_acc_days: 3, scan_date: today },
                { symbol: "STALE", signal: "accumulation", acc_score: 90, consecutive_acc_days: 5, scan_date: stale },
                { symbol: "ABOVE", signal: "accumulation", acc_score: 88, consecutive_acc_days: 2, scan_date: today }
            ]
        });
        const plan = {
            intent: "market_summary", confidence: 1,
            entities: { symbols: [], sector: null, timeframe: "current", reference: null, fair_value_direction: "below", require_distribution: false, require_accumulation: true },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_fair_value_scan"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };

        const output = await executeStructuredTools(supabase, plan, []);
        const scan = output.results.find(result => result.tool === "get_fair_value_scan");
        expect(scan.data.stocks.map(stock => stock.symbol)).toEqual(["FRESH"]);
        expect(scan.data.stocks[0]).toMatchObject({ acc_score: 82, scan_date: today });
    });

    it("applies all excluded sectors to a fair-value accumulation scan", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const symbols = ["BANK", "PHAR", "TECH", "FOOD"];
        const supabase = createSupabase({
            stock_fundamentals: [
                { symbol: "BANK", exchange: "EGX", data: { sector: "Finance", industry: "Banks" } },
                { symbol: "PHAR", exchange: "EGX", data: { sector: "Health Technology", industry: "Pharmaceuticals" } },
                { symbol: "TECH", exchange: "EGX", data: { sector: "Technology Services", industry: "Software" } },
                { symbol: "FOOD", exchange: "EGX", data: { sector: "Consumer Non-Durables", industry: "Food" } }
            ],
            stock_technical_indicators: symbols.map(symbol => ({ symbol, close: 4, volume: 200, vol_sma20: 100, date: today })),
            stock_prices: symbols.map(symbol => ({ symbol, exchange: "EGX", close: 4, low: 2, high: 8, date: today })),
            stock_scans_summary: symbols.map(symbol => ({ symbol, signal: "accumulation", acc_score: 80, scan_date: today }))
        });
        const plan = {
            intent: "market_summary", confidence: 1,
            entities: {
                symbols: [], sector: null, timeframe: "current", reference: null,
                fair_value_direction: "below", require_accumulation: true,
                excluded_sectors: ["بنوك", "أدوية", "تكنولوجيا"]
            },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_fair_value_scan"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };

        const output = await executeStructuredTools(supabase, plan, []);
        const scan = output.results.find(result => result.tool === "get_fair_value_scan");
        expect(scan.data.excluded_sectors).toEqual(["بنوك", "أدوية", "تكنولوجيا"]);
        expect(scan.data.stocks.map(stock => stock.symbol)).toEqual(["FOOD"]);
    });

    it("limits a fair-value scan to explicitly requested stocks", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const supabase = createSupabase({
            stock_technical_indicators: [
                { symbol: "ONLY", close: 4, date: today },
                { symbol: "OTHER", close: 3, date: today }
            ],
            stock_prices: [
                { symbol: "ONLY", exchange: "EGX", close: 4, low: 2, high: 8, date: today },
                { symbol: "OTHER", exchange: "EGX", close: 3, low: 1, high: 9, date: today }
            ]
        });
        const plan = {
            intent: "stock_analysis", confidence: 1,
            entities: { symbols: ["ONLY"], sector: null, timeframe: "current", reference: null, fair_value_direction: "below" },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_fair_value_scan"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };

        const output = await executeStructuredTools(supabase, plan, []);
        const scan = output.results.find(result => result.tool === "get_fair_value_scan");
        expect(scan.data.stocks.map(stock => stock.symbol)).toEqual(["ONLY"]);
    });

    it("excludes requested sectors from the liquidity ranking", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const supabase = createSupabase({
            stock_fundamentals: [
                { symbol: "BANK", exchange: "EGX", data: { sector: "Finance", industry: "Banks" } },
                { symbol: "PHAR", exchange: "EGX", data: { sector: "Health Technology", industry: "Pharmaceuticals" } },
                { symbol: "FOOD", exchange: "EGX", data: { sector: "Consumer Non-Durables", industry: "Food" } }
            ],
            stock_technical_indicators: [
                { symbol: "BANK", exchange: "EGX", close: 10, volume: 100, vol_sma20: 100, date: today },
                { symbol: "PHAR", exchange: "EGX", close: 30, volume: 1000, vol_sma20: 100, date: today },
                { symbol: "FOOD", exchange: "EGX", close: 20, volume: 200, vol_sma20: 100, date: today }
            ]
        });
        const plan = {
            intent: "market_summary", confidence: 1,
            entities: { symbols: [], sector: null, timeframe: "current", reference: null, excluded_sectors: ["أدوية"] },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_sector_liquidity"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };

        const output = await executeStructuredTools(supabase, plan, []);
        const scan = output.results.find(result => result.tool === "get_sector_liquidity");
        expect(scan.data.sectors.map(sector => sector.sector)).toEqual(["Consumer Non-Durables", "Finance"]);
        expect(scan.data.excluded_sectors).toEqual(["أدوية"]);
    });

    it("marks an old stock scan as stale instead of live accumulation", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const stale = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
        const supabase = createSupabase({
            stock_scans_summary: [
                { symbol: "CPME", signal: "strong_accumulation", acc_score: 80.3, scan_date: stale }
            ],
            stock_technical_indicators: [
                { symbol: "CPME", close: 32.56, volume: 8, vol_sma20: 100, date: today }
            ]
        });
        const plan = {
            intent: "accumulation_distribution", confidence: 1,
            entities: { symbols: ["CPME"], sector: null, timeframe: "current", reference: null, scan_direction: "accumulation" },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_accumulation_stocks"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };

        const output = await executeStructuredTools(supabase, plan, [], "", "", "هل CPME في تجميع؟");
        const scan = output.results.find(result => result.tool === "get_accumulation_stocks");
        expect(scan.source).toBe("validation");
        expect(scan.data.validation).toMatchObject({ ok: false, reason: "stale" });
        expect(scan.data.stocks).toEqual([]);
    });

    it("limits sector liquidity output to explicitly compared sectors", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const supabase = createSupabase({
            stock_fundamentals: [
                { symbol: "BANK", exchange: "EGX", data: { sector: "Finance" } },
                { symbol: "REAL", exchange: "EGX", data: { sector: "Consumer Durables" } },
                { symbol: "PHAR", exchange: "EGX", data: { sector: "Health Technology" } },
                { symbol: "TELE", exchange: "EGX", data: { sector: "Communications" } }
            ],
            stock_technical_indicators: ["BANK", "REAL", "PHAR", "TELE"].map(symbol => ({ symbol, exchange: "EGX", close: 10, volume: 100, vol_sma20: 100, date: today }))
        });
        const plan = {
            intent: "sector_analysis", confidence: 1,
            entities: { symbols: [], sector: null, timeframe: "current", reference: null, requested_sectors: ["عقارات", "أدوية", "اتصالات"] },
            needs_vision_context: false, needs_history: false, needs_live_data: true, needs_historical_data: false,
            tools: ["get_sector_liquidity"], clarification_needed: false, resolved_from: { symbol: null, message_id: null }
        };

        const output = await executeStructuredTools(supabase, plan, []);
        const result = output.results.find(item => item.tool === "get_sector_liquidity");
        expect(result.data.sectors.map(sector => sector.sector).sort()).toEqual(["Communications", "Consumer Durables", "Health Technology"].sort());
        expect(result.data.requested_sectors).toEqual(["عقارات", "أدوية", "اتصالات"]);
    });
});
