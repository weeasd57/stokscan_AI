const { buildDeterministicPlannerResult, extractSectorFromMessage } = require("../ai/pipeline");
const { buildEvidenceEnginePromptBlock, buildV2FinalMessages, buildDailyChangeHistoryResponse } = require("../ai/final-v2");
const { validateDeterministicRules } = require("../ai/validator");

const emptySession = { current_symbol: null, last_symbols: [], summary: null };

describe("Real chat routing — AMER daily closing history (Q1)", () => {
  it("routes 'سعر إقفال سهم AMER كل يوم ... أسبوعين فاتوا' to price history", () => {
    const plan = buildDeterministicPlannerResult(
      "سعر اقفال سهم AMER كل يوم من النهارده ولغاية اسبوعين فاتوا ومتوقع يعمل ايه",
      emptySession,
    );
    expect(plan).not.toBeNull();
    expect(plan.intent).toBe("stock_analysis");
    expect(plan.entities.symbols).toContain("AMER");
    expect(plan.tools).toEqual(["get_stock", "get_stock_levels", "get_price_history"]);
  });

  it("routes an Arabic-symbol daily-history follow-up from the session stock", () => {
    const plan = buildDeterministicPlannerResult(
      "عايز اعرف سعر اقفال سهم عامر يوم بيوم",
      { current_symbol: "AMER", last_symbols: ["AMER"], summary: "تحليل AMER" },
    );
    expect(plan).not.toBeNull();
    expect(plan.entities.symbols).toContain("AMER");
    expect(plan.tools).toEqual(["get_stock", "get_stock_levels", "get_price_history"]);
  });

  it("renders a day-by-day closing table deterministically from two weeks of sessions", () => {
    const response = buildDailyChangeHistoryResponse(
      "سعر اقفال سهم AMER كل يوم من النهارده ولغاية اسبوعين فاتوا ومتوقع يعمل ايه",
      {
        intent: "stock_analysis",
        confidence: 1,
        entities: { symbols: ["AMER"], sector: null, timeframe: "historical", reference: null },
        needs_vision_context: false,
        needs_history: false,
        needs_live_data: true,
        needs_historical_data: true,
        tools: ["get_stock", "get_stock_levels", "get_price_history"],
        clarification_needed: false,
        resolved_from: { symbol: null, message_id: null },
      },
      [
        {
          tool: "get_price_history", source: "stock_prices", data_time: "2026-09-03", symbols: ["AMER"], data_type: "historical",
          data: {
            symbol: "AMER",
            latest: { close: 5.53 },
            recent_5_sessions: [
              { date: "2026-09-03", close: 5.53, change_pct: "+1.47%", high: 5.55, low: 5.45 },
              { date: "2026-09-02", close: 5.45, change_pct: "-1.09%", high: 5.6, low: 5.4 },
              { date: "2026-09-01", close: 5.51, change_pct: "+0.73%", high: 5.55, low: 5.48 },
              { date: "2026-08-31", close: 5.47, change_pct: "-0.9%", high: 5.5, low: 5.42 },
              { date: "2026-08-28", close: 5.52, change_pct: "+0.55%", high: 5.6, low: 5.5 },
            ],
            recent_15_sessions: [
              { date: "2026-09-03", close: 5.53, change_pct: "+1.47%", high: 5.55, low: 5.45 },
              { date: "2026-09-02", close: 5.45, change_pct: "-1.09%", high: 5.6, low: 5.4 },
              { date: "2026-09-01", close: 5.51, change_pct: "+0.73%", high: 5.55, low: 5.48 },
              { date: "2026-08-31", close: 5.47, change_pct: "-0.9%", high: 5.5, low: 5.42 },
              { date: "2026-08-28", close: 5.52, change_pct: "+0.55%", high: 5.6, low: 5.5 },
              { date: "2026-08-27", close: 5.49, change_pct: "-0.36%", high: 5.52, low: 5.44 },
              { date: "2026-08-26", close: 5.51, change_pct: "+1.1%", high: 5.55, low: 5.47 },
              { date: "2026-08-25", close: 5.45, change_pct: "+0.74%", high: 5.48, low: 5.41 },
              { date: "2026-08-24", close: 5.41, change_pct: "-1.28%", high: 5.5, low: 5.39 },
              { date: "2026-08-21", close: 5.48, change_pct: "+0.37%", high: 5.52, low: 5.44 },
              { date: "2026-08-20", close: 5.46, change_pct: "-0.55%", high: 5.5, low: 5.42 },
              { date: "2026-08-19", close: 5.49, change_pct: "+0.92%", high: 5.54, low: 5.45 },
              { date: "2026-08-18", close: 5.44, change_pct: "-0.18%", high: 5.47, low: 5.4 },
              { date: "2026-08-17", close: 5.45, change_pct: "+0.55%", high: 5.5, low: 5.42 },
              { date: "2026-08-14", close: 5.42, change_pct: "-0.73%", high: 5.48, low: 5.38 },
            ],
          },
        },
      ],
    );
    expect(response).toContain("التغير اليومي لسهم AMER");
    expect(response).toContain("يوم بيوم");
    expect(response).toContain("5.53");
    expect(response).not.toContain("لا توجد بيانات");
    expect(response).not.toContain("لا أستطيع تزويدك");
  });
});

