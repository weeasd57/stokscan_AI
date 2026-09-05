import { describe, it, expect } from "@jest/globals";
import {
  validateResponse,
  validateDeterministicRules,
  isVerifiableDerivedMetric,
  extractNumbers,
  autoFixNumbers,
} from "../validator";
import {
  buildEvidenceEnginePromptBlock,
  buildV2FinalMessages,
} from "../final-v2";
import type { ToolResult, IntentPlan, FactSnapshot } from "../types";

const aalrToolResults = [
  {
    data: {
      symbol: "AALR",
      price: 310,
      rsi_14: 67.88,
      support: 290,
      resistance: 325.5,
    },
  },
];

describe("validator deterministic rules & semantic verification", () => {
  it("extracts Arabic-Indic numerals correctly", () => {
    const numbers = extractNumbers("داخل من ١٠.٨٦ بسعر ٧.٢٣");
    expect(numbers).toContain(10.86);
    expect(numbers).toContain(7.23);
  });

  it("exempts user-provided Arabic-Indic numbers from claim violations", () => {
    const reply = "أنت ذكرت أنك دخلت بسعر 10.86 جنيه، والسعر الحالي 310 جنيه.";
    const errors = validateDeterministicRules(
      reply,
      aalrToolResults,
      "داخل من ١٠.٨٦ ؟",
    );
    expect(errors).toEqual([]);
  });

  it("accepts a correct reply with decimal RSI and resistance values", () => {
    const reply =
      "سهم AALR يتداول عند سعر 310 جنيه. مؤشر القوة النسبية RSI يسجل 67.88 مقترباً من مناطق التشبع الشرائي. المقاومة الرئيسية عند 325.5 والدعم عند 290.";
    const errors = validateDeterministicRules(
      reply,
      aalrToolResults,
      "حلل سهم AALR",
    );
    expect(errors).toEqual([]);
  });

  it("accepts Arabic decimal separator in values", () => {
    const reply = "مؤشر RSI لسهم AALR عند 67٫88 والمقاومة عند 325٫5.";
    const errors = validateDeterministicRules(
      reply,
      aalrToolResults,
      "حلل سهم AALR",
    );
    expect(errors).toEqual([]);
  });

  it("accepts rounded RSI and resistance values", () => {
    const reply = "RSI لسهم AALR قرب 68 بينما المقاومة عند 326.";
    const errors = validateDeterministicRules(
      reply,
      aalrToolResults,
      "حلل سهم AALR",
    );
    expect(errors).toEqual([]);
  });

  it("does not flag non-RSI numbers (>100) inside an RSI sentence", () => {
    const reply =
      "مؤشر RSI يظهر تشبع شرائي لسهم AALR الذي يتداول قرب 310 جنيه.";
    const errors = validateDeterministicRules(
      reply,
      aalrToolResults,
      "حلل سهم AALR",
    );
    expect(errors).toEqual([]);
  });

  it("still detects a genuinely wrong RSI claim", () => {
    const reply = "مؤشر القوة النسبية RSI لسهم AALR يسجل 42 فقط.";
    const errors = validateDeterministicRules(
      reply,
      aalrToolResults,
      "حلل سهم AALR",
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("verifies mathematically derived formulas accurately", () => {
    const facts = {
      price: 120.78,
      support: 45.15,
      resistance: 144.94,
      rsi: 54.31,
    };
    expect(isVerifiableDerivedMetric(167.51, facts)).toBe(true);
    expect(isVerifiableDerivedMetric(16.67, facts)).toBe(true);
    expect(isVerifiableDerivedMetric(93.45, facts)).toBe(false);
  });

  it("safely auto-fixes exact current price rounding when strictly bound", () => {
    const reply = "السعر الحالي هو 120.7 جنيه لسهم AMES.";
    const amesFacts = [{ data: { symbol: "AMES", price: 120.78 } }];
    const fixed = autoFixNumbers(reply, amesFacts);
    expect(fixed).toContain("120.78");
  });

  it("validateResponse passes a fully correct reply with derived percentages", () => {
    const reply =
      "سهم AALR يتداول حالياً عند سعر 310 جنيه، ومؤشر القوة النسبية يساوي 67.88 مما يشير إلى قوة شرائية واضحة، بينما يقع الدعم الرئيسي عند 290 جنيه وتتمركز المقاومة عند 325.5 جنيه بمسافة 4.76% من السعر.";
    const liveData = JSON.stringify(aalrToolResults[0].data);
    const result = validateResponse(
      reply,
      liveData,
      ["AALR"],
      aalrToolResults,
      "حلل سهم AALR",
    );
    expect(result.deterministicErrors).toEqual([]);
    expect(result.suspiciousNumbers).toEqual([]);
    expect(result.isValid).toBe(true);
  });
});

describe("validator: Evidence Verifier Checks 1-4", () => {
  const scanToolResults = [
    {
      tool: "get_distribution_stocks",
      data: {
        stocks: [
          {
            symbol: "AALR",
            dist_score: 0,
            acc_score: 0,
            wyckoff_phase: "neutral",
            signal: "neutral",
          },
        ],
      },
    },
  ];

  const accScanToolResults = [
    {
      tool: "get_accumulation_stocks",
      data: {
        stocks: [
          {
            symbol: "AALR",
            dist_score: 0,
            acc_score: 80,
            wyckoff_phase: "accumulation",
            signal: "accumulation",
          },
        ],
      },
    },
  ];

  const distScanToolResults = [
    {
      tool: "get_distribution_stocks",
      data: {
        stocks: [
          {
            symbol: "AALR",
            dist_score: 75,
            acc_score: 10,
            wyckoff_phase: "distribution",
            signal: "distribution",
          },
        ],
      },
    },
  ];

  it("CHECK 1: rejects MACD signal line claim when macd_signal is null", () => {
    const reply = "سهم AALR فوق خط الإشارة لأن MACD إيجابي.";
    const errors = validateDeterministicRules(reply, aalrToolResults);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("خط الإشارة"))).toBe(true);
  });

  it("CHECK 2: rejects distribution claim when no evidence exists", () => {
    const reply = "سهم AALR في مرحلة تصريف.";
    const errors = validateDeterministicRules(reply, [
      ...aalrToolResults,
      ...scanToolResults,
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("توزيعية"))).toBe(true);
  });

  it("CHECK 2: rejects distribution claim when dist_score=0 and phase=neutral", () => {
    const reply = "سيولة توزيعية لسهم AALR.";
    const errors = validateDeterministicRules(reply, [
      ...aalrToolResults,
      ...scanToolResults,
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("CHECK 3: rejects accumulation claim when no evidence exists", () => {
    const reply = "سيولة تجميعية لسهم AALR.";
    const errors = validateDeterministicRules(reply, [
      ...aalrToolResults,
      ...scanToolResults,
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("تجميعية"))).toBe(true);
  });

  it("CHECK 3: accepts accumulation claim when acc_score>0 and phase=accumulation", () => {
    const reply = "سهم AALR في مرحلة تجميع.";
    const errors = validateDeterministicRules(reply, [
      ...aalrToolResults,
      ...accScanToolResults,
    ]);
    expect(errors.filter((e) => e.includes("تجميعية")).length).toBe(0);
  });

  it("CHECK 4: rejects phase conflict - claiming distribution when data shows accumulation", () => {
    const reply = "سهم AALR في مرحلة تصريف.";
    const errors = validateDeterministicRules(reply, [
      ...aalrToolResults,
      ...accScanToolResults,
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("تعارض"))).toBe(true);
  });

  it("CHECK 4: rejects phase conflict - claiming accumulation when data shows distribution", () => {
    const reply = "سهم AALR في مرحلة تجميع.";
    const errors = validateDeterministicRules(reply, [
      ...aalrToolResults,
      ...distScanToolResults,
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("تعارض"))).toBe(true);
  });

  it("accepts correct distribution claim when evidence is present", () => {
    const reply = "سهم AALR في مرحلة تصريف.";
    const errors = validateDeterministicRules(reply, [
      ...aalrToolResults,
      ...distScanToolResults,
    ]);
    expect(
      errors.filter((e) => e.includes("توزيعية") || e.includes("تعارض")).length,
    ).toBe(0);
  });

  it("rejects implicit inference 'ضغط بيعي' without evidence", () => {
    const reply = "حجم تداول سهم AALR أعلى من المتوسط مما يشير إلى ضغط بيعي.";
    const errors = validateDeterministicRules(reply, aalrToolResults);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("توزيعية"))).toBe(true);
  });

  it("rejects implicit inference 'نشاط شرائي' without evidence", () => {
    const reply = "حجم تداول سهم AALR أعلى من المتوسط مما يشير إلى نشاط شرائي.";
    const errors = validateDeterministicRules(reply, aalrToolResults);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("تجميعية"))).toBe(true);
  });

  it("handles multi-symbol replies correctly", () => {
    const multiToolResults = [
      {
        data: {
          symbol: "AALR",
          price: 310,
          rsi_14: 67.88,
          support: 290,
          resistance: 325.5,
        },
      },
      {
        data: {
          symbol: "AMES",
          price: 120.78,
          rsi_14: 54.31,
          support: 100,
          resistance: 140,
        },
      },
    ];
    const reply = "سهم AALR يتداول عند 310، وسهم AMES يتداول عند 120.78.";
    const errors = validateDeterministicRules(reply, multiToolResults);
    expect(errors).toEqual([]);
  });
});

describe("validator: Evidence Verifier Checks 5-7", () => {
  it("CHECK 5: rejects selling-pressure inference from high vol_ratio without distribution evidence", () => {
    const toolResults = [
      { data: { symbol: "AALR", price: 310, vol_ratio: 1.69, macd: 0.009 } },
    ];
    const reply =
      "نسبة الحجم لسهم AALR مرتفعة بـ 1.69x مما يدل على ضغط بيعي نشط.";
    const errors = validateDeterministicRules(
      reply,
      toolResults,
      "حلل سهم AALR",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.includes("ضغط بيعي") || e.includes("توزيعية")),
    ).toBe(true);
  });

  it("CHECK 5: accepts 'نشط' (active) volume without selling-pressure inference", () => {
    const toolResults = [
      { data: { symbol: "AALR", price: 310, vol_ratio: 1.69, macd: 0.009 } },
    ];
    const reply =
      "نسبة الحجم لسهم AALR مرتفعة بـ 1.69x، أي أن التداول نشط فوق المتوسط.";
    const errors = validateDeterministicRules(
      reply,
      toolResults,
      "حلل سهم AALR",
    );
    expect(
      errors.some((e) => e.includes("ضغط بيعي") || e.includes("توزيعية")),
    ).toBe(false);
  });

  it("CHECK 6: rejects large ML advantage claim when score difference is <= 1.0 point", () => {
    const toolResults = [
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          king_ai_score: 0.583,
          egx_ai_score: 0.67,
        },
      },
      {
        data: {
          symbol: "TMGH",
          price: 22.3,
          king_ai_score: 0.578,
          egx_ai_score: 0.667,
        },
      },
    ];
    const reply = "KING AI يتفوق على TMGH بتفوق كبير وميزة واضحة في النموذج.";
    const errors = validateDeterministicRules(
      reply,
      toolResults,
      "قارن COMI و TMGH",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("نقاط ML"))).toBe(true);
  });

  it("CHECK 6: accepts large ML advantage claim when score difference is > 1.0 point", () => {
    const toolResults = [
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          king_ai_score: 0.8,
          egx_ai_score: 0.67,
        },
      },
      {
        data: {
          symbol: "TMGH",
          price: 22.3,
          king_ai_score: 0.58,
          egx_ai_score: 0.667,
        },
      },
    ];
    const reply = "KING AI يتفوق على TMGH بتفوق كبير وميزة واضحة في النموذج.";
    const errors = validateDeterministicRules(
      reply,
      toolResults,
      "قارن COMI و TMGH",
    );
    const mlErrors = errors.filter((e) => e.includes("نقاط ML"));
    expect(mlErrors.length).toBe(0);
  });

  it("CHECK 7: rejects bullish MACD claim when macd_signal is null and MACD is slightly positive", () => {
    const toolResults = [
      { data: { symbol: "COMI", price: 15.5, macd: 0.009, macd_signal: null } },
    ];
    const reply =
      "MACD إيجابي فوق خط الصفر مما يدل على إشارة صاعدة قوية لسهم COMI.";
    const errors = validateDeterministicRules(
      reply,
      toolResults,
      "حلل سهم COMI",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.includes("خط الإشارة") || e.includes("signal")),
    ).toBe(true);
  });

  it("CHECK 7: accepts neutral MACD description when macd_signal is null", () => {
    const toolResults = [
      { data: { symbol: "COMI", price: 15.5, macd: 0.009, macd_signal: null } },
    ];
    const reply = "MACD لسهم COMI يسجل 0.009 نقطة، محايد تقريباً.";
    const errors = validateDeterministicRules(
      reply,
      toolResults,
      "حلل سهم COMI",
    );
    expect(
      errors.filter((e) => e.includes("خط الإشارة") || e.includes("إيجابية"))
        .length,
    ).toBe(0);
  });

  it("CHECK 5+6: COMI vs TMGH scenario — selling pressure + small ML delta both rejected", () => {
    const toolResults = [
      {
        data: {
          symbol: "TMGH",
          price: 22.3,
          macd: 0.9691,
          macd_signal: null,
          vol_ratio: 1.69,
          king_ai_score: 0.578,
          egx_ai_score: 0.667,
        },
      },
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          macd: 0.009,
          macd_signal: null,
          vol_ratio: 0.85,
          king_ai_score: 0.583,
          egx_ai_score: 0.67,
        },
      },
    ];
    const reply =
      "TMGH يظهر نسبة حجم 1.69x مما يدل على ضغط بيعي نشط، بينما KING AI يتفوق على COMI بتفوق كبير.";
    const errors = validateDeterministicRules(
      reply,
      toolResults,
      "قارن TMGH و COMI",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.includes("ضغط بيعي") || e.includes("توزيعية")),
    ).toBe(true);
    expect(errors.some((e) => e.includes("نقاط ML"))).toBe(true);
  });
});

