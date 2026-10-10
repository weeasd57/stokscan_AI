import { executeAgenticTool, runAgenticPipelineStream, AGENTIC_TOOLS_SCHEMA } from "../agentic-pipeline";
import { cairoWeekBounds } from "../agentic-tools";
import { checkAgenticDraft, checkUserPositionInputs, toAgenticEvidence, evidenceMemory, safeAgenticFallback } from "../agentic-publication";
import { compactHistory, unsupersededEvidence } from "../agentic-runtime";
import { AGENTIC_SYSTEM_PROMPT } from "../agentic-pipeline";
import { runAnswerGate } from "../answer-gate";
import { analyzeImage } from "../vision";
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
    test("publication completeness catches a user position that the draft ignored", () => {
        const request = "وضع سهم جولدن تكس ايه متوسطي فيه 155 ومعايا 4 اسهم ف اديني توقعاتك كدا";
        expect(checkUserPositionInputs("السهم في اتجاه ضعيف. لو تحب اكتبلي متوسطك والكمية.", request)).toEqual([
            "user_position_average_omitted:155", "user_position_quantity_omitted:4",
        ]);
        expect(checkAgenticDraft("بمتوسط ١٥٥ جنيه وكمية 4 أسهم، ربحك الورقي 20 جنيه تقريباً.", [], request)).toEqual([]);
    });
    test("an attached image that vision cannot read gets a precise failure instead of 'no image attached'", async () => {
        (analyzeImage as jest.Mock).mockResolvedValueOnce({ vision: null, error: "vision_http_503" });
        const r = await run([], { userMessage: "حلل الصورة المرفقة", images: ["fixture"] });
        expect(r.fetchMock).not.toHaveBeenCalled();
        expect(r.done).toMatchObject({ vision: null, vision_error: "vision_http_503", response_origin: "safe_fallback" });
        expect(r.done.response).toContain("وصلت الصورة إلى الشات");
        expect(r.done.response).not.toContain("لا أستطيع رؤية صورة مرفقة");
        expect(r.events.find(e => e.type === "token").data).toBe(r.done.response);
    });
    test("truncated reviewer is recovered within the same repair budget",async()=>{
        const r=await run([{content:"مدة استثمارك قد إيه وهل تحتاج المبلغ قريباً؟"},{content:"invalid-json"},{content:"مدة استثمارك قد إيه وهل تحتاج المبلغ قريباً؟"},verdict()],{userMessage:"معايا 10 تلاف اعمل بيهم ايه"});
        expect(r.done.publication_review).toMatchObject({repaired:true,final_passed:true});
        expect(r.done.response_origin).toBe("llm");
    });
    test("fallback for a failed new request never publishes old session quotes",async()=>{
        const previous=toAgenticEvidence("get_stock",{symbols:["AFMC"]},{stocks:[{symbol:"AFMC",close:152,date:price.date}]});
        const r=await run([{content:"غير مكتمل"},verdict(false,["لم ينجز الطلب"]),{content:"غير مكتمل"},verdict(false,["لم ينجز الطلب"])],{userMessage:"في باكتيست ELEC؟",summary:{last_tool_evidence:[previous]}});
        expect(r.done.response_origin).toBe("safe_fallback");expect(r.done.response).not.toContain("AFMC");expect(r.done.response).not.toContain("152");
    });
    test("internal tool names cannot publish even if the reviewer approves",async()=>{
        const r=await run([{content:"أستخدم get_stock من stock_prices"},verdict(),{content:"أستخدم بيانات الأسعار اليومية ومحرك التحليل الفني."},verdict()]);
        expect(r.done.publication_review.final_passed).toBe(true);expect(r.done.response).not.toContain("get_stock");expect(r.done.response).not.toContain("stock_prices");
    });
    test("a truncated writer gets one completion pass rather than publishing a fragment",async()=>{
        const queue=[response({content:"جزء غير مكتمل"},"length"),response({content:"حدد مدة الاستثمار ودرجة تحمل الخسارة قبل توزيع المبلغ."}),response(verdict())];
        global.fetch=jest.fn().mockImplementation(()=>Promise.resolve(queue.shift()));const events:any[]=[];
        for await(const e of runAgenticPipelineStream("معايا 10 تلاف",[],state,null,[],db().client,[],"u","s","m"))events.push(e);
        const done=events.find(e=>e.type === "done").data;expect(done.publication_review.final_passed).toBe(true);expect(done.response).not.toContain("جزء غير مكتمل");expect(done.usage.provider_calls).toBe(3);
    });
    test("chart context binds target symbol and publishes checked structured action", async () => {
        const d = db(() => ({ data: Array.from({length:40}, (_,i) => ({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:100+i,high:102+i,low:99+i,close:101+i,volume:1000})), error:null }));
        const r = await run([{tool_calls:[call("apply_chart_strategy",{symbol:"COMI",strategy_id:"smc",chart_id:"panel-2"})]}, {content:"تم تطبيق SMC على شارت COMI؛ الرسومات تقريب لكسر نطاق سابق."}, verdict()], {db:d,options:{chartContext:{active_chart_id:"panel-2",charts:[{id:"panel-2",symbol:"COMI",timeframe:"1d"}]}}});
        expect(r.done.chart_actions).toHaveLength(1);
        expect(r.done.chart_actions[0]).toMatchObject({type:"apply_strategy",chart_id:"panel-2",symbol:"COMI"});
        expect(r.done.chart_actions[0].result.analysis.overlays.length).toBeGreaterThan(0);
        expect(JSON.parse(r.fetchMock.mock.calls[0][1].body).messages[1].content).toContain("chart_context");
    });
    test("chart tool cannot silently mutate a different stock from its target", async () => {
        const r = await run([{tool_calls:[call("apply_chart_strategy",{symbol:"EAST",strategy_id:"smc",chart_id:"panel-2"})]}, {content:"تعذر التطبيق لأن الرمز لا يطابق الشارت المستهدف."}, verdict()], {options:{chartContext:{active_chart_id:"panel-2",charts:[{id:"panel-2",symbol:"COMI",timeframe:"1d"}]}}});
        expect(r.queries).toHaveLength(0); expect(r.done.chart_actions).toEqual([]);
        const records = r.events.find(e=>e.type === "tools_data").data.results;
        expect(records[0].availability).toBe("error");
    });
    test("an explicit stock backtest suggestion works with another stock's chart open",async()=>{
        const d=db(()=>({data:Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:100+i,high:102+i,low:99+i,close:101+i,volume:1000})),error:null}));
        const r=await run([{tool_calls:[call("compare_strategies_history",{symbol:"AFMC",strategy_ids:["trend_macd"],bar_limit:60})]},{content:"AFMC: اختبرت الاتجاه وMACD على الفترة المطلوبة؛ العينة محدودة."},verdict()],{db:d,userMessage:"اختبر الاتجاه وMACD على AFMC خلال آخر 60 جلسة",options:{chartContext:{active_chart_id:"panel-1",charts:[{id:"panel-1",symbol:"COMI",timeframe:"1d"}]}}});
        expect(r.done.publication_review.final_passed).toBe(true);
        expect(d.queries[0].ops).toContainEqual(["eq","symbol","AFMC"]);
        expect(r.done.chart_actions[0].chart_id).toBeNull();
        expect(r.done.chart_actions[0].symbol).toBe("AFMC");
    });
    test("current chart window and timeframe default into the tool", async () => {
        const d=db(()=>({data:Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:100+i,high:102+i,low:99+i,close:101+i,volume:1000})),error:null}));
        const r=await run([{tool_calls:[call("apply_chart_strategy",{symbol:"COMI",strategy_id:"smc"})]},{content:"تم تطبيق تحليل النطاق على شارت COMI اليومي."},verdict()],{db:d,options:{chartContext:{active_chart_id:"panel-1",charts:[{id:"panel-1",symbol:"COMI",timeframe:"1d",period:500,strategy_ids:["smc"]}]}}});
        expect(d.queries[0].ops).toContainEqual(["limit",500]);
        expect(r.done.chart_actions[0].result.timeframe).toBe("1d");
        expect(r.done.chart_actions[0].result.bounded_rows).toBe(500);
    });
    test("specialized screens and scenarios remain LLM selected", () => {
        const names=new Set(AGENTIC_TOOLS_SCHEMA.map(t=>t.function.name));
        expect(names.size).toBe(14); expect(names.has("screen_stocks")).toBe(true); expect(names.has("analyze_portfolio_risk")).toBe(true);
    });
    test("reviewer prompt distinguishes requested scenario holdings from saved positions",async()=>{
        const r=await run([{content:"تم تحليل السيناريو"},verdict()],{userMessage:"معايا 100 ألف ومحفظتي فيها COMI وSWDY"});
        const reviewer=JSON.parse(r.fetchMock.mock.calls[1][1].body).messages[0].content;
        expect(reviewer).toContain("مجرد ذكر المستخدم لأسهم ضمن سؤال تحليل أو محفظة افتراضية لا يعني أنها محفوظة");
        expect(reviewer).toContain("analyze_portfolio_risk");
    });
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
        expect(r.done.publication_review.final_passed).toBe(false); expect(r.done.response).not.toContain("9999"); expect(r.done.response).not.toContain("| السهم |");
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
    test("portfolio image request uses image evidence without a market-data fan-out", async () => {
        const vision={image_type:"portfolio",symbols:[{symbol:"ETEL",visible_values:{quantity:null,price:null,change_pct:73.26}}],confidence:.95,
            uncertainties:["لا يظهر متوسط الشراء أو عدد الوحدات"],technical_observations:[],market_depth:{},user_relevant_summary:"لقطة محفظة؛ عائد ظاهر 73.26%"};
        const r=await run([{content:"الصورة تعرض ETEL وعائداً ظاهراً، لكنها لا تعرض الكمية أو متوسط الشراء بوضوح."},verdict()],{
            userMessage:"قم بقراءة وتحليل هذه الصورة المرفقة.",images:["fixture"],options:{mockVisionResult:vision}});
        const context=JSON.parse(r.fetchMock.mock.calls[0][1].body).messages[1].content;
        expect(context).toContain("لا يظهر متوسط الشراء أو عدد الوحدات");
        expect(AGENTIC_SYSTEM_PROMPT).toContain("لا تخلط بين قيمة المركز أو المكسب النقدي أو العائد % وبين عدد الأسهم أو متوسط الشراء");
        expect(AGENTIC_SYSTEM_PROMPT).toContain("[افتح البروفايل عند قسم محفظتي](/profile#portfolio)");
        expect(AGENTIC_SYSTEM_PROMPT).toContain("لم تحفظ المراكز بسبب نقص متوسط الشراء");
        expect(r.events.filter(e=>e.type==="tools_data")).toHaveLength(0);
        expect(r.queries.some((q: Query)=>["positions","stock_prices","stock_technical_indicators"].includes(q.table))).toBe(false);
        expect(r.done.publication_review.final_passed).toBe(true);
    });
    test("an image without explicit units and average price cannot authorize portfolio registration", async () => {
        const vision={image_type:"portfolio",symbols:[{symbol:"ETEL",visible_values:{quantity:null,price:null,change_pct:73.26}}],confidence:.95,
            uncertainties:["quantity and average purchase price are not visible"],technical_observations:[],market_depth:{},user_relevant_summary:"portfolio image"};
        const d=db();
        const r=await run([{tool_calls:[call("manage_portfolio",{operation:"add",symbol:"ETEL",quantity:749,price:148})]},
            {content:'{"authorized":false}'},{content:"لم أسجل المركز لأن الصورة لا توضح متوسط الشراء."},verdict()],{
            userMessage:"قم بقراءة وتحليل هذه الصورة المرفقة.",images:["fixture"],db:d,options:{mockVisionResult:vision}});
        expect(d.queries.some(q=>q.table==="positions" && q.ops.some(o=>o[0]==="insert"))).toBe(false);
        expect(r.events.find(e=>e.type==="tools_data").data.results[0].data.persisted).toBe(false);
    });
    test("an image follow-up retains tickers but does not reuse unverified numeric extraction", async () => {
        const r=await run([{content:"الصورة السابقة توضح رموز الأسهم، لكنها لا تثبت الكميات أو متوسطات الشراء. أرسل أول خمسة رموز مع الكمية ومتوسط الشراء لكل سهم."},verdict()],{
            userMessage:"جدد محفظتي بناء على الصور المرسلة لك",
            summary:{last_vision_context:{image_type:"portfolio",symbols:[{symbol:"ETEL",name:"",visible_values:{quantity:749,price:null,change_pct:73.26}}],confidence:.95,
                uncertainties:[],user_relevant_summary:"قد تحتوي الصورة على أرقام ليست كميات مؤكدة."}},
        });
        const context=JSON.parse(r.fetchMock.mock.calls[0][1].body).messages[1].content;
        expect(context).toContain("ETEL");
        expect(context).not.toContain("749");
        expect(context).not.toContain("73.26");
        expect(r.queries.some((q: Query)=>q.table==="positions" && q.ops.some(o=>o[0]==="insert"))).toBe(false);
        expect(r.done.publication_review.final_passed).toBe(true);
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
    test("positive review explanations no longer reject a valid answer",async()=>{
        const r=await run([{content:"قيد محدد للبيانات"},verdict(true,["الرد ينجز المهمة ضمن حدود البيانات"])]);
        expect(r.done.publication_review.final_passed).toBe(true);expect(r.fetchMock).toHaveBeenCalledTimes(2);expect(r.done.response_origin).toBe("llm");
    });
    test("canonical issues still reject a contradictory passed=true verdict",async()=>{
        const bad={content:JSON.stringify({passed:true,issues:["المطلوب لم ينفذ"],notes:[]})};
        const r=await run([{content:"مسودة ناقصة"},bad,{content:"مسودة ناقصة"},bad]);expect(r.done.publication_review.final_passed).toBe(false);
    });
    test("spaces and promotional link cannot become a reviewed answer",async()=>{
        const empty="    [قناة EGX Bots](https://t.me/egxbots)";
        const r=await run([{content:JSON.stringify({kind:"analysis",answer:empty})},verdict(),{content:empty},verdict()]);
        expect(r.done.publication_review.final_passed).toBe(false);expect(r.done.response_origin).toBe("safe_fallback");
    });
    test("brief LLM social answer needs one call, without an intent regex",async()=>{
        const r=await run([{content:JSON.stringify({kind:"social",answer:"أهلاً، أقدر أساعدك في إيه؟"})}],{userMessage:"ازيك"});
        expect(r.fetchMock).toHaveBeenCalledTimes(1);expect(r.done.publication_review.final_passed).toBe(true);expect(r.done.response).not.toContain('"answer"');
    });
    test("analysis envelope still requires review",async()=>{
        const r=await run([{content:JSON.stringify({kind:"analysis",answer:"خلينا نحدد المطلوب"})},verdict()]);
        expect(r.fetchMock).toHaveBeenCalledTimes(2);expect(r.done.response).toContain("خلينا نحدد");
    });
    test("repair fetches missing data instead of forcing another unsupported draft",async()=>{
        const r=await run([{content:"لا أعرف بيانات ATQA"},verdict(false,["اجلب get_stock_levels للسهم ATQA"]),
            {tool_calls:[call("get_stock_levels",{symbols:["ATQA"]})]},
            {content:JSON.stringify({kind:"analysis",answer:"ATQA إغلاقه 100 جنيه والدعم 90 جنيه"})},verdict()],{db:stockDb(),userMessage:"وعتاقة"});
        expect(r.done.publication_review.final_passed).toBe(true);expect(r.done.response_origin).toBe("llm");expect(r.done.usage.tool_calls).toBe(1);
        expect(JSON.parse(r.fetchMock.mock.calls[2][1].body).tools).toEqual(AGENTIC_TOOLS_SCHEMA);
    });
    test("previous read evidence is visible in follow-up and checked numerically",async()=>{
        const snapshot=evidenceMemory([toAgenticEvidence("get_stock_levels",{symbols:["COMI"]},{status:"success",levels:[{symbol:"COMI",...price,support:90,resistance:110}]})]);
        const r=await run([{content:"COMI إغلاقه السابق 100 جنيه"},verdict()],{summary:{last_tool_evidence:snapshot},userMessage:"والأول؟"});
        expect(JSON.parse(r.fetchMock.mock.calls[0][1].body).messages[1].content).toContain('"close":100');
        expect(r.done.publication_review.final_passed).toBe(true);expect(r.done.usage.tool_calls).toBe(0);
    });
    test("cached evidence cannot prove a new account write",()=>{
        const snapshot=evidenceMemory([toAgenticEvidence("manage_portfolio",{operation:"add"},{status:"success",persisted:true,symbol:"COMI"})]);expect(snapshot).toEqual([]);
    });
    test("memory is bounded and expired observations are removed",()=>{
        const now=new Date();const record=toAgenticEvidence("get_stock",{symbols:["COMI"]},{stocks:[{symbol:"COMI",close:100,name:"x".repeat(20000)}]});
        expect(evidenceMemory([record],now)).toHaveLength(0);
        expect(evidenceMemory([{...record,data:{stocks:[]},captured_at:new Date(now.getTime()-25*3600000).toISOString()}],now)).toHaveLength(0);
    });
    test("context keeps recent choices while bounding long repeated analysis",()=>{
        const history=Array.from({length:16},(_,i)=>({role:i%2 ? "assistant" : "user",content:"تقرير ".repeat(1000)}));
        history.push({role:"user",content:"الأول"});const compact=compactHistory(history);
        expect(compact.at(-1)?.content).toBe("الأول");expect(compact.reduce((n,h)=>n+h.content.length,0)).toBeLessThanOrEqual(5000);
    });
    test("history drops the standard footer while retaining prices and user requests",()=>{
        const text="EOSB عند المقاومة 1.64";
        const history=[{role:"user",content:"هل اخترق؟"},{role:"assistant",content:text+"\n\n✅ تحليل EGX Bots مبني على أحدث البيانات المتاحة ومؤرّخ بمصدره — مش نصيحة استثمار، القرار ليك.\n\n📢 [قناة EGX Bots المجانية على تليجرام للتنبيهات والفرص](https://t.me/egxbots)"}];
        expect(compactHistory(history)).toEqual([{role:"user",content:"هل اخترق؟"},{role:"assistant",content:text}]);
    });
    test("refresh removes duplicate evidence but retains a different scan and failed refresh",()=>{
        const old=toAgenticEvidence("screen_stocks",{rsi_min:40,rsi_max:60},{status:"success",date:"2026-10-07",stocks:[{symbol:"COMI",close:100}]});
        const refreshed=toAgenticEvidence("screen_stocks",{rsi_max:60,rsi_min:40},{status:"success",date:"2026-10-08",stocks:[{symbol:"COMI",close:101}]});
        const different=toAgenticEvidence("screen_stocks",{rsi_min:45,rsi_max:55},{status:"success",stocks:[]});
        expect(unsupersededEvidence([old],[refreshed])).toEqual([]);
        expect(unsupersededEvidence([old],[different])).toEqual([old]);
        expect(unsupersededEvidence([old],[{...refreshed,availability:"error"}])).toEqual([old]);
    });
    test("refreshed scan is not repeated in writer or reviewer context",async()=>{
        const previous=toAgenticEvidence("screen_stocks",{}, {status:"success",date:"2026-10-07",stocks:[{symbol:"COMI",close:100}],scan_complete:true});
        const r=await run([{tool_calls:[call("screen_stocks",{})]},{content:"لا نتائج في لقطة 2026-10-08."},verdict()],{
            db:db(q=>({data:q.table === "stock_technical_indicators"&&q.ops.some(o=>o[0]==="select"&&o[1]==="date")?[{date:"2026-10-08"}]:[],error:null})),
            summary:{last_tool_evidence:evidenceMemory([previous])},userMessage:"أعد المسح"});
        const initial=JSON.parse(r.fetchMock.mock.calls[0][1].body).messages[1].content;
        const writer=JSON.parse(r.fetchMock.mock.calls[1][1].body).messages[1].content;
        const reviewer=JSON.parse(JSON.parse(r.fetchMock.mock.calls[2][1].body).messages[1].content);
        expect(initial).toContain("2026-10-07");expect(writer).not.toContain("2026-10-07");
        expect(writer.length).toBeLessThan(initial.length);expect(reviewer.previous_evidence).toEqual([]);
        expect(r.done.publication_review.final_passed).toBe(true);
    });
    test("current evidence snapshot is saved with session ownership filters",async()=>{
        const d=db(q=>({data:q.table === "stock_prices" ? [price] : q.table === "ai_chat_sessions" ? [{id:"063eb987-c6e1-4a24-b610-dbeacc58f6e8"}] : [],error:null}));
        global.fetch=jest.fn().mockResolvedValueOnce(response({tool_calls:[call("get_stock_levels",{symbols:["COMI"]})]}))
            .mockResolvedValueOnce(response({content:"COMI إغلاق 100 جنيه"})).mockResolvedValueOnce(response(verdict()));
        const events:any[]=[];for await(const e of runAgenticPipelineStream("COMI",[],state,null,[],d.client,[],
            "8010a163-6d2f-40df-834f-6ad9cbd1faa5","063eb987-c6e1-4a24-b610-dbeacc58f6e8","fixture"))events.push(e);
        const write=d.queries.find(q=>q.table === "ai_chat_sessions")!;
        expect(write.ops.find(o=>o[0] === "update")?.[1].summary_state.last_tool_evidence[0].data.levels[0].close).toBe(100);
        expect(write.ops).toContainEqual(["eq","user_id","8010a163-6d2f-40df-834f-6ad9cbd1faa5"]);
    });
});

