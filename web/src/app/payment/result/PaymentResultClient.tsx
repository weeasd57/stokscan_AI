"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import Link from "next/link";

export default function PaymentResultClient() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const searchParams = useSearchParams();
  const orderRef =
    searchParams.get("order_ref") ||
    searchParams.get("merchantOrderId") ||
    searchParams.get("order") ||
    "";

  const [status, setStatus] = useState<"pending" | "success" | "failed" | "unknown">("pending");

  useEffect(() => {
    if (!orderRef) {
      setStatus("unknown");
      return;
    }
    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/payment/kashier/status?order_ref=${encodeURIComponent(orderRef)}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const p = data?.payment;
        if (p?.status === "success") {
          setStatus("success");
          return;
        }
        if (p?.status === "failed" || p?.status === "cancelled") {
          setStatus("failed");
          return;
        }
      } catch {}
      attempts++;
      if (attempts < 12) {
        setTimeout(poll, 3000);
      } else {
        setStatus("unknown");
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [orderRef]);

  const content = {
    pending: {
      icon: <Loader2 className="w-12 h-12 animate-spin text-emerald-500" />,
      title: isAr ? "جارٍ التحقق من الدفع..." : "Verifying your payment...",
      text: isAr ? "من فضلك انتظر ثوانٍ، نحن نتأكد من حالة الدفع مع مزوّد الدفع." : "Please wait a moment while we confirm payment status with our provider.",
    },
    success: {
      icon: <CheckCircle2 className="w-12 h-12 text-emerald-500" />,
      title: isAr ? "تم تفعيل اشتراكك بنجاح! 🎉" : "Your subscription is active! 🎉",
      text: isAr ? "شكرًا لك، أصبحت جميع مزايا Pro متاحة لك الآن." : "Thank you, all Pro features are now available.",
    },
    failed: {
      icon: <XCircle className="w-12 h-12 text-rose-500" />,
      title: isAr ? "لم تكتمل عملية الدفع" : "Payment not completed",
      text: isAr ? "لم نتمكن من تأكيد الدفع. حاول مرة أخرى من صفحة الأسعار، أو تواصل معنا." : "We could not confirm the payment. Please try again or contact us.",
    },
    unknown: {
      icon: <XCircle className="w-12 h-12 text-amber-500" />,
      title: isAr ? "تعذّر تأكيد الحالة" : "Could not confirm status",
      text: isAr ? "لا يمكننا تأكيد حالة هذه العملية حاليًا. إذا تم الدفع فعلًا فسيتم تفعيل اشتراكك خلال دقائق." : "We cannot confirm this transaction right now. If you did pay, your subscription will activate within minutes.",
    },
  }[status];

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full neobrutal-card p-10 text-center space-y-5 border-4 border-black dark:border-white bg-white dark:bg-zinc-900">
        <div className="flex justify-center">{content.icon}</div>
        <h1 className="text-2xl font-black text-black dark:text-white">{content.title}</h1>
        <p className="text-zinc-600 dark:text-zinc-300 font-bold">{content.text}</p>
        {status !== "pending" && (
          <Link
            href="/pricing"
            className="inline-flex items-center h-12 px-6 border-4 border-black dark:border-white bg-emerald-400 text-black font-black uppercase tracking-widest shadow-[3px_3px_0px_rgba(0,0,0,1)]"
          >
            {isAr ? "العودة إلى الأسعار" : "Back to Pricing"}
          </Link>
        )}
      </div>
    </div>
  );
}
