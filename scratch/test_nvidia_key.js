const fs = require("fs");
const path = require("path");

const envPath = path.join(process.cwd(), "web", ".env.local");
const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
const env = {};
for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
}

(async () => {
    try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${env.NVIDIA_SECONDARY_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-ai/deepseek-v4-flash",
                messages: [{ role: "user", content: "Hello" }],
                max_tokens: 100
            })
        });
        console.log("NVIDIA Status:", res.status);
        const text = await res.text();
        console.log("NVIDIA Reply:", text.substring(0, 300));
    } catch (e) {
        console.error("NVIDIA Error:", e.message);
    }
})();
