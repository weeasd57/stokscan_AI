import { synchronizeMarketSnapshot } from "../market-snapshot";
import { checkContextEvidence } from "../context-evidence-gate";
import { buildFactRecords } from "../facts";
import { buildDeterministicResponse } from "../final-v2";
import { safeEvidenceResponse } from "../response-evidence";
import { extractSymbolsFromText } from "../planner";

const plan: any = { intent: "stock_analysis", entities: { symbols: ["JUFO"] }, tools: ["get_stock", "get_stock_levels"] };
const stock: any = { tool: "get_stock", source: "live_session", data_time: "2026-10-04T10:39:01.868Z", symbols: ["JUFO"], data_type: "live",
    data: { symbol: "JUFO", price: 25.8, is_live_intraday: true, rsi_14: 45.51, change_pct: "2.87%", vol_ratio: ".67x", macd: -.387,
        macd_signal: -.1689, wyckoff_status: "observed", wyckoff_phase: "neutral", acc_score: 0, dist_score: 0 } };
const level: any = { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-10-01", symbols: ["JUFO"], data_type: "historical",
    data: { symbol: "JUFO", close: 25.08, support: 24.4, resistance: 27.98, distance_from_support_pct: 2.71, position_pct: 18.99 } };
const normalized = () => synchronizeMarketSnapshot([stock, level]);

test("live quote replaces the hidden old close in every derived level metric while preserving level date", () => {
    const r = normalized()[1];
    expect(r.data.distance_from_support_pct).toBe(5.43);
    expect(r.data.distance_from_resistance_pct).toBe(8.45);
    expect(r.data.position_pct).toBe(39.11);
    expect(r.data.levels_as_of).toBe("2026-10-01");
    expect(r.data.quote_basis.as_of).toBe(stock.data_time);
    expect(r.data.trading_zone).toContain("حيادية");
    expect(level.data.close).toBe(25.08);
    expect(synchronizeMarketSnapshot(normalized())).toEqual(normalized());
});

test("old percentages and range position are rejected even when raw numbers existed in the old tool", () => {
    expect(checkContextEvidence("JUFO السعر 25.80، الدعم 24.40 بمسافة 2.71%، position_pct = 18.99%", plan, normalized()).length).toBeGreaterThanOrEqual(2);
    expect(checkContextEvidence("JUFO السعر 25.80، الدعم 24.40 بمسافة 5.43%، المقاومة 27.98 بمسافة 8.45%، position_pct = 39.11%", plan, normalized())).toEqual([]);
});

test("derived facts retain quote timestamp while support retains its historical observation timestamp", () => {
    const facts = buildFactRecords(normalized());
    expect(facts.find(f => f.field === "distance_from_support_pct")?.as_of).toBe(stock.data_time);
    expect(facts.find(f => f.field === "support")?.as_of).toBe("2026-10-01");
});

test("live prices do not make old ML scores or fallback indicators newly observed", () => {
    const dated = { ...stock, data: { ...stock.data, king_ai_score: .7,
        metric_dates: { king_ai_score: "2026-10-01", rsi_14: "2026-10-02" } } };
    const facts = buildFactRecords([dated]);
    expect(facts.find(f => f.field === "king_ai_score")?.as_of).toBe("2026-10-01");
    expect(facts.find(f => f.field === "rsi")?.as_of).toBe("2026-10-02");
    expect(facts.find(f => f.field === "price")?.as_of).toBe(stock.data_time);
});

test("the advice outage fallback still contains a stock opinion and its levels", () => {
    const reply = buildDeterministicResponse("إيه رأيك في JUFO؟", plan, normalized());
    expect(reply).toContain("JUFO");
    expect(reply).toContain("الزخم");
    expect(reply).toContain("24.40");
    expect(reply).toContain("27.98");
});

test("snapshot relationship is not evidence of a new MACD crossing, but conditional advice is permitted", () => {
    expect(checkContextEvidence("JUFO: MACD أعلى خط الإشارة، وهي إشارة تقاطع إيجابي", plan, normalized())).not.toEqual([]);
    expect(checkContextEvidence("شروط الدخول:\n- تقاطع MACD فوق خط الإشارة\n- تحسن الحجم\n\n## القراءة الحالية\nMACD تحت خط الإشارة", plan, normalized())).toEqual([]);
    expect(checkContextEvidence("MACD تقاطع إيجابي اليوم، لو تحسن الحجم نتابع", plan, normalized())).not.toEqual([]);
});