describe("Agentic tool correctness and failure boundaries", () => {
    test.each(AGENTIC_TOOLS_SCHEMA.map(t=>t.function.name).filter(name => !["list_chart_strategies", "apply_chart_strategy", "compare_strategies_history", "screen_stocks", "analyze_portfolio_risk"].includes(name)))("existing data tools: %s reads healthy bounded fixtures",async tool=>{
        const d=db(q=>({data:q.table === "stocks" ? [{id:1,symbol:"COMI",name:"Commercial Bank"}] : q.table === "stock_prices" ? [price]
            : q.table === "market_cache" ? {payload:{egx30:[{close:100,date:"2026-10-07"},{close:101,date:price.date}],regime:"sideways"}}
            : q.table === "stock_technical_indicators" ? [{symbol:"COMI",...price,change_pct:1,r_vol:2,rsi_14:55,macd:1,macd_signal:.5,macd_histogram:.5}]
            : q.table === "stock_scans_summary" ? [{symbol:"COMI",scan_date:price.date,acc_score:70,dist_score:5,vol_ratio:2}]
            : q.table === "scan_results" ? [{symbol:"COMI",entry_price:100,target_price:110,stop_loss:90,status:"open",created_at:price.date}]
            : q.table === "news" ? [{stock_id:1,title:"خبر موثق",published_at:price.date}] : [],error:null}));
        const r=await executeAgenticTool(tool,{symbols:["COMI"],operation:"view",preset:"top_gainers",status:"open",timeframe:"this_week"},d.client,"u");
        expect(r.status).toBe("success");expect(d.queries.length).toBeGreaterThan(0);
        for(const q of d.queries.filter(q=>q.ops.some(o=>o[0] === "select"))) expect(q.ops.some(o=>o[0] === "limit")).toBe(true);
    });
    test("composite stock screen enforces filters and measures resistance from 20 sessions",async()=>{
        const latest="2026-10-08";
        const history=Array.from({length:20},(_,i)=>({symbol:"COMI",date:`2026-09-${String(19-i).padStart(2,"0")}`,high:i===0?100:99,close:98}));
        const tooFar=Array.from({length:20},(_,i)=>({symbol:"SWDY",date:`2026-09-${String(19-i).padStart(2,"0")}`,high:100,close:96}));
        const d=db(q=>q.table==="stock_technical_indicators"
            ? {data:q.ops.some(o=>o[0]==="select"&&o[1]==="date")?[{date:latest}]:[
                {symbol:"COMI",date:latest,close:99,change_pct:1,r_vol:1.4,rsi_14:52},
                {symbol:"SWDY",date:latest,close:96,change_pct:0,r_vol:2,rsi_14:60}],error:null}
            : q.table==="stock_prices" ? {data:[...history,...tooFar],error:null} : {data:[],error:null});
        const r=await executeAgenticTool("screen_stocks",{},d.client,"u");
        expect(r.status).toBe("success"); expect(r.stocks).toHaveLength(1);
        expect(r.stocks[0]).toMatchObject({symbol:"COMI",resistance:100,distance_from_resistance_pct:1,resistance_sessions:20});
        const scan=d.queries.find(q=>q.table==="stock_technical_indicators"&&q.ops.some(o=>o[0]==="select"&&String(o[1]).includes("r_vol")))!;
        expect(scan.ops).toContainEqual(["gte","rsi_14",40]); expect(scan.ops).toContainEqual(["lte","rsi_14",60]); expect(scan.ops).toContainEqual(["gt","r_vol",1]);
    });
    test("screen table grounds resistance and distance separately",()=>{
        const e=toAgenticEvidence("screen_stocks",{}, {status:"success",date:"2026-10-08",stocks:[{symbol:"COMI",date:"2026-10-08",close:99,rsi_14:52,r_vol:1.4,resistance:100,distance_from_resistance_pct:1}]});
        const table="| السهم | الإغلاق | RSI | الحجم النسبي | المقاومة | البعد عن المقاومة % |\n|---|---:|---:|---:|---:|---:|\n| COMI | 99 | 52 | 1.4 | 100 | 1 |";
        expect(checkAgenticDraft(table,[e])).toEqual([]);
        expect(checkAgenticDraft(table.replace("| 100 | 1 |","| 100 | 4 |"),[e]).some((reason:string)=>reason.includes("COMI"))).toBe(true);
    });
    test("screen preserves fractional resistance and excludes an exact distance boundary",async()=>{
        const date="2026-10-07";
        const d=db(q=>q.table === "stock_technical_indicators" ? {data:q.ops.some(o=>o[0]==="select"&&o[1]==="date")?[{date}]:[
            {symbol:"ARAB",date,close:.273,r_vol:1.48,rsi_14:57.94},{symbol:"COMI",date,close:97,r_vol:2,rsi_14:50}],error:null}
            :{data:Array.from({length:20},(_,i)=>[{symbol:"ARAB",date:`2026-09-${30-i}`,high:.278,close:.273},{symbol:"COMI",date:`2026-09-${30-i}`,high:100,close:97}]).flat(),error:null});
        const r=await executeAgenticTool("screen_stocks",{},d.client,"u");
        expect(r.stocks).toHaveLength(1);expect(r.stocks[0]).toMatchObject({symbol:"ARAB",resistance:.278,distance_from_resistance_pct:1.8,resistance_relation:"below"});
        const e=toAgenticEvidence("screen_stocks",{},r);
        const table="| السهم | الإغلاق | المقاومة |\n|---|---:|---:|\n| ARAB | 0.273 | 0.278 |";
        expect(checkAgenticDraft(table,[e])).toEqual([]);
        expect(checkAgenticDraft(table.replace("0.278","0.28"),[e])).toContain("table_value_not_grounded:ARAB:0.28");
        const inclusive=await executeAgenticTool("screen_stocks",{relative_volume_min:2,resistance_distance_inclusive:true},d.client,"u");
        expect(inclusive.stocks.some((s:any)=>s.symbol === "COMI")).toBe(true);
        expect(d.queries.some(q=>q.ops.some(o=>o[0]==="gte"&&o[1]==="r_vol"&&o[2]===2))).toBe(true);
    });
    test.each([false,true])("admin scenario tables publish stock and sector allocations (explicit=%s)",async explicit=>{
        const d=db(q=>q.table === "stock_fundamentals" ? {data:[
            {symbol:"COMI",data:{sector:"Finance",industry:"Regional Banks"}},
            {symbol:"SWDY",data:{sector:"Producer Manufacturing",industry:"Electrical Products"}},
            {symbol:"TMGH",data:{sector:"Finance",industry:"Real Estate Development"}}
        ],error:null}:{data:[],error:null});
        const args:any={capital:100000,symbols:["COMI","SWDY","TMGH"]};
        if(explicit)args.allocations=[{symbol:"COMI",allocation_pct:60},{symbol:"SWDY",allocation_pct:25},{symbol:"TMGH",allocation_pct:15}];
        const r=await executeAgenticTool("analyze_portfolio_risk",args,d.client,"u");
        const e=toAgenticEvidence("analyze_portfolio_risk",args,r);
        const stock=r.stocks[0];
        const prose=`COMI توزيع ${stock.allocation_pct.toFixed(2)}% ومبلغ ${stock.allocated_capital} جنيه.`;
        expect(checkAgenticDraft(prose,[e])).toEqual([]);
        expect(checkAgenticDraft(prose.replace(stock.allocated_capital.toString(),"90000"),[e]).length).toBeGreaterThan(0);
        expect(checkAgenticDraft(prose.replace(stock.allocation_pct.toFixed(2),"80"),[e]).length).toBeGreaterThan(0);
        const table="محفظة افتراضية، لم تحفظ.\n| السهم | النسبة % | المبلغ بالجنيه |\n|---|---:|---:|\n"+
            r.stocks.map((s:any)=>`| ${s.symbol} | ${s.allocation_pct.toFixed(2)} | ${s.allocated_capital} |`).join("\n")+
            "\n\n| القطاع | الأسهم | نسبة التركيز % | المبلغ بالجنيه |\n|---|---|---:|---:|\n"+
            r.sector_exposure.map((s:any)=>`| ${s.sector} | ${s.symbols.join(" / ")} | ${s.allocation_pct.toFixed(2)} | ${s.allocated_capital} |`).join("\n");
        expect(checkAgenticDraft(table,[e])).toEqual([]);
        const stress="| هبوط المحفظة % | الخسارة بالجنيه |\n|---:|---:|\n| 5 | 5000 |\n| 10 | 10000 |";
        expect(checkAgenticDraft(table+"\n\n"+stress,[e])).toEqual([]);
        expect(checkAgenticDraft(table+"\n\n"+stress.replace("هبوط المحفظة %","نسبة هبوط المحفظة %"),[e])).toEqual([]);
        expect(checkAgenticDraft(table+"\n\n"+stress.replace("5000","7000"),[e]).length).toBeGreaterThan(0);
        const industries="| الصناعة | الأسهم | النسبة % | المبلغ بالجنيه |\n|---|---|---:|---:|\n"+
            r.industry_exposure.map((s:any)=>`| ${s.industry} | ${s.symbols.join(" / ")} | ${s.allocation_pct} | ${s.allocated_capital} |`).join("\n");
        expect(checkAgenticDraft(industries,[e])).toEqual([]);
        expect(r.sector_exposure.find((s:any)=>s.sector === "Finance").symbols).toEqual(["COMI","TMGH"]);
        expect(r.industry_exposure).toHaveLength(3);
        const wrong=table.replace(explicit?"| 60.00 |":"| 33.33 |","| 80 |");
        expect(checkAgenticDraft(wrong,[e]).some(reason=>reason.includes("COMI"))).toBe(true);
        const result=await run([{tool_calls:[call("analyze_portfolio_risk",args)]},{content:table},verdict()],{db:d,userMessage:"حلل المحفظة الافتراضية"});
        expect(result.done.response_origin).toBe("llm");expect(result.done.publication_review.final_passed).toBe(true);
        expect(result.done.usage.provider_calls).toBe(3);
    });
    test("sector aggregation cannot validate a subset or another sector's amount",()=>{
        const e=toAgenticEvidence("analyze_portfolio_risk",{}, {status:"success",mode:"scenario",stocks:[{symbol:"COMI",allocation_pct:60,allocated_capital:60000},{symbol:"TMGH",allocation_pct:15,allocated_capital:15000},{symbol:"SWDY",allocation_pct:25,allocated_capital:25000}],sector_exposure:[{symbol:"PORTFOLIO",sector:"Finance",symbols:["COMI","TMGH"],allocation_pct:75,allocated_capital:75000}]});
        expect(checkAgenticDraft("| السهم | النسبة % | المبلغ بالجنيه |\n|---|---:|---:|\n| COMI | 75 | 75000 |",[e]).length).toBeGreaterThan(0);
        expect(checkAgenticDraft("| القطاع | الأسهم | النسبة % | المبلغ بالجنيه |\n|---|---|---:|---:|\n| Finance | COMI / SWDY | 75 | 75000 |",[e]).length).toBeGreaterThan(0);
    });
    test("resistance equality is at resistance, never below or a confirmed breakout",()=>{
        const e=toAgenticEvidence("screen_stocks",{}, {status:"success",date:"2026-10-07",stocks:[{symbol:"EOSB",close:1.64,resistance:1.64,distance_from_resistance_pct:0},{symbol:"EFIH",close:25.23,resistance:25.37,distance_from_resistance_pct:0.55}]});
        expect(checkAgenticDraft("EOSB عند المقاومة، وليس فوقها. EFIH تحت المقاومة.",[e])).toEqual([]);
        expect(checkAgenticDraft("EOSB تحت المقاومة.",[e])).toContain("price_resistance_relation_contradiction:EOSB");
        expect(checkAgenticDraft("EOSB اخترق المقاومة فعلاً.",[e])).toContain("price_resistance_relation_contradiction:EOSB");
        expect(checkAgenticDraft("EOSB وEFIH لم يخترقا المقاومة بل كانا تحتها.",[e])).toContain("price_resistance_relation_contradiction:EOSB");
        expect(checkAgenticDraft("لو EOSB أغلق فوق المقاومة فهذا شرط اختراق.",[e])).toEqual([]);
    });
    test("rejected writer keeps verified virtual calculation in fallback",async()=>{
        const r=await run([{tool_calls:[call("analyze_portfolio_risk",{capital:100000,symbols:["COMI","SWDY","TMGH"]})]},
            {content:"تعذر التحليل"},verdict(false,["ناقص"]),{content:"تعذر التحليل"},verdict(false,["ناقص"])],{userMessage:"محفظة افتراضية بمئة ألف"});
        expect(r.done.response_origin).toBe("safe_fallback");expect(r.done.response).toContain("33333.33");
        expect(r.done.response).toContain("5000 جنيه");expect(r.done.response).toContain("لم يتم حفظه");
        expect(r.done.publication_review.final_passed).toBe(false);
    });
    test("virtual portfolio applies capital, states equal-weight assumption, and never writes",async()=>{
        const d=db(q=>q.table==="positions"?{data:[{symbol:"COMI"}],error:null}
            :q.table==="stock_fundamentals"?{data:[{symbol:"COMI",data:{sector:"Banks"}},{symbol:"SWDY",data:{sector:"Industrials"}},{symbol:"TMGH",data:{sector:"Real Estate"}}],error:null}:{data:[],error:null});
        const r=await executeAgenticTool("analyze_portfolio_risk",{capital:100000,symbols:["COMI","SWDY","TMGH"]},d.client,"user-1");
        expect(r).toMatchObject({status:"success",mode:"scenario",capital:100000,assumption:"equal_weight",source_portfolio:"user_scenario_not_saved",persisted:false});
        expect(r.stocks.map((s:any)=>s.allocation_pct)).toEqual([33.3333,33.3333,33.3333]);
        expect(r.stocks.map((s:any)=>s.allocated_capital)).toEqual([33333.33,33333.33,33333.33]);
        expect(r.stocks.find((s:any)=>s.symbol==="COMI").saved).toBe(true); expect(r.stocks.find((s:any)=>s.symbol==="SWDY").saved).toBe(false);
        expect(r.sector_exposure).toHaveLength(3); expect(r.stress_scenarios_not_forecasts).toEqual([{change_pct:-5,loss:5000},{change_pct:-10,loss:10000}]);
        expect(d.queries.find((q:Query)=>q.table==="positions")?.ops).toContainEqual(["eq","user_id","user-1"]);
        expect(d.queries.some((q:Query)=>q.ops.some(o=>["insert","update","delete"].includes(o[0])))).toBe(false);
    });
    test("portfolio percentages must cover every selected stock and total 100",async()=>{
        const r=await executeAgenticTool("analyze_portfolio_risk",{capital:100000,symbols:["COMI","SWDY"],allocations:[{symbol:"COMI",allocation_pct:60},{symbol:"SWDY",allocation_pct:30}]},db().client,"u");
        expect(r.status).toBe("error"); expect(r.message).toMatch(/100%/);
    });
    test("safe fallback renders checked scanner and hypothetical portfolio evidence",()=>{
        const scan=toAgenticEvidence("screen_stocks",{}, {status:"success",date:"2026-10-08",filters:{rsi_min:40,rsi_max:60,relative_volume_min:1,max_resistance_distance_pct:3},stocks:[{symbol:"COMI",close:99,rsi_14:52,r_vol:1.4,resistance:100,distance_from_resistance_pct:1}],scan_complete:true});
        const portfolio=toAgenticEvidence("analyze_portfolio_risk",{}, {status:"success",mode:"scenario",capital:100000,assumption:"equal_weight",source_portfolio:"user_scenario_not_saved",stocks:[{symbol:"COMI",sector:"Banks",allocation_pct:100,allocated_capital:100000,saved:false}],sector_exposure:[{symbol:"PORTFOLIO",sector:"Banks",allocation_pct:100,allocated_capital:100000}],sector_concentration_complete:true,stress_scenarios_not_forecasts:[{change_pct:-5,loss:5000},{change_pct:-10,loss:10000}]});
        const answer=safeAgenticFallback([scan,portfolio],"fixture");
        expect(answer).toContain("شاشة فنية بتاريخ 2026-10-08"); expect(answer).toContain("هذا سيناريو افتراضي"); expect(answer).toContain("5000 جنيه");
    });
    test("safe fallback reports a verified empty scan with date and constraints",()=>{
        const scan=toAgenticEvidence("screen_stocks",{}, {status:"success",date:"2026-10-08",filters:{rsi_min:40,rsi_max:60,relative_volume_min:1,max_resistance_distance_pct:3},stocks:[],scan_complete:true});
        const answer=safeAgenticFallback([scan],"fixture");
        expect(answer).toContain("2026-10-08"); expect(answer).toContain("لم تظهر أسهم تطابق الشروط"); expect(answer).toContain("RSI بين 40 و60");
        expect(scan.availability).toBe("available");expect(answer).not.toContain("بعض البيانات المطلوبة غير متاحة");
    });
    test("scenario portfolio answers are not rejected for lacking a saved-positions snapshot",()=>{
        const plan:any={intent:"risk_analysis",confidence:1,entities:{symbols:["COMI","SWDY"],sector:null,timeframe:"current",reference:null,portfolio_operation:"view"},needs_vision_context:false,needs_history:false,needs_live_data:false,needs_historical_data:false,tools:["manage_portfolio"],clarification_needed:false,resolved_from:{symbol:null,message_id:null}};
        const scenario:any={tool:"analyze_portfolio_risk",availability:"available",data:{mode:"scenario",source_portfolio:"user_scenario_not_saved",stocks:[{symbol:"COMI"},{symbol:"SWDY"}]},symbols:["COMI","SWDY"]};
        const result=runAnswerGate({reply:"هذا سيناريو افتراضي لتوزيع COMI وSWDY على رأس المال المذكور، ولم يتم حفظه.",plan,toolResults:[scenario],userMessage:"حلل مخاطر محفظتي الافتراضية COMI وSWDY",facts:[]});
        expect(result.reasons).not.toContain("الطلب يتطلب مراكز المستخدم الفعلية، لكن أداة المحفظة لم تُرجع لقطة موثقة. لا تقدم تحليلاً شخصياً للمحفظة.");
        expect(result.reasons.some((reason:string)=>reason.includes("لا يوجد مركز محفوظ"))).toBe(false);
    });
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
    test("comparison table grounding works for both symbols", () => {
        const e = [
            toAgenticEvidence("get_comparison", { symbols: ["COMI", "EAST"] }, {
                status: "success",
                comparison: [
                    { symbol: "COMI", close: 100, change_pct: 3, r_vol: 2, rsi_14: 65, date: "2026-10-07" },
                    { symbol: "EAST", close: 22.53, change_pct: -3.07, r_vol: 0.8, rsi_14: 45, date: "2026-10-07" },
                ]
            })
        ];
        const table = "| وجه المقارنة | COMI | EAST |\n|---|---|---|\n| السعر الحالي | 100.00 | 22.53 |\n| نسبة التغير | 3.00% | -3.07% |\n| الحجم النسبي | 2.00 | 0.80 |";
        expect(checkAgenticDraft(table, e)).toEqual([]);
    });
    test("comparison columns cannot borrow another stock's price or metric",()=>{
        const e=[toAgenticEvidence("get_comparison",{symbols:["COMI","EAST"]},{comparison:[{symbol:"COMI",close:108,rsi_14:65,date:price.date},{symbol:"EAST",close:22.53,rsi_14:45,date:price.date}]})];
        expect(checkAgenticDraft("| وجه المقارنة | COMI | EAST |\n|---|---|---|\n| السعر الحالي | 22.53 | 108 |",e).length).toBeGreaterThan(0);
        expect(checkAgenticDraft("| وجه المقارنة | COMI | EAST |\n|---|---|---|\n| RSI | 108 | 22.53 |",e).length).toBeGreaterThan(0);
    });
    test("admin production regression: price 124.65 is below EMA200 126.93",()=>{
        const e=[toAgenticEvidence("get_comparison",{symbols:["COMI"]},{comparison:[{symbol:"COMI",close:124.65,ema_50:133.15,ema_200:126.93,date:price.date}]})];
        expect(checkAgenticDraft("COMI: السعر 124.65 تحت EMA50 لكنه فوق EMA200.",e)).toContain("price_average_relation_contradiction:COMI:ema_200");
        expect(checkAgenticDraft("COMI: السعر تحت EMA50 وتحت EMA200.",e)).toEqual([]);
        expect(checkAgenticDraft("COMI: لو أغلق فوق EMA200 يمكن متابعة التحسن.",e)).toEqual([]);
    });
    test("period constants and small integers are not exemptions for invented price cells",()=>{
        const e=[toAgenticEvidence("get_stock",{symbols:["COMI"]},{stocks:[{symbol:"COMI",close:108,date:price.date}]})];
        for(const n of [14,20,50,100,200,5]) expect(checkAgenticDraft(`| السهم | الإغلاق |\n|---|---|\n| COMI | ${n} |`,e).length).toBeGreaterThan(0);
    });
    test("vertical table retains ownership through blank lines and prose",()=>{
        const e=[toAgenticEvidence("get_stock",{symbols:["COMI","EAST"]},{stocks:[{symbol:"COMI",close:108,date:price.date},{symbol:"EAST",close:22.53,date:price.date}]})];
        expect(checkAgenticDraft("## COMI\n\nالبيانات اليومية:\n\n| البند | القيمة |\n|---|---|\n| الإغلاق | 22.53 |",e).length).toBeGreaterThan(0);
    });
    test("accumulation table grounding works for acc_score, dist_score, and vol_ratio", () => {
        const e = [
            toAgenticEvidence("get_accumulation_stocks", {}, {
                status: "success",
                preset: "smart_money_flow",
                date: "2026-10-07",
                stocks: [
                    { symbol: "SIPC", scan_date: "2026-10-07", acc_score: 70.5, dist_score: 12.3, vol_ratio: 1.4, wyckoff_phase: "Accumulation", signal: "ACCUMULATION" },
                    { symbol: "DAPH", scan_date: "2026-10-07", acc_score: 65.0, dist_score: 5.18, vol_ratio: 3.07, wyckoff_phase: "Accumulation", signal: "ACCUMULATION" }
                ],
                accumulation_stocks: [
                    { symbol: "SIPC", scan_date: "2026-10-07", acc_score: 70.5, dist_score: 12.3, vol_ratio: 1.4, wyckoff_phase: "Accumulation", signal: "ACCUMULATION" },
                    { symbol: "DAPH", scan_date: "2026-10-07", acc_score: 65.0, dist_score: 5.18, vol_ratio: 3.07, wyckoff_phase: "Accumulation", signal: "ACCUMULATION" }
                ]
            })
        ];
        const table = "| السهم | نقاط التجميع | نقاط التصريف | الحجم النسبي |\n|---|---|---|---|\n| SIPC | 70.5 | 12.3 | 1.4 |\n| DAPH | 65.0 | 5.18 | 3.07 |";
        expect(checkAgenticDraft(table, e)).toEqual([]);
    });
});

