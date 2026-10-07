import { checkPortfolioTableEvidence } from "../portfolio-evidence";
import { ToolResult } from "../types";

const snapshot = (positions: any[]): ToolResult => ({
  tool: "manage_portfolio",
  source: "positions",
  data_time: "2026-10-07",
  symbols: positions.map((p) => p.symbol),
  data_type: "cached",
  data: { ok: true, positions },
});
const quote = (
  symbol: string,
  date: string,
  data: Record<string, unknown>,
): ToolResult => ({
  tool: "get_stock",
  source: "daily_prices",
  data_time: date,
  symbols: [symbol],
  data_type: "historical",
  data: { symbol, ...data },
});
const table = (header: string, rows: string[]) =>
  [header, "|---|---:|---:|---:|---:|---:|---:|---:|---:|", ...rows].join("\n");
const header =
  "| السهم | الكمية | سعر الشراء المسجل | السعر المتاح | العائد غير المحقق | وزن المحفظة | RSI | حجم نسبي | درجات KING/EGX* |";

describe("portfolio table evidence gate", () => {
  test("rejects forged symbol, quantity, entry, quote, return, weight and indicators", () => {
    const results = [
      snapshot([
        { symbol: "AMES", quantity: 100, entry_price: 10, last_price: 11 },
      ]),
      quote("AMES", "2026-10-07", {
        price: 11,
        rsi_14: 45,
        vol_ratio: 0.4,
        king_ai_score: 0.7,
        egx_ai_score: 0.55,
      }),
    ];
    const reply = table(header, [
      "| AMES | 999 | 77 | 99 | +900% | 99% | RSI 98 | 9.9x | 1% / 2% |",
      "| ZZZZ | غير متاح | غير متاح | غير متاح | غير محسوب | غير محسوب | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);
    const violations = checkPortfolioTableEvidence(reply, results);

    expect(violations.join(" ")).toMatch(/ZZZZ/);
    expect(violations.join(" ")).toMatch(/الكمية/);
    expect(violations.join(" ")).toMatch(/سعر الشراء/);
    expect(violations.join(" ")).toMatch(/السعر/);
    expect(violations.join(" ")).toMatch(/العائد/);
    expect(violations.join(" ")).toMatch(/وزن المحفظة/);
    expect(violations.join(" ")).toMatch(/RSI/);
    expect(violations.join(" ")).toMatch(/نسبة الحجم/);
    expect(violations.join(" ")).toMatch(/KING\/EGX/);
  });

  test("accepts a complete same-date row and the renderer's rounded portfolio math", () => {
    const results = [
      snapshot([{ symbol: "AMES", quantity: 100, entry_price: 10 }]),
      quote("AMES", "2026-10-07", {
        price: 11,
        rsi_14: 45,
        vol_ratio: 0.4,
        king_ai_score: 0.7,
        egx_ai_score: 0.55,
      }),
    ];
    const reply = table(header, [
      "| **AMES** | 100 | 10.00 ج.م (تاريخ سعر الشراء غير موثق) | آخر إغلاق مسجل 11.00 ج.م | +10.0% | 100.0% | محايد (30–أقل من 70؛ 45.0) | 0.40x من متوسط الحجم | 70% / 55% |",
    ]);

    expect(checkPortfolioTableEvidence(reply, results)).toEqual([]);
  });

  test("accepts honest unavailable fields on a partial holding and rejects fabricated derived amounts", () => {
    const results = [
      snapshot([{ symbol: "AMES", quantity: null, entry_price: 10 }]),
    ];
    const honest = table(header, [
      "| AMES | غير متاح | 10.00 ج.م | غير متاح | غير محسوب | غير محسوب | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);
    expect(checkPortfolioTableEvidence(honest, results)).toEqual([]);

    const fabricated = table(header, [
      "| AMES | غير متاح | 10.00 ج.م | غير متاح | +40% | غير محسوب | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);
    expect(checkPortfolioTableEvidence(fabricated, results).join(" ")).toMatch(
      /العائد/,
    );
  });

  test("accepts weights only when all held positions have one common dated quote", () => {
    const positions = [
      { symbol: "AMES", quantity: 100, entry_price: 10 },
      { symbol: "ETEL", quantity: 20, entry_price: 15 },
    ];
    const sameDate = [
      snapshot(positions),
      quote("AMES", "2026-10-07", { price: 11 }),
      quote("ETEL", "2026-10-07", { price: 16 }),
    ];
    const valid = table(header, [
      "| AMES | 100 | 10 | 11 | +10% | 77.5% | غير متاح | غير متاح | غير متاح / غير متاح |",
      "| ETEL | 20 | 15 | 16 | +6.7% | 22.5% | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);
    expect(checkPortfolioTableEvidence(valid, sameDate)).toEqual([]);

    const mixedDates = [
      snapshot(positions),
      quote("AMES", "2026-10-06", { price: 11 }),
      quote("ETEL", "2026-10-07", { price: 16 }),
    ];
    const unsupportedWeights = table(header, [
      "| AMES | 100 | 10 | 11 | +10% | 77.5% | غير متاح | غير متاح | غير متاح / غير متاح |",
      "| ETEL | 20 | 15 | 16 | +6.7% | 22.5% | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);
    expect(
      checkPortfolioTableEvidence(unsupportedWeights, mixedDates).join(" "),
    ).toMatch(/التاريخ نفسه/);
  });

  test("weights need quantity and same-date prices, not entry cost", () => {
    const results = [
      snapshot([
        { symbol: "AMES", quantity: 100, entry_price: null },
        { symbol: "ETEL", quantity: 20, entry_price: 15 },
      ]),
      quote("AMES", "2026-10-07", { price: 11 }),
      quote("ETEL", "2026-10-07", { price: 16 }),
    ];
    const reply = table(header, [
      "| AMES | 100 | غير متاح | 11 | غير محسوب | 77.5% | غير متاح | غير متاح | غير متاح / غير متاح |",
      "| ETEL | 20 | 15 | 16 | +6.7% | 22.5% | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);

    expect(checkPortfolioTableEvidence(reply, results)).toEqual([]);
  });

  test("rejects coercible booleans, empty numeric fields, and undated or malformed quotes", () => {
    const results = [
      snapshot([
        { symbol: "AMES", quantity: true, entry_price: "", last_price: true },
      ]),
      quote("AMES", "2026-02-30", { price: 11 }),
    ];
    const reply = table(header, [
      "| AMES | 1 | 0 | 11 | +10% | 100% | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);
    const violations = checkPortfolioTableEvidence(reply, results).join(" ");
    expect(violations).toMatch(/الكمية/);
    expect(violations).toMatch(/سعر الشراء/);
    expect(violations).toMatch(/العائد/);
    expect(violations).toMatch(/وزن المحفظة/);
  });

  test("uses the renderer's Cairo date for UTC timestamps crossing midnight", () => {
    const results = [
      snapshot([
        { symbol: "AMES", quantity: 100, entry_price: 10 },
        { symbol: "ETEL", quantity: 20, entry_price: 15 },
      ]),
      {
        ...quote("AMES", "2026-10-06", { price: 11 }),
        data: {
          symbol: "AMES",
          price: 11,
          quote_basis: { as_of: "2026-10-06T22:00:00Z" },
        },
      },
      quote("ETEL", "2026-10-07", { price: 16 }),
    ];
    const reply = table(header, [
      "| AMES | 100 | 10 | 11 | +10% | 77.5% | غير متاح | غير متاح | غير متاح / غير متاح |",
      "| ETEL | 20 | 15 | 16 | +6.7% | 22.5% | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);

    expect(checkPortfolioTableEvidence(reply, results)).toEqual([]);
  });

  test("honest unavailable markers stay valid when inputs are malformed or outside renderer ranges", () => {
    const results = [
      snapshot([
        {
          symbol: "AMES",
          quantity: "100x",
          entry_price: "10x",
          last_price: "11x",
        },
      ]),
      quote("AMES", "2026-10-07", {
        price: "11x",
        rsi_14: 130,
        vol_ratio: -1,
        king_ai_score: 1.2,
        egx_ai_score: -0.2,
      }),
    ];
    const reply = table(header, [
      "| AMES | غير متاح | غير متاح | غير متاح | غير محسوب | غير محسوب | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);

    expect(checkPortfolioTableEvidence(reply, results)).toEqual([]);
  });

  test("does not discard bare year-like values and rejects unlabeled P/L numbers", () => {
    const results = [
      snapshot([{ symbol: "AMES", quantity: 100, entry_price: 10 }]),
      quote("AMES", "2026-10-07", { price: 11 }),
    ];
    const yearPrice = table(header, [
      "| AMES | 100 | 10 | 2026 | +10% | 100% | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);
    expect(checkPortfolioTableEvidence(yearPrice, results).join(" ")).toMatch(
      /السعر/,
    );

    const unlabeledReturn = table(header, [
      "| AMES | 100 | 10 | 11 | 999 | 100% | غير متاح | غير متاح | غير متاح / غير متاح |",
    ]);
    expect(
      checkPortfolioTableEvidence(unlabeledReturn, results).join(" "),
    ).toMatch(/علامة نسبة أو وحدة مالية/);
  });

  test("checks the RSI band label as well as the numeric value", () => {
    const results = [
      snapshot([{ symbol: "AMES", quantity: 100, entry_price: 10 }]),
      quote("AMES", "2026-10-07", { price: 11, rsi_14: 30.9 }),
    ];
    const wrongBand = table(header, [
      "| AMES | 100 | 10 | 11 | +10% | 100% | تشبع بيعي (≤30؛ 30.9) | غير متاح | غير متاح / غير متاح |",
    ]);
    expect(checkPortfolioTableEvidence(wrongBand, results).join(" ")).toMatch(
      /وصف نطاق RSI/,
    );
  });
});