describe("validator: Evidence Verifier CHECK 8 — false 'آمن'/'قوي' with neutral RSI", () => {
  const afmcToolResults = [
    {
      data: {
        symbol: "AFMC",
        price: 8.5,
        rsi_14: 52.88,
        macd: 0.05,
        macd_signal: null,
        vol_ratio: 0.32,
        sma_50: 8.2,
        sma_200: 7.8,
        support: 8.0,
        resistance: 9.2,
        king_ai_score: 0.557,
        egx_ai_score: 0.397,
      },
    },
  ];

  it("CHECK 8: rejects 'آمن' claim when RSI is in neutral range (40-70)", () => {
    const reply = "السهم AFMC في منطقة زخم صاعد إيجابي وآمن مع RSI 52.88.";
    const errors = validateDeterministicRules(
      reply,
      afmcToolResults,
      "حلل سهم AFMC",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("آمن") && e.includes("محايد"))).toBe(
      true,
    );
  });

  it("CHECK 8: rejects 'قوي' claim when RSI is in neutral range", () => {
    const reply = "RSI 52.88 يدل على إشارة قوية للسهم AFMC.";
    const errors = validateDeterministicRules(
      reply,
      afmcToolResults,
      "حلل سهم AFMC",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some(
        (e) => e.includes("آمن") || e.includes("قوي") || e.includes("محايد"),
      ),
    ).toBe(true);
  });

  it("CHECK 8: rejects 'إيجابية واضحة' claim when RSI is neutral", () => {
    const reply = "السهم AFMC يوضح إيجابية واضحة مع RSI 52.88.";
    const errors = validateDeterministicRules(
      reply,
      afmcToolResults,
      "حلل سهم AFMC",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some(
        (e) => e.includes("آمن") || e.includes("قوي") || e.includes("محايد"),
      ),
    ).toBe(true);
  });

  it("CHECK 8: accepts neutral RSI description when RSI is in 40-70 range", () => {
    const reply =
      "RSI لسهم AFMC عند 52.88 يعني زخم محايد يميل للإيجابية، لكن ضعف الحجم يجعل الإشارة غير مؤكدة.";
    const errors = validateDeterministicRules(
      reply,
      afmcToolResults,
      "حلل سهم AFMC",
    );
    const check8Errors = errors.filter(
      (e) => e.includes("آمن") && e.includes("RSI"),
    );
    expect(check8Errors.length).toBe(0);
  });

  it("CHECK 8: does not flag strong-word claims when RSI >= 70 (overbought)", () => {
    const highRsiToolResults = [
      {
        data: {
          symbol: "TEST",
          price: 310,
          rsi_14: 78.5,
          macd: 0.5,
          macd_signal: null,
          vol_ratio: 1.5,
        },
      },
    ];
    const reply = "RSI 78.5 يدل على زخم قوي وآمن للسهم TEST.";
    const errors = validateDeterministicRules(
      reply,
      highRsiToolResults,
      "حلل سهم TEST",
    );
    const check8Errors = errors.filter(
      (e) => e.includes("آمن") && e.includes("محايد"),
    );
    expect(check8Errors.length).toBe(0);
  });

  it("CHECK 8: does not flag strong-word claims when RSI <= 30 (oversold)", () => {
    const lowRsiToolResults = [
      {
        data: {
          symbol: "TEST",
          price: 310,
          rsi_14: 25.0,
          macd: -0.5,
          macd_signal: null,
          vol_ratio: 1.5,
        },
      },
    ];
    const reply = "RSI 25.0 يدل على إشارة قوية للسهم TEST.";
    const errors = validateDeterministicRules(
      reply,
      lowRsiToolResults,
      "حلل سهم TEST",
    );
    const check8Errors = errors.filter(
      (e) => e.includes("آمن") && e.includes("محايد"),
    );
    expect(check8Errors.length).toBe(0);
  });

  it("CHECK 8: does not flag negated 'آمن' claim with neutral RSI", () => {
    const reply = "لا يوجد مستوى آمن لسهم AFMC عند RSI 52.88.";
    const errors = validateDeterministicRules(
      reply,
      afmcToolResults,
      "حلل سهم AFMC",
    );
    const check8Errors = errors.filter(
      (e) => e.includes("آمن") && e.includes("RSI"),
    );
    expect(check8Errors.length).toBe(0);
  });

  it("CHECK 8: does not flag negated 'قوي' claim with neutral RSI", () => {
    const reply = "ليس لدى السهم AFMC إشارة قوية عند RSI 52.88.";
    const errors = validateDeterministicRules(
      reply,
      afmcToolResults,
      "حلل سهم AFMC",
    );
    const check8Errors = errors.filter(
      (e) => e.includes("آمن") && e.includes("RSI"),
    );
    expect(check8Errors.length).toBe(0);
  });

  it("CHECK 8: does not flag negated 'إيجابية واضحة' claim with neutral RSI", () => {
    const reply = "لا توجد إيجابية واضحة لسهم AFMC مع RSI 52.88.";
    const errors = validateDeterministicRules(
      reply,
      afmcToolResults,
      "حلل سهم AFMC",
    );
    const check8Errors = errors.filter(
      (e) => e.includes("آمن") && e.includes("RSI"),
    );
    expect(check8Errors.length).toBe(0);
  });
});

