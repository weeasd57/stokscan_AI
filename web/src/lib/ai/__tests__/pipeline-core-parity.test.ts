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
