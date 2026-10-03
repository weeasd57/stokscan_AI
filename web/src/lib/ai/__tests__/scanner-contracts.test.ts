import { executeStructuredTools } from "../tools-v2";
import type { IntentPlan } from "../types";

const date = "2026-10-01";
const technical = (symbol: string, values: Record<string, any> = {}) => ({ symbol, exchange: "EGX", date, close: 12, rsi_14: 29,
    volume: 100, vol_sma20: 100, sma_200: 10, ema_200: 20, bb_lower: 11, bb_upper: 15, ...values });

function database(tables: Record<string, any[]>) {
    const readTables: string[] = [];
    const from = jest.fn((table: string) => {
        readTables.push(table);
        let rows = [...(tables[table] || [])];
        const chain: any = {
            select: () => chain,
            eq: (field: string, value: any) => { rows = rows.filter(row => row[field] === value); return chain; },
            in: (field: string, values: any[]) => { rows = rows.filter(row => values.includes(row[field])); return chain; },
            gte: (field: string, value: any) => { rows = rows.filter(row => row[field] >= value); return chain; },
            lte: (field: string, value: any) => { rows = rows.filter(row => row[field] <= value); return chain; },
            order: () => chain,
            limit: (limit: number) => { rows = rows.slice(0, limit); return chain; },
            then: (resolve: (result: any) => any) => Promise.resolve(resolve({ data: rows, error: null })),
        };
        return chain;
    });
    return { from, readTables };
}

function plan(tool: string, entities: Record<string, any> = {}): IntentPlan {
    return { intent: tool === "get_technical_scan" ? "technical_scan" : "accumulation_distribution", confidence: 1,
        entities: { symbols: [], sector: null, timeframe: "current", reference: null, ...entities },
        tools: [tool], needs_live_data: true, needs_historical_data: false, needs_history: false,
        needs_vision_context: false, clarification_needed: false, resolved_from: { symbol: null, message_id: null } };
}