describe("validator: Model Consensus rules in system prompt", () => {
  it("includes Model Consensus section rules in buildV2FinalMessages system prompt", () => {
    const mockPlan: IntentPlan = {
      intent: "comparison",
      confidence: 0.95,
      guidance_intent: null,
      entities: {
        symbols: ["COMI", "TMGH"],
        sector: null,
        timeframe: "current",
        reference: null,
      },
      needs_vision_context: false,
      needs_history: false,
      needs_live_data: true,
      needs_historical_data: false,
      tools: ["get_stock"],
      clarification_needed: false,
      resolved_from: { symbol: null, message_id: null },
    };
    const mockToolResults: ToolResult[] = [
      {
        tool: "get_stock",
        source: "database",
        data_time: "2026-08-17",
        data_type: "live",
        symbols: ["COMI"],
        data: {
          symbol: "COMI",
          price: 15.5,
          rsi_14: 52.88,
          macd: 0.009,
          macd_signal: null,
          vol_ratio: 0.85,
          king_ai_score: 0.583,
          egx_ai_score: 0.67,
        },
      },
      {
        tool: "get_stock",
        source: "database",
        data_time: "2026-08-17",
        data_type: "live",
        symbols: ["TMGH"],
        data: {
          symbol: "TMGH",
          price: 22.3,
          rsi_14: 48.5,
          macd: 0.9691,
          macd_signal: null,
          vol_ratio: 1.69,
          king_ai_score: 0.578,
          egx_ai_score: 0.667,
        },
      },
    ];
    const mockFacts: FactSnapshot[] = [];
    const messages = buildV2FinalMessages(
      "قارن COMI و TMGH",
      mockPlan,
      null,
      mockToolResults,
      mockFacts,
      [],
      { symbol: null, message_id: null, confidence: 0 },
    );
    const systemPrompt = String(messages[0].content);
    expect(systemPrompt).toContain("توافق");
    expect(systemPrompt).toContain("رأي النم");
    expect(systemPrompt).toContain("القرار الفني العام");
    expect(systemPrompt).toContain("تفسير كل نموذج");
    expect(systemPrompt).toContain("اتفاق ضعيف");
  });
});

