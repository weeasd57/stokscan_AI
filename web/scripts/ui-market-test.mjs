const puppeteer = await import("puppeteer-core");

const browser = await puppeteer.default.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message.slice(0, 200)}`));

await page.goto("http://localhost:3000/scanner/market", { waitUntil: "networkidle2", timeout: 90000 });

// Wait for heatmap section header (Arabic or English)
await page.waitForFunction(
  () => {
    const t = document.body.innerText;
    return t.includes("خريطة سيولة الأموال الذكية") || t.includes("Smart Money Flow Heatmap") || t.includes("No heatmap data");
  },
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 10000)); // allow heatmap fetch + render

const results = {};
const body = await page.evaluate(() => document.body.innerText);
results.hasNoDataError = body.includes("No heatmap data found");
results.hasPlayAnimation = body.includes("Play Animation") || body.includes("تشغيل الأنيميشن");
results.hasSectorRotation = body.includes("Sector Rotation Wheel") || body.includes("عجلة دوران القطاعات");
results.hasTotalMarketFlow = body.includes("Total Market Flow") || body.includes("إجمالي سيولة السوق");
results.hasFinanceSector = body.includes("Finance") || body.includes("الخدمات المالية");
results.heatmapSection = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll("span")).map((el) => el.textContent?.trim() || "");
  const flowValues = spans.filter((t) => /^\d{2,4}M$/.test(t)).slice(0, 5);
  return { flowValues };
});
results.dateInputValue = await page.evaluate(() => document.querySelector('input[type="date"]')?.value || "");

// Change date to 2026-09-10 and verify heatmap still renders
await page.evaluate(() => {
  const input = document.querySelector('input[type="date"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "2026-09-10");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 12000));
const afterChange = await page.evaluate(() => document.body.innerText);
results.dateChangeNoError = !afterChange.includes("No heatmap data found");
results.dateChangeHasFlow = afterChange.includes("Total Market Flow") || afterChange.includes("إجمالي سيولة السوق");
results.dateInputAfter = await page.evaluate(() => document.querySelector('input[type="date"]')?.value || "");

results.errors = errors.slice(0, 10);
console.log(JSON.stringify(results, null, 2));
await browser.close();
