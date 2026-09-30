"use client";

import { BookOpen, ShieldAlert } from "lucide-react";
import { explainSignal, type SignalExplanationInput } from "@/lib/signal-explanation";

const pct = (value: number | null) => value === null ? "—" : `${value.toFixed(2)}%`;

export default function SignalExplanation({ signal, isAr, compact = false, showReasons = true }: {
  signal: SignalExplanationInput; isAr: boolean; compact?: boolean; showReasons?: boolean;
}) {
  const detail = explainSignal(signal);
  const date = (value?: string | null) => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo" }) : "—";
  return (
    <details className={`${compact ? "rounded-xl border border-zinc-200 dark:border-white/10" : "border-2 border-black dark:border-white"} bg-zinc-50 dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100`} dir={isAr ? "rtl" : "ltr"} open={compact ? undefined : true}>
      <summary className="cursor-pointer p-4 text-sm font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500">
        <BookOpen className="mx-1 inline h-4 w-4 text-indigo-500" />{isAr ? "فهم الإشارة والمخاطر" : "Understand this signal & risk"}
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [isAr ? "المسافة للهدف من الدخول" : "Entry to target", pct(detail.rewardPct)],
            [isAr ? "المخاطرة من الدخول" : "Entry risk", pct(detail.riskPct)],
            [isAr ? "عائد / مخاطرة" : "Reward / risk", detail.rewardRisk === null ? "—" : `${detail.rewardRisk.toFixed(2)} : 1`],
            [isAr ? "المسافة للهدف من آخر سعر" : "Latest price to target", pct(detail.remainingPct)],
          ].map(([label, value]) => <div key={label} className="border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-950/40">
            <span className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400">{label}</span>
            <span className="mt-1 block font-mono text-sm font-black" dir="ltr">{value}</span>
          </div>)}
        </div>
        {(detail.protectedStop || detail.invalidTarget || detail.crossedStop) && <p className="border-s-4 border-amber-500 bg-amber-500/10 p-3 text-xs leading-relaxed">
          <ShieldAlert className="mx-1 inline h-4 w-4" />
          {detail.crossedStop ? (isAr ? "آخر سعر وصل أو تجاوز الوقف؛ راجع حالة الإشارة قبل اتخاذ قرار." : "The latest price reached or crossed the stop; check the signal status before acting.")
            : detail.protectedStop ? (isAr ? "الوقف عند الدخول أو في منطقة حماية الربح؛ لا تُحسب نسبة مخاطرة أصلية موجبة بهذه المستويات." : "The stop is at entry or protecting profit; these levels do not imply a positive original entry risk.")
            : (isAr ? "الهدف لا يقع في اتجاه الإشارة؛ لا يمكن حساب عائد متوقع صالح بهذه المستويات." : "The target is not in the signal direction; no valid potential reward can be calculated.")}
        </p>}
        {showReasons && <div className="space-y-2 text-xs leading-relaxed">
          <h4 className="font-black">{isAr ? "الأسباب المحفوظة وقت إصدار الإشارة" : "Reasons saved when the signal was issued"}</h4>
          {detail.reasons.length ? <ol className="list-inside list-decimal space-y-2">{detail.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ol>
            : <p className="text-zinc-500">{isAr ? "لا توجد أسباب محفوظة لهذه الإشارة؛ لم يتم إنشاء تفسير افتراضي." : "No reasons were saved for this signal; no explanation has been invented."}</p>}
        </div>}
        <details className="border-t border-zinc-200 pt-3 text-xs dark:border-white/10">
          <summary className="cursor-pointer font-bold">{isAr ? "كيف أقرأ المؤشرات ونسبة المخاطرة؟" : "How do I read the indicators and risk ratio?"}</summary>
          <ul className="mt-3 list-inside list-disc space-y-2 leading-relaxed text-zinc-600 dark:text-zinc-400">
            <li>{isAr ? "RSI يقيس الزخم من 0 إلى 100؛ أقل من 30 يُسمّى تشبعاً بيعياً، وأعلى من 70 تشبعاً شرائياً. هذا وحده لا يضمن انعكاس السعر." : "RSI measures momentum from 0 to 100; below 30 is called oversold and above 70 overbought. Neither alone guarantees a price reversal."}</li>
            <li>{isAr ? "ADX يقيس قوة الاتجاه، وليس إن كان صاعداً أو هابطاً. تُقرأ جهة الاتجاه من حركة السعر ومؤشرات أخرى." : "ADX measures trend strength, not whether it is rising or falling. Direction requires price action and other indicators."}</li>
            <li>{isAr ? "عائد / مخاطرة 2 : 1 يعني أن المسافة من الدخول للهدف ضعف المسافة من الدخول للوقف؛ لا يعني أن احتمال النجاح 2 من 3." : "Reward / risk of 2 : 1 means the entry-to-target distance is twice the entry-to-stop distance; it does not mean a two-in-three success probability."}</li>
          </ul>
        </details>
        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {isAr ? "صدرت:" : "Issued:"} {date(signal.created_at)}
          {signal.price_date && <> · {isAr ? "جلسة السعر:" : "Price session:"} {date(signal.price_date)}</>}
          {detail.scorePct !== null && <> · {isAr ? "تقييم النموذج المسجل:" : "Recorded model metric:"} {pct(detail.scorePct)}</>}
        </p>
        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {isAr ? "الأهداف والوقف مستويات تخطيط وليست ضماناً للتنفيذ؛ الفجوات والسيولة قد تغيّر سعر التنفيذ. تقييم النموذج ليس احتمال نجاح مضموناً لهذه الصفقة. الأسباب المسجلة ليست تحققاً مستقلاً من الأخبار، وADX يقيس قوة الاتجاه لا اتجاهه. الحسابات لا تشمل الرسوم." : "Targets and stops are planning levels, not guaranteed fills; gaps and liquidity affect execution. The recorded model metric is not a guaranteed success probability for this trade. Saved reasons are not independent news verification; ADX measures strength, not direction. Fees are excluded."}
        </p>
      </div>
    </details>
  );
}
