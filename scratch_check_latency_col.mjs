import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const env = {};
for (const p of [resolve("web/.env.local"), resolve(".env")]) {
    if (!existsSync(p)) continue;
    for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}` };
const r = await fetch(`${U}/rest/v1/ai_chat_messages?select=id,role,latency_ms,created_at&order=created_at.desc&limit=6`, { headers: H });
console.log(r.status, await r.text());
