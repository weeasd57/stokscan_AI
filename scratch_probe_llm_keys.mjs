// Probe candidate LLM providers (OpenRouter free tier + NVIDIA NIM free endpoints)
// with a REALISTIC sector-sized Arabic payload. Measures status, latency, reply quality.
// Usage: node scratch_probe_llm_keys.mjs [provider/model ...]
import { readFileSync } from "node:fs";

const envText = readFileSync("web/.env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const openrouterKey = env.OPENROUTER_API_KEY;
const nvidiaKey = env.NVIDIA_SECONDARY_API_KEY || env.NVIDIA_API_KEY;

const stocks = ["MPCI","NIPH","PHAR","OCPH","CPCI","ADCI","RMDA","SIPC","MIPH","MCRO","AXPH","SPMD","AMES","CLHO","NINH"]
    .map((s, i) => ({ symbol: s, price: 100 + i * 37.5, change_pct: (20 - i * 1.4).toFixed(2), vol_ratio: (1.5 + i * 0.13).toFixed(2), rsi_14: (82 - i * 2.1).toFixed(2), macd: (20 - i * 1.7).toFixed(4) }));
const dataText = "=== بيانات قطاع أدوية (2026-08-10) ===\n" + stocks.map(s =>
    `${s.symbol}: السعر=${s.price}, التغير=${s.change_pct}%, الحجم=${s.vol_ratio}x, RSI=${s.rsi_14}, MACD=${s.macd}`
).join("\n");

const messages = [
    { role: "system", content: "أنت محلل أسهم مصري محترف. أجب بالعربية الفصحى فقط. التزم بالأرقام المعطاة ولا تختلق أرقاماً. اكتب تحليلاً موجزاً من 4-6 أسطر يرد على سؤال المستخدم مباشرة." },
    { role: "user", content: `السؤال: هل اسهم الأدوية مكملة فى الارتفاع ام سيحدث تصحيح؟\n\n${dataText}` }
];

const CANDIDATES = [
    { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
    { provider: "openrouter", model: "google/gemma-4-26b-a4b-it:free" },
    { provider: "openrouter", model: "openai/gpt-oss-20b:free" },
    { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b" },
    { provider: "nvidia", model: "z-ai/glm-5.2" },
];

async function probe(c) {
    const key = c.provider === "openrouter" ? openrouterKey : nvidiaKey;
    const url = c.provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://integrate.api.nvidia.com/v1/chat/completions";
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    if (c.provider === "openrouter") {
        headers["HTTP-Referer"] = "https://egxbots.local";
        headers["X-Title"] = "EGX Bots";
    }
    const t0 = Date.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        const res = await fetch(url, {
            method: "POST", headers, signal: controller.signal,
            body: JSON.stringify({ model: c.model, messages, temperature: 0.15, max_tokens: 600, stream: false })
        });
        clearTimeout(timeoutId);
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (!res.ok) {
            const body = (await res.text()).slice(0, 200).replace(/\n/g, " ");
            console.log(`${c.provider}/${c.model}: HTTP ${res.status} (${secs}s) — ${body}`);
            return;
        }
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content || "";
        console.log(`${c.provider}/${c.model}: OK in ${secs}s, ${reply.length} chars`);
        console.log("   excerpt:", reply.slice(0, 220).replace(/\n/g, " "));
        console.log("   tail:", reply.slice(-320).replace(/\n/g, " "));
    } catch (e) {
        console.log(`${c.provider}/${c.model}: ERROR after ${((Date.now() - t0) / 1000).toFixed(1)}s — ${e.message}`);
    }
    console.log("---");
}

const filter = process.argv.slice(2);
for (const c of CANDIDATES) {
    if (filter.length > 0 && !filter.some(f => c.model.includes(f))) continue;
    await probe(c);
}
