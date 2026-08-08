const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
    for (const rawLine of fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.replace(/^\s*export\s+/, "");
        const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) continue;
        let value = match[2].trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        else value = value.replace(/\s+#.*$/, "").trim();
        process.env[match[1]] = value;
    }
}

const required = [
    ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
    ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"],
];
const missing = required.filter(names => !names.some(name => process.env[name])).map(names => names[0]);
if (missing.length) {
    console.error(`Live test configuration missing: ${missing.join(", ")}. Add them to web/.env.local.`);
    process.exit(1);
}

process.env.RUN_LIVE_CHAT_TESTS = "1";
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY;
const command = process.execPath;
const jestBin = require.resolve("jest/bin/jest");
const result = spawnSync(command, [jestBin, "--config", "jest.live.config.js", "--runInBand", "--forceExit", ...process.argv.slice(2)], {
    cwd: path.join(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
});
if (result.error) console.error(`Unable to start live Jest: ${result.error.message}`);
process.exit(result.status ?? 1);
