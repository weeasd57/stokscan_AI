/** Opt-in, single paid turn with synthetic data. Never writes to Supabase. */
import fs from "node:fs";
import path from "node:path";
import { runAgenticPipelineStream } from "../agentic-pipeline";
jest.mock("server-only", () => ({}));
jest.mock("../vision", () => ({ analyzeImage: jest.fn(), reconcileVisionWithMarket: jest.fn() }));
const live = process.env.RUN_AGENTIC_SMOKE === "1" ? test : test.skip;
live("completes scan then entry/stop levels and passes real context review", async () => {
    const envPath=path.resolve(process.cwd(),".env.local");
    if(fs.existsSync(envPath)) for(const line of fs.readFileSync(envPath,"utf8").split(/\r?\n/)) {
        const match=line.match(/^(DEEPSEEK_API_KEY|DEEPSEEK_OFFICIAL_API_KEY)\s*=\s*(.*)$/);
        if(match) process.env[match[1]]=match[2].trim().replace(/^["']|["']$/g,"");
    }
    const native=global.fetch;let requests=0;const tools:string[]=[];
    global.fetch=(async(url:any,init:any)=>{
        if(url !== "https://api.deepseek.com/chat/completions" || ++requests>7) throw new Error("Audit call budget");
        return native(url,{...init,signal:AbortSignal.any([init.signal,AbortSignal.timeout(25000)])});
    }) as any;
    const stocks=[
        {symbol:"COMI",close:100,change_pct:3,r_vol:2,rsi_14:55,ema_50:95,ema_200:90,macd:1,king_ai_score:75,egx_ai_score:70,date:"2026-10-08"},
        {symbol:"ETEL",close:150,change_pct:2,r_vol:1.8,rsi_14:58,ema_50:140,ema_200:130,macd:1,king_ai_score:70,egx_ai_score:65,date:"2026-10-08"},
        {symbol:"ABUK",close:60,change_pct:1,r_vol:1.5,rsi_14:52,ema_50:55,ema_200:50,macd:1,king_ai_score:65,egx_ai_score:60,date:"2026-10-08"},
    ];
    const db={from:(table:string)=>{
        let symbol:string|null=null;
        const q:any=new Proxy({}, {get:(_,method:string)=>{
            if(["insert","update","delete","upsert"].includes(method)) return ()=>{throw new Error("Audit prohibits all database writes");};
            if(method === "then") return (yes:any,no:any)=>{
                const selected=symbol ? stocks.filter(s=>s.symbol === symbol) : stocks;
                const rows=table === "stock_technical_indicators" ? selected : table === "stock_prices"
                    ? selected.map(s=>({high:s.close*1.1,low:s.close*.9,close:s.close,date:s.date}))
                    : table === "stocks" ? selected.map(s=>({...s,name:s.symbol})) : [];
                return Promise.resolve({data:rows,error:null}).then(yes,no);
            };
            return (...args:any[])=>{if(method === "eq" && args[0] === "symbol")symbol=args[1];return q;};
        }});return q;
    }};
    const events:any[]=[];const start=Date.now();
    try {
        for await(const e of runAgenticPipelineStream("هات أقوى 3 أسهم زخم وسيولة، وبعد ما تختارهم هات مناطق الدخول ووقف الخسارة لكل سهم من البيانات، متفترضش أي سعر مش موجود.",[],
            {current_symbol:null,last_symbols:[],summary:null},null,[],db,[],"offline-user","offline-session","offline-message"))events.push(e);
        for(const e of events.filter(e=>e.type === "tools_data"))for(const result of e.data.results)if(!tools.includes(result.tool))tools.push(result.tool);
        const done=events.find(e=>e.type === "done")?.data;
        const report={fixture:true,latency_ms:Date.now()-start,provider_calls:requests,tools,response:done?.response,publication_review:done?.publication_review,usage:done?.usage};
        const reportPath=path.resolve(process.cwd(),"../scratch/agentic-sol61-smoke-2026-10-08.json");
        fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
        console.log("AGENTIC_SMOKE "+JSON.stringify(report));
        expect(tools).toContain("get_technical_scan");expect(tools).toContain("get_stock_levels");
        expect(done.publication_review.final_passed).toBe(true);expect(done.response).not.toContain("DSML");
        for(const symbol of ["COMI","ETEL","ABUK"])expect(done.response).toContain(symbol);
    } finally {global.fetch=native;}
},60000);
