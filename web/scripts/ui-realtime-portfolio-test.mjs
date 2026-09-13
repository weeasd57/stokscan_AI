const fs = await import("node:fs");
const crypto = await import("node:crypto");

const env = {};
for (const file of [".env.local", "../.env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const email = `ui-e2e3-${Date.now()}@example.invalid`;
const password = crypto.randomUUID() + "Aa1!";
const { data: auth, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (authError || !auth.user) throw new Error(authError?.message || "user creation failed");
const userId = auth.user.id;

const puppeteer = (await import("puppeteer-core")).default;
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const jsErrors = [];
page.on("pageerror", (err) => jsErrors.push(err.message.slice(0, 200)));

await page.evaluateOnNewDocument(() => {
  window.__intervalCalls = [];
  const orig = window.setInterval.bind(window);
  window.setInterval = (fn, delay, ...args) => {
    try {
      const stack = (new Error().stack || "").split("\n").slice(2, 5).join(" | ").slice(0, 250);
      window.__intervalCalls.push({ delay: Number(delay) || 0, stack });
    } catch {
      window.__intervalCalls.push({ delay: Number(delay) || 0 });
    }
    return orig(fn, delay, ...args);
  };
});

const results = {};

// ── Login ──
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.type('input[type="email"]', email);
await page.type('input[type="password"]', password);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }),
  page.click('button[type="submit"]'),
]);
await new Promise((r) => setTimeout(r, 6000));

results.chipBefore = await page.evaluate(() => Boolean(document.querySelector('a[href="/profile"][title]')));

// ── Insert a position via service role (simulates portfolio change from another device) ──
const now = new Date().toISOString();
const { data: inserted, error: insertError } = await admin
  .from("positions")
  .insert({ user_id: userId, symbol: "COMI", name: "Commercial International Bank", quantity: 100, entry_price: 90, entry_at: now, status: "open", source: "chatbot", added_at: now })
  .select("id")
  .single();
results.insertError = insertError?.message || null;
const positionId = inserted?.id || null;

// ── Wait for realtime event to wake the chip (no polling!) ──
let chipAppearedAt = null;
const start = Date.now();
while (Date.now() - start < 25000) {
  const present = await page.evaluate(() => Boolean(document.querySelector('a[href="/profile"][title]')));
  if (present) { chipAppearedAt = Date.now() - start; break; }
  await new Promise((r) => setTimeout(r, 1000));
}

results.chipAppearedAfterMs = chipAppearedAt;
results.chipText = await page.evaluate(() => document.querySelector('a[href="/profile"][title]')?.textContent?.trim() || null);
results.intervalsRegistered = await page.evaluate(() => window.__intervalCalls);
results.jsErrors = jsErrors.slice(0, 10);

console.log(JSON.stringify(results, null, 2));

// ── Cleanup ──
if (positionId) await admin.from("positions").delete().eq("id", positionId);
await browser.close();
await admin.auth.admin.deleteUser(userId);
console.log("cleaned up user:", userId);
