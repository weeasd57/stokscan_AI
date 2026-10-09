/** One bounded writer replay: deliberate first-review rejection exercises repair. */
import fs from "node:fs";
import path from "node:path";
import {runAgenticPipelineStream} from "../agentic-pipeline";
jest.mock("server-only",()=>({}));
jest.mock("../vision",()=>({analyzeImage:jest.fn(),reconcileVisionWithMarket:jest.fn()}));
const live=process.env.RUN_COMPARISON_REPAIR_TONE === "1" ? test : test.skip;
live("COMI/TMGH repair produces a complete comparison rather than an internal change log",async()=>{
    const envPath=path.resolve(process.cwd(),".env.local");
    if(fs.existsSync(envPath))for(const line of fs.readFileSync(envPath,"utf8").split(/\r?\n/)){const m=line.match(/^(DEEPSEEK_API_KEY|DEEPSEEK_OFFICIAL_API_KEY)\s*=\s*(.*)$/);if(m)process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");}
    const rows=[{symbol:"COMI",close:124.65,change_pct:-.41,rsi_14:22.5332,macd:-3.073135,macd_signal:-2.707889,macd_histogram:-.365246,ema_50:133.146989,ema_200:126.925929,r_vol:.7954,date:"2026-10-07"},
        {symbol:"TMGH",close:87.89,change_pct:-.57,rsi_14:18.33,macd:-2.504034,macd_signal:-2.234424,macd_histogram:-.26961,ema_50:94.053915,ema_200:88.343529,r_vol:.5182,date:"2026-10-07"}];
    const db={from:(table:string)=>{let symbol:string|null=null;const q:any=new Proxy({}, {get:(_,key:string)=>{
        if(["insert","update","delete","upsert"].includes(key))return ()=>{throw new Error("Replay forbids writes");};
        if(key === "then")return (yes:any,no:any)=>Promise.resolve({data:table === "stock_technical_indicators" ? rows.filter(r=>!symbol||r.symbol === symbol) : [],error:null}).then(yes,no);
        return (...args:any[])=>{if(key === "eq" && args[0] === "symbol")symbol=args[1];return q;};}});return q;}};
    const native=global.fetch;let calls=0,reviewCalls=0;
    global.fetch=(async(url:any,init:any)=>{if(url !== "https://api.deepseek.com/chat/completions" || ++calls>7)throw new Error("Replay budget");const body=JSON.parse(init.body);
        if(body.response_format && ++reviewCalls === 1)return {ok:true,json:async()=>({choices:[{finish_reason:"stop",message:{content:JSON.stringify({passed:false,issues:["أعد الصياغة بمقارنة مختصرة وخلاصة واضحة؛ لا تسرد كل التفاصيل."],notes:[]})}}]})};
        return native(url,{...init,signal:AbortSignal.any([init.signal,AbortSignal.timeout(25000)])});}) as any;
    const events:any[]=[];const start=Date.now();
    try {for await(const e of runAgenticPipelineStream("قارن لي بين البنك التجاري الدولي (COMI) ومجموعة طلعت مصطفى (TMGH)",[],{current_symbol:null,last_symbols:[],summary:null},null,[],db,[],"fixture-user","fixture-session","fixture-message"))events.push(e);
        const done=events.find(e=>e.type === "done")?.data;
        fs.writeFileSync(path.resolve(process.cwd(),"../scratch/comparison-repair-tone-2026-10-09.json"),JSON.stringify({forced_initial_rejection:true,latency_ms:Date.now()-start,response:done?.response,review:done?.publication_review,usage:done?.usage},null,2));
        console.log("COMPARISON_REPAIR_TONE "+JSON.stringify(done));
        expect(done.publication_review).toMatchObject({repaired:true,final_passed:true});expect(done.response).toContain("COMI");expect(done.response).toContain("TMGH");
        expect(done.response).not.toMatch(/ما تم إصلاحه|تصحيح الجدول|كما وردت من الأداة|get_comparison|stock_technical_indicators/);
    }finally{global.fetch=native;}
},60000);
