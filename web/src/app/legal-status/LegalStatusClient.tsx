"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import {
  ShieldCheck,
  Building2,
  Coins,
  CreditCard,
  UserCheck,
  AlertTriangle,
  ArrowRight,
  Scale,
  FileCheck2,
} from "lucide-react";
import Link from "next/link";
import BrandedPageHeader from "@/components/BrandedPageHeader";

export default function LegalStatusClient() {
  const { language } = useLanguage();
  const isAr = language === "ar";

  const legalPoints = [
    {
      icon: <Building2 className="w-6 h-6 text-black" />,
      badge: isAr ? "طبيعة النشاط البرمجي" : "Software Nature",
      badgeColor: "bg-blue-300",
      title: {
        ar: "منصة برمجيات وتكنولوجيا مالية (FinTech Software)",
        en: "FinTech & Quantitative Software Platform",
      },
      content: {
        ar: "منصة EGX BOTS هي منصة برمجية وتقنية سحابية تقدم للمتعاملين أدوات مسح فني مؤتمتة، ونماذج إحصائية، ومؤشرات كمية مدعومة بالذكاء الاصطناعي لفحص بيانات البورصة المصرية التاريخية وإغلاقات السوق. المنصة أداة تقنية مساعدة لأغراض البحث والتحليل الفني والتعليم الشخصي.",
        en: "EGX BOTS is a cloud-based software and quantitative analytics platform providing technical scanners, algorithmic indicator models, and AI calculations based on historical market data. It operates strictly as an auxiliary software tool for research, educational, and technical analysis purposes.",
      },
    },
    {
      icon: <Scale className="w-6 h-6 text-black" />,
      badge: isAr ? "الهيئة العامة للرقابة المالية FRA" : "FRA & Capital Market Law",
      badgeColor: "bg-amber-300",
      title: {
        ar: "الموقف من تراخيص الهيئة العامة للرقابة المالية (قانون 95 لسنة 1992)",
        en: "Regulatory Status under Egyptian Capital Market Law 95/1992",
      },
      content: {
        ar: "توضح المنصة بشكل قاطع أنها ليست شركة وساطة مالية (Brokerage Firm) ولا شركة استشارات مالية مرخصة من الهيئة العامة للرقابة المالية في مصر (FRA)، ولا تقدم استشارات استثمارية مخصصة أو إدارة محافظ. جميع مخرجات المنصة والنماذج الرياضية والإشارات الرقمية هي مؤشرات فنية مؤتمتة خوارزمياً لا تشكل دعوة ملزمة أو أمراً بشراء أو بيع أي ورقة مالية.",
        en: "The platform explicitly clarifies that it is NOT a licensed brokerage firm nor a financial advisory firm licensed by the Egyptian Financial Regulatory Authority (FRA). It does not provide individualized investment advice or portfolio management. All model outputs and algorithmic signals are automated mathematical indicators, not solicitations or orders to trade securities.",
      },
    },
    {
      icon: <Coins className="w-6 h-6 text-black" />,
      badge: isAr ? "حظر توظيف الأموال" : "Anti-Money Pooling Law",
      badgeColor: "bg-emerald-300",
      title: {
        ar: "عدم تلقي أو إدارة أو توظيف أموال (قانون 146 لسنة 1988)",
        en: "No Funds Acceptance or Management (Law 146/1988)",
      },
      content: {
        ar: "لا تتلقى المنصة أي ودائع أو أموال من المستخدمين بغرض استثمارها أو إدارتها أو تشغيلها، ولا تتقاضى أي نسب من الأرباح ولا تعد بأي عوائد مالية ثابتة أو متغيرة. المقابل المالي الوحيد هو رسوم اشتراك رقمي ثابتة مقابل حق النفاذ واستخدام خدمات البرمجيات (Software as a Service - SaaS).",
        en: "The platform never solicits or accepts deposits or capital for investment or asset management, takes no profit cuts, and never guarantees financial returns. Financial transactions are solely fixed software subscription fees for accessing digital platform capabilities (SaaS model).",
      },
    },
    {
      icon: <CreditCard className="w-6 h-6 text-black" />,
      badge: isAr ? "البنك المركزي المصري" : "Central Bank Compliance",
      badgeColor: "bg-purple-300",
      title: {
        ar: "الامتثال المصرفي وبوابات الدفع المرخصة",
        en: "Certified Payment Processing & CBE Compliance",
      },
      content: {
        ar: "تتم جميع عمليات تحصيل الاشتراكات حصراً بالجنيه المصري من خلال بوابة الدفع الإلكتروني الرسمية والمعتمدة EasyKash، والمرخصة من البنك المركزي المصري. المنصة لا تحفظ ولا تطلع على أي أرقام بطاقات مصرفية أو بيانات سرية للمشتركين.",
        en: "All subscription payments are conducted in Egyptian Pounds through EasyKash, an authorized payment processor compliant with Central Bank of Egypt regulations. The platform neither processes nor stores sensitive card data.",
      },
    },
    {
      icon: <UserCheck className="w-6 h-6 text-black" />,
      badge: isAr ? "مسؤولية المستثمر" : "User Autonomy",
      badgeColor: "bg-pink-300",
      title: {
        ar: "تنفيذ الصفقات ومسؤولية المتداول الكاملة",
        en: "Independent Execution & Trader Responsibility",
      },
      content: {
        ar: "أي قرار استثماري أو عملية شراء أو بيع يتخذها المشترك هي مسؤولية شخصية تامة تخصه وحده، ويتم تنفيذها عبر شركة السمسرة المرخصة المعتمدة التي يتعامل معها المشترك. أسواق المال تنطوي على مخاطر تقلب الأسعار واحتمالية خسارة رأس المال، والأداء السابق لأي نموذج لا يمثل ضماناً للنتائج المستقبلية.",
        en: "Any investment action or trade executed by the user is their sole personal decision and responsibility, performed via their own licensed brokerage. Stock trading entails risk of capital loss, and historical performance is no guarantee of future returns.",
      },
    },
  ];

  return (
    <div className="neobrutal-layout flex flex-col gap-10 pb-20 pt-2 relative -mx-3 sm:-mx-6 md:-mx-8 px-4 md:px-8 min-h-screen neobrutal-grid-bg" dir={isAr ? "rtl" : "ltr"}>
      <BrandedPageHeader
        eyebrow={isAr ? "الشفافية والتنظيم القانوني" : "LEGAL & REGULATORY TRANSPARENCY"}
        title={isAr ? "الموقف القانوني والتنظيمي" : "Legal & Regulatory Status"}
        description={isAr
          ? "توضيح طبيعة المنصة البرمجية، حدود مسؤوليتها القانونية، وامتثالها للقوانين والتشريعات المصرية المعمول بها."
          : "Clarification of platform software nature, limitation of liability, and compliance with applicable Egyptian laws."}
        dir={isAr ? "rtl" : "ltr"}
        badgeIcon={<Scale className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      />

      {/* Highlights Summary Box */}
      <div className="border-4 border-black dark:border-white bg-amber-50 dark:bg-amber-950/30 p-6 sm:p-8 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#f59e0b] space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 border-2 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black shadow-[2px_2px_0px_rgba(0,0,0,1)]">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-zinc-950 dark:text-white">
            {isAr ? "خلاصة الموقف القانوني في سطور واضحة" : "Core Regulatory Summary"}
          </h2>
        </div>
        <p className="text-sm sm:text-base font-bold text-zinc-800 dark:text-zinc-200 leading-relaxed">
          {isAr
            ? "منصة EGX BOTS هي شركة وأداة برمجيات مالية (FinTech SaaS) وليست وسيط تداول أو مستشاراً مالياً معتمداً من الهيئة العامة للرقابة المالية (FRA). المنصة لا تدير أموالاً ولا تتلقى ودائع ولا تضمن أي أرباح. مخرجات الذكاء الاصطناعي والإشارات الفنية هي مؤشرات إحصائية مؤتمتة لأغراض البحث والدراسة الذاتية، وقرار التداول يقع على عاتق المستثمر وحده عبر وسيطه المرخص."
            : "EGX BOTS is an independent financial technology software platform (SaaS) and is not a broker nor a licensed financial advisory firm under the Egyptian FRA. We never manage funds, solicit deposits, or promise guaranteed returns. AI outputs are automated statistical indicators for self-directed research, and trading decisions remain exclusively the user's responsibility."}
        </p>
      </div>

      {/* Detailed Legal Sections */}
      <div className="space-y-6">
        {legalPoints.map((point, index) => (
          <div
            key={index}
            className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,0.2)] space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-zinc-200 dark:border-zinc-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  {point.icon}
                </div>
                <h3 className="text-lg sm:text-xl font-black text-zinc-950 dark:text-white">
                  {point.title[language]}
                </h3>
              </div>
              <span className={`border-2 border-black dark:border-white ${point.badgeColor} text-black text-xs font-black uppercase px-3 py-1 shadow-[2px_2px_0px_rgba(0,0,0,1)]`}>
                {point.badge}
              </span>
            </div>
            <p className="text-sm sm:text-base font-semibold text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {point.content[language]}
            </p>
          </div>
        ))}
      </div>

      {/* Navigation Links */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
        <Link
          href="/disclaimer"
          className="h-12 px-6 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white text-xs font-black uppercase tracking-wider shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2"
        >
          <FileCheck2 className="w-4 h-4" />
          {isAr ? "إخلاء المسؤولية الكامل" : "Full Legal Disclaimer"}
        </Link>
        <Link
          href="/refund"
          className="h-12 px-6 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white text-xs font-black uppercase tracking-wider shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2"
        >
          <Coins className="w-4 h-4" />
          {isAr ? "سياسة الاسترجاع" : "Refund Policy"}
        </Link>
        <Link
          href="/pricing"
          className="h-12 px-6 border-4 border-black dark:border-white bg-emerald-400 text-black text-xs font-black uppercase tracking-wider shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2"
        >
          {isAr ? "الاشتراكات والأسعار" : "Pricing Plans"}
          <ArrowRight className={`w-4 h-4 ${isAr ? "rotate-180" : ""}`} />
        </Link>
      </div>
    </div>
  );
}
