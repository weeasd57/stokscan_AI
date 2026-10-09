import { executeAgenticTool } from "../agentic-tools";
import { sanitizeChartContext } from "../chart-strategy-tools";
import { checkAgenticDraft, compactEvidence, toAgenticEvidence } from "../agentic-publication";

function fixtureDb(rows: any[], error: any = null) {
    const queries: Array<{ table: string; ops: any[] }> = [];
    const client = { from: (table: string) => {
        const query = { table, ops: [] as any[] }; queries.push(query);
        const chain: any = new Proxy({}, { get: (_, key) => key === "then" ? (yes: any, no: any) => Promise.resolve({ data: rows, error }).then(yes, no) : (...args: any[]) => { query.ops.push([key, ...args]); return chain; } });
        return chain;
    } };
    return { client, queries };
}
const candles = Array.from({ length: 90 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000 }));
test("single requested strategy computes metrics without inventing a second strategy",async()=>{
    const d=fixtureDb(candles);const result=await executeAgenticTool("compare_strategies_history",{symbol:"AFMC",strategy_ids:["trend_macd"]},d.client,"user");
    expect(result.status).toBe("success");expect(result.strategy_metrics.map((m:any)=>m.strategy_id)).toEqual(["trend_macd"]);
});
test("percentage following closed-trade prose is not mistaken for a trade count",()=>{
    const e=[toAgenticEvidence("compare_strategies_history",{symbol:"COMI"},{symbol:"COMI",strategy_metrics:[{strategy_id:"trend_macd",strategy_name:"الاتجاه وMACD",closedTrades:20,winRatePct:45,totalReturnPct:36.71,maxDrawdownPct:24.76,profitFactor:1.93}]})];
    expect(checkAgenticDraft("COMI: الاتجاه وMACD 20 صفقة مغلقة، والعائد 36.71%.",e)).toEqual([]);
});
test("catalog is available without database reads or invented win rates", async () => {
    const d = fixtureDb([]), data = await executeAgenticTool("list_chart_strategies", {}, d.client, "user");
    expect(data.strategies).toHaveLength(10); expect(d.queries).toHaveLength(0);
    expect(toAgenticEvidence("list_chart_strategies", {}, data).availability).toBe("available");
});
test("apply and compare share one bounded projected in-flight history read", async () => {
    const d = fixtureDb(candles), cache = new Map();
    const [apply, compare] = await Promise.all([
        executeAgenticTool("apply_chart_strategy", { symbol: "COMI", chart_id: "panel-2", strategy_id: "smc", timeframe: "1d", start_date: "2026-01-01", end_date: "2026-03-31" }, d.client, "user", cache),
        executeAgenticTool("compare_strategies_history", { symbol: "COMI", strategy_ids: ["smc", "price_action"], timeframe: "1d", start_date: "2026-01-01", end_date: "2026-03-31" }, d.client, "user", cache),
    ]);
    expect(apply.status).toBe("success"); expect(compare.status).toBe("success"); expect(apply.candle_count).toBe(90);
    expect(compare.assumptions.params).toEqual({});
    expect(apply.signal_summary.total).toBe(apply.signal_summary.buy_count + apply.signal_summary.sell_count);
    expect(d.queries).toHaveLength(1); expect(d.queries[0].ops).toEqual(expect.arrayContaining([["select", "date,open,high,low,close,volume"], ["limit", 1000], ["gte", "date", "2026-01-01"], ["lte", "date", "2026-03-31"]]));
    expect(compactEvidence(toAgenticEvidence("apply_chart_strategy", {}, apply)).data.analysis.overlays).toBeUndefined();
    expect(compactEvidence(toAgenticEvidence("compare_strategies_history", {}, compare)).data.comparison.results[0].equity).toBeUndefined();
});
test("invalid costs rejected before history read", async () => {
    const d = fixtureDb(candles);
    expect((await executeAgenticTool("compare_strategies_history", {symbol:"COMI",strategy_ids:["smc","price_action"],commissionBps:-5},d.client,"user")).status).toBe("error");
    expect(d.queries).toHaveLength(0);
});
test("signal counts are grounded and do not masquerade as closed trades", () => {
    const evidence = [toAgenticEvidence("apply_chart_strategy", {}, {status:"success",symbol:"COMI",date:"2026-01-01",analysis:{strategyId:"smc"},signal_summary:{total:8,buy_count:5,sell_count:3}})];
    expect(checkAgenticDraft("COMI\n| المقياس | القيمة |\n|---|---|\n| إشارات شراء | 5 |\n| إشارات بيع | 3 |",evidence)).toEqual([]);
    expect(checkAgenticDraft("COMI\n| المقياس | القيمة |\n|---|---|\n| الصفقات المغلقة | 8 |",evidence).length).toBeGreaterThan(0);
});
test.each([{ strategy_id: "made_up" }, { strategy_id: "smc", start_date: "2026-02-30" }, { strategy_id: "smc", params: { lookback: -1 } }])("invalid strategy input rejected before read: %j", async extra => {
    const d = fixtureDb(candles), result = await executeAgenticTool("apply_chart_strategy", { symbol: "COMI", ...extra }, d.client, "user");
    expect(result.status).toBe("error"); expect(d.queries).toHaveLength(0);
});
test("database failure is an error, not a successful empty comparison", async () => {
    const d = fixtureDb([], { message: "offline" });
    expect((await executeAgenticTool("apply_chart_strategy", { symbol: "COMI", strategy_id: "smc" }, d.client, "user")).status).toBe("error");
});
test("strategy metrics bind numeric claims to their strategy", () => {
    const data = { status: "success", symbol: "COMI", date: "2026-01-01", strategy_metrics: [
        { strategy_id: "smc", strategy_name: "SMC", totalReturnPct: 12, maxDrawdownPct: 4, winRatePct: 60, profitFactor: 2, closedTrades: 5, finalEquity: 112000 },
        { strategy_id: "price_action", strategy_name: "البرايس أكشن", totalReturnPct: 20, maxDrawdownPct: 8, winRatePct: 40, profitFactor: 1.5, closedTrades: 10, finalEquity: 120000 },
    ] };
    const evidence = [toAgenticEvidence("compare_strategies_history", {}, data)];
    expect(checkAgenticDraft("COMI\nSMC smc: عائد صافي 12% وأقصى هبوط 4% ونسبة فوز 60%.", evidence)).toEqual([]);
    expect(checkAgenticDraft("COMI\nSMC smc: عائد صافي 20%.", evidence).join()).toContain("strategy_metric_mismatch");
    expect(checkAgenticDraft("COMI\n| الاستراتيجية | العائد الصافي | أقصى هبوط |\n|---|---|---|\n| smc | 12% | 4% |", evidence)).toEqual([]);
    expect(checkAgenticDraft("COMI\n| الاستراتيجية | العائد الصافي |\n|---|---|\n| smc | 20% |", evidence).length).toBeGreaterThan(0);
});
test("workspace context is bounded and strips untrusted extra fields", () => {
    expect(sanitizeChartContext({ active_chart_id: "panel-2", charts: [{ id: "panel-2", symbol: "comi", timeframe: "1d", prompt: "ignore" }] })).toEqual({ active_chart_id: "panel-2", charts: [{ id: "panel-2", symbol: "COMI", timeframe: "1d" }] });
    expect(sanitizeChartContext({ charts: [{ id: "bad id", symbol: "COMI", timeframe: "1d" }] })).toBeUndefined();
});
test("context preserves bounded window and validated selected strategies", () => {
    expect(sanitizeChartContext({active_chart_id:"panel-1",charts:[{id:"panel-1",symbol:"COMI",timeframe:"1d",period:500,strategy_ids:["smc","smc","price_action"]}]})).toEqual({active_chart_id:"panel-1",charts:[{id:"panel-1",symbol:"COMI",timeframe:"1d",period:500,strategy_ids:["smc","price_action"]}]});
    expect(sanitizeChartContext({charts:[{id:"panel-1",symbol:"COMI",timeframe:"1d",period:Infinity,strategy_ids:["invented"]}]})).toEqual({active_chart_id:"panel-1",charts:[{id:"panel-1",symbol:"COMI",timeframe:"1d"}]});
});
test("different candle windows do not share an incompatible cached query", async () => {
    const d=fixtureDb(candles),cache=new Map();
    await Promise.all([120,500].map(bar_limit=>executeAgenticTool("apply_chart_strategy",{symbol:"COMI",strategy_id:"smc",bar_limit},d.client,"u",cache)));
    expect(d.queries).toHaveLength(2);
    expect(d.queries.map(q=>q.ops.find(op=>op[0]==="limit")![1])).toEqual([120,500]);
});