describe("Real chat routing — sharia + investment horizon chain (Q2-Q4)", () => {
  it("routes the sharia weekly entry request to recommendations", () => {
    const plan = buildDeterministicPlannerResult(
      "عاوز ادخل في أسهم شريعه خلال الأسبوع ده",
      emptySession,
    );
    expect(plan).toMatchObject({ intent: "market_summary", tools: ["get_recommendations"] });
    expect(plan.entities.symbols).toEqual([]);
  });

  it("keeps the recommendation feed when the user clarifies an investment horizon (no Finance hijack)", () => {
    const session = { current_symbol: null, last_symbols: [], summary: "عاوز ادخل في أسهم شريعه خلال الأسبوع ده" };
    const plan = buildDeterministicPlannerResult("مش مضاربه استثمار لحد اول السنه مثلا", session);
    expect(plan).toMatchObject({ intent: "market_summary", tools: ["get_recommendations"] });
    expect(plan.entities.sector).toBeNull();
  });

  it("keeps the recommendation feed when asked to narrow to a couple of names", () => {
    const session = { current_symbol: null, last_symbols: [], summary: "مش مضاربه استثمار لحد اول السنه مثلا" };
    const plan = buildDeterministicPlannerResult("هم سهمين اخش فيهم ليه كل ده", session);
    expect(plan).toMatchObject({ intent: "market_summary", tools: ["get_recommendations"] });
    expect(plan.entities.symbols).toEqual([]);
  });

  it("does not classify bare 'استثمار' wording as the Finance sector", () => {
    expect(extractSectorFromMessage("مش مضاربه استثمار لحد اول السنه مثلا")).toBeNull();
    expect(extractSectorFromMessage("الاستثمار المالي")).toBe("Finance");
  });
});

describe("Real chat routing — MOIN vs COMI chain (Q5-Q7)", () => {
  it("routes the MOIN vs COMI comparison to comparison tools", () => {
    const plan = buildDeterministicPlannerResult("مقارنة MOIN مع COMI", emptySession);
    expect(plan).toMatchObject({ intent: "comparison", tools: ["get_comparison"] });
    expect(plan.entities.symbols).toEqual(["MOIN", "COMI"]);
  });

  it("routes أخبار MOIN to news", () => {
    const plan = buildDeterministicPlannerResult("أخبار MOIN اليوم", emptySession);
    expect(plan).toMatchObject({ intent: "stock_news", tools: ["get_news"], entities: { symbols: ["MOIN"] } });
  });

  it("routes تحليل السيولة MOIN to stock data", () => {
    const plan = buildDeterministicPlannerResult("تحليل السيولة لـ MOIN", emptySession);
    expect(plan).toMatchObject({ intent: "stock_analysis", tools: ["get_stock"], entities: { symbols: ["MOIN"] } });
  });
});

