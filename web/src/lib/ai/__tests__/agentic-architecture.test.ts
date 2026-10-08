import { executeAgenticTool, runAgenticPipelineStream, AGENTIC_TOOLS_SCHEMA } from "../agentic-pipeline";
import { cairoWeekBounds } from "../agentic-tools";
import { checkAgenticDraft, toAgenticEvidence } from "../agentic-publication";
jest.mock("../server-secrets", () => ({ getDeepSeekApiKey: () => "offline-fake-key" }));
jest.mock("../vision", () => ({ analyzeImage: jest.fn(), reconcileVisionWithMarket: jest.fn() }));

type Query = { table: string; ops: Array<[string, ...any[]]> };
function db(resolve: (q: Query) => any = () => ({ data: [], error: null })) {
    const queries: Query[] = [];
    const client = { from: (table: string) => {
        const q: Query = { table, ops: [] }; queries.push(q);
        const chain: any = new Proxy({}, { get: (_, name: string) => name === "then"
            ? (yes: any, no: any) => Promise.resolve(resolve(q)).then(yes, no)
            : (...args: any[]) => { q.ops.push([name, ...args]); return chain; } });
        return chain;
    }};
    return { client, queries };
}
const state = { current_symbol: null, last_symbols: [], summary: null };
const call = (name: string, args: any, id = "call-1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const verdict = (passed = true, reasons: string[] = []) => ({ content: JSON.stringify({ passed, reasons }) });
const price = { high: 110, low: 90, close: 100, date: "2026-10-08" };
function response(message: any, finish_reason = "stop") { return { ok: true, json: async () => ({ choices: [{ message, finish_reason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) }; }
async function run(messages: any[], overrides: any = {}) {
    const fetchMock = jest.fn(); for (const msg of messages) fetchMock.mockResolvedValueOnce(response(msg));
    global.fetch = fetchMock as any;
    const d = overrides.db || db(); const events: any[] = [];
    for await (const e of runAgenticPipelineStream(overrides.userMessage || "اختبار", overrides.images || [], overrides.state || state,
        overrides.summary || null, overrides.history || [], d.client, [], "offline-user", "offline-session", "offline-message", overrides.model,
        { timeoutMs: 20000, ...(overrides.options || {}) })) events.push(e);
    return { events, fetchMock, queries: d.queries, done: events.find(e => e.type === "done")?.data };
}
const stockDb = () => db(q => ({ data: q.table === "stock_prices" ? [price] : q.table === "stocks" ? { symbol:"COMI",name:"Commercial Bank" } : [], error:null }));

describe("Agentic architecture integration: current production path", () => {
    test("nine tools remain LLM selected", () => expect(new Set(AGENTIC_TOOLS_SCHEMA.map(t=>t.function.name)).size).toBe(9));
    test("direct greeting is reviewed and publishes only canonical answer", async () => {
        const r = await run([{content:"أهلاً"},verdict()]); expect(r.queries).toHaveLength(0);
        expect(r.done.publication_review.final_passed).toBe(true); expect(r.events.filter(e=>e.type === "token")).toHaveLength(1);
        expect(r.fetchMock).toHaveBeenCalledTimes(2);
    });
    test("scan then levels executes dependent tools before answering", async () => {
        const d = db(q=>({data:q.table === "stock_prices" ? [price] : [{symbol:"COMI",close:100,change_pct:3,r_vol:2,date:price.date}],error:null}));
        const r = await run([{tool_calls:[call("get_technical_scan",{preset:"momentum_and_volume"})]},
            {tool_calls:[call("get_stock_levels",{symbols:["COMI"]},"call-2")]}, {content:"COMI: دعم 90 جنيه، وقف الخسارة 88.2 جنيه، بتاريخ 2026-10-08."}, verdict()],{db:d});
        expect(r.done.publication_review.final_passed).toBe(true); expect(r.done.usage.tool_calls).toBe(2);
        expect(JSON.parse(r.fetchMock.mock.calls[1][1].body).tools).toEqual(AGENTIC_TOOLS_SCHEMA);
        expect(r.done.session_update.last_symbols).toContain("COMI"); expect(r.done.response).not.toContain("DSML");
    });
    test("memory and recent indirect answer are visible to writer and reviewer", async () => {
        const history=[{role:"assistant",content:"تقصد COMI ولا ETEL؟"},{role:"user",content:"الأول"}];
        const r=await run([{content:"COMI"},verdict()],{state:{...state,current_symbol:"COMI"},summary:{last_topic:"MEMORY_MARKER"},history});
        const body=JSON.parse(r.fetchMock.mock.calls[0][1].body); expect(JSON.stringify(body.messages)).toContain("MEMORY_MARKER");
        const review=JSON.parse(r.fetchMock.mock.calls[1][1].body); expect(review.messages[1].content).toContain("الأول"); expect(review.messages[1].content).toContain("COMI");
    });
    test("false reviewer approval cannot authorize fabricated price", async () => {
        const r=await run([{tool_calls:[call("get_stock_levels",{symbols:["COMI"]})]}, {content:"سعر COMI الحالي 9999 جنيه"},verdict(),
            {content:"سعر COMI الحالي 9999 جنيه"},verdict()],{db:stockDb()});
        expect(r.done.publication_review.final_passed).toBe(false); expect(r.done.response).not.toContain("9999"); expect(r.done.response).toContain("100");
        expect(r.events.filter(e=>e.type === "token").every(e=>!String(e.data).includes("9999"))).toBe(true);
    });
    test("review rejection is repaired once and verified again", async () => {
        const r=await run([{content:"رد بعيد عن السؤال"},verdict(false,["لم يكمل السؤال"]),{content:"رد مصحح"},verdict()]);
        expect(r.done.publication_review).toMatchObject({passed:false,repaired:true,final_passed:true}); expect(r.done.response).toContain("رد مصحح");
    });
    test("DSML cannot pass even when reviewer approves", async () => {
        const r=await run([{content:"<DSML invoke get_stock>"},verdict(),{content:"<DSML invoke get_stock>"},verdict()]);
        expect(r.done.publication_review.final_passed).toBe(false); expect(r.done.response).not.toContain("DSML");
    });
    test("malformed review JSON fails closed", async () => {
        const r=await run([{content:"رد مبدئي"},{content:"invalid-json"}]); expect(r.done.publication_review.final_passed).toBe(false); expect(r.done.response).not.toContain("رد مبدئي");
    });
    test("truncated provider response never becomes a published partial report", async () => {
        global.fetch=jest.fn().mockResolvedValue(response({content:"جزء ناقص"},"length")); const events:any[]=[];
        for await(const e of runAgenticPipelineStream("اختبار",[],state,null,[],db().client,[],"u","s","m")) events.push(e);
        expect(events.find(e=>e.type === "done").data.publication_review.final_passed).toBe(false);
        expect(events.filter(e=>e.type === "token").map(e=>e.data).join("")).not.toContain("جزء ناقص");
    });
    test("already aborted request makes no provider calls", async () => {
        const controller=new AbortController(); controller.abort(); const r=await run([],{options:{signal:controller.signal}});
        expect(r.fetchMock).not.toHaveBeenCalled(); expect(r.done.publication_review.final_passed).toBe(false);
    });
    test("provider and database receive effective cancellation signals", async () => {
        const r=await run([{tool_calls:[call("get_stock_levels",{symbols:["COMI"]})]},{content:"لا تتوفر بيانات"},verdict()]);
        expect(r.fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal); expect(r.queries.some((q:Query)=>q.ops.some(o=>o[0] === "abortSignal"))).toBe(true);
    });
    test("deadline terminates a provider that ignores abort", async () => {
        global.fetch=jest.fn().mockImplementation(()=>new Promise(()=>{})); const events:any[]=[]; const start=Date.now();
        for await(const e of runAgenticPipelineStream("اختبار",[],state,null,[],db().client,[],"u","s","m",undefined,{timeoutMs:20})) events.push(e);
        expect(Date.now()-start).toBeLessThan(500); expect(events.find(e=>e.type === "done").data.publication_review.final_passed).toBe(false);
    });
    test("bounded tool loop cannot execute endless calls", async () => {
        const r=await run(Array.from({length:4},()=>({tool_calls:[call("get_stock_levels",{symbols:["COMI"]})]})));
        expect(r.fetchMock).toHaveBeenCalledTimes(4); expect(r.done.publication_review.final_passed).toBe(false); expect(r.queries.filter((q:Query)=>q.table === "stock_prices")).toHaveLength(1);
    });
    test("provider usage sums planner, synthesis and reviewer", async () => {
        const r=await run([{content:"أهلاً"},verdict()]); expect(r.done.usage).toMatchObject({prompt_tokens:20,completion_tokens:10,total_tokens:30,provider_calls:2});
    });
    test("requested allowed model is actually used", async () => {
        const r=await run([{content:"أهلاً"},verdict()],{model:"deepseek-reasoner"}); expect(JSON.parse(r.fetchMock.mock.calls[0][1].body).model).toBe("deepseek-reasoner");
    });
    test("vision confidence, uncertainty and quantities are context, not asserted market verification", async () => {
        const r=await run([{content:"الصورة غير مؤكدة"},verdict()],{images:["fixture"],options:{mockVisionResult:{symbols:[{symbol:"COMI",visible_values:{quantity:10}}],confidence:.4,uncertainties:["uncertain-fixture"]}}});
        expect(JSON.parse(r.fetchMock.mock.calls[0][1].body).messages[1].content).toContain("uncertain-fixture"); expect(r.done.vision.confidence).toBe(.4);
    });
    test("tool metadata preserves source, availability and date", async () => {
        const r=await run([{tool_calls:[call("get_stock_levels",{symbols:["COMI"]})]},{content:"COMI سعره 100 جنيه"},verdict()],{db:stockDb()});
        const e=r.events.find(e=>e.type === "tools_data").data.results[0]; expect(e).toMatchObject({source:"supabase:stock_prices",data_time:price.date,availability:"available",symbols:["COMI"]});
    });
    test("model-selected write cannot execute without contextual user authorization",async()=>{
        const d=stockDb();const r=await run([{tool_calls:[call("manage_portfolio",{operation:"add",symbol:"COMI",quantity:10,price:100})]},
            {content:'{"authorized":false}'},{content:"لم يتم الحفظ"},verdict()],{db:d,userMessage:"حلل COMI"});
        expect(d.queries.some(q=>q.ops.some(o=>o[0] === "insert"))).toBe(false);expect(r.events.find(e=>e.type === "tools_data").data.results[0].data.persisted).toBe(false);
    });
    test("duplicate portfolio calls write once and reuse confirmed result",async()=>{
        const d=db(q=>({data:q.table === "stocks" ? {symbol:"COMI",name:"Bank"} : q.ops.some(o=>o[0] === "insert") && q.table === "positions" ? [{id:"p",symbol:"COMI",quantity:10,entry_price:100}] : [],error:null}));
        const args={operation:"add",symbol:"COMI",quantity:10,price:100};
        const r=await run([{tool_calls:[call("manage_portfolio",args),call("manage_portfolio",args,"call-2")]},
            {content:'{"authorized":true}'},{content:"تم تسجيل سهم COMI"},verdict()],{db:d,userMessage:"سجل COMI عدد 10 بسعر 100"});
        expect(d.queries.filter(q=>q.table === "positions" && q.ops.some(o=>o[0] === "insert"))).toHaveLength(1);expect(r.done.publication_review.final_passed).toBe(true);
    });
});

describe("Agentic tool correctness and failure boundaries", () => {
    test.each([-10,0,Infinity,NaN])("rejects invalid quantity %s before write",async quantity=>{
        const d=db();const r=await executeAgenticTool("manage_portfolio",{operation:"add",symbol:"COMI",quantity,price:100},d.client,"u");
        expect(r.status).toBe("error");expect(d.queries.some(q=>q.ops.some(o=>o[0] === "insert"))).toBe(false);
    });
    test("unknown stock does not get saved under an invented identity",async()=>{
        const r=await executeAgenticTool("manage_portfolio",{operation:"add",symbol:"UNKNOWN",quantity:10,price:100},db().client,"u"); expect(r.status).toBe("error");
    });
    test("only a returned changed row proves persistence",async()=>{
        const d=stockDb();const r=await executeAgenticTool("manage_portfolio",{operation:"add",symbol:"COMI",quantity:10,price:100},d.client,"u"); expect(r.status).toBe("error");
    });
    test("verified insert is user scoped and auditable",async()=>{
        const d=db(q=>({data:q.table === "stocks" ? {symbol:"COMI",name:"Bank"} : q.ops.some(o=>o[0] === "insert") && q.table === "positions" ? [{id:"p",symbol:"COMI",quantity:10,entry_price:100}] : [],error:null}));
        const r=await executeAgenticTool("manage_portfolio",{operation:"add",symbol:"COMI.CA",quantity:10,price:100},d.client,"u");
        expect(r).toMatchObject({persisted:true,status:"success",audit_recorded:true}); expect(d.queries.find(q=>q.table === "positions" && q.ops.some(o=>o[0] === "insert"))?.ops.find(o=>o[0] === "insert")?.[1]).toMatchObject({user_id:"u",source:"chatbot",symbol:"COMI"});
    });
    test("missing quote is null, not flat zero PnL",async()=>{
        const d=db(q=>({data:q.table === "positions" ? [{symbol:"COMI",quantity:10,entry_price:100}] : [],error:null}));
        const r=await executeAgenticTool("manage_portfolio",{operation:"view"},d.client,"u"); expect(r.positions[0].current_price).toBeNull();expect(r.positions[0].profit_loss_pct).toBeNull();expect(r.summary.total_market_value).toBeNull();
    });
    test("unknown quantity is not silently zero",async()=>{
        const d=db(q=>({data:q.table === "positions" ? [{symbol:"COMI",quantity:null,entry_price:100}] : [{close:110,date:price.date}],error:null}));
        const r=await executeAgenticTool("manage_portfolio",{operation:"view"},d.client,"u"); expect(r.positions[0].market_value).toBeNull(); expect(r.positions[0].quantity).toBeNull();
    });
    test.each(["get_stock","get_market","get_recommendations","get_news","get_technical_scan","get_comparison","manage_portfolio"])("%s read errors never claim empty success",async tool=>{
        const r=await executeAgenticTool(tool,{symbols:["COMI"],preset:"top_losers",operation:"view"},db(()=>({data:null,error:{message:"unavailable"}})).client,"u");expect(r.status).toBe("error");
    });
    test("portfolio select has an explicit strict limit",async()=>{
        const d=db();await executeAgenticTool("manage_portfolio",{operation:"view"},d.client,"u");expect(d.queries[0].ops).toContainEqual(["limit",101]);
    });
    test.each(["top_losers","macd_cross","smart_money_flow"])("preset %s has its own actual filter",async preset=>{
        const d=db(()=>({data:[{date:price.date,scan_date:price.date}],error:null}));await executeAgenticTool("get_technical_scan",{preset},d.client,"u");
        const query=d.queries[1];if(preset === "top_losers") expect(query.ops).toContainEqual(["order","change_pct",{ascending:true}]);
        else expect(query.ops.some(o=>["gt","gte"].includes(o[0]))).toBe(true);
    });
    test("positive MACD histogram alone is not a fresh crossing",async()=>{
        const d=db(q=>({data:q.ops.some(o=>o[0] === "select" && o[1] === "date") ? [{date:q.ops.some(o=>o[0] === "lt") ? "2026-10-07" : price.date}]
            : q.ops.some(o=>o[0] === "lte") ? [] : [{symbol:"COMI",macd_histogram:2,date:price.date}],error:null}));
        const r=await executeAgenticTool("get_technical_scan",{preset:"macd_cross"},d.client,"u");expect(r.stocks).toHaveLength(0);
    });
    test("empty market never invents session date or regime",async()=>{
        const r=await executeAgenticTool("get_market",{},db().client,"u"); expect(r.session_date).toBeNull();expect(r.egx30.market_regime).toBeNull();
    });
    test("empty recommendations never invent latest date",async()=>{
        const r=await executeAgenticTool("get_recommendations",{},db().client,"u"); expect(r.latest_available_date_in_system).toBeNull();expect(r.note).not.toContain("2026-09-21");
    });
    test("closed recommendation without outcome or exit has unknown return",async()=>{
        const d=db(q=>({data:q.ops.some(o=>o[0] === "select" && o[1] === "created_at") ? [] : [{symbol:"COMI",status:"win",entry_price:100,target_price:120}],error:null}));
        const r=await executeAgenticTool("get_recommendations",{status:"closed"},d.client,"u");expect(r.recommendations[0].realized_return_pct).toBeNull();
    });
    test("stock news filters stock_id before limiting actual news schema",async()=>{
        const d=db(q=>({data:q.table === "stocks" ? [{id:7,symbol:"COMI"}] : [{stock_id:7,title:"خبر",published_at:price.date}],error:null}));
        const r=await executeAgenticTool("get_news",{symbols:["COMI"]},d.client,"u");
        expect(d.queries[1].ops).toContainEqual(["in","stock_id",[7]]);expect(r.news[0].symbol).toBe("COMI");
    });
    test("sell requires explicit price and quantity and cannot oversell",async()=>{
        const d=db(()=>({data:[{id:"p",symbol:"COMI",quantity:10,entry_price:100,updated_at:price.date}],error:null}));
        const r=await executeAgenticTool("manage_portfolio",{operation:"sell",symbol:"COMI",quantity:11,price:110},d.client,"u");expect(r.status).toBe("error");expect(d.queries.some(q=>q.ops.some(o=>o[0] === "update"))).toBe(false);
    });
    test("partial sell decreases holding with ownership and optimistic concurrency checks",async()=>{
        const d=db(q=>({data:q.ops.some(o=>o[0] === "update") ? [{id:"p",symbol:"COMI",quantity:6,status:"open"}] : q.table === "positions" ? [{id:"p",symbol:"COMI",quantity:10,entry_price:100,updated_at:price.date}] : [],error:null}));
        const r=await executeAgenticTool("manage_portfolio",{operation:"sell",symbol:"COMI",quantity:4,price:110},d.client,"u");
        expect(r).toMatchObject({persisted:true,operation:"sell",cash_updated:false});const write=d.queries.find(q=>q.ops.some(o=>o[0] === "update"))!;
        expect(write.ops.find(o=>o[0] === "update")?.[1].quantity).toBe(6);expect(write.ops).toContainEqual(["eq","user_id","u"]);expect(write.ops).toContainEqual(["eq","quantity",10]);
    });
    test("invalid/oversize tool arguments are rejected before queries",async()=>{
        const d=db();expect((await executeAgenticTool("get_stock",{symbols:Array(11).fill("COMI")},d.client,"u")).status).toBe("error");expect(d.queries).toHaveLength(0);
    });
    test("Cairo week starts Sunday local midnight, including DST",()=>{
        expect(cairoWeekBounds(new Date("2026-10-03T22:00:00Z")).thisWeekStartIso).toBe("2026-10-03T21:00:00.000Z");
        expect(cairoWeekBounds(new Date("2026-01-04T00:00:00Z")).thisWeekStartIso).toBe("2026-01-03T22:00:00.000Z");
    });
    test("bare fabricated table value is rejected",()=>{
        const e=toAgenticEvidence("get_stock_levels",{symbols:["COMI"]},{status:"success",levels:[{symbol:"COMI",...price,support:90,resistance:110}]});
        expect(checkAgenticDraft("| COMI | 9999 |",[e])).toContain("table_value_not_grounded:COMI:9999");
    });
    test("vertical table without symbol in row is grounded by section or context",()=>{
        const e=toAgenticEvidence("get_stock_levels",{symbols:["COMI"]},{status:"success",levels:[{symbol:"COMI",...price,support:90,resistance:110}]});
        expect(checkAgenticDraft("### سهم COMI\n| البيان | القيمة |\n|---|---|\n| الدعم | 90 |\n| المقاومة | 9999 |",[e])).toContain("table_value_not_grounded:COMI:9999");
        expect(checkAgenticDraft("### سهم COMI\n| البيان | القيمة |\n|---|---|\n| الدعم | 90 |\n| المقاومة | 110 |",[e])).toEqual([]);
    });
    test("ranking tables and ordinal indicator labels do not false-positive",()=>{
        const e=[
            toAgenticEvidence("get_stock",{symbols:["ADIB","TMGH"]},{status:"success",stocks:[{symbol:"ADIB",close:47.8,support:44,resistance:50,date:price.date},{symbol:"TMGH",close:87.89,support:80,resistance:92,date:price.date}]}),
            toAgenticEvidence("get_stock_levels",{symbols:["ADIB","TMGH"]},{status:"success",levels:[{symbol:"ADIB",close:47.8,support:44,resistance:50,take_profit_1:50,take_profit_2:55,date:price.date},{symbol:"TMGH",close:87.89,support:80,resistance:92,take_profit_1:92,take_profit_2:100,date:price.date}]}),
        ];
        expect(checkAgenticDraft("| الترتيب | السهم | السعر الحالي |\n|---|---|---|\n| 1 | ADIB | 47.80 |\n| 2 | TMGH | 87.89 |",e)).toEqual([]);
        expect(checkAgenticDraft("### سهم ADIB\n| البيان | القيمة |\n|---|---|\n| الهدف 1 | 50.00 |\n| الهدف 2 | 55.00 |\n| الدعم 1 | 44.00 |",e)).toEqual([]);
        expect(checkAgenticDraft("| الترتيب | السهم | السعر الحالي |\n|---|---|---|\n| 1 | ADIB | 9999.00 |",e)).toContain("table_value_not_grounded:ADIB:9999");
    });
    test("portfolio table grounding handles negative values, loss magnitudes, Unicode minuses, and summary rows", () => {
        const e = [
            toAgenticEvidence("manage_portfolio", { operation: "view" }, {
                status: "success",
                positions: [
                    { symbol: "ACAMD", quantity: 115, entry_price: 6.304348, current_price: 2.05, cost: 725, market_value: 235.75, profit_loss_val: -489.25, profit_loss_pct: -67.48, date: price.date },
                    { symbol: "ACAP", quantity: 100, entry_price: 5.0, current_price: 8.21, cost: 500, market_value: 821.0, profit_loss_val: 321.0, profit_loss_pct: 64.20, date: price.date },
                ],
                summary: {
                    positions_count: 2,
                    total_invested: 1225,
                    total_market_value: 1056.75,
                    unrealized_pl_val: -168.25,
                    unrealized_pl_pct: -13.73,
                }
            })
        ];
        // Test standard ASCII minus
        const tableAscii = "| السهم | الكمية | سعر الشراء | السعر الحالي | الربح/الخسارة | النسبة |\n|---|---|---|---|---|---|\n| ACAMD | 115 | 6.30 | 2.05 | -489.25 | -67.48% |\n| ACAP | 100 | 5.00 | 8.21 | 321.00 | 64.20% |\n| الإجمالي | 2 | - | - | -168.25 | -13.73% |";
        expect(checkAgenticDraft(tableAscii, e)).toEqual([]);

        // Test Unicode minus (U+2212) and positive magnitude for loss
        const tableUnicodeAndMagnitude = "| السهم | الكمية | سعر الشراء | السعر الحالي | الربح/الخسارة | النسبة |\n|---|---|---|---|---|---|\n| ACAMD | 115 | 6.30 | 2.05 | −489.25 | 67.48% |\n| ACAP | 100 | 5.00 | 8.21 | 321.00 | 64.20% |\n| المجموع | 2 | - | - | 168.25 | 13.73% |";
        expect(checkAgenticDraft(tableUnicodeAndMagnitude, e)).toEqual([]);

        // Test fabricated numbers in stock row and summary row are strictly rejected
        const tableFabricated = "| السهم | الكمية | سعر الشراء | السعر الحالي | الربح/الخسارة | النسبة |\n|---|---|---|---|---|---|\n| ACAMD | 115 | 6.30 | 2.05 | -9999.00 | -67.48% |\n| الإجمالي | 2 | - | - | -8888.00 | -13.73% |";
        const res = checkAgenticDraft(tableFabricated, e);
        expect(res).toContain("table_value_not_grounded:ACAMD:-9999");
        expect(res).toContain("table_value_not_grounded:PORTFOLIO:-8888");
    });
});
