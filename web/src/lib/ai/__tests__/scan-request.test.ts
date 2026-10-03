import { bollingerTouchEvidence, explicitBollingerPreset, requestedAllScanRows, scanSessionRows, consistentDailyRange } from "../scan-request";
import { extractRequestedDate, runPipeline } from "../pipeline";
import { buildDeterministicTechnicalScanResponse } from "../final-v2";

test("Arabic touch verb must not be parsed as yesterday", () => {
    expect(extractRequestedDate("هاتلي كل الاسهم اللي لامست قاع وbollinger Band", new Date("2026-10-03T10:00:00Z"))).toBeNull();
    expect(extractRequestedDate("أسهم امس", new Date("2026-10-03T10:00:00Z"))).toBe("2026-10-02");
});

test("Bollinger scan binds the requested side and all rows", () => {
    expect(explicitBollingerPreset("هاتلي كل الاسهم اللي لامست قاع وbollinger Band")).toBe("bollinger_lower_touch");
    expect(explicitBollingerPreset("قائمة أسهم بولينجر الحد العلوي")).toBe("bollinger_upper_touch");
    expect(requestedAllScanRows("هات كل الأسهم")).toBe(true);
});

test("touch requires actual range crossing and same stock/session evidence", () => {
    const tech = { symbol: "TAQA", date: "2026-10-01", bb_lower: 16 };
    const price = { symbol: "TAQA", date: "2026-10-01", low: 15.9, high: 17 };
    expect(bollingerTouchEvidence(tech, price, "lower").matches).toBe(true);
    expect(bollingerTouchEvidence(tech, { ...price, low: 16.1 }, "lower").matches).toBe(false);
    for (const invalid of [{ ...price, date: "2026-09-30" }, { ...price, symbol: "KORA" }, { ...price, low: null }, { ...price, high: 15 }, { ...price, date: null }]) {
        expect(bollingerTouchEvidence(tech, invalid, "lower").available).toBe(false);
    }
});

test("market scan uses one session and rejects conflicting price sources", () => {
    expect(scanSessionRows([{ symbol: "TAQA", date: "2026-10-01" }, { symbol: "KORA", date: "2026-09-30" }])).toMatchObject({ date: "2026-10-01", rows: [{ symbol: "TAQA" }], excluded_count: 1 });
    expect(scanSessionRows([{ symbol: "TAQA", date: "2026-10-01" }], "2026-09-30").rows).toEqual([]);
    expect(consistentDailyRange([{ low: 16, high: 17 }, { low: 16.1, high: 17 }])).toBeUndefined();
    expect(consistentDailyRange([{ low: 16, high: 17 }, { low: "16", high: "17" }])).toEqual({ low: 16, high: 17 });
});

test("scan rendering preserves more than fifteen matches and range evidence", () => {
    const rows = Array.from({ length: 22 }, (_, i) => ({ symbol: `S${i}`, close: 17, change_pct: 0, date: "2026-10-01", bollinger_evidence: { available: true, matches: true, band: 16, low: 15.9, high: 17 } }));
    const reply = buildDeterministicTechnicalScanResponse("كل الأسهم", {} as any, [{ tool: "get_technical_scan", data_time: "2026-10-01", data: { stocks: rows, preset: "bollinger_lower_touch" } }] as any)!;
    expect(reply).toContain("S21");
    expect(reply).toContain("15.9/17");
});

test("explicit scan overrides stale stock conversation and keeps date unrequested", async () => {
    const result = await runPipeline("هاتلي كل الاسهم اللي لامست قاع وbollinger Band", [], { current_symbol: "TAQA", last_symbols: ["TAQA"] } as any,
        null, [], {}, [], "", "", "", undefined, { mockToolsResults: { results: [], formattedText: "" } as any, timeoutMs: 15000 });
    expect(result.plan.tools).toEqual(["get_technical_scan"]);
    expect(result.plan.entities.technical_preset).toBe("bollinger_lower_touch");
    expect(result.plan.entities.symbols).toEqual([]);
    expect(result.plan.entities.requested_date).toBeNull();
});

test("Bollinger preset detects various query variations flexibly", () => {
    expect(explicitBollingerPreset("اسهم لامست بولنجر")).toBeNull();
    expect(explicitBollingerPreset("هات بولنجر سفلي")).toBe("bollinger_lower_touch");
    expect(explicitBollingerPreset("لامست بولنجر")).toBeNull();
    expect(explicitBollingerPreset("اسهم لامست قاع وbollinger")).toBe("bollinger_lower_touch");
    expect(explicitBollingerPreset("bollinger band")).toBeNull();
    expect(explicitBollingerPreset("اسهم بولنجر علوي")).toBe("bollinger_upper_touch");
    expect(explicitBollingerPreset("اسهم قمة بولنجر")).toBe("bollinger_upper_touch");
    expect(explicitBollingerPreset("اسهم لامست الحد العلوي لبولنجر")).toBe("bollinger_upper_touch");
    expect(explicitBollingerPreset("ما هو مؤشر بولنجر")).toBeNull();
});

test("Bollinger parser leaves stock analysis and unsupported band conditions intact", () => {
    for (const message of ["حلل سهم TAQA باستخدام Bollinger", "حلل TAQA عند الحد السفلي لبولينجر", "هات الأسهم اللي لامست الحد العلوي والسفلي لبولينجر",
        "هات الأسهم اللي أغلقت تحت الحد السفلي لبولينجر", "هات الأسهم اللي اخترقت قمة بولينجر", "هات الأسهم في Bollinger squeeze"]) {
        expect(explicitBollingerPreset(message)).toBeNull();
    }
});

test("Unspecified opportunity request plans discovery tools without clarification refusal", async () => {
    const result = await runPipeline("افضل خمس اسهم للاستثمار حاليا", [], {} as any,
        null, [], {}, [], "", "", "", undefined, { mockToolsResults: { results: [], formattedText: "" } as any, timeoutMs: 15000 });
    expect(result.plan.clarification_needed).toBe(false);
    expect(result.plan.tools).toContain("get_recommendations");
    expect(result.plan.tools).toContain("get_market");
    expect(result.plan.tools).toContain("get_accumulation_stocks");
});


