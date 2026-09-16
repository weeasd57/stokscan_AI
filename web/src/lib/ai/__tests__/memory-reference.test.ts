import { describe, expect, it } from "@jest/globals";
import { retrieveRelevantMemory } from "../memory";

describe("conversation reference ordering", () => {
  it("uses the newest explicit reference instead of an older image", async () => {
    const result = await retrieveRelevantMemory(
      "حلل ده",
      { current_symbols: ["COMI"], last_image_symbols: ["GGCC"], last_reference_symbol: "COMI", last_reference_source: "text", last_reference_at: "2026-09-16T00:00:00Z", last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: "2026-09-16T00:00:00Z" },
      { current_symbol: "COMI", last_symbols: ["COMI"], summary: null } as any,
      [], null, "user", "session",
    );
    expect(result.resolved_references.symbol).toBe("COMI");
  });
});