describe("scanner evidence and request contracts", () => {
    test("Bollinger keeps every genuine match, rejects different sessions and conflicting daily ranges", async () => {
        const rows = Array.from({ length: 22 }, (_, n) => technical(`S${n}`));
        rows.push(technical("OLD", { date: "2026-09-30" }), technical("CONFLICT"), technical("NO_RANGE"));
        const prices = rows.map(row => ({ symbol: row.symbol, exchange: "EGX", date: row.date, low: 10.9, high: 12 }));
        prices.push({ symbol: "CONFLICT", exchange: "EGX", date, low: 10.8, high: 12 });
        const db = database({ stock_technical_indicators: rows, stock_prices: prices.filter(row => row.symbol !== "NO_RANGE") });
        const output = await executeStructuredTools(db, plan("get_technical_scan", { technical_preset: "bollinger_lower_touch" }), [], "", "",
            "هاتلي كل الاسهم اللي لامست قاع وbollinger Band");
        const result = output.results.find(result => result.tool === "get_technical_scan")!;
        expect(result.data.stocks).toHaveLength(22);
        expect(result.symbols).not.toEqual(expect.arrayContaining(["OLD", "CONFLICT", "NO_RANGE"]));
        expect(result.data.scan_collection).toMatchObject({ complete: false, missing_evidence_count: 2, excluded_session_rows: 1 });
        expect(result.data.stocks[0].bollinger_evidence).toMatchObject({ available: true, matches: true, low: 10.9, high: 12, band: 11 });
    });

    test("upper Bollinger requests override a wrongly inferred lower preset", async () => {
        const db = database({ stock_technical_indicators: [technical("UPPER")], stock_prices: [{ symbol: "UPPER", exchange: "EGX", date, low: 14, high: 16 }] });
        const output = await executeStructuredTools(db, plan("get_technical_scan", { technical_preset: "bollinger_lower_touch" }), [], "", "", "هات الأسهم اللي لامست الحد العلوي لبولينجر");
        expect(output.results[0].data).toMatchObject({ preset: "bollinger_upper_touch", count: 1 });
    });

    test.each(["هات الأسهم اللي لامست الحد العلوي والسفلي لبولينجر", "هات الأسهم اللي أغلقت تحت الحد السفلي لبولينجر", "هات أسهم SMA 200 cross", "أسهم تقاطع MACD الذهبي"])("does not substitute snapshot state for unsupported condition: %s", async message => {
        const db = database({ stock_technical_indicators: [technical("A")] });
        const output = await executeStructuredTools(db, plan("get_technical_scan", { technical_preset: "sma_200_breakout" }), [], "", "", message);
        expect(output.results[0]).toMatchObject({ availability: "unsupported", data: { stocks: [] } });
        expect(db.readTables).not.toContain("stock_technical_indicators");
    });

    test.each([["هات الأسهم RSI < 30", ["LOW"]], ["هات الأسهم RSI <= 30", ["LOW", "BOUND"]], ["هات الأسهم RSI أقل من ٣٥", ["LOW", "BOUND", "MID"]], ["هات الأسهم RSI > 30", ["MID", "HIGH"]]])("respects RSI threshold and operator: %s", async (message, expected) => {
        const db = database({ stock_technical_indicators: [technical("LOW", { rsi_14: 29 }), technical("BOUND", { rsi_14: 30 }), technical("MID", { rsi_14: 34 }), technical("HIGH", { rsi_14: 35 }), technical("MISSING", { rsi_14: null })] });
        const output = await executeStructuredTools(db, plan("get_technical_scan", { technical_preset: "rsi_oversold" }), [], "", "", message as string);
        expect(output.results[0].symbols).toEqual(expected);
    });

    test("SMA above uses SMA without replacing it with EMA, and stays in the requested sector/session", async () => {
        const db = database({ stock_technical_indicators: [technical("BANK"), technical("REAL"), technical("OLD", { date: "2026-09-30" })],
            stock_fundamentals: [{ symbol: "BANK", exchange: "EGX", data: { sector: "banking" } }, { symbol: "REAL", exchange: "EGX", data: { sector: "real estate" } }] });
        const output = await executeStructuredTools(db, plan("get_technical_scan", { technical_preset: "sma_200_breakout", sector: "بنوك" }), [], "", "", "هات أسهم البنوك فوق SMA 200");
        expect(output.results[0].symbols).toEqual(["BANK"]);
        expect(output.results[0].data.preset_name_ar).toBe("السعر فوق SMA 200");
    });

    test("empty accumulation discovery exposes alternatives separately without manufactured scores/volume ratios", async () => {
        const db = database({ stock_scans_summary: [], stock_technical_indicators: [technical("ACTIVE", { volume: null, vol_sma20: null })] });
        const output = await executeStructuredTools(db, plan("get_accumulation_stocks"), [], "", "", "أفضل أسهم للاستثمار حاليا");
        expect(output.results.find(result => result.tool === "get_accumulation_stocks")).toMatchObject({ availability: "empty", data: { stocks: [], matches: [] } });
        const alternative = output.results.find(result => result.tool === "get_market_alternatives")!;
        expect(alternative.data.stocks[0]).toMatchObject({ symbol: "ACTIVE", vol_ratio: null });
        expect(alternative.data.stocks[0]).not.toHaveProperty("acc_score");
        expect(alternative.data.stocks[0]).not.toHaveProperty("dist_score");
    });

    test.each([{ symbols: ["NAMED"] }, { sector: "بنوك" }, { requested_date: date }, { min_acc_score: 70 }, { timeframe: "historical" }])("never widens a scoped or strict empty accumulation scan: %s", async entities => {
        const db = database({ stock_scans_summary: [], stock_technical_indicators: [technical("OTHER")] });
        const output = await executeStructuredTools(db, plan("get_accumulation_stocks", entities), [], "", "", "هات أسهم التجميع");
        expect(output.results.some(result => result.tool === "get_market_alternatives")).toBe(false);
        expect(db.readTables).not.toContain("stock_technical_indicators");
    });
});