describe("validator: Metric value matching for MACD, vol_ratio, ML scores", () => {
  it("accepts MACD value mentioned in reply when it exists in source data", () => {
    const toolResults = [
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          rsi_14: 52.88,
          macd: 0.27,
          macd_signal: 0.15,
          vol_ratio: 0.85,
          king_ai_score: 0.583,
          egx_ai_score: 0.67,
        },
      },
    ];
    const reply = "MACD لسهم COMI يسجل 0.27 مستوى، محايد تقريباً.";
    const errors = validateDeterministicRules(reply, toolResults, "حلل سهم COMI");
    const detErrors = errors.filter(
      (e) =>
        e.includes("آمن") ||
        e.includes("قوي") ||
        e.includes("توزيعية") ||
        e.includes("تجميعية")
    );
    expect(detErrors.length).toBe(0);
  });

  it("accepts vol_ratio value mentioned in reply when it exists in source data", () => {
    const toolResults = [
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          rsi_14: 52.88,
          macd: 0.27,
          macd_signal: null,
          vol_ratio: 1.1,
          king_ai_score: 0.583,
          egx_ai_score: 0.67,
        },
      },
    ];
    const reply = "نسبة الحجم لسهم COMI 1.1x فوق المتوسط.";
    const errors = validateDeterministicRules(reply, toolResults, "حلل سهم COMI");
    const detErrors = errors.filter(
      (e) =>
        e.includes("توزيعية") ||
        e.includes("تجميعية") ||
        e.includes("توزيع") ||
        e.includes("تجميع")
    );
    expect(detErrors.length).toBe(0);
  });

  it("accepts ML score values mentioned in comparison reply", () => {
    const toolResults = [
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          rsi_14: 52.88,
          macd: 0.27,
          macd_signal: null,
          vol_ratio: 0.85,
          king_ai_score: 0.583,
          egx_ai_score: 0.67,
        },
      },
      {
        data: {
          symbol: "TMGH",
          price: 22.3,
          rsi_14: 48.5,
          macd: 1.06,
          macd_signal: null,
          vol_ratio: 1.1,
          king_ai_score: 0.578,
          egx_ai_score: 0.667,
        },
      },
    ];
    const reply =
      "KING AI لسهم COMI 58.3% ولـ TMGH 57.8%، EGX AI COMI 67.0% و TMGH 66.7%. الفرق في KING AI هو 0.5 نقطة.";
    const result = validateResponse(
      reply,
      JSON.stringify(toolResults[0].data) + JSON.stringify(toolResults[1].data),
      ["COMI", "TMGH"],
      toolResults,
      "قارن COMI و TMGH"
    );
    expect(result.suspiciousNumbers).toEqual([]);
  });

  it("accepts cross-symbol MACD difference in comparison reply", () => {
    const toolResults = [
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          macd: 0.27,
          macd_signal: null,
          vol_ratio: 0.85,
        },
      },
      {
        data: {
          symbol: "TMGH",
          price: 22.3,
          macd: 1.06,
          macd_signal: null,
          vol_ratio: 1.1,
        },
      },
    ];
    const reply = "الفرق في MACD بين COMI و TMGH هو 0.79 نقطة.";
    const result = validateResponse(
      reply,
      JSON.stringify(toolResults[0].data) + JSON.stringify(toolResults[1].data),
      ["COMI", "TMGH"],
      toolResults,
      "قارن COMI و TMGH"
    );
    expect(result.suspiciousNumbers).toEqual([]);
  });

  it("accepts ML score difference in comparison reply", () => {
    const toolResults = [
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          king_ai_score: 0.583,
          egx_ai_score: 0.67,
        },
      },
      {
        data: {
          symbol: "TMGH",
          price: 22.3,
          king_ai_score: 0.578,
          egx_ai_score: 0.667,
        },
      },
    ];
    const reply = "الفرق في KING AI بينهما 0.5 نقطة.";
    const result = validateResponse(
      reply,
      JSON.stringify(toolResults[0].data) + JSON.stringify(toolResults[1].data),
      ["COMI", "TMGH"],
      toolResults,
      "قارن COMI و TMGH"
    );
    expect(result.suspiciousNumbers).toEqual([]);
  });

  it("rejects ML score difference that does not match source data", () => {
    const toolResults = [
      {
        data: {
          symbol: "COMI",
          price: 15.5,
          king_ai_score: 0.583,
          egx_ai_score: 0.67,
        },
      },
      {
        data: {
          symbol: "TMGH",
          price: 22.3,
          king_ai_score: 0.578,
          egx_ai_score: 0.667,
        },
      },
    ];
    const reply = "الفرق في KING AI بينهما 7.5 نقطة.";
    const result = validateResponse(
      reply,
      JSON.stringify(toolResults[0].data) + JSON.stringify(toolResults[1].data),
      ["COMI", "TMGH"],
      toolResults,
      "قارن COMI و TMGH"
    );
    expect(result.suspiciousNumbers.length).toBeGreaterThan(0);
    expect(result.suspiciousNumbers).toContain("7.5");
  });

  it("accepts ML score values presented as percentages (58.28) when source has 0.5828", () => {
    const toolResults = [
      {
        data: {
          symbol: "AFMC",
          price: 8.5,
          rsi_14: 52.88,
          king_ai_score: 0.5828,
          egx_ai_score: 0.4654,
        },
      },
      {
        data: {
          symbol: "AALR",
          price: 310,
          rsi_14: 67.88,
          king_ai_score: 0.5567,
          egx_ai_score: 0.3967,
        },
      },
    ];
    const reply =
      "KING AI لسهم AFMC 58.28% ولألر 55.67%، EGX AI AFMC 46.54% وAALR 39.67%. الفرق بين KING AI نقاط.";
    const result = validateResponse(
      reply,
      JSON.stringify(toolResults[0].data) + JSON.stringify(toolResults[1].data),
      ["AFMC", "AALR"],
      toolResults,
      "قارن AFMC و AALR"
    );
    expect(result.suspiciousNumbers).toEqual([]);
  });
});

