/** Opt-in, single paid turn with synthetic data. Never writes to Supabase. */
import fs from "node:fs";
import path from "node:path";
import { runAgenticPipelineStream } from "../agentic-pipeline";
import { toAgenticEvidence, evidenceMemory } from "../agentic-publication";
jest.mock("server-only", () => ({}));
jest.mock("../vision", () => ({ analyzeImage: jest.fn(), reconcileVisionWithMarket: jest.fn() }));
const live = process.env.RUN_AGENTIC_SMOKE === "1" ? test : test.skip;
live("completes scan then entry/stop levels and passes real context review", async () => {
    const envPath=path.resolve(process.cwd(),".env.local");
    if(fs.existsSync(envPath)) for(const line of fs.readFileSync(envPath,"utf8").split(/\r?\n/)) {
        const match=line.match(/^(DEEPSEEK_API_KEY|DEEPSEEK_OFFICIAL_API_KEY)\s*=\s*(.*)$/);
        if(match) process.env[match[1]]=match[2].trim().replace(/^["']|["']$/g,"");
    }
    const native=global.fetch;let requests=0;const tools:string[]=[]; let savedSummary:any=null; const providerMessages:any[]=[];
    global.fetch=(async(url:any,init:any)=>{
        if(url !== "https://api.deepseek.com/chat/completions" || ++requests>12) throw new Error("Audit call budget");
        const result=await native(url,{...init,signal:AbortSignal.any([init.signal,AbortSignal.timeout(25000)])});
        const parsed=await result.clone().json();providerMessages.push(parsed.choices?.[0]?.message);return result;
    }) as any;
    const stocks=[
        {symbol:"COMI",close:100,change_pct:3,r_vol:2,rsi_14:55,ema_50:95,ema_200:90,macd:1,king_ai_score:75,egx_ai_score:70,date:"2026-10-08"},
        {symbol:"ETEL",close:150,change_pct:2,r_vol:1.8,rsi_14:58,ema_50:140,ema_200:130,macd:1,king_ai_score:70,egx_ai_score:65,date:"2026-10-08"},
        {symbol:"ABUK",close:60,change_pct:1,r_vol:1.5,rsi_14:52,ema_50:55,ema_200:50,macd:1,king_ai_score:65,egx_ai_score:60,date:"2026-10-08"},
    ];
    const extraStocks=[{symbol:"AFMC",name:"مطاحن الإسكندرية",close:152,change_pct:-2.44,r_vol:.523,rsi_14:43.31,macd:-6.48,macd_signal:-7.78,macd_histogram:1.3,date:"2026-10-08"},
        {symbol:"ATQA",name:"مصر الوطنية للصلب (عتاقة)",close:12.25,change_pct:1.32,r_vol:.753,rsi_14:44.98,macd:.006,macd_signal:.11,macd_histogram:-.104,date:"2026-10-08"}];
    const db={from:(table:string)=>{
        let symbol:string|null=null, nameTerm:string|null=null;
        const q:any=new Proxy({}, {get:(_,method:string)=>{
            if(["insert","update","delete","upsert"].includes(method)) return (payload:any)=>{
                if(table !== "ai_chat_sessions" || method !== "update") throw new Error("Audit prohibits market/portfolio writes");
                savedSummary=payload.summary_state; return q;
            };
            if(method === "then") return (yes:any,no:any)=>{
                const selected=nameTerm ? extraStocks.filter(s=>s.name.includes(nameTerm!)) : symbol ? [...stocks,...extraStocks].filter(s=>s.symbol === symbol) : stocks;
                const rows=table === "ai_chat_sessions" ? [{id:"00000000-0000-4000-8000-000000000001"}] : table === "stock_technical_indicators" ? selected : table === "stock_prices"
                    ? selected.map(s=>({high:s.close*1.1,low:s.close*.9,close:s.close,date:s.date}))
                    : table === "stocks" ? selected.map(s=>({...s,name:(s as any).name || s.symbol})) : [];
                return Promise.resolve({data:rows,error:null}).then(yes,no);
            };
            return (...args:any[])=>{if(method === "eq" && args[0] === "symbol")symbol=args[1];if(method === "ilike" && args[0] === "name_ar")nameTerm=args[1].replace(/%/g,"");return q;};
        }});return q;
    }};
    const events:any[]=[];const start=Date.now();
    try {
        if(process.env.AGENTIC_SMOKE_IDENTITY_ONLY === "1") {
            const reportPath=path.resolve(process.cwd(),"../scratch/agentic-compact-smoke-2026-10-09.json");
            const stored=JSON.parse(fs.readFileSync(reportPath,"utf8"));
            const summary:any={current_symbols:stocks.map(s=>s.symbol),last_tool_evidence:evidenceMemory([
                toAgenticEvidence("get_technical_scan",{preset:"momentum_and_volume"},{status:"success",date:"2026-10-08",stocks}),
                toAgenticEvidence("get_comparison",{symbols:stocks.map(s=>s.symbol)},{status:"success",comparison:stocks}),
            ])};
            for await(const e of runAgenticPipelineStream("afmc عتاقه",[],{current_symbol:"COMI",last_symbols:stocks.map(s=>s.symbol),summary:null},summary,
                [{role:"user",content:"رتبهم من الأفضل للـ MACD"},{role:"assistant",content:stored.followup.response}],db,[],
                "00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000001","identity-message"))events.push(e);
            const identity=events.find(e=>e.type === "done")?.data;
            const result={latency_ms:Date.now()-start,provider_calls:requests,response:identity?.response,publication_review:identity?.publication_review,usage:identity?.usage,provider_messages:providerMessages};
            fs.writeFileSync(reportPath,JSON.stringify({...stored,identity:result},null,2));console.log("AGENTIC_IDENTITY "+JSON.stringify(result));
            expect(identity.publication_review.final_passed).toBe(true);expect(identity.response).not.toContain("مطاحن الإسكندرية (عتاقة)");
            expect(identity.response).toContain("AFMC");expect(identity.response).toContain("ATQA");return;
        }
        for await(const e of runAgenticPipelineStream("هات أقوى 3 أسهم زخم وسيولة، وبعد ما تختارهم هات مناطق الدخول ووقف الخسارة لكل سهم من البيانات، متفترضش أي سعر مش موجود.",[],
            {current_symbol:null,last_symbols:[],summary:null},null,[],db,[],"00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000001","offline-message"))events.push(e);
        for(const e of events.filter(e=>e.type === "tools_data"))for(const result of e.data.results)if(!tools.includes(result.tool))tools.push(result.tool);
        const done=events.find(e=>e.type === "done")?.data;
        const report={fixture:true,latency_ms:Date.now()-start,provider_calls:requests,tools,response:done?.response,publication_review:done?.publication_review,usage:done?.usage};
        const reportPath=path.resolve(process.cwd(),"../scratch/agentic-compact-smoke-2026-10-09.json");
        fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
        console.log("AGENTIC_SMOKE "+JSON.stringify(report));
        expect(tools).toContain("get_technical_scan");expect(tools).toContain("get_stock_levels");
        expect(done.publication_review.final_passed).toBe(true);expect(done.response).not.toContain("DSML");
        for(const symbol of ["COMI","ETEL","ABUK"])expect(done.response).toContain(symbol);
        expect(savedSummary.last_tool_evidence.length).toBeGreaterThan(0);
        const nextEvents:any[]=[];const followStart=Date.now(); const firstCalls=requests;
        for await(const e of runAgenticPipelineStream("رتبهم من الأفضل للـ MACD",[],done.session_update,savedSummary,
            [{role:"user",content:"هات أقوى 3 أسهم زخم وسيولة ومستوياتها"},{role:"assistant",content:done.response}],db,[],
            "00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000001","followup-message"))nextEvents.push(e);
        const follow=nextEvents.find(e=>e.type === "done")?.data;
        const followReport={latency_ms:Date.now()-followStart,provider_calls:requests-firstCalls,response:follow?.response,publication_review:follow?.publication_review,usage:follow?.usage};
        fs.writeFileSync(reportPath,JSON.stringify({...report,followup:followReport},null,2));
        console.log("AGENTIC_FOLLOWUP "+JSON.stringify(followReport));
        expect(follow.publication_review.final_passed).toBe(true);expect(follow.response_origin).toBe("llm");expect(follow.response).not.toContain("DSML");
        expect(nextEvents.filter(e=>e.type === "tools_data").some(e=>e.data.results.some((r:any)=>r.tool === "get_comparison"))).toBe(true);
        const identityEvents:any[]=[];const identityStart=Date.now();const identityCalls=requests;
        for await(const e of runAgenticPipelineStream("afmc عتاقه",[],follow.session_update,savedSummary,
            [{role:"user",content:"رتبهم من الأفضل للـ MACD"},{role:"assistant",content:follow.response}],db,[],
            "00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000001","identity-message"))identityEvents.push(e);
        const identity=identityEvents.find(e=>e.type === "done")?.data;
        const identityReport={latency_ms:Date.now()-identityStart,provider_calls:requests-identityCalls,response:identity?.response,publication_review:identity?.publication_review,usage:identity?.usage};
        fs.writeFileSync(reportPath,JSON.stringify({...report,followup:followReport,identity:identityReport},null,2));
        console.log("AGENTIC_IDENTITY "+JSON.stringify(identityReport));
        expect(identity.publication_review.final_passed).toBe(true);
        expect(identity.response).not.toContain("مطاحن الإسكندرية (عتاقة)");
        expect(identity.response).toContain("AFMC");expect(identity.response).toContain("ATQA");
    } finally {global.fetch=native;}
},120000);
