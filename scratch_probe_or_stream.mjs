// Verify OpenRouter SSE streaming mechanics (raw lines + parsed tokens)
import { readFileSync } from "node:fs";
const envText = readFileSync("web/.env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const key = env.OPENROUTER_API_KEY;
const model = process.argv[2] || "nvidia/nemotron-3-ultra-550b-a55b:free";

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "EGX Bots"
    },
    body: JSON.stringify({
        model,
        messages: [
            { role: "system", content: "أنت محلل أسهم مصري. أجب بالعربية فقط وبإيجاز." },
            { role: "user", content: "السهم SCEM سعره 82 جنيه والمقاومة 88 جنيه. هل أبيع الآن؟ أجب في سطرين." }
        ],
        temperature: 0.15,
        max_tokens: 300,
        stream: true
    })
});
console.log("status:", res.status, "| content-type:", res.headers.get("content-type"));
if (!res.ok) { console.log(await res.text()); process.exit(1); }

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "", tokens = "", sawDone = false, rawLines = 0;
while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        rawLines++;
        if (rawLines <= 4) console.log("RAW:", JSON.stringify(trimmed.slice(0, 160)));
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") { sawDone = true; continue; }
        try {
            const evt = JSON.parse(payload);
            const delta = evt.choices?.[0]?.delta?.content ?? evt.choices?.[0]?.message?.content ?? "";
            if (delta) tokens += delta;
        } catch (e) { console.log("PARSE FAIL:", trimmed.slice(0, 120)); }
    }
}
console.log("rawLines:", rawLines, "| sawDone:", sawDone, "| tokens length:", tokens.length);
console.log("TOKENS:", tokens.slice(0, 400));
