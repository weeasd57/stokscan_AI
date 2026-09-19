import { describe, expect, it } from "@jest/globals";
import { runPipeline, runPipelineStream } from "../pipeline";

const state = { current_symbol: null, last_symbols: [], summary: null } as any;
const plan = {
  intent: "stock_analysis",
  confidence: 1,
  entities: { symbols: ["COMI"], sector: null, timeframe: "current", reference: null },
  needs_vision_context: false,
  needs_history: false,
  needs_live_data: false,
  needs_historical_data: false,
  tools: [],
  clarification_needed: false,
  resolved_from: { symbol: null, message_id: null },
};

it("non-stream pipeline collects the same canonical done event as stream", async () => {
  const mockToolsResults = { results: [], formattedText: "" } as any;
  const options = { mockToolsResults, timeoutMs: 15_000 };
  const streamEvents: any[] = [];
  for await (const event of runPipelineStream("حلل COMI", [], state, null, [], {}, [], "", "", "", undefined, options)) {
    streamEvents.push(event);
  }
  expect(streamEvents.some((event) => event.type === "done")).toBe(true);
  const result = await runPipeline("حلل COMI", [], state, null, [], {}, [], "", "", "", undefined, options);
  expect(result.plan.intent).toBe(streamEvents.find((event) => event.type === "plan")?.data.intent);
  expect(result.response).toBe(streamEvents.find((event) => event.type === "done")?.data.response);
});

it("serves top movers from the deterministic grounded renderer", async () => {
  const mockToolsResults = {
    formattedText: "",
    results: [{
      tool: "get_market", source: "database", data_time: "2026-09-17", symbols: [], data_type: "live",
      data: { top_gainers: [{ symbol: "CRST", name: "Creast Mark", change: 10.1124 }] },
    }],
  } as any;
  const result = await runPipeline(
    "أقوى الأسهم النهارده", [], state, null, [], {}, [], "", "", "", undefined,
    { mockToolsResults, timeoutMs: 15_000 },
  );
  expect(result.response).toContain("CRST");
  expect(result.response).toContain("آخر جلسة متاحة بتاريخ 2026-09-17");
  expect(result.response).not.toContain("حركة السعر اللحظية");
  expect(result.response).not.toContain("سيولة متوسطة إلى مرتفعة");
});

it("names stocks in a market-wide accumulation answer", async () => {
  const mockToolsResults = {
    formattedText: "",
    results: [{
      tool: "get_accumulation_stocks", source: "stock_scans_summary", data_time: "2026-09-17", symbols: ["ORAS"], data_type: "live",
      data: { stocks: [{ symbol: "ORAS", name: "Orascom Construction", acc_score: 80, vol_ratio: 7.232, change_pct: 5.01 }] },
    }],
  } as any;
  const result = await runPipeline(
    "هل فيه أسهم في مناطق تجميع وايكوف ومؤشرات إيجابية؟", [], state, null, [], {}, [], "", "", "", undefined,
    { mockToolsResults, timeoutMs: 15_000 },
  );
  expect(result.response).toContain("ORAS");
  expect(result.response).toContain("درجة التجميع 80/100");
});
