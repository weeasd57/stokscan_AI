// Inspect ai_chat_messages: counts per user, latest rows
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), "web", ".env.local");
const env = {};
if (existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
}
const URL0 = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function q(table, params) {
    const res = await fetch(`${URL0}/rest/v1/${table}?${params}`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
}

const summary = await q("ai_chat_messages", "select=user_id,role,created_at&order=created_at.desc&limit=4000");
const perUser = {};
for (const r of summary) {
    perUser[r.user_id] ||= { user: 0, assistant: 0, latest: null };
    perUser[r.user_id][r.role] = (perUser[r.user_id][r.role] || 0) + 1;
    if (!perUser[r.user_id].latest || r.created_at > perUser[r.user_id].latest) perUser[r.user_id].latest = r.created_at;
}
console.log("total rows:", summary.length);
console.log("distinct users:", Object.keys(perUser).length);
for (const [uid, s] of Object.entries(perUser)) console.log(`  ${uid} user=${s.user} assistant=${s.assistant} latest=${s.latest}`);

const legacy = await q("ai_chatbot_logs", "select=user_id,created_at&order=created_at.desc&limit=2000");
const legacyUsers = new Set(legacy.map(r => r.user_id));
console.log("legacy ai_chatbot_logs rows:", legacy.length, "distinct users:", legacyUsers.size);
for (const u of legacyUsers) console.log("  legacy user:", u);
