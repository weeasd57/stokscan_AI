const fs = require("fs");
const path = require("path");

function loadEnv(p) {
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
}
loadEnv(path.join(__dirname, "web", ".env.local"));

const apiKey = process.env.NVIDIA_SECONDARY_API_KEY || process.env.NVIDIA_API_KEY;
console.log("USING KEY:", apiKey ? apiKey.substring(0, 15) + "..." : "NONE");

(async () => {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "deepseek-ai/deepseek-v4-flash",
            messages: [
                { role: "system", content: "You are an AI financial analyst." },
                { role: "user", content: "Explain why Qalaa stock CCAP fell." }
            ],
            temperature: 0.15,
            max_tokens: 500
        })
    });

    console.log("STATUS:", res.status);
    const text = await res.text();
    console.log("BODY:\n", text);
})();
