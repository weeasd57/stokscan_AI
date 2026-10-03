import { describe, expect, it } from "@jest/globals";
import { isStockFollowUpReference, retrieveRelevantMemory } from "../memory";

describe("conversation reference ordering", () => {
  const state = { current_symbol: "GGCC", last_symbols: ["GGCC"], summary: null };
  const imageSummary = {
    current_symbols: ["GGCC"], last_image_symbols: ["GGCC"], last_reference_symbol: "GGCC",
    last_reference_source: "image" as const, last_reference_at: "2026-09-16T00:00:00Z",
    last_topic: "chart", open_references: [], last_data_date: null, last_vision_context: null,
    updated_at: "2026-09-16T00:00:00Z"
  };
  const resolve = (message: string, summary: any = imageSummary, session: any = state, history: any[] = [], supabase: any = null) =>
    retrieveRelevantMemory(message, summary, session, history, supabase, "user", "session");

  it("uses the newest explicit reference instead of an older image", async () => {
    const result = await retrieveRelevantMemory(
      "حلل ده",
      { current_symbols: ["COMI"], last_image_symbols: ["GGCC"], last_reference_symbol: "COMI", last_reference_source: "text", last_reference_at: "2026-09-16T00:00:00Z", last_topic: null, open_references: [], last_data_date: null, last_vision_context: null, updated_at: "2026-09-16T00:00:00Z" },
      { current_symbol: "COMI", last_symbols: ["COMI"], summary: null } as any,
      [], null, "user", "session",
    );
    expect(result.resolved_references.symbol).toBe("COMI");
  });

  it("follows the latest named user turn across a stale image and an intervening implicit turn", async () => {
    const history = [
      { role: "user", content: "حلل GGCC" },
      { role: "assistant", content: "GGCC مقاومته 5" },
      { role: "user", content: "طيب حلل سهم فوري" },
      { role: "assistant", content: "FWRY السعر 9. وقارنته مع COMI و GGCC" },
      { role: "user", content: "هل ادخل" },
      { role: "assistant", content: "انتظر تأكيد الاختراق" },
    ];
    const result = await resolve("وقف الخسارة كام", imageSummary, state, history);
    expect(result.resolved_references).toEqual({ symbol: "FWRY", message_id: null, confidence: 0.95 });
  });

  it.each(["الهدف كام", "حلل ده", "هل ادخل"])("does not choose the first stock after a comparison: %s", async message => {
    const result = await resolve(message, { ...imageSummary, current_symbols: ["COMI", "FWRY"], last_reference_symbol: "COMI", last_reference_source: "text" },
      { current_symbol: "COMI", last_symbols: ["COMI", "FWRY"], summary: null },
      [{ role: "user", content: "قارن COMI و FWRY" }, { role: "assistant", content: "COMI أقوى من FWRY" }]);
    expect(result.resolved_references.symbol).toBeNull();
    expect(result.resolved_references.requires_clarification).toBe(true);
    expect(result.resolved_references.candidates).toEqual(["COMI", "FWRY"]);
  });

  it("does not treat the first image symbol as the user-selected stock", async () => {
    const result = await resolve("حلل ده", { ...imageSummary, current_symbols: [], last_image_symbols: ["COMI", "FWRY"], last_reference_symbol: "COMI" },
      { current_symbol: "COMI", last_symbols: ["COMI", "FWRY"], summary: null });
    expect(result.resolved_references.symbol).toBeNull();
  });

  it("does not choose an arbitrary last symbol when no stock is active", async () => {
    const result = await resolve("تارجت", null, { current_symbol: null, last_symbols: ["COMI", "FWRY"], summary: null });
    expect(result.resolved_references.symbol).toBeNull();
    expect(result.resolved_references.requires_clarification).toBe(true);
  });

  it("carries ambiguous candidates from a plural named-stock turn", async () => {
    const result = await resolve("الهدف كام", null, { current_symbol: "COMI", last_symbols: ["COMI", "FWRY"], summary: null },
      [{ role: "user", content: "حلل اسهم COMI و FWRY" }]);
    expect(result.resolved_references).toMatchObject({ symbol: null, confidence: 0, requires_clarification: true, candidates: ["COMI", "FWRY"] });
  });

  it("lets a new explicit user reference narrow a multi-stock image", async () => {
    const result = await resolve("متى اشتري", { ...imageSummary, current_symbols: ["COMI", "FWRY"], last_image_symbols: ["COMI", "FWRY"] }, state,
      [{ role: "user", content: "حلل COMI و FWRY" }, { role: "user", content: "خلينا في فوري" }]);
    expect(result.resolved_references.symbol).toBe("FWRY");
  });

  it.each(["السهم ده فوري مستهدفه كام", "حلل سهم فوري ده", "حلل سهم زيد الجديد ده", "قارن سهم فوري مع COMI"])("does not add the stale stock to a newly named request: %s", async message => {
    const from = jest.fn();
    const result = await resolve(message, imageSummary, state, [], { from });
    expect(result.resolved_references.symbol).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["يعني ايه وقف الخسارة", "ما معنى الهدف ده", "الهدف من الاستثمار ايه", "السوق ده هدفه كام", "الهدف بتاع المؤشر كام", "متى اشتري عربية", "what is stop loss?"])("does not scope a definition or other topic to a stock: %s", async message => {
    const result = await resolve(message);
    expect(result.resolved_references.symbol).toBeNull();
    expect(result.resolved_references.confidence).toBe(0);
  });

  it("does not revive stock context after a market topic change", async () => {
    const result = await resolve("رايك ايه فيه", imageSummary, state,
      [{ role: "user", content: "حلل GGCC" }, { role: "user", content: "اخبار السوق ايه" }]);
    expect(result.resolved_references.symbol).toBeNull();
  });

  it("does not revive a known stock after the user named an unresolved company", async () => {
    const result = await resolve("هل ادخل", imageSummary, state,
      [{ role: "user", content: "حلل GGCC" }, { role: "user", content: "حلل سهم زيد الجديد" }]);
    expect(result.resolved_references.symbol).toBeNull();
  });

  it("can supply the old stock as the other side of an explicit comparison", async () => {
    const result = await resolve("قارن ده مع COMI", imageSummary, state,
      [{ role: "user", content: "حلل GGCC" }]);
    expect(result.resolved_references.symbol).toBe("GGCC");
  });

  it("uses the active text stock when only a legacy image list remains", async () => {
    const result = await resolve("حلل ده", { ...imageSummary, current_symbols: ["COMI"], last_reference_symbol: null, last_reference_source: null },
      { current_symbol: "COMI", last_symbols: ["COMI", "GGCC"], summary: null });
    expect(result.resolved_references.symbol).toBe("COMI");
  });

  it("exposes the same followup classification for the pipeline fallback guard", () => {
    expect(isStockFollowUpReference("متى اشتري")).toBe(true);
    expect(isStockFollowUpReference("الهدف كام")).toBe(true);
    expect(isStockFollowUpReference("حلل ده")).toBe(true);
    expect(isStockFollowUpReference("ما معنى وقف الخسارة")).toBe(false);
    expect(isStockFollowUpReference("متى اشتري عربية")).toBe(false);
  });
});
