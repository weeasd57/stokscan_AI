import { validateResponse } from "../web/src/lib/ai/validator";

const replyText = `
سهم طلعت مصطفى (TMGH) وسهم العامة لاستصلاح الأراضي (AALR) وسهم الزيوت المستخلصة (ZEOT).
سعر TMGH هو 97.70 جنيه، وتغير الجلسة +0.72%، وحجم التداول 2,176,618 سهم (متوسط الحجم 2,584,724).
سعر AALR هو 320.43 جنيه، وتغير الجلسة -2.97%، وحجم التداول 75,083 سهم (متوسط الحجم 197,647).
الفرق في تقييم KING AI بين AALR و TMGH هو 18.1%.
`;

const toolResults = [
  {
    tool: "get_stock",
    symbols: ["TMGH"],
    data: {
      symbol: "TMGH",
      close: 97.70,
      change_pct: 0.7216,
      volume: 2176618,
      vol_sma20: 2584724,
      king_ai_score: 0.401987,
      egx_ai_score: 0.554667
    }
  },
  {
    tool: "get_stock",
    symbols: ["AALR"],
    data: {
      symbol: "AALR",
      close: 320.43,
      change_pct: -2.9706,
      volume: 75083,
      vol_sma20: 197647,
      king_ai_score: 0.582779,
      egx_ai_score: 0.465420
    }
  }
];

const validSymbols = ["TMGH", "AALR", "ZEOT"];
const liveDataString = toolResults.map(r => ` الأداة: ${r.tool} | البيانات: ${JSON.stringify(r.data)}`).join("\n");

const res = validateResponse(replyText, liveDataString, validSymbols, toolResults, "قارن بين tmgh , aalr , zeot", "comparison");
console.log("VALIDATION RESULT:", JSON.stringify(res, null, 2));