describe("validator: autoFixNumbers derived metrics", () => {
  it("fixes derived percentage from support", () => {
    const reply = "السهم ارتفع حوالي 7.59% من مستوى الدعم.";
    const facts = [{ data: { symbol: "TEST", price: 310, support: 288.54 } }];
    const fixed = autoFixNumbers(reply, facts);
    // ((310 - 288.54) / 288.54) * 100 = 7.4376% ≈ 7.44%
    expect(fixed).toContain("7.44");
  });

  it("fixes derived percentage from resistance", () => {
    const reply = "السهم انخفض حوالي 5.00% من مستوى المقاومة.";
    const facts = [
      { data: { symbol: "TEST", price: 310, resistance: 326.32 } },
    ];
    const fixed = autoFixNumbers(reply, facts);
    expect(fixed).toContain("5.00");
  });
});

describe("validator: buildEvidenceEnginePromptBlock", () => {
  it("generates evidence block for stock+scan results", () => {
    const toolResults: ToolResult[] = [
      {
        tool: "get_stock",
        source: "database",
        data_time: "2026-08-17",
        symbols: ["AALR"],
        data_type: "live",
        data: {
          symbol: "AALR",
          price: 310,
          rsi_14: 67.88,
          macd: 2.32,
          macd_signal: null,
          vol_ratio: 1.19,
        },
      },
      {
        tool: "get_accumulation_stocks",
        source: "database",
        data_time: "2026-08-17",
        symbols: ["AALR"],
        data_type: "live",
        data: {
          stocks: [
            {
              symbol: "AALR",
              acc_score: 80,
              dist_score: 10,
              wyckoff_phase: "accumulation",
              consecutive_acc_days: 3,
            },
          ],
        },
      },
    ];
    const block = buildEvidenceEnginePromptBlock(toolResults);
    expect(block).toContain("=== STRICT EVIDENCE CONTEXT");
    expect(block).toContain("STOCK: AALR");
    expect(block).toContain("macd_signal: NOT_PROVIDED");
    expect(block).toContain("macd_signal_line_status: UNKNOWN");
    expect(block).toContain("accumulation_score (acc_score): 80");
    expect(block).toContain("distribution_score (dist_score): 10");
    expect(block).toContain("consecutive_days: 3");
    expect(block).toContain("STRICT BOUNDARIES");
  });

  it("generates evidence block for scan-only results (no get_stock)", () => {
    const toolResults: ToolResult[] = [
      {
        tool: "get_distribution_stocks",
        source: "database",
        data_time: "2026-08-17",
        symbols: ["AALR"],
        data_type: "live",
        data: {
          stocks: [
            {
              symbol: "AALR",
              dist_score: 75,
              acc_score: 5,
              wyckoff_phase: "distribution",
              consecutive_dist_days: 2,
            },
          ],
        },
      },
    ];
    const block = buildEvidenceEnginePromptBlock(toolResults);
    expect(block).toContain("STOCK: AALR");
    expect(block).toContain("price: NOT_PROVIDED");
    expect(block).toContain("macd_signal: NOT_PROVIDED");
    expect(block).toContain("distribution_score (dist_score): 75");
    expect(block).toContain("accumulation_score (acc_score): 5");
    expect(block).toContain("STRICT BOUNDARIES");
  });

  it("returns empty string when no relevant results", () => {
    const toolResults: ToolResult[] = [
      {
        tool: "search_web",
        source: "web",
        data_time: "2026-08-17",
        symbols: [],
        data_type: "live",
        data: { results: [] },
      },
    ];
    const block = buildEvidenceEnginePromptBlock(toolResults);
    expect(block).toBe("");
  });

  it("includes all STRICT BOUNDARIES rules including new MACD and volume inference bans", () => {
    const toolResults: ToolResult[] = [
      {
        tool: "get_stock",
        source: "database",
        data_time: "2026-08-17",
        symbols: ["AALR"],
        data_type: "live",
        data: {
          symbol: "AALR",
          price: 310,
          rsi_14: 67.88,
          macd: 2.32,
          macd_signal: null,
        },
      },
    ];
    const block = buildEvidenceEnginePromptBlock(toolResults);
    expect(block).toContain("NEVER claim 'فوق خط الإشارة'");
    expect(block).toContain("NEVER classify volume as 'سيولة توزيعية'");
    expect(block).toContain("NEVER classify volume as 'سيولة تجميعية'");
    expect(block).toContain("NEVER make implicit inferences");
    expect(block).toContain(
      "MACD > 0 (above the zero line) does NOT by itself mean a bullish signal",
    );
    expect(block).toContain("INFERENCE BAN");
    expect(block).toContain("SELLING PRESSURE");
    expect(block).toContain("BUYING PRESSURE");
  });

  it("handles OTC market flag correctly", () => {
    const toolResults: ToolResult[] = [
      {
        tool: "get_stock",
        source: "database",
        data_time: "2026-08-17",
        symbols: ["AFDI"],
        data_type: "live",
        data: {
          symbol: "AFDI",
          price: null,
          rsi_14: null,
          macd: null,
          macd_signal: null,
        },
      },
    ];
    const block = buildEvidenceEnginePromptBlock(toolResults);
    expect(block).toContain("OTC_MARKET");
  });
});

