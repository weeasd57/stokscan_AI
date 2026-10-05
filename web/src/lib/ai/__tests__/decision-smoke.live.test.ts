import fs from "fs";
import os from "os";
import path from "path";
import { buildV2FinalMessages } from "../final-v2";
import { runAnswerGate } from "../answer-gate";
import { buildFactRecords } from "../facts";
import { getDeepSeekApiKey, getNvidiaApiKeys } from "../server-secrets";
import { AI_CONFIG } from "../config";
import { completeDecisionTools } from "../response-task";
import { IntentPlan, ToolResult } from "../types";

jest.mock("server-only", () => ({}));

const boundedLive = process.env.RUN_BOUNDED_DECISION_SMOKE === "1" ? test : test.skip;
boundedLive("one real responder call answers the reported decision from saved observations", async () => {
    const message = "أيهما أفضل للمضاربة يوم الإثنين gbco أو alcn";
    const plan = { intent: "comparison", confidence: 1, entities: { symbols: ["GBCO", "ALCN"], sector: null, timeframe: "current", reference: null },
        tools: ["get_stock", "get_comparison"], clarification_needed: false, resolved_from: { symbol: null, message_id: null } } as IntentPlan;
    completeDecisionTools(message, plan);
    const results = [
        { symbol: "GBCO", price: 32.5, change_pct: 4.84, rsi_14: 71.43, vol_ratio: "1.94x" },
        { symbol: "ALCN", price: 35, change_pct: 2.64, rsi_14: 65.94, vol_ratio: "3.12x" },
    ].map(data => ({ tool: "get_stock", source: "saved_incident_fixture", data_time: "2026-10-04", data_type: "historical", symbols: [data.symbol], data })) as ToolResult[];
    const deepseek = getDeepSeekApiKey();
    const key = deepseek || getNvidiaApiKeys()[0];
    expect(Boolean(key)).toBe(true);
    const model = deepseek ? "deepseek-chat" : "meta/llama-3.3-70b-instruct";
    const started = Date.now();
    // Exactly one request; no retry, tool execution, user session, or DB writes.
    const response = await fetch(deepseek ? AI_CONFIG.api.deepseekBaseUrl : AI_CONFIG.api.nvidiaBaseUrl, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(35000), body: JSON.stringify({ model, stream: false, max_tokens: 1300, temperature: 0,
            messages: buildV2FinalMessages(message, plan, null, results, [], [], { symbol: null, message_id: null, confidence: 1 }) }),
    });
    expect(response.ok).toBe(true);
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "";
    const gate = runAnswerGate({ reply, plan, userMessage: message, toolResults: results, facts: buildFactRecords(results) });
    fs.writeFileSync(path.join(os.tmpdir(), "oct5-decision-smoke-report.json"), JSON.stringify({ model, elapsed_ms: Date.now() - started,
        request_count: 1, usage: data.usage || null, response: reply, gate }, null, 2));
    expect(gate.reasons).toEqual([]);
    expect(reply).toMatch(/ALCN/i);
    expect(reply).toMatch(/GBCO/i);
}, 40000);
