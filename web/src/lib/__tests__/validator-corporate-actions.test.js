const { validateDeterministicRules } = require("../ai/validator");

const bonusEvidence = [{
  tool: "get_corporate_actions",
  source: "database",
  data_type: "live",
  data: {
    corporate_actions: [{
      symbol: "ORHD",
      action_type: "bonus_shares",
      title: "زيادة رأس المال بأسهم مجانية",
    }],
  },
}];

describe("corporate-action evidence validation", () => {
  test("rejects denying bonus shares when structured evidence says bonus_shares", () => {
    const errors = validateDeterministicRules(
      "الشركة عندها زيادة رأس مال معلنة، مش توزيع أسهم مجانية.",
      bonusEvidence,
      "ما هي شروط توزيع الاسهم القادم",
      "stock_analysis",
    );
    expect(errors.some((error) => error.includes("bonus_shares"))).toBe(true);
  });

  test("allows confirming bonus shares while keeping missing terms explicit", () => {
    const errors = validateDeterministicRules(
      "البيانات تؤكد زيادة رأس المال بأسهم مجانية، لكن نسبة التوزيع وتاريخ الاستحقاق غير متاحين في البيانات الحالية.",
      bonusEvidence,
      "ما هي شروط توزيع الاسهم القادم",
      "stock_analysis",
    );
    expect(errors).toEqual([]);
  });
});
