const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// load env
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
    for (const rawLine of fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.replace(/^\s*export\s+/, "");
        const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
            value = value.slice(1, -1);
        else value = value.replace(/\s+#.*$/, "").trim();
        process.env[match[1]] = value;
    }
}

process.env.RUN_LIVE_CHAT_TESTS = "1";
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY;

const jestBin = require.resolve("jest/bin/jest");
const result = spawnSync(
    process.execPath,
    [jestBin, "--config", "jest.live.config.js", "--testPathPattern", "automation-full-eval", "--runInBand", "--forceExit", "--verbose"],
    { cwd: path.join(__dirname, ".."), env: process.env, stdio: "inherit" }
);
process.exit(result.status ?? 1);
