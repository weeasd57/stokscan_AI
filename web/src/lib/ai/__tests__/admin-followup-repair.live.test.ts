/** Bounded provider replay with synthetic market history; no database writes. */
import fs from "node:fs";
import path from "node:path";
import {runAgenticPipelineStream} from "../agentic-pipeline";
import {toAgenticEvidence} from "../agentic-publication";
jest.mock("server-only",()=>({}));
jest.mock("../vision",()=>({analyzeImage:jest.fn(),reconcileVisionWithMarket:jest.fn()}));
const live=process.env.RUN_ADMIN_FOLLOWUP_REPLAY === "1" ? test : test.skip;
live("admin requests choose current symbols, bounded recent periods and natural answers",async()=>{
    const envPath=path.resolve(process.cwd(),".env.local");
    if(fs.existsSync(envPath))for(const line of fs.readFileSync(envPath,"utf8").split(/\r?\n/)){
        const m=line.match(/^(DEEPSEEK_API_KEY|DEEPSEEK_OFFICIAL_API_KEY)\s*=\s*(.*)$/);if(m)process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");
    }
    const prices=Array.from({length:140},(_,i)=>{const close=50+i*.08+4*Math.sin(i/7);return {date:new Date(Date.UTC(2026,4,21+i)).toISOString().slice(0,10),open:close-.1,high:close+1,low:close-1,close,volume:1000+i*10};});
    const queries:any[]=[];
    const db={from:(table:string)=>{const ops:any[]=[];queries.push({table,ops});const q:any=new Proxy({}, {get:(_,key:string)=>{
        if(["insert","update","delete","upsert"].includes(key))return ()=>{throw new Error("Replay forbids writes");};
        if(key === "then")return (yes:any,no:any)=>{let rows=table === "stock_prices" ? [...prices] : [];
            for(const [method,...args] of ops){if(method === "gte" && args[0] === "date")rows=rows.filter(r=>r.date>=args[1]);if(method === "lte" && args[0] === "date")rows=rows.filter(r=>r.date<=args[1]);}
            const limit=ops.find(o=>o[0] === "limit")?.[1]||1000;return Promise.resolve({data:rows.slice(-limit).reverse(),error:null}).then(yes,no);};
        return (...args:any[])=>{ops.push([key,...args]);return q;};}});return q;}};
    const old=toAgenticEvidence("get_stock",{symbols:["ABUK"]},{stocks:[{symbol:"ABUK",close:90,date:"2026-10-07"}]});
    const cases=[{prompt:"هات أكتر استراتيجية ناجحة لسهم COMI",symbol:"COMI",tools:true},
        {prompt:"معايا 10 تلاف أعمل بيهم إيه",symbol:null,tools:false},
        {prompt:"في الباكتيست بيانات لسهم ELEC؟",symbol:"ELEC",tools:true},
        {prompt:"هات باكتيست ELEC لفترة قريبة من السوق دلوقتي، آخر 60 شمعة",symbol:"ELEC",tools:true},
        {prompt:"إيه ده",symbol:null,tools:false},
        {prompt:"إيه الخدمات والأدوات اللي بتستخدمها؟",symbol:null,tools:false},
        {prompt:"قارن بين استراتيجية البرايس أكشن وتتبع الاتجاه وSMC على تاريخ سهم السويدي SWDY",symbol:"SWDY",tools:true},
        {prompt:"اختبره في استراتيجية من عندك",symbol:"AFMC",tools:true}];
    const native=global.fetch;let calls=0;global.fetch=(async(url:any,init:any)=>{
        if(url !== "https://api.deepseek.com/chat/completions" || ++calls>24)throw new Error("Replay provider budget");
        return native(url,{...init,signal:AbortSignal.any([init.signal,AbortSignal.timeout(25000)])});
    }) as any;
    const reports:any[]=[];
    try {for(const c of cases.slice(Number(process.env.REPLAY_START_CASE || 0))){const events:any[]=[];const start=Date.now();
        const selected=c.symbol === "AFMC" ? "AFMC" : "ABUK";
        const history=c.prompt === "إيه ده" ? [{role:"user",content:"معايا 10 تلاف اعمل بيهم ايه"},{role:"assistant",content:"تعذر إكمال الإجابة. ABUK إغلاقه 90."}] : [{role:"user",content:c.symbol === "AFMC" ? "afmc" : "حلل أبو قير"},{role:"assistant",content:`${selected} إغلاقه 90 بتاريخ 2026-10-07.`}];
        for await(const e of runAgenticPipelineStream(c.prompt,[],{current_symbol:selected,last_symbols:[selected],summary:null},{last_tool_evidence:c.symbol === "AFMC" ? [] : [old],current_symbols:[selected]} as any,history,db,[],"fixture-user","fixture-session","fixture-message"))events.push(e);
        const done=events.find(e=>e.type === "done")?.data;const evidence=events.filter(e=>e.type === "tools_data").at(-1)?.data.results||[];
        reports.push({prompt:c.prompt,latency_ms:Date.now()-start,response:done?.response,review:done?.publication_review,usage:done?.usage,tools:evidence.map((e:any)=>({tool:e.tool,args:e.arguments,availability:e.availability}))});
        expect(done?.publication_review.final_passed).toBe(true);expect(done?.response_origin).toBe("llm");
        expect(done.response).not.toMatch(/get_stock|stock_prices|compare_strategies_history|stock_scans_summary/);
        if(c.symbol){expect(done.response).toContain(c.symbol);expect(done.response).not.toContain("ABUK");expect(evidence.some((e:any)=>e.symbols.includes(c.symbol))).toBe(true);}
        else if(c.prompt === "إيه ده") {expect(done.response).toContain("10");expect(evidence).toHaveLength(0);expect(done.response).not.toContain("| السهم |");}
        else if(c.prompt.startsWith("معايا")) expect(done.response).not.toContain("ABUK");
        else expect(evidence).toHaveLength(0);
        if(c.prompt.includes("60"))expect(evidence.some((e:any)=>e.arguments.bar_limit === 60)).toBe(true);
        if(c.symbol === "SWDY")expect(evidence.find((e:any)=>e.tool === "compare_strategies_history")?.arguments.strategy_ids.sort()).toEqual(["price_action","smc","trend_macd"]);
        if(c.symbol === "AFMC")expect(evidence.find((e:any)=>e.tool === "compare_strategies_history")?.arguments.strategy_ids).toHaveLength(1);
    }}finally{global.fetch=native;fs.writeFileSync(path.resolve(process.cwd(),"../scratch/admin-followup-repair-2026-10-09.json"),JSON.stringify({fixture:true,calls,reports,queries},null,2));console.log("ADMIN_FOLLOWUP_REPLAY "+JSON.stringify(reports));}
},240000);
