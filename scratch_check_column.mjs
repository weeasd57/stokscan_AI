// Direct PostgREST probe: does latency_ms column exist? What error does insert with it return?
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
    const paths = [resolve(process.cwd(), "web", ".env.local"), resolve(process.cwd(), "web", ".env"), resolve(process.cwd(), ".env")];
    const env = {};
    for (const p of paths) {
        if (!existsSync(p)) continue;
        for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
    }
    return env;
}

const env = loadEnv();
const URL0 = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

console.log("== latest assistant row (select *) ==");
let r = await fetch(`${URL0}/rest/v1/ai_chat_messages?role=eq.assistant&select=*&order=created_at.desc&limit=1`, { headers: H });
console.log(r.status, (await r.text()).slice(0, 600));

console.log("== insert with bogus latency_ms into a temp-check (expect error, no real row) ==");
// Use the idempotency-free approach: attempt insert with an invalid session_id so even if
// the column exists the FK blocks it — we only care about the ERROR TYPE for latency_ms.
r = await fetch(`${URL0}/rest/v1/ai_chat_messages`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify([{ session_id: "00000000-0000-0000-0000-000000000000", user_id: "x", role: "user", content: "col-check", latency_ms: 1234 }])
});
console.log(r.status, (await r.text()).slice(0, 600));