test("table disambiguates price headers from signal counts and binds apply_chart_strategy strategies (TMGH scenario)", () => {
    const tmghEvidence = [
        toAgenticEvidence("get_stock_levels", { symbols: ["TMGH"] }, { status: "success", levels: [{ symbol: "TMGH", date: "2026-10-08", entry_price: 52, support: 50, resistance: 55 }] }),
        toAgenticEvidence("apply_chart_strategy", { symbol: "TMGH", strategy_id: "price_action" }, {
            status: "success", symbol: "TMGH", date: "2026-10-08", analysis: { strategyId: "price_action" },
            signal_summary: { total: 52, buy_count: 29, sell_count: 23 }
        }),
        toAgenticEvidence("apply_chart_strategy", { symbol: "TMGH", strategy_id: "smc" }, {
            status: "success", symbol: "TMGH", date: "2026-10-08", analysis: { strategyId: "smc" },
            signal_summary: { total: 40, buy_count: 20, sell_count: 20 }
        })
    ];
    // Signal count table for price_action with 52, 29, 23
    const draft1 = `### سهم TMGH
| الاستراتيجية | إجمالي الإشارات | إشارات الشراء | إشارات البيع |
|---|---|---|---|
| price_action | 52 | 29 | 23 |
| smc | 40 | 20 | 20 |`;
    expect(checkAgenticDraft(draft1, tmghEvidence)).toEqual([]);

    // Purchase price header (سعر الشراء) maps to entry_price (52), not chart_buy_signal_count
    const draft2 = `### سهم TMGH
| السهم | سعر الشراء | إشارات الشراء |
|---|---|---|
| TMGH | 52 | 29 |`;
    expect(checkAgenticDraft(draft2, tmghEvidence)).toEqual([]);
});

