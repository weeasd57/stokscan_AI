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

const email = `pub-probe-${Date.now()}@example.invalid`;
const password = crypto.randomUUID() + "Aa1!";
const { data: auth, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (authError) throw new Error(authError.message);
const userId = auth.user.id;

const userClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 10 } } });
await userClient.auth.signInWithPassword({ email, password });

const events = [];
const subscribed = {};
const tables = ["positions", "scan_results", "daily_job_runs", "backtests", "similarity_reports", "bot_configs"];

await Promise.all(
  tables.map(
    (table) =>
      new Promise((resolve) => {
        const channel = userClient
          .channel(`pub-${table}`)
          .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
            events.push({ table, type: payload.eventType });
          })
          .subscribe((status) => {
            subscribed[table] = status;
            resolve();
          });
        setTimeout(() => resolve(), 8000);
      }),
  ),
);
await new Promise((r) => setTimeout(r, 2000));
console.log("subscriptions:", JSON.stringify(subscribed));

// Inspect an existing scan_results row for required columns
const { data: sample } = await admin.from("scan_results").select("*").limit(1);
const sampleRow = sample?.[0] || {};
console.log("scan_results sample keys:", Object.keys(sampleRow).join(","));

// Insert valid rows per table
const now = new Date().toISOString();
const insertedIds = {};

const insertResults = [];
const posIns = await admin.from("positions").insert({ user_id: userId, symbol: "COMI", name: "CIB", quantity: 10, entry_price: 90, entry_at: now, status: "open", source: "chatbot", added_at: now }).select("id").single();
insertResults.push({ table: "positions", ok: !posIns.error, err: posIns.error?.message?.slice(0, 60) });
if (posIns.data) insertedIds.positions = posIns.data.id;

if (sampleRow.id !== undefined) {
  const clone = { ...sampleRow, id: undefined };
  // strip identifiers/timestamps that would conflict
  for (const key of Object.keys(clone)) {
    if (key === "created_at" || key === "id" || key === "updated_at") clone[key] = undefined;
  }
  const scanIns = await admin.from("scan_results").insert(clone).select("id").single();
  insertResults.push({ table: "scan_results", ok: !scanIns.error, err: scanIns.error?.message?.slice(0, 60) });
  if (scanIns.data) insertedIds.scan_results = scanIns.data.id;
}

const jobsIns = await admin.from("daily_job_runs").insert({}).select("id").single();
insertResults.push({ table: "daily_job_runs", ok: !jobsIns.error, err: jobsIns.error?.message?.slice(0, 80) });
if (jobsIns.data) insertedIds.daily_job_runs = jobsIns.data.id;

const btIns = await admin.from("backtests").insert({}).select("id").single();
insertResults.push({ table: "backtests", ok: !btIns.error, err: btIns.error?.message?.slice(0, 80) });
if (btIns.data) insertedIds.backtests = btIns.data.id;

console.log("inserts:", JSON.stringify(insertResults));

await new Promise((r) => setTimeout(r, 10000));
console.log("events received:", JSON.stringify(events.filter((e) => e.type)));

await userClient.removeAllChannels();
await admin.from("positions").delete().eq("user_id", userId);
if (insertedIds.scan_results) await admin.from("scan_results").delete().eq("id", insertedIds.scan_results);
if (insertedIds.daily_job_runs) await admin.from("daily_job_runs").delete().eq("id", insertedIds.daily_job_runs);
if (insertedIds.backtests) await admin.from("backtests").delete().eq("id", insertedIds.backtests);
await admin.auth.admin.deleteUser(userId);
process.exit(0);
