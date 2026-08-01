const fs = require("fs");
const path = require("path");

const envPath = path.join(process.cwd(), "web", ".env.local");
const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
const env = {};
for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
}

const key = env.NVIDIA_SECONDARY_API_KEY;

const modelsToTest = [
    "meta/llama-3.1-70b-instruct",
    "meta/llama-3.1-8b-instruct",
    "mistralai/mistral-7b-instruct-v0.3",
    "deepseek-ai/deepseek-v4-flash"
];

(async () => {
    for (const m of modelsToTest) {
        try {
            const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({
                    model: m,
                    messages: [{ role: "user", content: "Hello" }],
                    max_tokens: 50
                })
            });
            console.log(`Model: ${m} -> Status: ${res.status}`);
            if (res.ok) {
                const json = await res.json();
                console.log(`   Reply: ${json.choices?.[0]?.message?.content?.replace(/\n/g, " ")}`);
            }
        } catch (e) {
            console.error(`Model: ${m} -> Error: ${e.message}`);
        }
    }
})();
