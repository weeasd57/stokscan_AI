"use client";

import Link from "next/link";
import { useChat } from "@/contexts/ChatContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Brain,
  Sparkles,
  Zap,
  TrendingUp,
  ShieldCheck,
  BarChart3,
  Bot,
  ChevronDown,
  LineChart,
  Search,
  MessageSquare
} from "lucide-react";
import { useState } from "react";

export default function AIScannerClient() {
  const { setIsOpen } = useChat();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const toggleFaq = (idx: number) => {
    setOpenFaq(openFaq === idx ? null : idx);
  };

  const openAIChat = () => {
    setIsOpen(true);
  };

  const faqs = [
    {
      q: "كيف يعمل محلل الأسهم بالذكاء الاصطناعي (EGX AI Analyzer)؟",
      a: "يعتمد المحلل على نماذج تعلم آلي كمّية (Machine Learning) تم تدريبها على سنوات من بيانات التداول التاريخية في البورصة المصرية (EGX). يقوم المحلل بفحص حركة السعر، السيولة، مؤشرات الزخم (RSI, MACD, ADX)، ونسب التداول لتوليد تقييم رقمي موضوعي لكل سهم دون أي تحيز بشري."
    },
    {
      q: "ما هو مقياس الذكاء الاصطناعي (AI Score) من 1 إلى 10؟",
      a: "المقياس هو تصنيف احتمالي لقوة حركة السهم: من 1 إلى 3 يمثل مناطق ضغط بيعي أو خروج (Sell / Strong Sell)، ومن 4 إلى 6 يمثل مناطق اتجاه عرضي أو احتفاظ (Hold)، ومن 7 إلى 10 يمثل فرص شراء ذات احتمالية إيجابية مرتفعة (Buy / Strong Buy)."
    },
    {
      q: "كيف يمكنني استخدام الشات بوت التفاعلي لتحليل سهمي؟",
      a: "يمكنك الضغط على زر 'تشغيل المساعد الذكي' في أي وقت، وكتابة اسم أو رمز أي سهم مصري (مثل COMI أو ETEL)، أو حتى رفع لقطة شاشة لمحفظتك أو الشارت، وسيقوم المساعد الذكي بتحليل الوضع المالي والفني ونقاط الدعم والمقاومة فوراً."
    },
    {
      q: "هل التحليلات والإشارات مجانية؟",
      a: "نعم، يمكنك استعراض تقييمات الأسهم والماسح الفني ومحاكاة الاستراتيجيات واستخدام المساعد الذكي مجاناً عبر منصة EGX BOTS."
    }
  ];

  return (
    <main dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-yellow-400 selection:text-black">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-zinc-800 bg-gradient-to-b from-zinc-900/60 via-zinc-950 to-zinc-950 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]" />
        
        <div className="relative mx-auto max-w-5xl text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400/40 bg-yellow-400/10 px-4 py-1.5 text-xs font-semibold text-yellow-400 sm:text-sm">
            <Sparkles className="h-4 w-4 animate-pulse" />
            <span>EGX AI Analyzer & Quantitative Engine</span>
          </div>

          {/* Heading */}
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
            محلل الأسهم المصرية بالذكاء الاصطناعي
            <span className="block mt-2 bg-gradient-to-r from-yellow-400 via-amber-300 to-orange-400 bg-clip-text text-transparent">
              EGX AI Stock Analyzer
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-zinc-400 sm:text-lg lg:text-xl">
            نظام التحليل الكمّي الأحدث للبورصة المصرية. خوارزميات ذكاء اصطناعي تفحص أكثر من 270+ سهم مصري يومياً، 
            لحساب تقييمات دقيقة من 1 إلى 10، كشف مستويات السيولة، وتقديم إشارات استرشادية مدعومة بالبيانات التاريخية.
          </p>

          {/* Primary CTAs */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={openAIChat}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-yellow-400 bg-yellow-400 px-6 py-3.5 text-sm font-black text-black shadow-[4px_4px_0_0_#fff] transition hover:translate-y-0.5 hover:shadow-none sm:text-base"
            >
              <Bot className="h-5 w-5" />
              <span>تشغيل المساعد الذكي والمحلل الآن</span>
            </button>

            <Link
              href="/scanner/backtests"
              className="inline-flex items-center gap-2 rounded-xl border-2 border-zinc-700 bg-zinc-900 px-6 py-3.5 text-sm font-bold text-zinc-200 shadow-[4px_4px_0_0_#3f3f46] transition hover:translate-y-0.5 hover:border-zinc-500 hover:text-white hover:shadow-none sm:text-base"
            >
              <LineChart className="h-5 w-5 text-indigo-400" />
              <span>محرك المحاكاة والتقييمات (Backtests)</span>
            </Link>

            <Link
              href="/scanner/technical"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-3 text-sm font-semibold text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              <Search className="h-4 w-4" />
              <span>الماسح الفني للأسهم</span>
            </Link>
          </div>

          {/* Key Stats Bar */}
          <div className="mt-14 grid grid-cols-2 gap-4 border-t border-zinc-800/80 pt-8 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
              <div className="text-2xl font-black text-yellow-400 sm:text-3xl">279+</div>
              <div className="mt-1 text-xs text-zinc-400">سهم مصري تحت الرصد</div>
            </div>
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
              <div className="text-2xl font-black text-emerald-400 sm:text-3xl">1 - 10</div>
              <div className="mt-1 text-xs text-zinc-400">مقياس الذكاء الاصطناعي</div>
            </div>
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
              <div className="text-2xl font-black text-cyan-400 sm:text-3xl">24/7</div>
              <div className="mt-1 text-xs text-zinc-400">شات بوت تفاعلي مباشر</div>
            </div>
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
              <div className="text-2xl font-black text-purple-400 sm:text-3xl">0%</div>
              <div className="mt-1 text-xs text-zinc-400">تحيز عاطفي أو بشري</div>
            </div>
          </div>
        </div>
      </section>

      {/* Pillars Section */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-2xl font-black sm:text-3xl">
            ما الذي يقدمه لك محلل البورصة المصرية (EGX AI Analyzer)؟
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-400 sm:text-base">
            تم بناء المنصة لسد الفجوة بين التحليل الفني الكلاسيكي والتحليل الكمّي الحديث المعتمد على خوارزميات التعلم الآلي.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Card 1 */}
          <div className="rounded-2xl border-2 border-zinc-800 bg-zinc-900/60 p-6 shadow-sm transition hover:border-yellow-400/80">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-400">
              <Brain className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">تصنيف ذكي (AI Score)</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              نموذج احتمالي يقيّم كل سهم من 1 إلى 10، ليوضح ما إذا كان السهم يمر بمرحلة تجميع قوي، اتجاه صاعد، أو مناطق تصريف وحاجة لتفعيل وقف الخسارة.
            </p>
          </div>

          {/* Card 2 */}
          <div className="rounded-2xl border-2 border-zinc-800 bg-zinc-900/60 p-6 shadow-sm transition hover:border-emerald-400/80">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">محاكاة واختبار تاريخي (Backtesting)</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              لا نعتمد على التخمين. خوارزمياتنا تم اختبارها تاريخياً بطريقة الحاجز الثلاثي (Triple Barrier) مع منع تسرب البيانات المستقبلية لحساب نسب الربح الحقيقية.
            </p>
          </div>

          {/* Card 3 */}
          <div className="rounded-2xl border-2 border-zinc-800 bg-zinc-900/60 p-6 shadow-sm transition hover:border-cyan-400/80">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-400">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">شات بوت البورصة التفاعلي</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              تحاور مع المساعد الذكي، اسأله عن نقاط الدعم والمقاومة، قارن بين سهمين في ثوانٍ، أو ارفع صورة شارت ومحفظتك لتحليلها فوراً.
            </p>
          </div>

          {/* Card 4 */}
          <div className="rounded-2xl border-2 border-zinc-800 bg-zinc-900/60 p-6 shadow-sm transition hover:border-purple-400/80">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-400/10 text-purple-400">
              <TrendingUp className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">رصد السيولة والتقاطعات الذهبية</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              تنبيهات فورية لتقاطعات المتوسطات المتحركة (EMA50/EMA200)، مؤشر القوة النسبية RSI، واختراقات أحجام التداول غير الاعتيادية في السوق.
            </p>
          </div>

          {/* Card 5 */}
          <div className="rounded-2xl border-2 border-zinc-800 bg-zinc-900/60 p-6 shadow-sm transition hover:border-orange-400/80">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-400/10 text-orange-400">
              <BarChart3 className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">فحص التوافق مع الشريعة</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              فلترة فورية للأسهم المتوافقة مع الضوابط الشرعية المعتمدة في السوق المصري لتسهيل اتخاذ القرار الاستثماري المناسب.
            </p>
          </div>

          {/* Card 6 */}
          <div className="rounded-2xl border-2 border-zinc-800 bg-zinc-900/60 p-6 shadow-sm transition hover:border-pink-400/80">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pink-400/10 text-pink-400">
              <Zap className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">تحديث يومي فوري</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              مع نهاية كل جلسة تداول بالبورصة المصرية، تتم معالجة البيانات وإعادة تشغيل النماذج لتقديم تقرير جاهز قبل افتتاح الجلسة التالية.
            </p>
          </div>
        </div>
      </section>

      {/* Interactive Score Explainer */}
      <section className="border-y border-zinc-800 bg-zinc-900/40 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-black text-white sm:text-3xl">
            كيف تقرأ درجات الـ AI Score في المنصة؟
          </h2>
          <p className="mt-3 text-sm text-zinc-400 sm:text-base">
            نظام تصنيف مكون من 10 مستويات يترجم ملايين العمليات الحسابية إلى إشارة سهلة ومباشرة
          </p>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border-2 border-red-900/60 bg-red-950/20 p-5 text-right">
              <div className="flex items-center justify-between">
                <span className="rounded bg-red-500/20 px-2.5 py-1 font-mono text-xs font-bold text-red-400">1 - 3</span>
                <span className="text-sm font-black text-red-400">بيع / تخفيف (Sell)</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                إشارات تدل على ضغط بيعي مرتفع، كسر دعوم رئيسية، أو ضعف في الزخم. ينصح بالحذر ومراقبة وقف الخسارة.
              </p>
            </div>

            <div className="rounded-xl border-2 border-amber-900/60 bg-amber-950/20 p-5 text-right">
              <div className="flex items-center justify-between">
                <span className="rounded bg-amber-500/20 px-2.5 py-1 font-mono text-xs font-bold text-amber-400">4 - 6</span>
                <span className="text-sm font-black text-amber-400">احتفاظ / محايد (Hold)</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                السهم يتحرك داخل نطاق عرضي أو مرحلة ترقب وتجميع. مناسب للمتابعة حتى تأكيد الاتجاه الصاعد.
              </p>
            </div>

            <div className="rounded-xl border-2 border-emerald-900/60 bg-emerald-950/20 p-5 text-right">
              <div className="flex items-center justify-between">
                <span className="rounded bg-emerald-500/20 px-2.5 py-1 font-mono text-xs font-bold text-emerald-400">7 - 10</span>
                <span className="text-sm font-black text-emerald-400">شراء قوي (Buy)</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                توافق إيجابي بين تدفق السيولة والزخم الفني، مع احتمالية صعود متفوقة على أداء مؤشر البورصة EGX30.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Accordion Section */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-2xl font-black text-white sm:text-3xl">
            الأسئلة الشائعة عن محلل الأسهم بالذكاء الاصطناعي
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            إجابات واضحة على كل ما يهمك حول المنصة والنماذج
          </p>
        </div>

        <div className="mt-10 space-y-4">
          {faqs.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 transition"
              >
                <button
                  onClick={() => toggleFaq(idx)}
                  className="flex w-full items-center justify-between px-5 py-4 text-right font-bold text-white transition hover:bg-zinc-800/40"
                >
                  <span className="text-sm sm:text-base">{faq.q}</span>
                  <ChevronDown
                    className={`h-5 w-5 text-zinc-400 transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-yellow-400" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-zinc-800/80 px-5 py-4 text-xs leading-relaxed text-zinc-300 sm:text-sm">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="border-t border-zinc-800 bg-gradient-to-r from-yellow-500/10 via-amber-500/5 to-transparent px-4 py-14 text-center sm:px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-black text-white sm:text-3xl">
            ابدأ تحليلك القادم في البورصة المصرية بذكاء ودقة
          </h2>
          <p className="mt-3 text-sm text-zinc-400 sm:text-base">
            استفد من قوة الذكاء الاصطناعي في فحص الأسهم واتخاذ قرارات مبنية على الأرقام الحقيقية.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <button
              onClick={openAIChat}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-yellow-400 bg-yellow-400 px-6 py-3 text-sm font-black text-black shadow-[4px_4px_0_0_#fff] transition hover:translate-y-0.5 hover:shadow-none sm:text-base"
            >
              <Bot className="h-5 w-5" />
              <span>جرب الشات بوت الذكي الآن مجاناً</span>
            </button>
            <Link
              href="/faq"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-bold text-zinc-300 transition hover:border-zinc-500 hover:text-white sm:text-base"
            >
              <span>مركز المساعدة والأسئلة الشائعة</span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
