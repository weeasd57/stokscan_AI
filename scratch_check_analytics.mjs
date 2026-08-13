// Check ai_analytics latency data + ai_chat_messages columns
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
    const paths = [resolve(process.cwd(), "web", ".env.local"), resolve(process.cwd(), "web", ".env"), resolve(process.cwd(), ".env")];
    const env = {};
    for (const p of paths) {
        if (!existsSync(p)) continue;
        const found = [];
        for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m) { found.push(m[1]); if (!(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
        }
        console.log(`[env] ${p}:`, found.filter(k => /SUPABASE|NVIDIA|OPENROUTER/.test(k)).join(", "));
    }
    return env;
}

const env = loadEnv();
const URL0 = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log("key type:", env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY ? "SERVICE" : "ANON");
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function q(path) {
    const r = await fetch(`${URL0}/rest/v1/${path}`, { headers: H });
    const body = await r.text();
    return { status: r.status, body: body.slice(0, 1200) };
}

console.log("== ai_chatbot_logs sample (all cols) ==");
console.log(await q("ai_chatbot_logs?select=*&order=created_at.desc&limit=2"));

console.log("== ai_chat_messages single row (columns) ==");
console.log(await q("ai_chat_messages?select=*&limit=1"));

console.log("== ai_chat_messages count ==");
const c2 = await fetch(`${URL0}/rest/v1/ai_chat_messages?select=id`, { headers: { ...H, Prefer: "count=exact" } });
console.log(c2.status, "count:", c2.headers.get("content-range"));
