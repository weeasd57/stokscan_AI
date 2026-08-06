"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import {
  HelpCircle,
  ChevronDown,
  Search,
  Brain,
  BarChart3,
  Send,
  UserCircle2,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";

type Language = "en" | "ar";

interface LocalizedText {
  en: string;
  ar: string;
}

interface FAQItem {
  q: LocalizedText;
  a: LocalizedText;
}

interface FAQCategory {
  id: string;
  icon: React.ReactNode;
  title: LocalizedText;
  items: FAQItem[];
}

export default function FAQClient() {
  const { t, language } = useLanguage();
  const isAr = language === "ar";
  const [openId, setOpenId] = useState<string | null>("cat-general-0");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("cat-general");

  const categories: FAQCategory[] = [
    {
      id: "cat-general",
      icon: <Sparkles className="w-5 h-5" />,
      title: { en: "General & Platform", ar: "عن المنصة" },
      items: [
        {
          q: {
            en: "What makes EGX Bots different from basic signal-only bots?",
            ar: "ما الفرق بين EGX Bots كمساعد محادثة تفاعلي وبين بوتات الإشارات التقليدية؟",
          },
          a: {
            en: "EGX Bots features a 24/7 Interactive AI Chatbot where you can chat naturally in Arabic or English, upload portfolio screenshots for instant Vision AI analysis, and discuss technical support and resistance levels. Static signal bots only send one-way text alerts without chat or interactive discussion capabilities.",
            ar: "EGX Bots يوفر شات بوت محادثة ذكي تفاعلي بالكامل (Interactive AI Chatbot) تدردش معه بالعربية والإنجليزي، ترفع له صور وسكرين شوت للمحفظة الاستثمارية لتحليلها فوراً بالرؤية الحسابية، وتسأله عن تفاصيل الدعم والمقاومة وتوزيع السيولة. هذا يختلف جذرياً عن البوتات المغلقة التي تقتصر على إرسال إشارات شراء وبيع جافة ومكتوبة مقدماً بدون محادثة أو مناقشة.",
          },
        },
        {
          q: {
            en: "What is EGX Bots?",
            ar: "ما هو EGX Bots؟",
          },
          a: {
            en: "EGX Bots is an AI-powered analysis platform for the Egyptian Exchange (EGX). It combines a 24/7 interactive AI chatbot, a technical scanner, machine-learning models, backtesting, and pattern matching for Egyptian investors.",
            ar: "EGX Bots هي منصة تحليل أسهم البورصة المصرية (EGX) بالذكاء الاصطناعي. تجمع المنصة بين الشات بوت التفاعلي 24/7، الماسح الفني، نماذج التعلم الآلي، المحاكاة التاريخية، وتشابه النماذج لتقديم إشارات وتحليلات مدعومة بالبيانات.",
          },
        },
        {
          q: {
            en: "Are the AI signals financial advice?",
            ar: "هل إشارات الذكاء الاصطناعي نصيحة مالية؟",
          },
          a: {
            en: "No. The model outputs and trading signals are analytical tools only and are not financial advice or investment recommendations. The final decision and the act of trading are your personal responsibility. Stock trading involves risk and may result in capital loss.",
            ar: "لا. مخرجات النماذج وإشارات التداول هي أدوات تحليلية مساعدة فقط وليست نصيحة مالية أو توصية استثمارية. القرار النهائي والتداول مسؤوليتك الشخصية. التداول في الأسهم ينطوي على مخاطر وقد يؤدي إلى خسارة رأس المال.",
          },
        },
        {
          q: {
            en: "Which markets does EGX Bots support?",
            ar: "ما الأسواق التي يدعمها EGX Bots؟",
          },
          a: {
            en: "We focus primarily on the Egyptian Exchange (EGX), with models trained exclusively on Egyptian market data and behavior. The platform also supports viewing selected US stocks for comparison, but the AI signals and recommendations are specifically engineered for EGX market behavior.",
            ar: "نركز بشكل أساسي على البورصة المصرية (EGX) مع تدريب النماذج حصرياً على بيانات وأنماط السوق المصري. يدعم النظام أيضاً عرض أسهم أمريكية مختارة للمقارنة، لكن إشارات الذكاء الاصطناعي والتوصيات مصممة خصيصاً لسلوك سوق EGX.",
          },
        },
        {
          q: {
            en: "Do I need an account to use the platform?",
            ar: "هل أحتاج حساب لاستخدام المنصة؟",
          },
          a: {
            en: "You can explore the technical scanner and view backtests without an account. Creating a free account lets you save a synced watchlist, track trading positions, set targets and stop-loss defaults, and subscribe to Telegram trading-bot alerts.",
            ar: "يمكنك تصفح الماسح الفني وعرض المحاكاة التاريخية بدون حساب. إنشاء حساب مجاني يتيح لك حفظ قائمة مراقبة متزامنة، تتبع مراكز التداول، تحديد أهداف ووقف خسارة افتراضية، والاشتراك في تنبيهات بوتات التداول عبر تليجرام.",
          },
        },
        {
          q: {
            en: "How often is market data updated?",
            ar: "كم مرة تتحدث بيانات السوق والإشارات؟",
          },
          a: {
            en: "Price data and indicators update daily after the trading session closes. Telegram technical alerts run in real time during the trading day and fire as soon as your saved filter conditions are met.",
            ar: "تتحدث بيانات الأسعار والمؤشرات يومياً بعد إغلاق الجلسة. أما تنبيهات تليجرام الفنية فتعمل بشكل لحظي أثناء تداول اليوم بمجرد تحقق شروط الفلتر الذي حددته.",
          },
        },
      ],
    },
    {
      id: "cat-ai",
      icon: <Brain className="w-5 h-5" />,
      title: { en: "AI & Models", ar: "الذكاء الاصطناعي والنماذج" },
      items: [
        {
          q: {
            en: "How do the AI models work?",
            ar: "كيف تعمل نماذج الذكاء الاصطناعي؟",
          },
          a: {
            en: "We use Random Forest classifiers and gradient-boosted trees trained on years of EGX data. Instead of relying on a single indicator, the model combines fundamentals (P/E, market cap) with technicals (RSI, MACD, EMA crosses, volume) and market regime to identify high-probability setups. Each prediction comes with a confidence score.",
            ar: "نستخدم مصنفات الغابة العشوائية وأشجار التعزيز المتدرج المدربة على سنوات من بيانات EGX. بدلاً من الاعتماد على مؤشر واحد، يجمع النموذج بين الأساسيات (نسبة السعر للأرباح، القيمة السوقية) والمؤشرات الفنية (RSI، MACD، تقاطعات EMA، الحجم) وحالة السوق لاكتشاف الفرص عالية الاحتمالية. كل توقع يأتي بدرجة ثقة.",
          },
        },
        {
          q: {
            en: "What are the available models like model_EGX and KING?",
            ar: "ما هي النماذج المتاحة مثل model_EGX و KING؟",
          },
          a: {
            en: "model_EGX is a precision-focused model that uses a 0.60 confidence threshold, so it takes fewer, carefully selected trades. The KING model is more active and takes a larger number of trades to target a higher cumulative return. Both are trained on EGX data and use an adaptive exit system that detects market regime (bull/sideways/bear).",
            ar: "model_EGX نموذج دقيق يستخدم عتبة ثقة 0.60 فيدخل صفقات قليلة مختارة بعناية. نموذج KING أكثر نشاطاً ويدخل عدداً أكبر من الصفقات بهدف تحقيق عائد تراكمي أعلى. كلا النموذجين مدربان على بيانات EGX ويستخدمان نظام خروج تكيفي يكشف حالة السوق (ثور/تذبذب/دب).",
          },
        },
        {
          q: {
            en: "What does AI Precision mean?",
            ar: "ماذا تعني دقة الذكاء الاصطناعي (Precision)؟",
          },
          a: {
            en: "Precision means: among all signals the model produced during the backtest, how many were correct. High precision usually indicates higher-quality signals with fewer false positives, even if that means fewer total trades.",
            ar: "الدقة تعني: من بين جميع الإشارات التي أنتجها النموذج أثناء المحاكاة، كم منها كان صحيحاً. الدقة العالية تشير عادةً إلى إشارات أعلى جودة بأخطاء أقل، حتى لو كان عدد الصفقات الكلي أقل.",
          },
        },
        {
          q: {
            en: "What is the Triple Barrier Method?",
            ar: "ما هي طريقة الحاجز الثلاثي (Triple Barrier Method)؟",
          },
          a: {
            en: "The Triple Barrier Method is a target-labeling technique that sets three barriers: a take-profit barrier above, a stop-loss barrier below, and a time limit. A trade is labeled by which barrier is hit first, producing realistic training labels for the model.",
            ar: "طريقة الحاجز الثلاثي هي أسلوب تصنيف أهداف التدريب حيث تُحدد ثلاثة حواجز: هدف الربح (Take Profit) من الأعلى، وقف الخسارة (Stop Loss) من الأسفل، وحد زمني للتداول. يُصنّف السهم بناءً على أي حاجز يُلمس أولاً، ما ينتج تسميات تدريب واقعية للنموذج.",
          },
        },
      ],
    },
    {
      id: "cat-backtest",
      icon: <BarChart3 className="w-5 h-5" />,
      title: { en: "Backtesting & Integrity", ar: "المحاكاة التاريخية والنزاهة" },
      items: [
        {
          q: {
            en: "How does the backtesting engine work?",
            ar: "كيف يعمل محرك المحاكاة التاريخية (Backtest)؟",
          },
          a: {
            en: "The engine replays a strategy on real historical data to compute win rate, total return, average return per trade, and trade count. It applies realistic rules: trades execute on the next day, stop-loss is prioritized when both TP and SL are hit in the same day, and the trailing stop is applied from the next bar to prevent look-ahead bias.",
            ar: "محرك المحاكاة يعيد تشغيل الاستراتيجية على بيانات تاريخية حقيقية لحساب نسبة النجاح، إجمالي العائد، متوسط العائد لكل صفقة، وعدد الصفقات. يطبق المحرك قواعد واقعية: تنفيذ الصفقة في اليوم التالي، أولوية وقف الخسارة عند كسره مع هدف الربح في نفس اليوم، ووقف خسارة متحرك يُطبق على الشمعة التالية لمنع تحيز النظر للأمام (look-ahead bias).",
          },
        },
        {
          q: {
            en: "How do you prevent future data leakage (look-ahead bias)?",
            ar: "كيف يمنع النظام تسرب البيانات المستقبلية (data leakage)؟",
          },
          a: {
            en: "We use shift(1) on features so the model only sees data available up to today's close. StandardScaler and PCA are fitted on the training set only, and we call .transform() on test data. We also apply Purged/Embargo K-Fold validation that deletes a gap equal to the holding period at each split boundary.",
            ar: "نستخدم تحويلات shift(1) للميزات حتى لا يصل النموذج إلا للمعلومات المتاحة حتى إغلاق اليوم. يتم ملاءمة StandardScaler و PCA على بيانات التدريب فقط ونستخدم .transform() على بيانات الاختبار. كما نطبق تحقق Purged/Embargo K-Fold مع حذف فجوة تساوي فترة احتفاظ الصفقة عند حدود الانقسام.",
          },
        },
        {
          q: {
            en: "What is Historical Similarity?",
            ar: "ما هي النماذج التاريخية المتكررة (Historical Similarity)؟",
          },
          a: {
            en: "The similarity tool scans a stock's history for past periods whose technical setup (RSI, moving averages, volume) matches the current setup, then shows what happened to price afterwards. This helps you anticipate likely behavior based on comparable historical scenarios.",
            ar: "أداة النماذج المتكررة تبحث في تاريخ السهم عن فترات سابقة تشابه الوضع الفني الحالي (نفس نمط RSI والمتوسطات والحجم) وتعرض ماذا حدث للسعر بعدها، لتساعدك على توقع السلوك المحتمل بناءً على سيناريوهات تاريخية مماثلة.",
          },
        },
        {
          q: {
            en: "Did the models survive Egypt's hardest market year (2022)?",
            ar: "هل نجت النماذج من أصعب سنة في السوق المصري (2022)؟",
          },
          a: {
            en: "Yes. In a full-year 2022 stress test covering the Egyptian pound's devaluation and high volatility, both production models preserved and grew capital. KING returned +28.1% (vs EGX30 +22.6%) while model_EGX returned +8.1% with a 50% win rate on just 20 high-confidence trades.",
            ar: "نعم. في اختبار ضغط شامل لعام 2022 شمل انهيار الجنيه المصري والتقلبات العالية، حافظ كلا النموذجين على رأس المال ونمّياه. حقق KING عائداً +28.1% (مقابل EGX30 +22.6%) بينما حقق model_EGX عائداً +8.1% بنسبة نجاح 50% على 20 صفقة عالية الثقة فقط.",
          },
        },
      ],
    },
    {
      id: "cat-telegram",
      icon: <Send className="w-5 h-5" />,
      title: { en: "Telegram & Alerts", ar: "تليجرام والتنبيهات" },
      items: [
        {
          q: {
            en: "How do I receive Telegram alerts?",
            ar: "كيف أتلقى إشارات تليجرام (Telegram Alerts)؟",
          },
          a: {
            en: "Log in, go to the Profile page, link your Telegram by clicking the connect button and pressing Start in the bot chat. You can then create custom technical alerts (e.g. EGX stocks with RSI under 30) and receive instant Telegram signals whenever your conditions are met.",
            ar: "سجّل الدخول، اذهب إلى صفحة الملف الشخصي، اربط حساب تليجرام بالضغط على زر ربط البوت ثم اضغط Start داخل المحادثة. بعدها يمكنك إنشاء تنبيهات فنية مخصصة (مثل أسهم RSI أقل من 30) وستصلك الإشارات الفورية عبر تليجرام عند تحقق الشروط.",
          },
        },
        {
          q: {
            en: "What trading bots can I subscribe to?",
            ar: "ما بوتات التداول التي يمكنني الاشتراك فيها؟",
          },
          a: {
            en: "You can subscribe to active trading bots that run our AI models in live mode and push signals to your Telegram. Each bot has an identity, mode (aggressive/defensive/hybrid), model, and live stats including trades, win rate, and net P/L.",
            ar: "يمكنك الاشتراك في بوتات تداول نشطة تشغل نماذج الذكاء الاصطناعي في الوضع المباشر وترسل الإشارات إلى تليجرام. لكل بوت هوية، نمط (نشط/حذر/متوازن)، موديل، وإحصائيات حية تشمل الصفقات ونسبة النجاح وصافي الأرباح.",
          },
        },
        {
          q: {
            en: "My Telegram username shows inactive, what do I do?",
            ar: "معرف تليجرام لدي غير مفعّل، ماذا أفعل؟",
          },
          a: {
            en: "Open the Profile page, set your Telegram Chat ID, and activate the bot by pressing Start inside the bot chat. Until then, technical alerts will not be delivered.",
            ar: "افتح صفحة الملف الشخصي، عيّن معرف تليجرام الخاص بك، وفعّل البوت بالضغط على Start داخل محادثة البوت. حتى ذلك الحين لن تصل التنبيهات الفنية.",
          },
        },
      ],
    },
    {
      id: "cat-account",
      icon: <UserCircle2 className="w-5 h-5" />,
      title: { en: "Account & Pricing", ar: "الحساب والأسعار" },
      items: [
        {
          q: {
            en: "Is there a free plan and what are its limits?",
            ar: "هل يوجد اشتراك مجاني؟ وما حدوده؟",
          },
          a: {
            en: "Yes. The free plan lets you use the technical scanner, view backtests, and inspect models. It limits trading-bot subscriptions to two bots. To get higher limits and extra features you can upgrade to the Pro plan.",
            ar: "نعم، توجد خطة مجانية تتيح استخدام الماسح الفني والمحاكاة التاريخية وعرض النماذج. الخطة المجانية تحدّ اشتراكات بوتات التداول إلى بوتين اثنين. للحصول على حدود أعلى وميزات إضافية يمكنك الترقية إلى الخطة الاحترافية (Pro).",
          },
        },
        {
          q: {
            en: "Can I save a watchlist and track my positions?",
            ar: "هل يمكنني حفظ قائمة مراقبة ومتابعة مراكزي؟",
          },
          a: {
            en: "Yes. Log in to save a watchlist and sync it across your devices. From the Profile page you can track open and closed positions, set default targets and stop-loss, and review your overall win rate.",
            ar: "نعم. سجّل الدخول لحفظ قائمة المراقبة ومزامنتها عبر أجهزتك. من صفحة الملف الشخصي يمكنك تتبع المراكز المفتوحة والمغلقة، تحديد أهداف ووقف خسارة افتراضية، وعرض نسبة النجاح الإجمالية لتداولاتك.",
          },
        },
        {
          q: {
            en: "How do I log in or create an account?",
            ar: "كيف أسجّل الدخول أو أنشئ حساباً؟",
          },
          a: {
            en: "Use the Login button in the header to sign in with email and password or Google. If you don't have an account, choose Create one on the login page to sign up for free and sync your watchlist, targets, and stats.",
            ar: "استخدم زر تسجيل الدخول في الهيدر للدخول بالبريد وكلمة المرور أو عبر جوجل. إذا لم يكن لديك حساب، اختر إنشاء حساب في صفحة الدخول للتسجيل مجاناً ومزامنة قائمة المراقبة والأهداف والإحصائيات.",
          },
        },
      ],
    },
  ];

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (it) =>
            it.q.en.toLowerCase().includes(q) ||
            it.q.ar.includes(query.trim()) ||
            it.a.en.toLowerCase().includes(q) ||
            it.a.ar.includes(query.trim())
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [query, categories]);

  const totalQuestions = categories.reduce(
    (sum, cat) => sum + cat.items.length,
    0
  );

  const toggle = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  const scrollToCat = (id: string) => {
    setActiveCat(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="neobrutal-layout flex flex-col gap-12 pb-20 pt-2 relative -mx-3 sm:-mx-6 md:-mx-8 px-4 md:px-8 min-h-screen neobrutal-grid-bg">
      {/* Header section */}
      <header className="space-y-4 max-w-3xl pt-8">
        <div className="inline-flex items-center gap-2 border-4 border-black dark:border-white px-4 py-2 neobrutal-bg-yellow font-black text-xs sm:text-sm uppercase tracking-widest rotate-[-1deg] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:rotate-0 transition-transform duration-200 cursor-pointer">
          <HelpCircle className="w-4 h-4 text-black" />
          <span className="text-black">
            {isAr ? "الأسئلة الشائعة" : "Frequently Asked Questions"}
          </span>
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tighter text-black dark:text-white uppercase drop-shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:drop-shadow-[4px_4px_0px_rgba(255,255,255,0.15)] pt-2">
          {isAr ? "كل ما تريد معرفته" : "Everything You Need To Know"}
        </h1>
        <p className="text-zinc-800 dark:text-zinc-300 text-base sm:text-lg max-w-2xl font-bold leading-relaxed">
          {isAr
            ? `إجابات تفصيلية على ${totalQuestions} سؤال حول منصة EGX Bots، الذكاء الاصطناعي، الماسح الفني، المحاكاة التاريخية، إشارات تليجرام، والاشتراكات.`
            : `Detailed answers to ${totalQuestions} questions about EGX Bots, AI models, the technical scanner, backtesting, Telegram alerts, and subscriptions.`}
        </p>

        {/* Search */}
        <div className="relative flex items-center w-full max-w-xl pt-2">
          <Search className="absolute left-3 w-4 h-4 text-black/60 dark:text-white/60 pointer-events-none z-10" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAr ? "ابحث في الأسئلة..." : "Search questions..."}
            className="h-12 w-full rounded-none pl-10 pr-4 text-sm font-bold outline-none border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white placeholder-black/50 dark:placeholder-white/50 focus:bg-[#FFE600] focus:text-black transition-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]"
          />
        </div>
      </header>

      {/* Category quick-nav */}
      {!query && (
        <div className="flex flex-wrap gap-3">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => scrollToCat(cat.id)}
              className={`inline-flex items-center gap-2 border-4 border-black dark:border-white px-4 py-2 font-black text-xs sm:text-sm uppercase tracking-widest transition-all duration-200 cursor-pointer ${
                activeCat === cat.id
                  ? "neobrutal-bg-yellow shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]"
                  : "bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[5px_5px_0px_0px_rgba(255,255,255,1)]"
              }`}
            >
              {cat.icon}
              <span>
                {cat.title[language]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* No results */}
      {filteredCategories.length === 0 && (
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-8 text-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)]">
          <p className="font-black uppercase tracking-widest text-black dark:text-white">
            {isAr
              ? "لا توجد نتائج مطابقة لبحثك."
              : "No results match your search."}
          </p>
        </div>
      )}

      {/* FAQ accordion sections */}
      <div className="flex flex-col gap-12">
        {filteredCategories.map((cat) => (
          <section key={cat.id} id={cat.id} className="scroll-mt-28">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 border-4 border-black dark:border-white neobrutal-bg-yellow flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)]">
                {cat.icon}
              </div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-black dark:text-white uppercase">
                {cat.title[language]}
              </h2>
            </div>

            <div className="flex flex-col gap-5">
              {cat.items.map((item, i) => {
                const itemId = `${cat.id}-${i}`;
                const isOpen = openId === itemId;
                return (
                  <div
                    key={itemId}
                    className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] transition-all duration-200 ${
                      isOpen
                        ? "translate-x-[-2px] translate-y-[-2px] shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)]"
                        : "hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)]"
                    }`}
                  >
                    <button
                      onClick={() => toggle(itemId)}
                      className="w-full flex items-center justify-between gap-4 p-5 text-left cursor-pointer"
                      aria-expanded={isOpen}
                    >
                      <h3 className="text-base sm:text-lg font-black text-black dark:text-white tracking-tight leading-snug">
                        {item.q[language]}
                      </h3>
                      <span
                        className={`shrink-0 w-8 h-8 border-2 border-black dark:border-white flex items-center justify-center transition-transform duration-200 ${
                          isOpen
                            ? "neobrutal-bg-yellow rotate-180"
                            : "bg-black dark:bg-zinc-800"
                        }`}
                      >
                        <ChevronDown
                          className={`w-4 h-4 ${
                            isOpen ? "text-black" : "text-white"
                          }`}
                        />
                      </span>
                    </button>

                    {isOpen && (
                      <div className="px-5 pb-5 -mt-1">
                        <div className="border-t-2 border-black dark:border-white pt-4">
                          <p className="text-sm sm:text-base text-zinc-850 dark:text-zinc-200 font-semibold leading-relaxed">
                            {item.a[language]}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* CTA section */}
      <section className="mt-4 border-4 border-black dark:border-white bg-[#fb923c] dark:bg-amber-500 p-8 sm:p-12 text-center space-y-6 relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[10px_10px_0px_0px_rgba(255,255,255,1)] transition-all duration-200">
        <div className="w-14 h-14 border-4 border-black neobrutal-bg-yellow flex items-center justify-center mx-auto shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
          <Sparkles className="w-7 h-7 text-black" />
        </div>

        <h2 className="text-2xl sm:text-3xl font-black text-black uppercase tracking-tight">
          {isAr ? "هل ما زال لديك سؤال؟" : "Still have a question?"}
        </h2>
        <p className="text-black max-w-lg mx-auto text-sm sm:text-base font-extrabold leading-relaxed">
          {isAr
            ? "ابدأ بفحص سوق EGX الآن أو تواصل معنا عبر تليجرام. فريقنا جاهز لمساعدتك في رحلتك الاستثمارية."
            : "Start scanning the EGX market now or reach us on Telegram. Our team is ready to help with your investment journey."}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto pt-2">
          <Link
            href="/scanner/technical"
            className="h-14 px-8 border-4 border-black bg-black text-white text-xs font-black uppercase tracking-widest hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-2"
          >
            {isAr ? "ابدأ الفحص" : "Start Scanning"}
            <ArrowRight
              className={`w-4 h-4 ${isAr ? "rotate-180" : ""}`}
            />
          </Link>
          <Link
            href="/scanner/backtests"
            className="h-14 px-8 border-4 border-black bg-white text-black text-xs font-black uppercase tracking-widest hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center"
          >
            {t("nav.scanner.ai_trading")}
          </Link>
        </div>
      </section>
    </div>
  );
}
