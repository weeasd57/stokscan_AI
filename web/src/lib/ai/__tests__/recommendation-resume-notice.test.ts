import { recommendationResumeNotice } from "../recommendation-resume-notice";

const date = "2026-10-05";

describe("daily recommendation resumption notice", () => {
  it("explains today's model and risk rejection without promising a date", () => {
    const text = recommendationResumeNotice({
      date, recommendationsCreated: 0, blocked: false,
      decision: {
        date, reason_code: "council_rejection",
        reason: "كل المرشحين دون نسبة توافق مجلس النماذج المطلوبة (55.0%).",
        candidates: [{ risk_reward: .53 }, { risk_reward: .62 }, { risk_reward: .53 }],
      },
    });
    expect(text).toContain("55.0%");
    expect(text).toContain("3 من المرشحين");
    expect(text).toContain("في أول تشغيل يومي");
    expect(text).toContain("1.5 على الأقل");
    expect(text).toContain("بعد إغلاق كل جلسة تداول");
    expect(text).toContain("لا يوجد تاريخ مضمون");
    expect(text).toContain("ضوابط الاختيار والمخاطر كما هي");
  });

  it("uses today's market block reason without declaring all candidates weak", () => {
    const text = recommendationResumeNotice({
      date, recommendationsCreated: 0, blocked: true,
      gateReason: "قاطع الأمان منع الشراء بسبب هبوط السوق.",
    });
    expect(text).toContain("هبوط السوق");
    expect(text).toContain("سماح حالة السوق بالشراء");
    expect(text).not.toContain("من المرشحين");
  });

  it("ignores a previous session's rejection reason", () => {
    const text = recommendationResumeNotice({
      date, recommendationsCreated: 0,
      decision: { date: "2026-10-04", reason: "سبب قديم", reason_code: "trade_structure" },
    });
    expect(text).not.toContain("سبب قديم");
    expect(text).toContain("لم يعتمد التشغيل اليومي");
  });

  it("preserves a technical or capacity reason instead of blaming market direction", () => {
    for (const reason of ["تعذر استكمال فحص المرشحين بسبب خطأ تقني", "تم بلوغ سعة التوصيات"]) {
      const text = recommendationResumeNotice({ date, recommendationsCreated: 0, decision: { date, reason } });
      expect(text).toContain(reason);
      expect(text).not.toContain("السوق يهبط");
    }
  });

  it("does not announce a halt after recommendations were published", () => {
    expect(recommendationResumeNotice({ date, recommendationsCreated: 1, blocked: false })).toBe("");
  });
});
