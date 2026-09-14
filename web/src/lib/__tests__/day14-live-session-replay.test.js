/**
 * LIVE replay of the real day-14 (2026-09-14) user session from Supabase:
 *   session b53e2ab2-e33e-42b7-9809-77968f29eed3
 *   user    5c91f8c6-0053-46bc-9ae1-87ee6ff32468
 *
 * Day-14 failure under test:
 *   1) 15:15 user uploads portfolio screenshot -> bot replies generic comparison
 *   2) 15:17 user says "دى محفظتى ..." -> bot wrongly replies
 *      "محفظتك فاضية حالياً. سجّل أسهمك أولاً..."
 *
 * This test replays the exact turns against the REAL Supabase project with the
 * REAL vision models, in the SAME session, then verifies the fixes:
 *   - the confirmation no longer answers "محفظتك فاضية"
 *   - the pending import dialogue completes and saves positions
 *   - "ضيف AMER 200 بسعر 45.65" succeeds without touching cash
 *
 * It snapshots the user's positions/cash/summary before the run and restores
 * them after (full cleanup), so the live account returns to its prior state.
 *
 * Run: RUN_LIVE_DAY14=1 npx jest src/lib/__tests__/day14-live-session-replay.test.js --runInBand
 * The default `npm test` run skips this file entirely.
 */

const fs = require("fs");
const path = require("path");

// Load web/.env.local BEFORE requiring the pipeline modules so vision/final
// LLM keys are present in process.env (same pattern as scripts/run-live-tests.js).
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
const DAY14_IMAGE_URL = "https://gfcmaxbtscmizsakarvc.supabase.co/storage/v1/object/public/chat-images/5c91f8c6-0053-46bc-9ae1-87ee6ff32468/b53e2ab2-e33e-42b7-9809-77968f29eed3/f0f71340-9318-4b2e-84b6-c889234ba0f0.jpg";

const DAY14_TURN2 = "دى محفظتى و عامل امر شراء بسعر محدد 30 سهم بسعر 125 ل etel لسه متنفذش عشان السهم موصلش للسعر و عامل امر شراء ل صندوق bmm ب اجمالى 1978 جنيه و سيبك من الاسهم اللى مساحتها صغيره و لسه هدخل بكره 14 الف فى bmm كمان قولى رايك";