describe("Real chat consensus labels — evidence block from the live Finance feed", () => {
  const finToolResults = [
    { tool: "get_stock", source: "database", data_time: "2026-09-03", symbols: ["MOIN"], data_type: "live", data: { symbol: "MOIN", name: "Mohandes Insurance Co.", price: 37.4, change_pct: "+15.04%", rsi_14: 58.99, macd: 1.5526, macd_signal: 0.5, vol_ratio: "2.59x", king_ai_score: 0.623, egx_ai_score: 0.539 } },
    { tool: "get_stock", source: "database", data_time: "2026-09-03", symbols: ["MAAL"], data_type: "live", data: { symbol: "MAAL", name: "Marseilla Al Masreia", price: 9.94, change_pct: "+3.54%", rsi_14: 72.12, macd: 0.3368, macd_signal: 0.2, vol_ratio: "1.72x", king_ai_score: 0.588, egx_ai_score: 0.56 } },
    { tool: "get_stock", source: "database", data_time: "2026-09-03", symbols: ["EMFD"], data_type: "live", data: { symbol: "EMFD", name: "Emaar Misr", price: 14.38, change_pct: "+4.20%", rsi_14: 93.42, macd: 0.5265, macd_signal: 0.3, vol_ratio: "1.30x", king_ai_score: 0.588, egx_ai_score: 0.584 } },
    { tool: "get_stock", source: "database", data_time: "2026-09-03", symbols: ["MASR"], data_type: "live", data: { symbol: "MASR", name: "Madinet Masr", price: 7.98, change_pct: "+3.50%", rsi_14: 63.85, macd: -0.0145, macd_signal: 0.1, vol_ratio: "1.88x", king_ai_score: 0.422, egx_ai_score: 0.594 } },
    { tool: "get_stock_levels", source: "stock_prices", data_time: "2026-09-03", symbols: ["MOIN"], data_type: "live", data: { symbol: "MOIN", support: 30, resistance: 45 } },
  ];

  const blockFor = (sym) => {
    const block = buildEvidenceEnginePromptBlock(finToolResults);
    const lines = block.split("\n");
    const start = lines.findIndex((l) => l.includes(`STOCK: ${sym}`));
    const end = lines.findIndex((l, i) => i > start && /STOCK:|STRICT BOUNDARIES/.test(l));
    return lines.slice(start, end === -1 ? lines.length : end).join("\n");
  };

  it("labels MOIN's 8.4pt diff as اتفاق ضعيف (not قوي/متوسط)", () => {
    const section = blockFor("MOIN");
    expect(section).toContain("اتفاق ضعيف");
    expect(section).not.toContain("اتفاق قوي");
    expect(section).not.toContain("اتفاق متوسط");
  });

  it("labels MAAL's 2.8pt diff as اتفاق قوي", () => {
    expect(blockFor("MAAL")).toContain("اتفاق قوي");
  });

  it("labels EMFD's 0.4pt diff as اتفاق قوي", () => {
    expect(blockFor("EMFD")).toContain("اتفاق قوي");
  });

  it("labels MASR's 17.2pt opposite-direction diff as اتفاق منخفض جدا", () => {
    expect(blockFor("MASR")).toContain("اتفاق منخفض جداً");
  });
});

describe("Real chat validator — the exact phrases the live bot used", () => {
  const moinToolResults = [
    {
      data: {
        symbol: "MOIN", price: 37.4, change_pct: "+15.04%", rsi_14: 58.99, macd: 1.5526, macd_signal: 0.5,
        support: 30, resistance: 45, king_ai_score: 0.623, egx_ai_score: 0.539,
      },
    },
  ];

  it("flags the old MOIN line 'اتفاق متوسط → القرار: مراقبة' (true label is ضعيف)", () => {
    const reply = "MOIN: KING إيجابي متوسط (62.3%) وEGX محايد (53.9%) — اتفاق متوسط → القرار: مراقبة مع ميل إيجابي.";
    const errors = validateDeterministicRules(reply, moinToolResults, "حلل سهم MOIN");
    expect(errors.some((e) => e.includes("اتفاق") && e.includes("> 8"))).toBe(true);
  });

  it("accepts the corrected MOIN wording 'اتفاق ضعيف'", () => {
    const reply = "MOIN: KING إيجابي متوسط (62.3%) وEGX محايد (53.9%) — اتفاق ضعيف → القرار: انتظار/مراقبة.";
    const errors = validateDeterministicRules(reply, moinToolResults, "حلل سهم MOIN");
    const consensusErrors = errors.filter((e) => e.includes("اتفاق") && e.includes("غير دقيق"));
    expect(consensusErrors.length).toBe(0);
  });

  it("does not penalize a negated entry call from the live EMFD reply", () => {
    const reply = "RSI 93 عند EMFD يمنع الدخول الآن تماماً.";
    const errors = validateDeterministicRules(
      reply,
      [{ data: { symbol: "EMFD", price: 14.38, rsi_14: 93.42, support: 13, resistance: 16 } }],
      "حلل سهم EMFD",
    );
    const entryErrors = errors.filter((e) => e.includes("معايير") || e.includes("إشارة دخول غير مدعومة"));
    expect(entryErrors.length).toBe(0);
  });
});

describe("Real chat system prompt — response quality rules present", () => {
  it("bakes entry-condition restraint and recommendation separation into the system prompt", () => {
    const plan = {
      intent: "market_summary",
      confidence: 0.9,
      entities: { symbols: [], sector: null, timeframe: "current", reference: null },
      needs_vision_context: false,
      needs_history: false,
      needs_live_data: true,
      needs_historical_data: false,
      tools: ["get_recommendations"],
      clarification_needed: false,
      resolved_from: { symbol: null, message_id: null },
    };
    const messages = buildV2FinalMessages("عاوز ادخل في أسهم شريعه", plan, null, [], [], [], { symbol: null, message_id: null, confidence: 0 });
    const systemPrompt = String(messages[0].content);
    expect(systemPrompt).toContain("فقط عندما يدعمها التحليل");
    expect(systemPrompt).toContain("توصية سابقة على المنصة");
    expect(systemPrompt).toContain("لا تخلطها مع تحليلك الفني الحالي");
  });
});
