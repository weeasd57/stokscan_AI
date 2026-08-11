// Probe: test NVIDIA NIM models nvidia/nemotron-3.5-lightning-30b-a3b and meta/muse-glimmer-30b
import { readFileSync } from "node:fs";

const envText = readFileSync("web/.env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const keys = [env.NVIDIA_API_KEY, env.NVIDIA_SECONDARY_API_KEY, env.NVIDIA_NIM_API_KEY].filter(Boolean);
const key = [...new Set(keys)][0];
if (!key) { console.error("no NVIDIA key"); process.exit(1); }

const MODELS = ["nvidia/nemotron-3.5-lightning-30b-a3b", "meta/muse-glimmer-30b"];
const EXTRA_BODY = process.argv.includes("--no-reason") ? { reasoning_effort: "none" } : {};
console.log("extra body:", JSON.stringify(EXTRA_BODY));
const PROMPT = "اكتب جملة عربية قصيرة عن البورصة المصرية، ثم حلل باختصار: سهم سعره 10 جنيه وRSI عند 75 وحجم تداول 5 أضعاف المتوسط.";

for (const model of MODELS) {
    const t = Date.now();
    try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: PROMPT }],
                temperature: 0.7,
                top_p: 0.95,
                max_tokens: 1500,
                stream: false,
                ...EXTRA_BODY
            }),
            signal: AbortSignal.timeout(60_000)
        });
        const data = await res.json().catch(() => null);
        const ms = Date.now() - t;
        console.log(`\n══ ${model} — status ${res.status} in ${ms}ms ══`);
        if (res.ok) {
            const choice = data?.choices?.[0] || {};
            const reply = choice.message?.content || "(empty)";
            console.log("finish_reason:", choice.finish_reason, "| usage:", JSON.stringify(data?.usage));
            console.log("message keys:", Object.keys(choice.message || {}).join(", "));
            if (choice.message?.reasoning_content) console.log("reasoning_content len:", choice.message.reasoning_content.length);
            console.log("CONTENT:", reply.slice(0, 900));
        } else {
            console.log("ERROR:", JSON.stringify(data).slice(0, 400));
        }
    } catch (err) {
        console.log(`\n══ ${model} — EXCEPTION in ${Date.now() - t}ms: ${err?.message || err} ══`);
    }
}
