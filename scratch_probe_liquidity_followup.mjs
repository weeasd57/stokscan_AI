// Reproduce: "هات سيولة قطاع الأدوية" then follow-up "ليه السيولة عالية؟"
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ENV_PATH = resolve(process.cwd(), "web", ".env.local");

function loadEnv() {
    const paths = [ENV_PATH, resolve(process.cwd(), "web", ".env")];
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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TEST_EMAIL = "session.flow.test@example.com";
const TEST_PASSWORD = "FlowTest@2026!";

const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
});
const { access_token: token } = await signInRes.json();
if (!token) { console.error("sign-in failed", signInRes.status); process.exit(1); }

async function chat(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    try {
        const res = await fetch(`${BASE_URL}/api/ai-chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ stream: false, ...payload }),
            signal: controller.signal
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { status: res.status, json, text };
    } finally { clearTimeout(timer); }
}

const sessionId = randomUUID();

console.log("=== [1] هات سيولة قطاع الأدوية ===");
const r1 = await chat({ message: "هات سيولة قطاع الأدوية", session_id: sessionId });
console.log("status:", r1.status);
console.log("reply:", (r1.json?.reply || r1.text).slice(0, 300).replace(/\n/g, " "));

console.log("\n=== [2] ليه السيولة عالية؟ ===");
const r2 = await chat({ message: "ليه السيولة عالية؟", session_id: sessionId });
console.log("status:", r2.status);
console.log("reply:", (r2.json?.reply || r2.text).slice(0, 600).replace(/\n/g, " "));
if (r2.json?.session_update) console.log("session_update:", JSON.stringify(r2.json.session_update));
