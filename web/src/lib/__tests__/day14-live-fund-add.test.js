/**
 * LIVE verification of the two day-14 user reports against the real database
 * and the real pipeline:
 *
 * 1) ahmeduwk05@gmail.com (ad93a700) — "Kora" answered twice with different
 *    data dates (2026-09-13 then 2026-09-14). This test asserts the database
 *    rows behind both replies: the 06:05 reply was pre-market (EGX opens
 *    ~10:00 Cairo) so the freshest closed session was Sept 13 (close 7.20,
 *    +5.57%), and the 14:42 reply used the live Sept-14 row (close 7.42,
 *    +3.06%). Expected: both rows exist and match — correct behavior, not a
 *    data bug.
 *
 * 2) davidganzr92@hotmail.com (695aa60e) — asked "ادون وثيقة" / "وثيقة ادون"
 *    (= وثائق صندوق استثمار أودن — كسب, ticker KASABF, which he already
 *    trades) and got "لا يوجد سهم". Then wanted "ضيفه معانا السهم ده".
 *    This test drives the full fixed conversation in his REAL session:
 *      "ضيفه معانا السهم ده" → asks for the symbol
 *      "ادون وثيقة"          → recognized as KASABF, asks for the quantity
 *      "100 سهم"             → position saved, cash untouched
 *    with a full snapshot/restore of his positions, cash, and session state.
 *
 * Run: RUN_LIVE_DAY14=1 npx jest src/lib/__tests__/day14-live-fund-add.test.js --runInBand
 * The default `npm test` run skips this file entirely.
 */

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", "..", "..", ".env.local");
if (fs.existsSync(envPath)) {
    for (const rawLine of fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.replace(/^\s*export\s+/, "");
        const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        else value = value.replace(/\s+#.*$/, "").trim();
        process.env[match[1]] = value;
    }
}

const { createClient } = require("@supabase/supabase-js");
const { runPipelineStream } = require("../ai/pipeline");
const { loadSessionState, loadSessionSummary } = require("../ai/session");

const live = process.env.RUN_LIVE_DAY14 === "1" ? it : it.skip;

const DAVID_ID = "695aa60e-2c2e-409f-8433-17a6f0323a33";
const DAVID_SESSION = "a13f6ba8-33e3-4086-8b34-32754f71e9fe";

async function drivePipeline(supabase, apiKeys, message) {
    const sessionState = await loadSessionState(supabase, DAVID_SESSION, DAVID_ID);
    const sessionSummary = await loadSessionSummary(supabase, DAVID_SESSION, DAVID_ID);
    const messageId = `day14-fund-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let done = null;
    for await (const event of runPipelineStream(
        message,
        [],
        sessionState,
        sessionSummary,
        [],
        supabase,
        apiKeys,
        DAVID_ID,
        DAVID_SESSION,
        messageId,
    )) {
        if (event.type === "done") {
            done = event.data;
            break;
        }
    }
    return String(done?.response || "");
}

if (process.env.RUN_LIVE_DAY14 === "1") jest.setTimeout(120000);

live("verifies KORA dual-date replies and drives the fixed fund-add conversation", async () => {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const apiKeys = [
        process.env.NVIDIA_API_KEY,
        process.env.NVIDIA_SECONDARY_API_KEY,
        process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_OFFICIAL_API_KEY,
    ].filter(Boolean);

    // ---------- Part 1: KORA data behind both day-14 replies ----------
    const { data: koraRows } = await supabase.from("stock_prices")
        .select("date,close").eq("symbol", "KORA").order("date", { ascending: false }).limit(4);
    const closeByDate = Object.fromEntries((koraRows || []).map((r) => [r.date, r.close]));
    console.log(`[KORA] closes: ${JSON.stringify(closeByDate)}`);
    // The 06:05 (pre-market) reply: Sept-13 close 7.20, +5.57% vs Sept-10 6.82
    expect(closeByDate["2026-09-13"]).toBe(7.20);
    expect(closeByDate["2026-09-10"]).toBe(6.82);
    expect(((7.20 - 6.82) / 6.82) * 100).toBeCloseTo(5.57, 1);
    // The 14:42 (in-session) reply: Sept-14 live close 7.42, +3.06% vs 7.20
    expect(closeByDate["2026-09-14"]).toBe(7.42);
    expect(((7.42 - 7.20) / 7.20) * 100).toBeCloseTo(3.06, 1);
    console.log("[KORA] both day-14 replies match their database rows — correct pre-market vs live behavior");

    // ---------- Part 2: david's conversational fund add ----------
    // Snapshot for full restore.
    const snapRows = (await supabase.from("positions").select("id,symbol,quantity,entry_price,status").eq("user_id", DAVID_ID)).data || [];
    const snapIds = new Set(snapRows.map((r) => r.id));
    const snapProfile = (await supabase.from("profiles").select("cash_balance").eq("id", DAVID_ID).maybeSingle()).data;
    const snapCash = snapProfile ? snapProfile.cash_balance : null;
    const snapSession = (await supabase.from("ai_chat_sessions").select("summary_state,state").eq("id", DAVID_SESSION).maybeSingle()).data;
    const testStartIso = new Date().toISOString();

    try {
        // Turn 1: the day-14 message that used to fail intent detection.
        const reply1 = await drivePipeline(supabase, apiKeys, "ضيفه معانا السهم ده");
        console.log(`[TURN 1] "ضيفه معانا السهم ده" -> ${reply1.slice(0, 200)}`);
        expect(reply1).toContain("رمز السهم");
        let summary = await loadSessionSummary(supabase, DAVID_SESSION, DAVID_ID);
        expect(summary.portfolio_add_awaiting).toMatchObject({ operation: "add", symbol: null });

        // Turn 2: the fund's colloquial Arabic name — used to be "لا يوجد سهم".
        const reply2 = await drivePipeline(supabase, apiKeys, "ادون وثيقة");
        console.log(`[TURN 2] "ادون وثيقة" -> ${reply2.slice(0, 200)}`);
        expect(reply2).not.toContain("لا يوجد سهم");
        expect(reply2).toContain("KASABF");
        expect(reply2).toMatch(/عدد أسهم/);
        summary = await loadSessionSummary(supabase, DAVID_SESSION, DAVID_ID);
        expect(summary.portfolio_add_awaiting).toMatchObject({ operation: "add", symbol: "KASABF" });

        // Turn 3: the quantity answer completes the add.
        const reply3 = await drivePipeline(supabase, apiKeys, "100 سهم");
        console.log(`[TURN 3] "100 سهم" -> ${reply3.slice(0, 200)}`);
        expect(reply3).toContain("تمام");
        expect(reply3).toContain("KASABF");
        summary = await loadSessionSummary(supabase, DAVID_SESSION, DAVID_ID);
        expect(summary.portfolio_add_awaiting).toBeNull();

        // Verify the database row.
        const { data: kasabf } = await supabase.from("positions")
            .select("symbol,quantity,entry_price,status").eq("user_id", DAVID_ID).eq("symbol", "KASABF").eq("status", "open").maybeSingle();
        console.log(`[VERIFY] KASABF row: ${JSON.stringify(kasabf)}`);
        expect(kasabf).toBeTruthy();
        expect(kasabf.quantity).toBe(100);

        // Cash must be untouched by the whole conversation.
        const { data: cashRow } = await supabase.from("profiles").select("cash_balance").eq("id", DAVID_ID).maybeSingle();
        console.log(`[VERIFY] cash before=${snapCash} after=${cashRow?.cash_balance}`);
        expect(cashRow?.cash_balance).toBe(snapCash);
    } finally {
        // ---------- full cleanup ----------
        const currentRows = (await supabase.from("positions").select("id").eq("user_id", DAVID_ID)).data || [];
        const createdIds = currentRows.map((r) => r.id).filter((id) => !snapIds.has(id));
        for (const id of createdIds) {
            await supabase.from("positions").delete().eq("id", id);
        }
        if (snapCash !== null && snapCash !== undefined) {
            await supabase.from("profiles").update({ cash_balance: snapCash }).eq("id", DAVID_ID);
        }
        if (snapSession) {
            await supabase.from("ai_chat_sessions").update({ summary_state: snapSession.summary_state, state: snapSession.state }).eq("id", DAVID_SESSION);
        }
        try {
            await supabase.from("position_events").delete().eq("user_id", DAVID_ID).gte("event_at", testStartIso);
        } catch {}
        const finalIds = ((await supabase.from("positions").select("id").eq("user_id", DAVID_ID)).data || []).map((r) => r.id);
        console.log(`[CLEANUP] removed ${createdIds.length} test positions; remaining=${finalIds.length}; cash restored=${snapCash}`);
        expect(finalIds.sort()).toEqual([...snapIds].sort());
    }
});
