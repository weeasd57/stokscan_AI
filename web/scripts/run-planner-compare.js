const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const rawLine of fs
    .readFileSync(envPath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*export\s+/, "");
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY;
const missing = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
].filter((key) => !process.env[key]);
if (missing.length) {
  console.error(
    `Planner comparison configuration missing: ${missing.join(", ")}`,
  );
  process.exit(1);
}

process.env.RUN_LIVE_CHAT_TESTS = "1";
const result = spawnSync(
  process.execPath,
  [
    require.resolve("jest/bin/jest"),
    "--config",
    "jest.planner-compare.config.js",
    "--runInBand",
    "--forceExit",
    ...process.argv.slice(2),
  ],
  { cwd: path.join(__dirname, ".."), env: process.env, stdio: "inherit" },
);
if (result.error)
  console.error(`Unable to start planner comparison: ${result.error.message}`);
process.exit(result.status ?? 1);
