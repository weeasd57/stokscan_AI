type RecommendationDecision = {
  date?: string;
  reason?: string;
  reason_code?: string;
  candidates?: Array<{ risk_reward?: number | null; minimum_rr?: number }>;
};

export function recommendationResumeNotice(input: {
  date: string;
  recommendationsCreated: number;
  blocked?: boolean;
  gateReason?: string;
  decision?: RecommendationDecision | null;
}): string {
  if (input.recommendationsCreated > 0) return "";
  const decision = input.decision?.date === input.date ? input.decision : null;
  const reason = decision?.reason?.trim() || input.gateReason?.trim();
  const weakSetups = decision?.candidates?.filter((candidate) =>
    typeof candidate.risk_reward === "number" && Number.isFinite(candidate.risk_reward)
    && candidate.risk_reward < (candidate.minimum_rr ?? 1.5),
  ).length || 0;
  const lines = [
    "📌 حالة التوصيات الجديدة",
    reason ? `سبب عدم إصدار توصيات اليوم: ${reason.slice(0, 700)}`
      : "لم يعتمد التشغيل اليومي توصيات شراء جديدة اليوم.",
  ];
  if (!input.blocked && decision?.reason_code === "council_rejection" && weakSetups > 0) {
    lines.push(`كذلك لم يستوفِ ${weakSetups} من المرشحين نسبة العائد إلى المخاطرة المطلوبة (1.5 على الأقل).`);
  }
  lines.push(
    "",
    "عودة التوصيات: في أول تشغيل يومي تتوافر فيه فرصة تستوفي جميع الشروط الحالية: سماح حالة السوق بالشراء، واجتياز شروط النماذج والسيولة والقطاع، ووجود وقف وهدف مناسبين بعائد إلى مخاطرة 1.5 على الأقل، مع توافر سعة النشر.",
    "تُعاد المراجعة بعد إغلاق كل جلسة تداول. لا يوجد تاريخ مضمون لعودة التوصيات؛ ستُرسل تلقائيًا عند اعتماد فرصة مناسبة وحفظها. تظل ضوابط الاختيار والمخاطر كما هي.",
  );
  return lines.join("\n");
}
