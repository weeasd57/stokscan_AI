/** One opt-in matched question/data replay. Synthetic client: no remote DB or writes. */
import fs from "node:fs";
import path from "node:path";
import { runAgenticPipelineStream } from "../agentic-pipeline";
jest.mock("server-only",()=>({}));
jest.mock("../vision",()=>({analyzeImage:jest.fn(),reconcileVisionWithMarket:jest.fn()}));
const live=process.env.RUN_ADMIN_COMPARISON === "1" ? test : test.skip;
live("replays admin COMI/EAST comparison with the same 2026-10-07 market observations",async()=>{
    const envPath=path.resolve(process.cwd(),".env.local");
    if(fs.existsSync(envPath))for(const line of fs.readFileSync(envPath,"utf8").split(/\r?\n/)){
        const m=line.match(/^(DEEPSEEK_API_KEY|DEEPSEEK_OFFICIAL_API_KEY)\s*=\s*(.*)$/);if(m)process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");
    }
    const rows=[{symbol:"COMI",date:"2026-10-07",close:124.65,change_pct:-.4075,r_vol:.7954,rsi_14:22.5332,macd:-3.073135,macd_signal:-2.707889,macd_histogram:-.365246,ema_50:133.146989,ema_200:126.925929,bb_upper:137.533751,bb_lower:122.567249,king_ai_score:.2949,egx_ai_score:.5097},
        {symbol:"EAST",date:"2026-10-07",close:28.21,change_pct:-2.7241,r_vol:.9084,rsi_14:17.0984,macd:-1.696736,macd_signal:-1.555980,macd_histogram:-.140756,ema_50:33.309559,ema_200:36.576003,bb_upper:35.073590,bb_lower:27.112410,king_ai_score:.5153,egx_ai_score:.4115}];
    const db={from:(table:string)=>{
        let symbol:string|null=null;const q:any=new Proxy({}, {get:(_,method:string)=>{
            if(["insert","update","delete","upsert"].includes(method))return ()=>{throw new Error("Replay forbids all writes");};
            if(method === "then")return (yes:any,no:any)=>Promise.resolve({data:table === "stock_technical_indicators" ? rows.filter(r=>!symbol || r.symbol === symbol) : [],error:null}).then(yes,no);
            return (...args:any[])=>{if(method === "eq" && args[0] === "symbol")symbol=args[1];return q;};
        }});return q;
    }};
    const native=global.fetch;let count=0;global.fetch=(async(url:any,init:any)=>{
        if(url !== "https://api.deepseek.com/chat/completions" || ++count>7)throw new Error("Replay provider budget");
        return native(url,{...init,signal:AbortSignal.any([init.signal,AbortSignal.timeout(25000)])});
    }) as any;
    const events:any[]=[];const start=Date.now();
    try {
        for await(const e of runAgenticPipelineStream("مقارنة COMI و EAST",[],{current_symbol:null,last_symbols:[],summary:null},null,[],db,[],"fixture-user","fixture-session","fixture-message"))events.push(e);
        const done=events.find(e=>e.type === "done")?.data;
        const report={production_commit:"49877998",production_message_id:"efc3ee86-a7dc-4376-bba7-75c082d57e4e",question:"مقارنة COMI و EAST",
            matched_market_date:"2026-10-07",history_matched:false,baseline:{latency_ms:10219,total_tokens:19569,provider_calls:3,issue:"COMI 124.65 was described above EMA200 126.93"},
            candidate:{latency_ms:Date.now()-start,provider_calls:count,response:done?.response,usage:done?.usage,review:done?.publication_review}};
        fs.writeFileSync(path.resolve(process.cwd(),"../scratch/admin-matched-comparison-2026-10-09.json"),JSON.stringify(report,null,2));
        console.log("ADMIN_MATCHED_COMPARISON "+JSON.stringify(report));
        expect(done.publication_review.final_passed).toBe(true);expect(done.response_origin).toBe("llm");expect(done.response).toContain("COMI");expect(done.response).toContain("EAST");
        expect(events.some(e=>e.type === "tools_data" && e.data.results.some((r:any)=>r.tool === "get_comparison"))).toBe(true);
    }finally{global.fetch=native;}
},60000);