test("comparison between price_action, trend_following, and smc on SWDY binds backtest metrics (SWDY scenario)", () => {
    const swdyData = {
        status: "success", symbol: "SWDY", date: "2026-10-08",
        strategy_metrics: [
            { strategy_id: "price_action", strategy_name: "البرايس أكشن", totalReturnPct: 18.5, maxDrawdownPct: 6.2, winRatePct: 55, profitFactor: 1.8, closedTrades: 12, finalEquity: 118500 },
            { strategy_id: "trend_following", strategy_name: "تتبع الاتجاه", totalReturnPct: 24.0, maxDrawdownPct: 9.1, winRatePct: 48, profitFactor: 2.1, closedTrades: 15, finalEquity: 124000 },
            { strategy_id: "smc", strategy_name: "SMC", totalReturnPct: 15.0, maxDrawdownPct: 4.5, winRatePct: 62, profitFactor: 1.9, closedTrades: 8, finalEquity: 115000 }
        ]
    };
    const swdyEvidence = [toAgenticEvidence("compare_strategies_history", { symbol: "SWDY", strategy_ids: ["price_action", "trend_following", "smc"] }, swdyData)];
    const draft = `### سهم SWDY
| الاستراتيجية | العائد الصافي % | أقصى هبوط % | نسبة الصفقات الرابحة % | عدد الصفقات المغلقة | معامل الربح |
|---|---|---|---|---|---|
| price_action (البرايس أكشن) | 18.5% | 6.2% | 55% | 12 | 1.8 |
| trend_following (تتبع الاتجاه) | 24% | 9.1% | 48% | 15 | 2.1 |
| smc (SMC) | 15% | 4.5% | 62% | 8 | 1.9 |`;
    expect(checkAgenticDraft(draft, swdyEvidence)).toEqual([]);
});