describe("validator: Evidence Verifier CHECKs 9-11", () => {
  // Tool results for a stock with king_ai_score=0.583 and egx_ai_score=0.539
  // This gives a 4.4-point difference — the exact scenario from the bot review
  const diffMlToolResults = [
    {
      data: {
        symbol: "TEST",
        price: 310,
        rsi_14: 55.0,
        macd: 0.5,
        macd_signal: 0.3,
        support: 290,
        resistance: 325,
        king_ai_score: 0.583,
        egx_ai_score: 0.539,
      },
    },
  ];

  // Tool results for a stock with king_ai_score=0.583 and egx_ai_score=0.580
  // This gives a 0.3-point difference — genuinely close/strong agreement
  const closeMlToolResults = [
    {
      data: {
        symbol: "CLOSE",
        price: 100,
        rsi_14: 65.0,
        macd: 0.2,
        macd_signal: 0.1,
        support: 95,
        resistance: 105,
        king_ai_score: 0.583,
        egx_ai_score: 0.580,
      },
    },
  ];

  it("CHECK 9: rejects unwarranted 'طبيعي' judgment on profit-taking", () => {
    const reply = "عمليات جني أرباح فنية طبيعية بعد وصول مؤشر RSI لمناطق تشبع شرائي مرتفعة لسهم TEST.";
    const errors = validateDeterministicRules(
      reply,
      diffMlToolResults,
      "حلل سهم TEST",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("طبيعي"))).toBe(true);
  });

  it("CHECK 9: does NOT flag linguistic uses of 'طبيعي' (e.g. محادثة طبيعية)", () => {
    const reply = "محادثة طبيعية مع العميل يوضح فيها التحليل الفني للسهم.";
    const errors = validateDeterministicRules(
      reply,
      diffMlToolResults,
      "حلل سهم TEST",
    );
    const check9Errors = errors.filter((e) =>
      e.includes("طبيعي") && !e.includes("محادثة"),
    );
    expect(check9Errors.length).toBe(0);
  });

  it("CHECK 9: rejects 'هذا طبيعي' as value judgment without data", () => {
    const reply = "الفرق بين النماذج غير مبرر. هذا طبيعي — النماذج تلتقط الاتجاه طويل الأجل لسهم TEST.";
    const errors = validateDeterministicRules(
      reply,
      diffMlToolResults,
      "حلل سهم TEST",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.includes("طبيعي")),
    ).toBe(true);
  });

  it("CHECK 10: rejects 'مناسب للدخول' without technical criteria", () => {
    const reply = "سهم TEST مناسب للدخول الآن.";
    const errors = validateDeterministicRules(
      reply,
      diffMlToolResults,
      "حلل سهم TEST",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.includes("معايير") || e.includes("دخول")),
    ).toBe(true);
  });

  it("CHECK 10: accepts 'مناسب للدخول' WITH explicit technical criteria", () => {
    const reply = "مناسب للدخول إذا اقترب السعر من مستوى الدعم 290 جنيه وعاد الحجم فوق 1.0x.";
    const errors = validateDeterministicRules(
      reply,
      diffMlToolResults,
      "حلل سهم TEST",
    );
    const check10Errors = errors.filter(
      (e) => e.includes("معايير") || e.includes("غير مدعوم"),
    );
    expect(check10Errors.length).toBe(0);
  });

  it("CHECK 11: rejects 'اتفاق قوي' when ML score diff > 3 points (4.4pt scenario)", () => {
    const reply = "KING AI = 58.3% و EGX AI = 53.9%، الفرق = 4.4 نقطة → اتفاق قوي لسهم TEST.";
    const errors = validateDeterministicRules(
      reply,
      diffMlToolResults,
      "حلل سهم TEST",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.includes("اتفاق قوي") || e.includes("غير دقيق")),
    ).toBe(true);
  });

  it("CHECK 11: accepts 'اتفاق قوي' when ML score diff <= 3 points", () => {
    const reply = "KING AI = 58.3% و EGX AI = 58.0%، الفرق = 0.3 نقطة → اتفاق قوي لسهم CLOSE.";
    const errors = validateDeterministicRules(
      reply,
      closeMlToolResults,
      "حلل سهم CLOSE",
    );
    const check11Errors = errors.filter((e) =>
      e.includes("اتفاق") && e.includes("غير دقيق"),
    );
    expect(check11Errors.length).toBe(0);
  });

  it("CHECK 11: rejects weak agreement label when diff <= 3 with same direction", () => {
    const reply = "KING AI = 58.3% و EGX AI = 58.0%، الفرق = 0.3 نقطة → اتفاق ضعيف لسهم CLOSE.";
    const errors = validateDeterministicRules(
      reply,
      closeMlToolResults,
      "حلل سهم CLOSE",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.includes("اتفاق") && e.includes("<= 3")),
    ).toBe(true);
  });

  it("CHECK 10: does NOT flag negated entry recommendation (e.g. 'لا ينصح بالدخول')", () => {
    const reply = "RSI عالي جداً (93) لسهم TEST لا ينصح بالدخول الآن.";
    const errors = validateDeterministicRules(
      reply,
      diffMlToolResults,
      "حلل سهم TEST",
    );
    const check10Errors = errors.filter((e) =>
      e.includes("معايير") || e.includes("إشارة دخول غير مدعومة"),
    );
    expect(check10Errors.length).toBe(0);
  });

  // Real-scenario from the Abdullah session: MOIN 62.3% vs 53.9% = 8.4 points.
  const moinMlToolResults = [
    {
      data: {
        symbol: "MOIN",
        price: 37.4,
        change_pct: "+15.04%",
        rsi_14: 58.99,
        macd: 1.5526,
        macd_signal: 0.3,
        support: 30,
        resistance: 45,
        king_ai_score: 0.623,
        egx_ai_score: 0.539,
      },
    },
  ];

  // Real-scenario from the Abdullah session: MAAL 58.8% vs 56.0% = 2.8 points.
  const maalMlToolResults = [
    {
      data: {
        symbol: "MAAL",
        price: 9.94,
        change_pct: "+3.54%",
        rsi_14: 72.12,
        macd: 0.3368,
        macd_signal: 0.2,
        support: 8.5,
        resistance: 13.44,
        king_ai_score: 0.588,
        egx_ai_score: 0.56,
      },
    },
  ];

  it("CHECK 11: rejects 'اتفاق متوسط' when ML score diff is 8.4pt (real MOIN mislabel)", () => {
    const reply = "KING AI إيجابي متوسط (62.3%) وEGX محايد (53.9%) — اتفاق متوسط لسهم MOIN.";
    const errors = validateDeterministicRules(
      reply,
      moinMlToolResults,
      "حلل سهم MOIN",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.includes("اتفاق") && e.includes("> 8")),
    ).toBe(true);
  });

  it("CHECK 11: accepts 'اتفاق ضعيف' when ML score diff is 8.4pt (real MOIN correct label)", () => {
    const reply = "KING AI = 62.3% و EGX AI = 53.9% — اتفاق ضعيف لسهم MOIN.";
    const errors = validateDeterministicRules(
      reply,
      moinMlToolResults,
      "حلل سهم MOIN",
    );
    const check11Errors = errors.filter((e) =>
      e.includes("اتفاق") && e.includes("غير دقيق"),
    );
    expect(check11Errors.length).toBe(0);
  });

  it("CHECK 11: accepts 'اتفاق قوي' when ML score diff is 2.8pt (real MAAL correct label)", () => {
    const reply = "KING AI = 58.8% و EGX AI = 56.0% — اتفاق قوي لسهم MAAL.";
    const errors = validateDeterministicRules(
      reply,
      maalMlToolResults,
      "حلل سهم MAAL",
    );
    const check11Errors = errors.filter((e) =>
      e.includes("اتفاق") && e.includes("غير دقيق"),
    );
    expect(check11Errors.length).toBe(0);
  });
});
