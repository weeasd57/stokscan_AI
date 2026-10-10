#!/usr/bin/env node
/** Two bounded real HTTP turns. No direct pipeline import, provider mocks or auth bypass. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createChatRequest } = require("../src/lib/chat-request.cjs");
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const origin = option("--url", "https://egxbots.com");
const sessionId = option("--session", crypto.randomUUID());
const model = option("--model", "deepseek-chat");
const reportPath = option("--report", path.resolve(__dirname, "../scratch/production-chat-verification.json"));
const expectedSha = option("--expected-sha", process.env.CHAT_EXPECTED_SHA);
const report = {mode: "real-http", origin, session_id: sessionId, requested_model: model, started_at: new Date().toISOString(), status: "blocked", ui_verified: false, turns: []};
const prompts = [
    "محفظة افتراضية بـ100 ألف جنيه: COMI بنسبة 60%، وSWDY بنسبة 25%، وTMGH بنسبة 15%. حلل مخاطر التركيز ووضّح أي بيانات ناقصة.",
    "معايا 100 ألف جنيه وعايز أوزعهم بالتساوي على COMI وSWDY وTMGH. دي محفظة افتراضية. احسب مبلغ كل سهم والتركيز القطاعي، والخسارة لو المحفظة نزلت 5% و10%.",
];
function ensure(value, message) { if (!value) throw new Error(message); }
async function readSse(response) {
    ensure(response.headers.get("content-type")?.includes("text/event-stream"), "Expected the same SSE transport as ChatContext");
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let buffer = "", done = null; const events = [];
    while (true) {
        const chunk = await reader.read();
        if (chunk.done) { buffer += decoder.decode(); break; }
        buffer += decoder.decode(chunk.value, {stream: true});
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
            if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue;
            const event = JSON.parse(line.slice(5).trim()); events.push(event);
            if (event.type === "error") throw new Error("Server returned an SSE error");
            if (event.type === "done") done = event;
        }
    }
    ensure(done?.reply, "Stream closed without the canonical JSON done event");
    return {done, events};
}
async function run() {
    ensure(/^https?:\/\/[^/?#]+$/.test(origin), "--url must be a plain origin without credentials, path or query");
    ensure(!new URL(origin).username && !new URL(origin).password, "Credentials must never appear in URLs");
    ensure(expectedSha && /^[a-f0-9]{40}$/i.test(expectedSha), "Provide --expected-sha to prove the deployed revision being tested");
    const headers = {};
    if (process.env.CHAT_AUTH_COOKIE_FILE) headers.Cookie = fs.readFileSync(process.env.CHAT_AUTH_COOKIE_FILE, "utf8").trim();
    else if (process.env.CHAT_AUTH_TOKEN_FILE) headers.Authorization = `Bearer ${fs.readFileSync(process.env.CHAT_AUTH_TOKEN_FILE, "utf8").trim()}`;
    else throw new Error("No authenticated session: use CHAT_AUTH_COOKIE_FILE or CHAT_AUTH_TOKEN_FILE locally; never put credentials in arguments or reports");
    const get = async endpoint => {
        const response = await fetch(origin + endpoint, {headers, signal: AbortSignal.timeout(15000)});
        ensure(response.ok, `Authenticated read failed (HTTP ${response.status})`);
        return response.json();
    };
    const access = await get("/api/admin/ai-chatbot/trace?action=access");
    report.deployment_sha = access.deployment_sha;
    ensure(access.deployment_sha === expectedSha, "Deployed revision differs from the requested revision");
    let totalCost = 0;
    for (let index = 0; index < prompts.length; index++) {
        const history = await get(`/api/ai-chat?session_id=${encodeURIComponent(sessionId)}`);
        const previous = await get(`/api/admin/ai-chatbot/trace?session_id=${encodeURIComponent(sessionId)}`);
        const previousInput = previous.messages?.[0]?.trace?.entries?.find(entry => entry.type === "http_request")?.data;
        const clientId = `${sessionId}:${Date.now()}`;
        const input = {message: prompts[index], history: (history.history || []).map(item => ({role: item.role, content: item.content})), model,
            sessionId, clientMessageId: clientId, chartContext: previousInput?.chart_context};
        const request = createChatRequest(input);
        const start = Date.now();
        const response = await fetch(origin + "/api/ai-chat", {...request, headers: {...request.headers, ...headers}, signal: AbortSignal.timeout(125000)});
        ensure(response.ok, `Chat request failed (HTTP ${response.status}); no automatic retry`);
        const {done, events} = await readSse(response);
        const saved = await get(`/api/admin/ai-chatbot/trace?session_id=${encodeURIComponent(sessionId)}`);
        const row = saved.messages?.find(item => item.trace?.entries?.some(entry => entry.type === "http_request" && entry.data?.client_message_id === clientId));
        const turn = {turn: index+1, prompt: prompts[index], latency_ms: Date.now()-start, reply: done.reply, server_events: events,
            stored_message_id: row?.id, stored_reply_matches: row?.content?.trim() === done.reply.trim(), trace: row?.trace, usage: row?.usage, review: row?.review, checks: []};
        report.turns.push(turn);
        ensure(row?.trace?.complete, "Missing/incomplete real execution trace: parity is not verified");
        ensure(row.trace.deployment_sha === expectedSha, "Turn ran on a different deployment revision");
        ensure(turn.stored_reply_matches, "Stored answer and SSE answer differ");
        ensure(row.review?.final_passed && row.origin === "llm", "Real reviewer rejected the answer or a fallback was published");
        const tools = row.trace.entries.filter(entry => entry.type === "pipeline_event" && entry.data?.type === "tools_data").flatMap(entry => entry.data.data?.results || []);
        ensure(!tools.some(tool => tool.tool === "manage_portfolio" && tool.data?.persisted === true), "Virtual scenario unexpectedly changed a saved portfolio");
        const scenario = [...tools].reverse().find(tool => tool.tool === "analyze_portfolio_risk" && tool.data?.status === "success")?.data;
        ensure(scenario?.capital === 100000 && scenario.persisted === false, "Capital or virtual-portfolio contract failed");
        ensure(scenario.stocks?.length === 3, "Scenario did not cover all three stocks");
        if (index === 0) {
            const expected = {COMI: [60,60000], SWDY: [25,25000], TMGH: [15,15000]};
            ensure(scenario.stocks.every(stock => expected[stock.symbol] && stock.allocation_pct === expected[stock.symbol][0] && stock.allocated_capital === expected[stock.symbol][1]), "Explicit allocation calculation failed");
        } else {
            ensure(scenario.assumption === "equal_weight", "Equal weights were replaced by rounded explicit percentages");
            ensure(scenario.stocks.every(stock => Math.abs(stock.allocation_pct - 100/3) < 0.0001), "Shares are not equal before display rounding");
            ensure(Math.abs(scenario.stocks.reduce((sum, stock) => sum+stock.allocated_capital,0) - 100000) < 0.001, "Rounded allocations do not preserve capital");
            ensure(scenario.stress_scenarios_not_forecasts.some(item => item.change_pct === -5 && item.loss === 5000) && scenario.stress_scenarios_not_forecasts.some(item => item.change_pct === -10 && item.loss === 10000), "Stress losses do not match the requested portfolio");
        }
        ensure(row.usage?.provider_calls <= 7 && typeof row.usage.cost_usd === "number", "Unknown usage or provider budget exceeded");
        totalCost += row.usage.cost_usd;
        turn.checks = ["real HTTP/SSE", "exact deployed revision", "stored response matches", "real review passed", "scenario arithmetic", "no saved-portfolio writes"];
        if (totalCost > 0.05) throw new Error("Estimated USD budget exceeded; remaining turns stopped");
    }
    report.total_estimated_usd = totalCost;
    report.status = "api_verified_ui_not_verified";
}
async function main() {
    try { await run(); }
    catch (error) { report.status = report.turns.length ? "failed" : "blocked"; report.error = error.message; }
    fs.mkdirSync(path.dirname(reportPath), {recursive:true});
    fs.writeFileSync(reportPath, JSON.stringify(report,null,2), {mode: 0o600});
    // No secrets, private prompts, trace bodies or cookies in terminal output.
    console.log(JSON.stringify({status: report.status, turns: report.turns.length, report: reportPath, error: report.error}));
    process.exitCode = report.status === "api_verified_ui_not_verified" ? 0 : 2;
}
if (require.main === module) void main();
module.exports = {readSse};
