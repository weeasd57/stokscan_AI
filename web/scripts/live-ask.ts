import fs from "fs";
import path from "path";

function loadEnv(filePath: string) {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i > 0) {
            const k = t.slice(0, i).trim();
            const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
            if (!process.env[k]) process.env[k] = v;
        }
    }
}
loadEnv(path.resolve(__dirname, "../.env.local"));
loadEnv(path.resolve(__dirname, "../../.env"));

import { getSupabaseClient } from "../src/lib/supabase/route-data";
import { runPipelineStream } from "../src/lib/ai/pipeline";
import { getNvidiaApiKeys, getDeepSeekApiKey } from "../src/lib/ai/server-secrets";

// Usage: tsx scripts/live-ask.ts <questions.json> <out.json>   (questions.json = string[])
async function main() {
    const [qFile, outFile] = [process.argv[2], process.argv[3]];
    const questions: string[] = JSON.parse(fs.readFileSync(qFile, "utf-8"));
    const supabase = getSupabaseClient();
    const dk = getDeepSeekApiKey();
    const apiKeys = dk ? [dk, ...getNvidiaApiKeys()] : getNvidiaApiKeys();
    const state: any = { current_symbol: null, last_symbols: [], summary: null };
    const summary: any = { current_symbols: [], last_image_symbols: [], last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: new Date().toISOString() };
    const history: Array<{ role: string; content: string }> = [];
    const userId = "00000000-0000-0000-0000-0000000000aa";
    const sessionId = crypto.randomUUID();
    const out: any[] = [];

    for (let n = 0; n < questions.length; n++) {
        const q = questions[n];
        const t0 = Date.now();
        let plan: any = null, tools: any[] = [], reply = "";
        try {
            for await (const ev of runPipelineStream(q, [], state, summary, history, supabase, apiKeys, userId, sessionId, `live_${Date.now()}_${n}`)) {
                if (ev.type === "plan") plan = ev.data;
                else if (ev.type === "tools") tools = Array.isArray(ev.data) ? ev.data : (ev.data?.results || ev.data?.tools || []);
                else if (ev.type === "token") reply += ev.data;
                else if (ev.type === "done") {
                    if (ev.data?.response) reply = ev.data.response;
                    if (ev.data?.session_update) Object.assign(state, ev.data.session_update);
                }
            }
        } catch (e: any) { reply = `ERROR: ${e.message}`; }
        history.push({ role: "user", content: q }, { role: "assistant", content: reply });
        if (plan?.entities?.symbols?.length) {
            state.current_symbol = plan.entities.symbols[0];
            state.last_symbols = Array.from(new Set([...plan.entities.symbols, ...(state.last_symbols || [])])).slice(0, 15);
            summary.current_symbols = plan.entities.symbols;
        }
        out.push({
            n: n + 1, q, ms: Date.now() - t0, intent: plan?.intent, symbols: plan?.entities?.symbols, plan_tools: plan?.tools,
            tools: tools.map(t => ({ tool: t.tool, source: t.source, symbols: t.symbols, avail: t.availability, rows: Array.isArray(t.data?.stocks) ? t.data.stocks.length : undefined })),
            reply,
        });
        console.log(`[${n + 1}] ${Date.now() - t0}ms intent=${plan?.intent} symbols=${JSON.stringify(plan?.entities?.symbols)} tools=${tools.map(t => t.tool).join(",")}`);
    }
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf-8");
    console.log("saved", outFile);
}
main().catch(e => { console.error(e); process.exit(1); });
