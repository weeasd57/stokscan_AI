/**
 * LIVE verification of the pending portfolio-import dialogue in the REAL
 * day-14 user session (same user, same session, real Supabase writes):
 *   session b53e2ab2-e33e-42b7-9809-77968f29eed3
 *   user    5c91f8c6-0053-46bc-9ae1-87ee6ff32468
 *
 * The day-14 screenshot had 14 symbols so the free-plan limit correctly
 * blocks the import up-front (verified in day14-live-session-replay.test.js).
 * To verify the FULL conversational state machine live — "دى محفظتى" → ask
 * for missing quantity → answer → ask for missing average → answer → save —
 * this test seeds the session summary with a controlled 2-symbol vision
 * context (ETEL missing both fields, COMI missing price only), then drives
 * the real pipeline against the real database and asserts the positions
 * actually land with the right numbers. Everything is restored afterwards.
 *
 * Run: RUN_LIVE_DAY14=1 npx jest src/lib/__tests__/day14-live-pending-flow.test.js --runInBand
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

const USER_ID = "5c91f8c6-0053-46bc-9ae1-87ee6ff32468";
const SESSION_ID = "b53e2ab2-e33e-42b7-9809-77968f29eed3";

async function drivePipeline(supabase, apiKeys, message) {
    const sessionState = await loadSessionState(supabase, SESSION_ID, USER_ID);
    const sessionSummary = await loadSessionSummary(supabase, SESSION_ID, USER_ID);
    const messageId = `day14-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const events = [];
    let done = null;
    for await (const event of runPipelineStream(
        message,
        [],
        sessionState,
        sessionSummary,
        [],
        supabase,
        apiKeys,
        USER_ID,
        SESSION_ID,
        messageId,
    )) {
        events.push(event);
        if (event.type === "done") {
            done = event.data;
            break;
        }
    }
    return { events, done };
}

if (process.env.RUN_LIVE_DAY14 === "1") jest.setTimeout(180000);

live("drives the pending import dialogue to completion in the live session", async () => {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
        );
        const apiKeys = [
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_SECONDARY_API_KEY,
            process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_OFFICIAL_API_KEY,
        ].filter(Boolean);

        // ---------- snapshot live state for full restore ----------
        const snapIds = new Set(((await supabase.from("positions").select("id").eq("user_id", USER_ID)).data || []).map((r) => r.id));
        const snapProfile = (await supabase.from("profiles").select("cash_balance").eq("id", USER_ID).maybeSingle()).data;
        const snapCash = snapProfile ? snapProfile.cash_balance : null;
        const snapSession = (await supabase.from("ai_chat_sessions").select("summary_state,state").eq("id", SESSION_ID).maybeSingle()).data;
        const testStartIso = new Date().toISOString();

        try {
            // Seed a controlled 2-symbol vision context: ETEL missing qty+price,
            // COMI has qty but misses the average price.
            const seededSummary = {
                current_symbols: ["ETEL", "COMI"],
                last_image_symbols: ["ETEL", "COMI"],
                last_topic: "portfolio",
                open_references: [],
                last_data_date: new Date().toISOString().slice(0, 10),
                last_vision_context: {
                    image_type: "portfolio",
                    symbols: [
                        { symbol: "ETEL", name: "Telecom Egypt", visible_values: { price: null, change_pct: null, quantity: null } },
                        { symbol: "COMI", name: "CIB", visible_values: { price: null, change_pct: null, quantity: 100 } },
                    ],
                    technical_observations: [],
                    market_depth: { total_bid: null, total_ask: null, spread: null },
                    user_relevant_summary: "seeded day-14 pending flow verification",
                    uncertainties: [],
                    confidence: 0.9,
                    analyzed_at: new Date().toISOString(),
                    message_id: `seed-${Date.now()}`,
                },
                pending_portfolio_import: null,
                updated_at: new Date().toISOString(),
            };
            const seedResult = await supabase.from("ai_chat_sessions").update({ summary_state: seededSummary }).eq("id", SESSION_ID).eq("user_id", USER_ID);
            expect(seedResult.error).toBeNull();

            // ---------- TURN 1: confirmation ----------
            const turn1 = await drivePipeline(supabase, apiKeys, "دى محفظتى");
            const reply1 = String(turn1.done?.response || "");
            console.log(`[TURN 1] "دى محفظتى" -> ${reply1.slice(0, 250)}`);
            expect(reply1).not.toContain("محفظتك فاضية");
            expect(reply1).toContain("ETEL");
            expect(reply1).toMatch(/الكمية ومتوسط/);

            // Pending state persisted pointing at ETEL.
            let summary = await loadSessionSummary(supabase, SESSION_ID, USER_ID);
            expect(summary.pending_portfolio_import?.items?.length).toBe(2);
            expect(summary.pending_portfolio_import.current_index).toBe(0);

            // ---------- TURN 2: answer ETEL ----------
            const turn2 = await drivePipeline(supabase, apiKeys, "معايا 30 سهم بمتوسط 125");
            const reply2 = String(turn2.done?.response || "");
            console.log(`[TURN 2] ETEL answer -> ${reply2.slice(0, 250)}`);
            expect(reply2).not.toContain("محفظتك فاضية");
            expect(reply2).toContain("COMI");
            expect(reply2).toMatch(/متوسط/);
            expect(reply2).not.toMatch(/الكمية/); // COMI already has 100 — only price asked

            summary = await loadSessionSummary(supabase, SESSION_ID, USER_ID);
            expect(summary.pending_portfolio_import.current_index).toBe(1);
            expect(summary.pending_portfolio_import.items[0]).toMatchObject({ symbol: "ETEL", quantity: 30, price: 125 });

            // ---------- TURN 3: answer COMI average price ----------
            const turn3 = await drivePipeline(supabase, apiKeys, "85.5");
            const reply3 = String(turn3.done?.response || "");
            console.log(`[TURN 3] COMI price -> ${reply3.slice(0, 250)}`);
            expect(/تم حفظ|سجلت/.test(reply3)).toBe(true);

            // Pending cleared.
            summary = await loadSessionSummary(supabase, SESSION_ID, USER_ID);
            expect(summary.pending_portfolio_import).toBeNull();

            // ---------- verify DB ----------
            const { data: positions } = await supabase.from("positions").select("symbol,quantity,entry_price,status,source").eq("user_id", USER_ID).eq("status", "open");
            const bySymbol = Object.fromEntries((positions || []).map((p) => [p.symbol, p]));
            console.log(`[VERIFY] positions: ${JSON.stringify(positions)}`);
            expect(bySymbol.ETEL).toMatchObject({ quantity: 30, entry_price: 125, source: "chatbot_image" });
            expect(bySymbol.COMI).toMatchObject({ quantity: 100, entry_price: 85.5, source: "chatbot_image" });
            expect(Object.keys(bySymbol).sort()).toEqual(["COMI", "ETEL"]);

            // ---------- TURN 4: cancel should not be needed; test "اعرض محفظتي" ----------
            const turn4 = await drivePipeline(supabase, apiKeys, "اعرض محفظتي");
            const reply4 = String(turn4.done?.response || "");
            console.log(`[TURN 4] view -> ${reply4.slice(0, 250)}`);
            expect(reply4).toContain("ETEL");
            expect(reply4).toContain("COMI");

            // Cash untouched by the whole import.
            const { data: cashRow } = await supabase.from("profiles").select("cash_balance").eq("id", USER_ID).maybeSingle();
            expect(cashRow?.cash_balance).toBe(snapCash);
        } finally {
            // ---------- full cleanup ----------
            const currentIds = ((await supabase.from("positions").select("id").eq("user_id", USER_ID)).data || []).map((r) => r.id);
            const createdIds = currentIds.filter((id) => !snapIds.has(id));
            for (const id of createdIds) {
                await supabase.from("positions").delete().eq("id", id);
            }
            if (snapCash !== null && snapCash !== undefined) {
                await supabase.from("profiles").update({ cash_balance: snapCash }).eq("id", USER_ID);
            }
            if (snapSession) {
                await supabase.from("ai_chat_sessions").update({ summary_state: snapSession.summary_state, state: snapSession.state }).eq("id", SESSION_ID);
            }
            try {
                await supabase.from("position_events").delete().eq("user_id", USER_ID).gte("event_at", testStartIso);
            } catch {}
            const finalIds = ((await supabase.from("positions").select("id").eq("user_id", USER_ID)).data || []).map((r) => r.id);
            console.log(`[CLEANUP] removed ${createdIds.length} test positions; remaining=${finalIds.length}; cash restored=${snapCash}`);
            expect(finalIds.sort()).toEqual([...snapIds].sort());
        }
    });
