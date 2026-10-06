"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Layers,
  Zap,
  TrendingUp,
  Target,
  Clock,
  ShieldAlert,
  Award,
  CheckCircle2,
  Scale,
  ArrowUpRight,
  Flame,
  ShieldCheck,
  Calendar,
  BarChart3,
  HelpCircle,
  Percent
} from "lucide-react";

interface SystemsComparisonTabProps {
  isAr?: boolean;
  isPro?: boolean;
}

export default function SystemsComparisonTab({
  isAr = true,
  isPro = false
}: SystemsComparisonTabProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<"august" | "september" | "full_year">("full_year");

  // Performance data per period (Exact live figures verified against Supabase and RecommendationCalendar)
  const periodData = {
    august: {
      titleAr: "شهر أغسطس (شهر زخم وصعود قوي)",
      titleEn: "August 2026 (Strong Bullish Momentum)",
      medium: {
        winRate: 78.0,
        totalReturn: 1208.3,
        tradeCount: 41,
        avgHolding: "29.5 يوم",
        bestTrade: "CRST +143.2%",
        profitFactor: 3.85,
        summaryAr: "شهر استثنائي حققت فيه التوصيات المتوسطة طفرات قياسية بقيادة سهم CRST (+143.2%)، مع نسبة نجاح عالية 78% ومجموع عوائد موثق بالتقويم بلغ +1208.3%."
      },
      short: {
        winRate: 58.3,
        totalReturn: 493.2,
        tradeCount: 115,
        avgHolding: "2.8 جلسات",
        bestTrade: "EDBM +81.5% و GGCC +71.0%",
        profitFactor: 3.04,
        summaryAr: "كثافة عالية في اقتناص الفرص (115 صفقة سريعة)؛ حقق النظام +493.2% مع قفزات خارقة وصلت إلى +81.5% عبر ركوب موجات الصعود السريعة وتتبع EMA10."
      }
    },
    september: {
      titleAr: "شهر سبتمبر (سوق تصحيحي وهابط)",
      titleEn: "September 2026 (Correction & Bearish Pressure)",
      medium: {
        winRate: 36.1,
        totalReturn: -66.3,
        tradeCount: 61,
        avgHolding: "25.0 يوم",
        bestTrade: "KASABF +101.4%",
        profitFactor: 0.82,
        summaryAr: "تأثرت التوصيات المتوسطة بالهبوط العام للمؤشر وضرب وقوف الخسارة الأوسع (-8% إلى -12%)، رغم اقتناص طفرة KASABF القياسية (+101.4%)."
      },
      short: {
        winRate: 40.8,
        totalReturn: -74.9,
        tradeCount: 71,
        avgHolding: "3.1 جلسات",
        bestTrade: "KORA +19.4% و CERA +19.6%",
        profitFactor: 0.69,
        summaryAr: "صمود سريع وحد من الخسائر بفضل الوقف الصارم (-4%) وتأمين نقطة الدخول عند +4.5%، مع خروج سريع في أقل من 3 جلسات لتحرير الكاش وتجنب التعليق."
      }
    },
    full_year: {
      titleAr: "إجمالي عام 2026 (كامل العينة التاريخية)",
      titleEn: "Full 2026 Backtest (Complete Sample)",
      medium: {
        winRate: 58.1,
        totalReturn: 1379.5,
        tradeCount: 136,
        avgHolding: "28.0 يوم",
        bestTrade: "CRST +143.2%",
        profitFactor: 2.65,
        summaryAr: "استراتيجية استثمارية وتراكمية قوية للمستثمر متوسط المدى؛ حققت عائداً كلياً يتجاوز +1379.5% على مدار العام دون حاجة لمتابعة الشاشة لحظة بلحظة."
      },
      short: {
        winRate: 55.0,
        totalReturn: 1002.2,
        tradeCount: 511,
        avgHolding: "2.9 جلسات",
        bestTrade: "EDBM +81.5% و GGCC +71.0%",
        profitFactor: 1.95,
        summaryAr: "محرك مضاربة عالي الكفاءة يضاعف تدوير رأس المال (511 فرصة سريعة) ويحقق عائداً تراكمياً ضخماً (+1002.2%) مع تحرير السيولة في أقل من 3 جلسات للفرصة."
      }
    }
  };

  const current = periodData[selectedPeriod];

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      {/* ── 1. Header Banner (Neo-Brutalist) ── */}
      <div className="border-4 border-black dark:border-white bg-[#FFE600] text-black p-5 sm:p-6 shadow-[5px_5px_0px_#000] dark:shadow-[5px_5px_0px_#fff]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 border-3 border-black bg-white flex items-center justify-center font-black text-black shadow-[2px_2px_0px_#000]">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider bg-black text-[#FFE600] px-2 py-0.5 border border-black inline-block mb-1">
                دليل المقارنة الفنية والكمية
              </span>
              <h2 className="text-xl sm:text-2xl font-black">
                {isAr ? "مقارنة أداء النظامين: الصفقات المتوسطة 📈 مقابل الصفقات القصيرة ⚡ PRO" : "Systems Comparison: Medium Swings vs Short Swings PRO"}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isPro && (
              <Link
                href="/pricing"
                className="inline-flex items-center gap-1.5 px-4 py-2 border-2 border-black bg-black text-[#FFE600] text-xs font-black shadow-[2px_2px_0px_#000] hover:bg-zinc-800 transition-all"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>فتح الصفقات القصيرة فوراً</span>
              </Link>
            )}
          </div>
        </div>

        <p className="mt-3 text-xs sm:text-sm font-bold text-zinc-900 leading-relaxed border-t-2 border-black/20 pt-3">
          يقدم StokScan AI نظامين مستقلين تماماً تم تصميمهما لتلبية احتياجات المتداولين والمستثمرين في البورصة المصرية؛ النظام المتوسط يركز على تجميع الأسهم ذات النماذج الفنية الكلاسيكية، بينما يركز نظام الصفقات القصيرة على اقتناص زخم السيولة المؤسسية وتدوير المحفظة بسرعة فائقة.
        </p>
      </div>

      {/* ── 2. Period Selector Buttons ── */}
      <div className="flex flex-wrap items-center gap-2 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 p-1.5 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff]">
        <button
          onClick={() => setSelectedPeriod("full_year")}
          className={`flex-1 sm:flex-none py-2.5 px-4 border-2 border-black font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all ${
            selectedPeriod === "full_year"
              ? "bg-[#FFE600] text-black shadow-[2px_2px_0px_#000]"
              : "bg-white dark:bg-zinc-950 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
          }`}
        >
          <Award className="w-4 h-4 text-black dark:text-amber-400" />
          <span>كامل عام 2026 (العينة الإجمالية)</span>
        </button>

        <button
          onClick={() => setSelectedPeriod("august")}
          className={`flex-1 sm:flex-none py-2.5 px-4 border-2 border-black font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all ${
            selectedPeriod === "august"
              ? "bg-[#FFE600] text-black shadow-[2px_2px_0px_#000]"
              : "bg-white dark:bg-zinc-950 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
          }`}
        >
          <TrendingUp className="w-4 h-4 text-emerald-600" />
          <span>شهر أغسطس 2026 (سوق صاعد قوي)</span>
        </button>

        <button
          onClick={() => setSelectedPeriod("september")}
          className={`flex-1 sm:flex-none py-2.5 px-4 border-2 border-black font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all ${
            selectedPeriod === "september"
              ? "bg-[#FFE600] text-black shadow-[2px_2px_0px_#000]"
              : "bg-white dark:bg-zinc-950 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-rose-600" />
          <span>شهر سبتمبر 2026 (سوق تصحيحي وهابط)</span>
        </button>
      </div>

      {/* ── 3. Head-to-Head Period Scorecard ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: الصفقات المتوسطة */}
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-5 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff] flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b-2 border-black pb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 border-2 border-black bg-blue-400 text-black flex items-center justify-center font-black">
                  <Layers className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-black text-base text-black dark:text-white">الصفقات المتوسطة 📈</h3>
                  <span className="text-[11px] font-bold text-zinc-500">الأفق الاستثماري المتوسط</span>
                </div>
              </div>
              <span className="text-xs font-black px-2 py-0.5 border border-black bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white">
                {current.medium.tradeCount} صفقة
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 my-4">
              <div className="p-3 border-2 border-black bg-zinc-50 dark:bg-zinc-900">
                <span className="text-[10px] font-bold text-zinc-500 block">نسبة النجاح</span>
                <span className="text-lg font-black font-mono text-black dark:text-white" dir="ltr">
                  {current.medium.winRate.toFixed(1)}%
                </span>
              </div>

              <div className="p-3 border-2 border-black bg-zinc-50 dark:bg-zinc-900">
                <span className="text-[10px] font-bold text-zinc-500 block">صافي العائد (مجموع عوائد الصفقات)</span>
                <span
                  className={`text-lg font-black font-mono ${
                    current.medium.totalReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                  }`}
                  dir="ltr"
                >
                  {current.medium.totalReturn >= 0 ? "+" : ""}{current.medium.totalReturn.toFixed(1)}%
                </span>
              </div>

              <div className="p-3 border-2 border-black bg-zinc-50 dark:bg-zinc-900 col-span-2 sm:col-span-1">
                <span className="text-[10px] font-bold text-zinc-500 block">عامل الربح (PF)</span>
                <span className="text-lg font-black font-mono text-black dark:text-white">
                  {current.medium.profitFactor.toFixed(2)}
                </span>
              </div>

              <div className="p-3 border-2 border-black bg-zinc-50 dark:bg-zinc-900">
                <span className="text-[10px] font-bold text-zinc-500 block">متوسط مدة الصفقة</span>
                <span className="text-sm font-black text-black dark:text-white">
                  {current.medium.avgHolding}
                </span>
              </div>

              <div className="p-3 border-2 border-black bg-zinc-50 dark:bg-zinc-900 col-span-2 sm:col-span-2">
                <span className="text-[10px] font-bold text-zinc-500 block">أبرز صفقة رابحة</span>
                <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 truncate block" dir="ltr">
                  {current.medium.bestTrade}
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300 bg-blue-50 dark:bg-blue-950/30 p-3 border-2 border-blue-400">
            💡 <strong>تحليل الفترة:</strong> {current.medium.summaryAr}
          </p>
        </div>

        {/* Card 2: الصفقات القصيرة */}
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-5 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff] flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b-2 border-black pb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 border-2 border-black bg-[#FFE600] text-black flex items-center justify-center font-black">
                  <Zap className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-black text-base text-black dark:text-white">الصفقات القصيرة ⚡ PRO</h3>
                  <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">نظام الزخم والسرعة</span>
                </div>
              </div>
              <span className="text-xs font-black px-2 py-0.5 border-2 border-black bg-[#FFE600] text-black">
                {current.short.tradeCount} صفقة
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 my-4">
              <div className="p-3 border-2 border-black bg-amber-500/10 border-amber-500/40">
                <span className="text-[10px] font-bold text-zinc-500 block">نسبة النجاح</span>
                <span className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400" dir="ltr">
                  {current.short.winRate.toFixed(1)}%
                </span>
              </div>

              <div className="p-3 border-2 border-black bg-amber-500/10 border-amber-500/40">
                <span className="text-[10px] font-bold text-zinc-500 block">صافي العائد (مجموع عوائد الصفقات)</span>
                <span
                  className={`text-lg font-black font-mono ${
                    current.short.totalReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                  }`}
                  dir="ltr"
                >
                  {current.short.totalReturn >= 0 ? "+" : ""}{current.short.totalReturn.toFixed(1)}%
                </span>
              </div>

              <div className="p-3 border-2 border-black bg-amber-500/10 border-amber-500/40 col-span-2 sm:col-span-1">
                <span className="text-[10px] font-bold text-zinc-500 block">عامل الربح (PF)</span>
                <span className="text-lg font-black font-mono text-black dark:text-white">
                  {current.short.profitFactor.toFixed(2)}
                </span>
              </div>

              <div className="p-3 border-2 border-black bg-amber-500/10 border-amber-500/40">
                <span className="text-[10px] font-bold text-zinc-500 block">متوسط مدة الصفقة</span>
                <span className="text-sm font-black text-black dark:text-white">
                  {current.short.avgHolding}
                </span>
              </div>

              <div className="p-3 border-2 border-black bg-amber-500/10 border-amber-500/40 col-span-2 sm:col-span-2">
                <span className="text-[10px] font-bold text-zinc-500 block">أبرز صفقة رابحة</span>
                <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 truncate block" dir="ltr">
                  {current.short.bestTrade}
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 bg-amber-200/60 dark:bg-amber-950/40 p-3 border-2 border-amber-500">
            ⚡ <strong>ميزة الزخم:</strong> {current.short.summaryAr}
          </p>
        </div>
      </div>

      {/* ── 4. Deep Structural Comparison Table ── */}
      <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-5 sm:p-6 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff] space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-black pb-3">
          <BarChart3 className="w-5 h-5 text-amber-500" />
          <h3 className="text-base sm:text-lg font-black text-black dark:text-white">
            جدول المقارنة الهيكلية وقواعد إدارة المخاطر
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start border-collapse border-2 border-black">
            <thead>
              <tr className="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black">
                <th className="p-3 border border-black font-black text-start">وجه المقارنة</th>
                <th className="p-3 border border-black font-black text-start bg-blue-600/90 text-white">الصفقات المتوسطة 📈</th>
                <th className="p-3 border border-black font-black text-start bg-[#FFE600] text-black">الصفقات القصيرة ⚡ PRO</th>
                <th className="p-3 border border-black font-black text-start">القيمة المضافة للمتداول</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black font-bold text-zinc-800 dark:text-zinc-200">
              <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="p-3 border border-black font-black bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white">
                  ⏱️ متوسط مدة الصفقة
                </td>
                <td className="p-3 border border-black">25 إلى 45 يوماً (أفق أسبوعي وشهري)</td>
                <td className="p-3 border border-black bg-amber-50 dark:bg-amber-950/20 text-black dark:text-white font-black">
                  2.9 جلسات تداول فقط
                </td>
                <td className="p-3 border border-black text-emerald-700 dark:text-emerald-400">
                  سرعة غير مسبوقة في تدوير السيولة وتجنب حبس رأس المال لفترات طويلة.
                </td>
              </tr>

              <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="p-3 border border-black font-black bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white">
                  🛡️ وقف الخسارة (Stop Loss)
                </td>
                <td className="p-3 border border-black">-8% إلى -12% (وقف فني واسع)</td>
                <td className="p-3 border border-black bg-amber-50 dark:bg-amber-950/20 text-black dark:text-white font-black">
                  -4.0% صارم + تأمين عند +4.5%
                </td>
                <td className="p-3 border border-black text-emerald-700 dark:text-emerald-400">
                  حماية محكمة من الهبوط المفاجئ؛ أي صفقة تحقق +4.5% تصبح خالية من المخاطر.
                </td>
              </tr>

              <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="p-3 border border-black font-black bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white">
                  🎯 استراتيجية جني الأرباح
                </td>
                <td className="p-3 border border-black">أهداف سعرية محددة مسبقاً (هدف أول وهدف ثانٍ)</td>
                <td className="p-3 border border-black bg-amber-50 dark:bg-amber-950/20 text-black dark:text-white font-black">
                  وقف متحرك بكسر متوسط EMA10
                </td>
                <td className="p-3 border border-black text-emerald-700 dark:text-emerald-400">
                  لا سقف للأرباح! السهم يصعد ويستمر النظام في ركوب الطفرة (وصلت لـ +81.5%).
                </td>
              </tr>

              <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="p-3 border border-black font-black bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white">
                  🔍 شروط الاختيار والدخول
                </td>
                <td className="p-3 border border-black">نماذج كلاسيكية (قيعان، دعم) + نموذج تعلم آلي</td>
                <td className="p-3 border border-black bg-amber-50 dark:bg-amber-950/20 text-black dark:text-white font-black">
                  انفجار سيولة مؤسسية &gt;140% + اختراق قواعد 20 يوم
                </td>
                <td className="p-3 border border-black text-emerald-700 dark:text-emerald-400">
                  تركيز فقط على الأسهم التي تشهد تدفقات أموال ذكية جاهزة للانفجار الحركي.
                </td>
              </tr>

              <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="p-3 border border-black font-black bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white">
                  📊 كثافة التداول والفرص
                </td>
                <td className="p-3 border border-black">منخفضة إلى متوسطة (3 - 6 إشارات شهرياً)</td>
                <td className="p-3 border border-black bg-amber-50 dark:bg-amber-950/20 text-black dark:text-white font-black">
                  عالية ونشطة (35 - 70 إشارة شهرياً)
                </td>
                <td className="p-3 border border-black text-emerald-700 dark:text-emerald-400">
                  توافر فرص يومية مستمرة للمضارب النشط، مع فرز كمي صارم يمنع العشوائية.
                </td>
              </tr>

              <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="p-3 border border-black font-black bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white">
                  📱 قنوات تليجرام للتنبيهات
                </td>
                <td className="p-3 border border-black">قناة VIP (كاملة) وقناة مجانية (ملخص وإغلاقات)</td>
                <td className="p-3 border border-black bg-amber-50 dark:bg-amber-950/20 text-black dark:text-white font-black">
                  قناة VIP (إشارات لحظية فورية) وقناة مجانية (تلميحات مشفرة)
                </td>
                <td className="p-3 border border-black text-emerald-700 dark:text-emerald-400">
                  تنبيهات فورية في الجلسة لدخول وخروج الصفقات السريعة دون تأخير دقيقة واحدة.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 5. Recommended Portfolio Allocation Strategy ── */}
      <div className="border-4 border-black dark:border-white bg-zinc-950 text-white p-5 sm:p-6 shadow-[5px_5px_0px_#000] dark:shadow-[5px_5px_0px_#fff] space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-base sm:text-lg font-black text-white">
            كيف تدمج النظامين لتحقيق أفضل عائد متوازن لمحفظتك؟
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border-2 border-zinc-700 bg-zinc-900 p-4 space-y-2">
            <span className="text-xs font-black text-amber-400 block uppercase">
              1. استراتيجية المحفظة الهجينة (الأمثل)
            </span>
            <p className="text-xs text-zinc-300 font-bold leading-relaxed">
              تخصيص <strong>60% - 70%</strong> من رأس المال للصفقات المتوسطة ذات الاتجاه الهادئ، وتخصيص <strong>30% - 40%</strong> للصفقات القصيرة ⚡ PRO لاقتناص الطفرات وتوليد تدفق نقدي سريع.
            </p>
          </div>

          <div className="border-2 border-zinc-700 bg-zinc-900 p-4 space-y-2">
            <span className="text-xs font-black text-sky-400 block uppercase">
              2. في فترات تصحيح السوق والاتجاه العرضي
            </span>
            <p className="text-xs text-zinc-300 font-bold leading-relaxed">
              تتفوق الصفقات القصيرة بفضل وقف الخسارة السريع (-4%) والتأمين التلقائي، مما يحمي المحفظة من الهبوط الحاد الذي قد تتعرض له المراكز المتوسطة.
            </p>
          </div>

          <div className="border-2 border-zinc-700 bg-zinc-900 p-4 space-y-2">
            <span className="text-xs font-black text-emerald-400 block uppercase">
              3. في فترات الرالي الصاعد القوي
            </span>
            <p className="text-xs text-zinc-300 font-bold leading-relaxed">
              يعمل كلا النظامين بكفاءة قصوى؛ الصفقات المتوسطة تركب الاتجاه العام للأسهم القيادية، بينما تحقق الصفقات القصيرة عوائد قياسية (+70% إلى +80%) على أسهم المضاربة.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
