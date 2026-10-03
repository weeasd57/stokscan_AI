import { evidenceViolations, safeEvidenceResponse, volumeAssessment } from "../response-evidence";
import { checkStructuredClaims } from "../claim-evidence";
import { runPipelineStream } from "../pipeline";

const market: any = { tool: "get_market", source: "database", data_type: "historical", data_time: "2026-09-28", symbols: [], data: {
    egx30: 52468.7, egx100: 24702.6, usd: 50.81,
    component_dates: { egx30: "2026-09-28", egx100: "2026-09-28", usd: "2026-08-25", movers: "2026-09-28" },
    top_gainers: [{ symbol: "TYCN", change: 17.24 }],
} };

test("daily quotes and independently stale FX cannot pass as a live screen", () => {
    const reply = "الشاشة اللحظية — جلسة 2026-09-28، EGX30 52468.7 والدولار 50.81. السيولة تتجه للأسهم الكبيرة";
    expect(evidenceViolations(reply, "الشاشة اللحظية", [market]).length).toBeGreaterThanOrEqual(3);
    const safe = safeEvidenceResponse("الشاشة اللحظية", [market]);
    expect(safe).toContain("2026-08-25");
    expect(safe).toContain("TYCN");
    expect(evidenceViolations(safe, "الشاشة اللحظية", [market])).toEqual([]);
    expect(evidenceViolations("إغلاق EGX30 بتاريخ 2026-09-28", "المؤشر كام", [market])).toEqual([]);
    expect(evidenceViolations("إغلاق EGX30 بتاريخ 2026-09-28. دخلت أموال للأسهم الكبيرة. اختلاف المؤشرات لا يثبت انتقال السيولة", "السوق", [market])).not.toEqual([]);
});

test("today request cannot silently substitute sentiment with zero supporting articles", () => {
    const news: any = { tool: "get_news", data: [{ date: "2026-09-29", headlines: [], news_count: 0, sentiment_score: 1 }] };
    expect(evidenceViolations("تم العثور على 3 سجل أخبار ومعنويات. معنويات ORWE إيجابية، عدد الأخبار 0", "أخبار ORWE اليوم", [news])).not.toEqual([]);
    expect(evidenceViolations("لم أجد خبراً موثقاً اليوم في المصادر المتاحة", "أخبار ORWE اليوم", [news])).toEqual([]);
});

test("below-average volume contradicts elevated-volume interpretation", () => {
    const stock: any = { tool: "get_stock", symbols: ["ORWE"], data: { symbol: "ORWE", vol_ratio: "0.85x" } };
    expect(volumeAssessment(.85)).toContain("أقل");
    expect(volumeAssessment(null)).toBe("غير متاح");
    expect(evidenceViolations("الحجم المرتفع يؤكد أهمية الحركة", "تحليل السيولة", [stock])).not.toEqual([]);
    expect(evidenceViolations("لو الحجم مرتفع يمكن متابعة الحركة", "تحليل السيولة", [stock])).toEqual([]);
});

test("stock quote dates are bound to each symbol clause", () => {
    const stocks: any[] = [
        { tool: "get_stock", symbols: ["SAUD"], data_time: "2026-10-01", data: { symbol: "SAUD", price: 23.11 } },
        { tool: "get_stock", symbols: ["GTHE"], data_time: "2026-09-30", data: { symbol: "GTHE", price: 4.25 } },
    ];
    const swapped = "SAUD: آخر إغلاق مسجل 23.11 بتاريخ 2026-09-30\nGTHE: آخر إغلاق مسجل 4.25 بتاريخ 2026-10-01";
    expect(evidenceViolations(swapped, "أسعار السهمين", stocks)).toHaveLength(2);
});

test("bonus-share denial is rejected and fallback preserves the corporate action", () => {
    const action: any = { tool: "get_corporate_actions", data_time: "2026-10-01", data: { corporate_actions: [
        { symbol: "ORHD", action_type: "bonus_shares", title: "توزيع أسهم مجانية", event_date: "2026-10-15" },
    ] } };
    expect(checkStructuredClaims("لا توجد أسهم مجانية لـ ORHD", [action])).not.toEqual([]);
    expect(safeEvidenceResponse("حدث ORHD", [action])).toContain("أسهم مجانية");
});

test("nested stock recommendation rejects stored return, signed mismatch and realized wording", () => {
    const stock: any = { tool: "get_stock", symbols: ["GTHE"], data: { symbol: "GTHE", recommendation: {
        has_recommendation: true, status: "open", signal: "BUY", entry_price: 5,
        current_price: 4.25, current_date: "2026-10-01", created_at: "2026-09-01", profit_loss_pct: 8,
    } } };
    expect(checkStructuredClaims("GTHE حققت ربحًا محققًا +8%.", [stock])).not.toEqual([]);
    expect(checkStructuredClaims("GTHE عائدها +15%.", [stock])).not.toEqual([]);
    expect(checkStructuredClaims("GTHE توصية مفتوحة، وحققت عائداً محققاً 15%.", [stock])).not.toEqual([]);
    expect(checkStructuredClaims("GTHE خسارتها غير المحققة 15% من سعر الدخول حتى آخر إغلاق.", [stock])).toEqual([]);
});

test("nested recommendation is not proof the user executed the signal", () => {
    const stock: any = { tool: "get_stock", symbols: ["GTHE"], data: { symbol: "GTHE", recommendation: {
        has_recommendation: true, status: "open", signal: "BUY", entry_price: 5,
        current_price: 4.25, current_date: "2026-10-01", created_at: "2026-09-01",
    } } };
    expect(checkStructuredClaims("أنت اشتريت GTHE عند 5 جنيه.", [stock], "حلل GTHE")).not.toEqual([]);
    expect(checkStructuredClaims("أنت اشتريت GTHE عند 5 جنيه.", [stock], "عندي GTHE في المحفظة")).not.toEqual([]);
    expect(checkStructuredClaims("حسب كلامك أنت اشتريت GTHE عند 5 جنيه.", [stock], "أنا اشتريت GTHE عند 5 جنيه")).toEqual([]);
    expect(checkStructuredClaims("حسب كلامك أنت بعت GTHE وربحت 20%.", [stock], "أنا بعت GTHE وربحت 20%")).toEqual([]);
});

test("nested absence permits an explicit no-recommendation statement", () => {
    const stock: any = { tool: "get_stock", symbols: ["GTHE"], data: { symbol: "GTHE", recommendation: {
        has_recommendation: false, status: "none",
    } } };
    expect(checkStructuredClaims("لا توجد توصية نشطة لسهم GTHE.", [stock])).toEqual([]);
    expect(checkStructuredClaims("توجد توصية نشطة لسهم GTHE.", [stock])).not.toEqual([]);
});

test("stream publication reviews deterministic market responses before first token", async () => {
    const events: any[] = [];
    for await (const event of runPipelineStream("الشاشة اللحظية", [], { current_symbol: null, last_symbols: [], summary: null } as any,
        null, [], {}, [], "", "", "", undefined, { mockToolsResults: { results: [market], formattedText: "" } as any, timeoutMs: 15000 })) events.push(event);
    const done = events.find(event => event.type === "done")?.data;
    expect(done.publication_review).toBeDefined();
    expect(done.response).toContain("2026-08-25");
    expect(evidenceViolations(done.response, "الشاشة اللحظية", [market])).toEqual([]);
    expect(events.filter(event => event.type === "token").map(event => event.data).join("")).toBe(done.response);
});
