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

const email = `ui-e2e2-${Date.now()}@example.invalid`;
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
  window.__wsUrls = [];
  const origSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, delay, ...args) => {
    window.__intervalCalls.push({ delay: Number(delay) || 0 });
    return origSetInterval(fn, delay, ...args);
  };
  const OrigWS = window.WebSocket;
  class PatchedWS extends OrigWS {
    constructor(url, protocols) {
      super(url, protocols);
      window.__wsUrls.push(String(url).slice(0, 90));
    }
  }
  window.WebSocket = PatchedWS;
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

// ── Portfolio chip (correct selector) ──
await new Promise((r) => setTimeout(r, 6000));
results.portfolioChip = await page.evaluate(() => {
  const chip = document.querySelector('a[href="/profile"][title]');
  return { present: Boolean(chip), title: chip?.getAttribute("title") || null, text: chip?.textContent?.trim() || null };
});

// ── Admin: unlock + JOBS tab ──
await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 90000 });
await page.evaluate(() => { window.__intervalCalls = []; });
if (await page.evaluate(() => Boolean(document.querySelector('input[type="password"]')))) {
  await page.type('input[type="password"]', env.ADMIN_SECRET_PASSWORD);
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 6000));
}

const jobsClicked = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "JOBS");
  if (btn) { btn.click(); return true; }
  return false;
});
results.jobsClicked = jobsClicked;
await new Promise((r) => setTimeout(r, 15000));

const jobsBody = await page.evaluate(() => document.body.innerText);
results.jobsTabActive = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "JOBS");
  return btn ? btn.className.includes("orange") || btn.getAttribute("aria-current") === "page" || btn.dataset.active === "true" : false;
});
results.jobsContentRendered = /Daily Jobs|job|Job|تشغيل|توصيات|recommendations|status/i.test(jobsBody);
results.jobsTextSample = jobsBody.slice(0, 400);
results.jobsIntervals = await page.evaluate(() => window.__intervalCalls);
results.jobsWebsockets = await page.evaluate(() => window.__wsUrls);

await new Promise((r) => setTimeout(r, 20000));
results.jobsIntervalsAfterLongWait = await page.evaluate(() => window.__intervalCalls);
results.jsErrors = jsErrors.slice(0, 10);

console.log(JSON.stringify(results, null, 2));
await browser.close();
await admin.auth.admin.deleteUser(userId);
console.log("cleaned up user:", userId);