test("observed neutral Wyckoff cannot be described as missing data", () => {
    expect(checkContextEvidence("بيانات وايكوف غير متاحة. الحالة neutral والأصفار مسجلة", plan, normalized())).not.toEqual([]);
    expect(checkContextEvidence("وايكوف محايد بدرجات تجميع وتصريف صفر؛ لا توجد إشارة اتجاهية", plan, normalized())).toEqual([]);
});

test("ML differences cannot prove significance or its absence, nor a specific training cause", () => {
    expect(checkContextEvidence("الفارق ضيق وغير ذي دلالة إحصائية", plan, normalized())).not.toEqual([]);
    expect(checkContextEvidence("النموذجان يعملان على مجموعات سمات ومعايرة مختلفة", plan, normalized())).not.toEqual([]);
    expect(checkContextEvidence("لا يمكن الحكم على الدلالة الإحصائية دون اختبار موثق؛ سبب اختلاف الدرجة غير متاح", plan, normalized())).toEqual([]);
    expect(checkContextEvidence("### هل للفرق دلالة إحصائية؟\nلا يمكن الحكم على الدلالة الإحصائية دون اختبار موثق؛ سبب اختلاف الدرجة غير متاح", plan, normalized())).toEqual([]);
    expect(checkContextEvidence("### ليه KING مختلف عن EGX؟\nسبب اختلاف الدرجة غير متاح لهذه الحالة دون بيانات تفسير موثقة", plan, normalized())).toEqual([]);
    expect(checkContextEvidence("لم يجر اختبار للدلالة الإحصائية؛ لا تتوفر نتائج اختبار للدلالة الإحصائية", plan, normalized())).toEqual([]);
    expect(checkContextEvidence("لا توجد دلالة إحصائية", plan, normalized())).not.toEqual([]);
});

test("image coverage is per symbol and a partial failure cannot waive other holdings", () => {
    const image: any = { image_type: "portfolio", symbols: [{ symbol: "JUFO" }, { symbol: "ALCN" }] };
    const reply = "الصورة: لم تتوفر بيانات ALCN. محفظتك فاضية";
    const reasons = checkContextEvidence(reply, plan, normalized(), image);
    expect(reasons.some(r => r.includes("لا تستبدل"))).toBe(true);
    expect(reasons.some(r => r.includes("JUFO"))).toBe(true);
    expect(checkContextEvidence("عدد الإشارات المعروضة 2؛ JUFO وALCN", plan, normalized(), image).some(r => r.includes("مستند إلى الصورة"))).toBe(true);
    const fallback = safeEvidenceResponse("الصورة", [{ tool: "image_context", data: { ...image, image_type: "chart" } } as any]);
    expect(fallback).not.toContain("قراءة المحفظة");
});

const live: any[] = [
    { ...stock, symbols: ["CCAP"], data: { ...stock.data, symbol: "CCAP", price: 6.84, change_pct: "-.58%", rsi_14: 58.71, vol_ratio: ".40x" } },
    { ...stock, symbols: ["COMI"], data: { ...stock.data, symbol: "COMI", price: 127.7, change_pct: ".01%", rsi_14: 33.58, vol_ratio: ".22x" } },
];
const comparison: any = { tool: "get_comparison", source: "database", data_time: "2026-10-01", symbols: ["CCAP", "COMI"], data_type: "live",
    data: { comparisons: [{ symbol: "CCAP", price: 6.88, rsi_14: 61.89 }, { symbol: "COMI", price: 127.69, rsi_14: 24.36 }] } };

test.each(["مقارنة CCAP مع COMI", "قارن سيولة CCAP مع COMI"])("comparison %s uses the same snapshot and dates for both text and payload", message => {
    const tools = synchronizeMarketSnapshot([...live, comparison]);
    const p: any = { intent: "comparison", entities: { symbols: ["CCAP", "COMI"] }, tools: ["get_comparison"] };
    const reply = buildDeterministicResponse(message, p, tools)!;
    expect(reply).toContain("6.84");
    expect(reply).toContain("127.70");
    expect(reply).toContain("2026-10-04");
    expect(reply).not.toContain("61.9");
    expect(checkContextEvidence(reply, p, tools)).toEqual([]);
});

