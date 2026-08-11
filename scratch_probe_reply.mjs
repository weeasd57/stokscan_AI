// Probe: print the FULL reply for one quality scenario to verify natural LLM response
import { readFileSync } from "node:fs";

const envText = readFileSync("web/.env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const signin = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "session.flow.test@example.com", password: "FlowTest@2026!" })
});
const auth = await signin.json();
const token = auth.access_token;
if (!token) { console.error("signin failed", auth); process.exit(1); }

const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const useStream = process.argv.includes("--stream");
const modelIdx = process.argv.indexOf("--model");
const model = modelIdx >= 0 ? process.argv[modelIdx + 1] : undefined;
const question = args[0] || "scem افضل سعر بيع";
const res = await fetch("http://localhost:3000/api/ai-chat", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Accept": useStream ? "text/event-stream" : "application/json",
        "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ message: question, stream: useStream, ...(model ? { model } : {}) })
});
console.log("model:", model || "(default)");
console.log("status:", res.status);
if (!useStream) {
    const data = await res.json();
    console.log("── FULL REPLY ──");
    console.log(data.reply || data.detail || JSON.stringify(data));
} else {
    const text = await res.text();
    const tokens = [];
    let sawDone = false, sawError = null;
    for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
            const evt = JSON.parse(payload);
            if (evt.type === "token" || typeof evt === "string") tokens.push(typeof evt === "string" ? evt : (evt.content || evt.data || ""));
            if (evt.type === "done") sawDone = true;
            if (evt.type === "error") sawError = evt.data;
        } catch {}
    }
    console.log("── STREAM RESULT ──");
    console.log("done event:", sawDone, "| error:", sawError || "none");
    console.log(tokens.join("").slice(0, 600));
}
