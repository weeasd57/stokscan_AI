"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { ArrowLeft, Wallet, Clock, BadgeCheck, FileText } from "lucide-react";
import Link from "next/link";

export default function RefundClient() {
  const { language } = useLanguage();
  const isAr = language === "ar";

  const sections = [
    {
      icon: <Wallet className="w-6 h-6 text-black" />,
      title: { en: "General Policy", ar: "السياسة العامة" },
      content: {
        en: "If you are not satisfied with your EGX Bots subscription, you may request a refund within 3 days of the original purchase date, provided the subscription has not been actively used. No questions asked for first-time refunds.",
        ar: "إذا لم تكن راضيًا عن اشتراكك في EGX Bots، يمكنك طلب استرداد المبلغ خلال 3 أيام من تاريخ الشراء الأصلي، بشرط ألا يكون الاشتراك قد تم استخدامه بشكل فعلي. الاسترداد لأول مرة يتم دون أسئلة."
      }
    },
    {
      icon: <Clock className="w-6 h-6 text-black" />,
      title: { en: "Refund Window", ar: "مدة الاسترداد" },
      content: {
        en: "Refunds must be requested within 3 days of purchase. Requests after this window may be considered at our sole discretion on a case-by-case basis.",
        ar: "يجب طلب الاسترداد خلال 3 أيام من الشراء. الطلبات بعد هذه المدة قد يتم النظر فيها وفقًا لتقديرنا الخاص وحسب كل حالة."
      }
    },
    {
      icon: <BadgeCheck className="w-6 h-6 text-black" />,
      title: { en: "How Refunds Are Processed", ar: "كيفية معالجة الاسترداد" },
      content: {
        en: "Approved refunds are processed back to the original payment method used at checkout (via our payment provider Kashier). The refund typically reflects within 5–10 business days depending on your bank or payment provider.",
        ar: "تتم معالجة الاستردادات المعتمدة من خلال إعادة المبلغ إلى طريقة الدفع الأصلية المستخدمة في عملية الشراء (عبر مزوّد الدفع Kashier). عادةً يظهر المبلغ خلال 5–10 أيام عمل حسب البنك أو مزوّد الدفع الخاص بك."
      }
    },
    {
      icon: <FileText className="w-6 h-6 text-black" />,
      title: { en: "How to Request a Refund", ar: "كيفية طلب الاسترداد" },
      content: {
        en: "Contact us via the support chat or Telegram and include your registered email/account so we can locate your subscription. We aim to respond within 1 business day.",
        ar: "تواصل معنا عبر الشات أو تليجرام واذكر بريدك الإلكتروني المسجّل حتى نتمكن من العثور على اشتراكك. نحرص على الرد خلال يوم عمل واحد."
      }
    },
    {
      icon: <ArrowLeft className="w-6 h-6 text-black" />,
      title: { en: "Non-Refundable Cases", ar: "حالات لا تشمل الاسترداد" },
      content: {
        en: "Data/analytics already delivered, fulfilled signal access, and purchases made more than 3 days ago are generally non-refundable except where required by law.",
        ar: "البيانات والتحليلات التي تم تسليمها بالفعل، والإشارات التي تم تفعيلها، والمشتريات التي مضى عليها أكثر من 3 أيام لا تشملها الاستردادات عمومًا إلا في الحالات التي يوجبها القانون."
      }
    },
  ];

  return (
    <div className="min-h-[70vh] py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-black text-black dark:text-white">
            {isAr ? "سياسة الاسترجاع" : "Refund Policy"}
          </h1>
          <p className="text-zinc-500 font-bold">
            {isAr ? "سياسة استرداد الأموال لاشتراكات EGX Bots" : "Refund policy for EGX Bots subscriptions"}
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((s, i) => (
            <div key={i} className="neobrutal-card p-6 space-y-3 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[5px_5px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_rgba(255,255,255,1)]">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 border-4 border-black dark:border-white bg-emerald-500 text-white flex items-center justify-center">
                  {s.icon}
                </div>
                <h2 className="text-lg font-black text-black dark:text-white">
                  {isAr ? s.title.ar : s.title.en}
                </h2>
              </div>
              <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {isAr ? s.content.ar : s.content.en}
              </p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 h-12 px-6 border-4 border-black dark:border-white bg-emerald-400 text-black font-black uppercase tracking-widest shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
          >
            {isAr ? "العودة إلى الأسعار" : "Back to Pricing"}
          </Link>
        </div>
      </div>
    </div>
  );
}