async function drivePipeline(supabase, apiKeys, message, images) {
    const sessionState = await loadSessionState(supabase, SESSION_ID, USER_ID);
    const sessionSummary = await loadSessionSummary(supabase, SESSION_ID, USER_ID);
    const messageId = `day14-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const events = [];
    let done = null;
    for await (const event of runPipelineStream(
        message,
        images || [],
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

function finalText(result) {
    return String(result.done?.response || "");
}

async function openPositions(supabase) {
    const { data } = await supabase.from("positions").select("symbol,quantity,entry_price,status").eq("user_id", USER_ID).eq("status", "open");
    return data || [];
}

async function allPositionIds(supabase) {
    const { data } = await supabase.from("positions").select("id").eq("user_id", USER_ID);
    return (data || []).map((row) => row.id);
}

if (process.env.RUN_LIVE_DAY14 === "1") jest.setTimeout(400000);

live("replays the day-14 session and verifies the fixed portfolio flows", async () => {
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
        const snapPositionIds = new Set(await allPositionIds(supabase));
        const snapProfile = (await supabase.from("profiles").select("cash_balance").eq("id", USER_ID).maybeSingle()).data;
        const snapCash = snapProfile ? snapProfile.cash_balance : null;
        const snapSession = (await supabase.from("ai_chat_sessions").select("summary_state,state").eq("id", SESSION_ID).maybeSingle()).data;
        const testStartIso = new Date().toISOString();
        let verificationFailed = false;

        try {
            // ---------- TURN 1: replay the exact day-14 image message ----------
            const imgRes = await fetch(DAY14_IMAGE_URL);
            expect(imgRes.status).toBe(200);
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
            const dataUrl = `data:image/jpeg;base64,${imgBuf.toString("base64")}`;

            const turn1 = await drivePipeline(supabase, apiKeys, "قم بقراءة وتحليل هذه الصورة المرفقة.", [dataUrl]);
            const visionEvent = turn1.events.find((event) => event.type === "vision_result");
            const visionSymbols = (visionEvent?.data?.symbols || []).map((symbol) => symbol.symbol);
            console.log(`[TURN 1] vision symbols: ${visionSymbols.join(", ") || "(none)"}`);
            console.log(`[TURN 1] reply (first 200): ${finalText(turn1).slice(0, 200)}`);
            expect(visionSymbols.length).toBeGreaterThan(0);

            // With the fix, ANY analyzed image persists its symbols so the next
            // "دى محفظتى" can start the import.
            const summaryAfterImage = await loadSessionSummary(supabase, SESSION_ID, USER_ID);
            const persistedSymbols = (summaryAfterImage?.last_vision_context?.symbols || []).map((s) => s.symbol);
            console.log(`[TURN 1] persisted vision symbols: ${persistedSymbols.join(", ")}`);
            expect(persistedSymbols.length).toBeGreaterThan(0);

            // ---------- TURN 2: the exact day-14 confirmation message ----------
            const turn2 = await drivePipeline(supabase, apiKeys, DAY14_TURN2, []);
            const reply2 = finalText(turn2);
            console.log(`[TURN 2] reply: ${reply2.slice(0, 400)}`);
            // The day-14 bug: this exact message produced "محفظتك فاضية".
            expect(reply2).not.toContain("محفظتك فاضية");

            const uniqueCount = new Set(persistedSymbols).size;
            const freeLimit = 5; // FREE_PORTFOLIO_LIMIT; this user has no subscription
            if (reply2.includes("الخطة المجانية")) {
                // Correct plan-limit behavior: rejected up-front with guidance.
                expect(uniqueCount).toBeGreaterThan(freeLimit);
                console.log(`[TURN 2] plan-limit reply is the new correct behavior for ${uniqueCount} symbols`);
            } else {
                // The import dialogue started — walk it to completion.
                expect(reply2).toMatch(/محتاج (الكمية|متوسط|الكمية ومتوسط)/);
                let lastReply = reply2;
                for (let step = 0; step < Math.min(uniqueCount * 2, 10); step += 1) {
                    // Answer the symbol the bot asked about. ETEL keeps the
                    // user's day-14 numbers; others get plausible values.
                    const asked = (lastReply.match(/\b([A-Z]{2,6})\b/g) || []).find((token) => persistedSymbols.includes(token));
                    const answer = asked === "ETEL"
                        ? "30 سهم بمتوسط 125"
                        : "100 سهم بمتوسط 10";
                    const stepResult = await drivePipeline(supabase, apiKeys, answer, []);
                    lastReply = finalText(stepResult);
                    console.log(`[STEP ${step + 1}] asked=${asked} answer="${answer}" -> ${lastReply.slice(0, 160)}`);
                    if (/تم حفظ المحفظة|سجلت الكميات/.test(lastReply)) break;
                    if (/الخطة المجانية|فشل/.test(lastReply)) break;
                    if (!/محتاج/.test(lastReply)) break;
                }
                expect(/تم حفظ|سجلت|تمام/.test(lastReply)).toBe(true);

                // Positions must now exist with quantity and entry price.
                const positions = await openPositions(supabase);
                console.log(`[VERIFY] open positions after import: ${JSON.stringify(positions)}`);
                expect(positions.length).toBeGreaterThan(0);
                const etel = positions.find((p) => p.symbol === "ETEL");
                if (etel) {
                    expect(etel.quantity).toBe(30);
                    expect(etel.entry_price).toBe(125);
                }
            }

            // ---------- TURN 3: the AMER add (day-9 style failure) ----------
            const turn3 = await drivePipeline(supabase, apiKeys, "ضيف فى محفظتى سهم AMER 200 بسعر 45.65", []);
            const reply3 = finalText(turn3);
            console.log(`[TURN 3] AMER add reply: ${reply3.slice(0, 300)}`);
            expect(reply3).toContain("تمام");
            expect(reply3).not.toContain("غير موجود");
            expect(reply3).not.toContain("القائمة المسموحة");

            // AMER position saved with quantity 200 and price 45.65.
            const { data: amer } = await supabase.from("positions").select("symbol,quantity,entry_price,status").eq("user_id", USER_ID).eq("symbol", "AMER").eq("status", "open").maybeSingle();
            console.log(`[VERIFY] AMER row: ${JSON.stringify(amer)}`);
            expect(amer).toBeTruthy();
            expect(amer.quantity).toBe(200);
            expect(amer.entry_price).toBe(45.65);

            // Cash must be untouched by the stock add.
            const { data: cashRow } = await supabase.from("profiles").select("cash_balance").eq("id", USER_ID).maybeSingle();
            const cashAfter = cashRow?.cash_balance;
            console.log(`[VERIFY] cash before=${snapCash} after=${cashAfter}`);
            expect(cashAfter).toBe(snapCash);
        } catch (error) {
            verificationFailed = true;
            throw error;
        } finally {
            // ---------- full cleanup: restore the live account ----------
            const currentIds = await allPositionIds(supabase);
            const createdIds = currentIds.filter((id) => !snapPositionIds.has(id));
            for (const id of createdIds) {
                await supabase.from("positions").delete().eq("id", id);
            }
            if (snapCash !== null && snapCash !== undefined) {
                await supabase.from("profiles").update({ cash_balance: snapCash }).eq("id", USER_ID);
            }
            if (snapSession) {
                await supabase.from("ai_chat_sessions").update({
                    summary_state: snapSession.summary_state,
                    state: snapSession.state,
                }).eq("id", SESSION_ID);
            }
            // Remove analytics events generated by this replay.
            try {
                await supabase.from("position_events").delete().eq("user_id", USER_ID).gte("event_at", testStartIso);
            } catch {}
            const finalIds = await allPositionIds(supabase);
            console.log(`[CLEANUP] removed ${createdIds.length} test positions; remaining=${finalIds.length}; cash restored=${snapCash}${verificationFailed ? " (test FAILED - state restored)" : ""}`);
            expect(finalIds.sort()).toEqual([...snapPositionIds].sort());
        }
    });
