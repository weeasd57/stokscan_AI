const fs = require("fs");
const path = require("path");

const envPath = path.join(process.cwd(), "web", ".env.local");
const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
const env = {};
for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
}

console.log("NVIDIA_SECONDARY:", env.NVIDIA_SECONDARY_API_KEY ? "YES" : "NO");
console.log("DEEPSEEK_OFFICIAL:", env.DEEPSEEK_OFFICIAL_API_KEY ? "YES" : "NO");
console.log("AGENT_ROUTER:", env.AGENT_ROUTER_API_KEY ? "YES" : "NO");

(async () => {
    // Test DeepSeek Official API
    if (env.DEEPSEEK_OFFICIAL_API_KEY) {
        try {
            const res = await fetch("https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.DEEPSEEK_OFFICIAL_API_KEY}` },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [{ role: "user", content: "Hello" }]
                })
            });
            console.log("DeepSeek Official Status:", res.status);
            if (res.ok) console.log("DeepSeek Reply:", (await res.json()).choices[0].message.content);
        } catch (e) { console.error("DeepSeek Error:", e.message); }
    }

    // Test Agent Router API
    if (env.AGENT_ROUTER_API_KEY) {
        try {
            const res = await fetch("https://agentrouter.ai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.AGENT_ROUTER_API_KEY}` },
                body: JSON.stringify({
                    model: "deepseek-ai/deepseek-v4-flash",
                    messages: [{ role: "user", content: "Hello" }]
                })
            });
            console.log("Agent Router Status:", res.status);
            if (res.ok) console.log("Agent Router Reply:", (await res.json()).choices[0].message.content);
        } catch (e) { console.error("Agent Router Error:", e.message); }
    }
})();