test("comparison facts keep independently observed symbol timestamps", () => {
    const altered = { ...live[1], data_time: "2026-10-04T10:40:02.000Z" };
    const facts = buildFactRecords(synchronizeMarketSnapshot([live[0], altered, comparison]));
    expect(facts.find(f => f.symbol === "COMI" && f.field === "price")?.as_of).toBe(altered.data_time);
    expect(facts.some(f => f.symbol === "SYM1" || f.symbol === "SYM2")).toBe(false);
});

test("an unknown comparison row date never borrows the other symbol's timestamp", () => {
    const mixed = { ...comparison, data_time: "", data: { comparisons: [
        { symbol: "CCAP", price: 6.88, as_of: null },
        { symbol: "COMI", price: 127.7, as_of: "2026-10-04" },
    ] } };
    const tools = synchronizeMarketSnapshot([mixed]);
    expect(synchronizeMarketSnapshot(tools)).toEqual(tools);
    const p: any = { intent: "comparison", entities: { symbols: ["CCAP", "COMI"] }, tools: ["get_comparison"] };
    const response = buildDeterministicResponse("قارن CCAP مع COMI", p, tools)!;
    expect(response.split("\n").find(l => l.includes("**CCAP**"))).toContain("غير موثق");
    const prices = buildFactRecords(tools).filter(f => f.symbol === "CCAP" && ["price", "close"].includes(f.field));
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every(f => f.as_of === null)).toBe(true);
});

test("missing or malformed timestamps do not prove one quote is newer", () => {
    const tools = synchronizeMarketSnapshot([{ ...live[0], data_time: "bad" }, { ...comparison, data_time: "bad" }]);
    expect(tools[1].data.comparisons[0].price).toBe(6.88);
    expect(tools[1].data.comparisons[0].as_of).toBeNull();
    expect(tools[1].data_time).toBe("");
});

test("a requested historical snapshot is not upgraded with an older quote", () => {
    const tools = synchronizeMarketSnapshot([{ ...live[0], data_time: "2026-09-30" }, comparison]);
    expect(tools[1].data.comparisons[0].price).toBe(6.88);
});

test("CIB is an exact alias and never a fuzzy second entity", () => {
    expect(extractSymbolsFromText("Cib", ["COMI", "CIEB"], {})).toEqual(["COMI"]);
});

test("AMES scenario: negative percentage drop, negated MACD crossover, and multi-price line pass context evidence", () => {
    const amesStock: any = {
        tool: "get_stock", source: "database", data_time: "2026-10-05", symbols: ["AMES"], data_type: "historical",
        data: {
            symbol: "AMES", price: 48.21, change_pct: "-4.25%", rsi_14: 44.51, vol_ratio: "0.41x",
            macd: -13.1371, macd_signal: -15.16835, macd_histogram: 2.03125,
        }
    };
    const amesLevel: any = {
        tool: "get_stock_levels", source: "stock_prices", data_time: "2026-10-05", symbols: ["AMES"], data_type: "historical",
        data: { symbol: "AMES", close: 48.21, support: 40.15, resistance: 82.90, distance_from_support_pct: 20.07, position_pct: 18.85 }
    };
    const amesTools = synchronizeMarketSnapshot([amesStock, amesLevel]);
    const amesPlan: any = { intent: "stock_analysis", entities: { symbols: ["AMES"] }, tools: ["get_stock", "get_stock_levels"] };

    // 1. Line with approved price and session high should not fail on the high price
    const replyPrice = "AMES: آخر إغلاق مسجل 48.21 جنيه بتاريخ 2026-10-05، بعد أن سجل أعلى سعر 50.87 جنيه.";
    expect(checkContextEvidence(replyPrice, amesPlan, amesTools)).toEqual([]);

    // 2. Negated MACD crossover description should not be rejected
    const replyMacd = "AMES: مؤشر MACD عند -13.13 أعلى من خط الإشارة -15.17، دون أي تقاطع جديد مؤكد.";
    expect(checkContextEvidence(replyMacd, amesPlan, amesTools)).toEqual([]);

    // 3. Stale price substitution is still correctly rejected
    const replyStale = "AMES: آخر إغلاق مسجل 50.35 جنيه بتاريخ 2026-10-05.";
    expect(checkContextEvidence(replyStale, amesPlan, amesTools).length).toBeGreaterThan(0);
});
