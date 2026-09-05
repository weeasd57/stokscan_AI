import { describe, it, expect } from "@jest/globals";
import {
  buildEvidenceEnginePromptBlock,
  buildV2FinalMessages,
} from "../final-v2";
import type { ToolResult } from "../types";

// Simulate the AMER stock data from the live chat logs
// KING AI = 58.6%, EGX AI = 51.7%, diff = 6.88 points
const amerToolResults: ToolResult[] = [
  {
    tool: "get_stock",
    source: "database",
    data_time: "2026-09-03",
    data_type: "live",
    symbols: ["AMER"],
    data: {
      symbol: "AMER",
      name: "Amer Group Holding",
      price: 5.53,
      change_pct: "+1.47%",
      change_pct_num: 1.47,
      rsi_14: 36.49,
      macd: 0.2306,
      macd_signal: 0.43,
      macd_histogram: -0.20,
      vol_ratio: "0.31x",
      vol_ratio_num: 0.31,
      support: 5.30,
      resistance: 8.47,
      king_ai_score: 0.586,
      egx_ai_score: 0.517,
    },
  },
];

describe("AMER stock scenario (live chat log verification)", () => {
  it("AMER: 6.88pt ML diff should be 'اتفاق متوسط' NOT 'اتفاق قوي'", () => {
    const block = buildEvidenceEnginePromptBlock(amerToolResults);
    expect(block).toContain("model_consensus");
    expect(block).toContain("اتفاق متوسط");
    expect(block).not.toMatch(/اتفاق قوي/);
  });

  it("AMER: system prompt should NOT mention '15 نقطة' threshold", () => {
    const block = buildEvidenceEnginePromptBlock(amerToolResults);
    // The old code had "أقل من 15 نقطة" in the note
    expect(block).not.toContain("15 نقطة");
  });

  it("AMER: system prompt consensus decision should NOT map 'اتفاق قوي' to 'شراء/مراجعة'", () => {
    const mockPlan: any = {
      intent: "stock_detail",
      confidence: 0.9,
      guidance_intent: null,
      entities: { symbols: ["AMER"], sector: null, timeframe: "current", reference: null },
      needs_vision_context: false,
      needs_history: false,
      needs_live_data: true,
      needs_historical_data: false,
      tools: ["get_stock"],
      clarification_needed: false,
      resolved_from: { symbol: null, message_id: null },
    };
    const messages = buildV2FinalMessages(
      "حلل سهم AMER",
      mockPlan,
      null,
      amerToolResults,
      [],
      [],
      { symbol: null, message_id: null, confidence: 0 },
    );
    const systemPrompt = String(messages[0].content);
    // The decision mapping should require additional evidence, not just "اتفاق قوي"
    expect(systemPrompt).not.toContain("اتفاق قوي + نطاق عالي = 'شراء/مراجعة'");
    expect(systemPrompt).toContain("لا تعتمد على توافق النماذج وحده");
  });

  it("AMER: Rule 13 should NOT force entry conditions unconditionally", () => {
    const mockPlan: any = {
      intent: "stock_detail",
      confidence: 0.9,
      guidance_intent: null,
      entities: { symbols: ["AMER"], sector: null, timeframe: "current", reference: null },
      needs_vision_context: false,
      needs_history: false,
      needs_live_data: true,
      needs_historical_data: false,
      tools: ["get_stock"],
      clarification_needed: false,
      resolved_from: { symbol: null, message_id: null },
    };
    const messages = buildV2FinalMessages(
      "حلل سهم AMER",
      mockPlan,
      null,
      amerToolResults,
      [],
      [],
      { symbol: null, message_id: null, confidence: 0 },
    );
    const systemPrompt = String(messages[0].content);
    expect(systemPrompt).not.toContain("لا تكتفي بـ 'للمراقبة'. قدم دائماً شروطاً تنفيذية");
    expect(systemPrompt).toContain("فقط عندما يدعمها التحليل");
  });

  it("AMER: evidence block should NOT contain 'طبيعي' in profit-taking template", () => {
    const block = buildEvidenceEnginePromptBlock(amerToolResults);
    expect(block).not.toMatch(/جني أرباح فنية\s*طبيعي/);
  });

  it("AMER: should include separation rule for platform recommendations", () => {
    const mockPlan: any = {
      intent: "stock_detail",
      confidence: 0.9,
      guidance_intent: null,
      entities: { symbols: ["AMER"], sector: null, timeframe: "current", reference: null },
      needs_vision_context: false,
      needs_history: false,
      needs_live_data: true,
      needs_historical_data: false,
      tools: ["get_stock"],
      clarification_needed: false,
      resolved_from: { symbol: null, message_id: null },
    };
    const messages = buildV2FinalMessages(
      "حلل سهم AMER",
      mockPlan,
      null,
      amerToolResults,
      [],
      [],
      { symbol: null, message_id: null, confidence: 0 },
    );
    const systemPrompt = String(messages[0].content);
    expect(systemPrompt).toContain("توصية سابقة على المنصة");
    expect(systemPrompt).toContain("لا تخلطها مع تحليلك الفني الحالي");
  });
});
