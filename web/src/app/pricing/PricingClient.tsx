"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Loader2,
  Rocket,
  Check,
  X,
  Smartphone,
  QrCode,
  CheckCircle2,
  ChevronDown,
  ShieldCheck,
  Zap,
  MessageSquare,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";

type Step = "plans" | "payment" | "submitted";

export default function PricingClient() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);
  const [localOrder, setLocalOrder] = useState<string | null>(null);
  const [customerNote, setCustomerNote] = useState("");
  const [step, setStep] = useState<Step>("plans");
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const local = await fetch("/api/payment/local/config", {
          cache: "no-store",
        }).then((r) => r.json());
        setLocalConfig(local);
      } catch {
        setLocalConfig(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const startLocalPayment = async () => {
    if (!user) {
      toast.error(isAr ? "سجّل الدخول أولاً" : "Please sign in first");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/payment/local/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "تعذر إنشاء طلب الدفع");
      setLocalOrder(data.order_id);
      setStep("payment");
      setShowQr(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitLocalPayment = async () => {
    if (!localOrder) return;
    setBusy(true);
    try {
      const res = await fetch("/api/payment/local/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: localOrder, note: customerNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "تعذر إرسال الطلب");
      setStep("submitted");
      toast.success(isAr ? "تم إرسال الطلب للمراجعة" : "Payment sent for review");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
      </div>
    );
  }

  // ── Payments disabled ────────────────────────────────────────────────────
  if (!localConfig?.enabled) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="max-w-xl w-full neobrutal-card p-8 text-center space-y-4 border-4 border-black dark:border-white bg-white dark:bg-zinc-900">
          <div className="flex justify-center">
            <div className="h-16 w-16 border-4 border-black dark:border-white bg-emerald-500 text-white flex items-center justify-center">
              <Rocket className="h-8 w-8" />
            </div>
          </div>
          <h1 className="text-3xl font-black text-black dark:text-white">
            {isAr ? "المنصة مجانية حاليًا" : "The platform is currently free"}
          </h1>
          <p className="text-zinc-600 dark:text-zinc-300 font-bold leading-relaxed">
            {isAr
              ? "نحن في فترة تجريبية. جميع المزايا متاحة بدون أي رسوم. سنعلن عن خطة الاشتراك المدفوع قريبًا."
              : "We are in a free period. All features are available with no charge. Our paid subscription plan will be announced soon."}
          </p>
        </div>
      </div>
    );
  }

  const proPrice = localConfig.amount_egp ?? 300;

  const freeFeatures = [
    {
      icon: <Zap className="w-4 h-4" />,
      text: isAr ? "تأخير الإشارات 5 أيام" : "Signals delayed 5 days",
      included: true,
    },
    {
      icon: <MessageSquare className="w-4 h-4" />,
      text: isAr ? "50 رسالة شات بوت / شهر" : "50 chatbot messages / month",
      included: true,
    },
    {
      icon: <BarChart3 className="w-4 h-4" />,
      text: isAr ? "حتى 5 أسهم في المحفظة" : "Up to 5 portfolio stocks",
      included: true,
    },
    {
      icon: <ShieldCheck className="w-4 h-4" />,
      text: isAr ? "تحليلات متقدمة" : "Advanced analytics",
      included: false,
    },
  ];

  const proFeatures = [
    {
      icon: <Zap className="w-4 h-4" />,
      text: isAr ? "إشارات يومية فورية" : "Daily instant signals",
      included: true,
    },
    {
      icon: <MessageSquare className="w-4 h-4" />,
      text: isAr ? "350 رسالة شات بوت / شهر" : "350 chatbot messages / month",
      included: true,
    },
    {
      icon: <BarChart3 className="w-4 h-4" />,
      text: isAr ? "حتى 10 أسهم في المحفظة" : "Up to 10 portfolio stocks",
      included: true,
    },
    {
      icon: <ShieldCheck className="w-4 h-4" />,
      text: isAr ? "تحليلات متقدمة" : "Advanced analytics",
      included: true,
    },
  ];

  // ── Submitted ────────────────────────────────────────────────────────────
  if (step === "submitted") {
    return (
      <div className="min-h-[70vh] flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] p-8 space-y-6 text-center">
          <div className="flex justify-center">
            <div className="h-20 w-20 border-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-black dark:text-white">
              {isAr ? "الطلب قيد المراجعة ⏳" : "Order Under Review ⏳"}
            </h2>
            <p className="text-sm font-bold text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {isAr
                ? "تم إرسال طلبك بنجاح! سيتم مراجعة التحويل من قبل الإدارة وتفعيل حسابك Pro فور التحقق."
                : "Your request was submitted! The transfer will be reviewed by admin and your Pro account will be activated upon verification."}
            </p>
          </div>
          {localOrder && (
            <div className="border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3">
              <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-1">
                Order ID
              </p>
              <p className="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300 break-all">
                {localOrder}
              </p>
            </div>
          )}
          <p className="text-xs font-bold text-zinc-400">
            {isAr
              ? "سنتواصل معك عبر البريد الإلكتروني بمجرد التفعيل"
              : "You'll be notified via email once activated"}
          </p>
        </div>
      </div>
    );
  }

  // ── Payment step ─────────────────────────────────────────────────────────
  if (step === "payment" && localOrder) {
    return (
      <div className="min-h-[70vh] py-12 px-4">
        <div className="max-w-lg mx-auto space-y-5">
          {/* Header */}
          <div className="text-center space-y-1">
            <h1 className="text-3xl font-black text-black dark:text-white">
              {isAr ? "إتمام الدفع" : "Complete Payment"}
            </h1>
            <p className="text-sm font-bold text-zinc-500">
              {isAr ? "حوّل المبلغ ثم أضغط «لقد قمت بالتحويل»" : "Transfer the amount then tap 'I have transferred'"}
            </p>
          </div>

          {/* Card */}
          <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] p-6 space-y-5">
            {/* Amount banner */}
            <div className="border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex items-center justify-between">
              <span className="font-black text-zinc-700 dark:text-zinc-200">
                {isAr ? "المبلغ المطلوب" : "Amount due"}
              </span>
              <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                {proPrice} {isAr ? "جنيه" : "EGP"}
              </span>
            </div>

            {/* Wallet number */}
            <div className="space-y-1">
              <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">
                {isAr ? "رقم Vodafone Cash" : "Vodafone Cash Number"}
              </p>
              <div className="flex items-center gap-3 border-2 border-black dark:border-white p-3">
                <Smartphone className="w-5 h-5 text-red-500 shrink-0" />
                <span className="text-2xl font-black text-black dark:text-white tracking-widest">
                  {localConfig.wallet_number || "—"}
                </span>
              </div>
            </div>

            {/* QR toggle */}
            {localConfig.qr_url && (
              <div className="space-y-3">
                <button
                  onClick={() => setShowQr((v) => !v)}
                  className="flex items-center gap-2 text-sm font-black text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  <QrCode className="w-4 h-4" />
                  {showQr
                    ? isAr ? "إخفاء رمز QR" : "Hide QR code"
                    : isAr ? "عرض رمز QR للتحويل" : "Show QR code"}
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${showQr ? "rotate-180" : ""}`}
                  />
                </button>
                {showQr && (
                  <div className="flex justify-center">
                    <img
                      src={`https://quickchart.io/qr?size=220&text=${encodeURIComponent(
                        localConfig.qr_url
                      )}`}
                      alt="Vodafone Cash QR"
                      className="border-4 border-black dark:border-white bg-white p-2"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Note input */}
            <div className="space-y-1.5">
              <label className="text-xs font-black text-zinc-600 dark:text-zinc-300 uppercase tracking-widest">
                {isAr
                  ? "رقم الهاتف المحوّل منه (اختياري)"
                  : "Sender phone number (optional)"}
              </label>
              <input
                type="text"
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                placeholder={isAr ? "مثال: 01012345678" : "e.g. 01012345678"}
                className="w-full p-3 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-800 text-sm font-bold placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Submit */}
            <button
              onClick={submitLocalPayment}
              disabled={busy}
              className="w-full h-13 flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-emerald-500 text-white font-black text-base uppercase tracking-widest shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-60 transition-all py-3"
            >
              {busy ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  {isAr ? "لقد قمت بالتحويل ✓" : "I have transferred ✓"}
                </>
              )}
            </button>

            {/* Order ID */}
            <p className="text-center text-xs font-mono text-zinc-400 break-all">
              Order: {localOrder}
            </p>
          </div>

          {/* Back */}
          <button
            onClick={() => { setStep("plans"); setLocalOrder(null); }}
            className="w-full text-sm font-black text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline text-center"
          >
            {isAr ? "← العودة" : "← Back"}
          </button>
        </div>
      </div>
    );
  }

  // ── Plans page (default) ─────────────────────────────────────────────────
  return (
    <div className="min-h-[70vh] py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Title */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-black text-black dark:text-white">
            {isAr ? "اختر خطتك" : "Choose your plan"}
          </h1>
          <p className="text-zinc-500 font-bold">
            {isAr
              ? "مزايا واضحة تناسب طريقة تداولك"
              : "Clear features that fit your trading style"}
          </p>
        </div>

        {/* Plans grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* ── Free ── */}
          <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] p-6 space-y-6 flex flex-col">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black text-black dark:text-white">
                  {isAr ? "مجاني" : "Free"}
                </h2>
                <span className="text-xs font-black bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 px-3 py-1 border-2 border-zinc-200 dark:border-zinc-700">
                  {isAr ? "الخطة الحالية" : "Current plan"}
                </span>
              </div>
              <div className="flex items-end gap-1 mb-1">
                <span className="text-4xl font-black text-black dark:text-white">EGP 0</span>
              </div>
              <p className="text-xs font-bold text-zinc-400">
                {isAr ? "مجاناً للأبد" : "Free forever"}
              </p>
            </div>

            <ul className="space-y-3 flex-1">
              {freeFeatures.map((f, i) => (
                <li
                  key={i}
                  className={`flex items-center gap-3 text-sm font-bold ${
                    f.included
                      ? "text-zinc-700 dark:text-zinc-300"
                      : "text-zinc-400 dark:text-zinc-600 line-through"
                  }`}
                >
                  {f.included ? (
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <X className="w-4 h-4 text-zinc-300 shrink-0" />
                  )}
                  <span className="flex items-center gap-1.5">
                    {f.icon}
                    {f.text}
                  </span>
                </li>
              ))}
            </ul>

            <button
              disabled
              className="w-full h-12 border-4 border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 font-black uppercase tracking-widest disabled:cursor-not-allowed"
            >
              {isAr ? "خطتك الحالية" : "Current Plan"}
            </button>
          </div>

          {/* ── Pro ── */}
          <div className="border-4 border-black dark:border-white bg-emerald-50 dark:bg-emerald-950/20 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] p-6 space-y-6 flex flex-col relative">
            {/* Popular badge */}
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <span className="bg-emerald-500 text-white text-xs font-black px-4 py-1 border-2 border-black dark:border-white uppercase tracking-widest">
                {isAr ? "الأكثر شيوعًا" : "Most Popular"}
              </span>
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black text-black dark:text-white">Pro</h2>
                <span className="text-xs font-black bg-emerald-500 text-white px-3 py-1 border-2 border-black dark:border-white">
                  {isAr ? "مميّز" : "Premium"}
                </span>
              </div>
              <div className="flex items-end gap-1 mb-1">
                <span className="text-4xl font-black text-black dark:text-white">
                  EGP {proPrice}
                </span>
                <span className="text-sm font-bold text-zinc-500 mb-1">
                  /{isAr ? "شهر" : "month"}
                </span>
              </div>
              <p className="text-xs font-bold text-zinc-500">
                {isAr ? "اشتراك شهري قابل للتجديد" : "Monthly renewable subscription"}
              </p>
            </div>

            <ul className="space-y-3 flex-1">
              {proFeatures.map((f, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 text-sm font-bold text-zinc-700 dark:text-zinc-200"
                >
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="flex items-center gap-1.5">
                    {f.icon}
                    {f.text}
                  </span>
                </li>
              ))}
            </ul>

            <button
              onClick={startLocalPayment}
              disabled={busy}
              className="w-full h-12 flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-emerald-500 text-white font-black uppercase tracking-widest shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-60 transition-all"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Smartphone className="h-4 w-4" />
                  {isAr ? "اشترك الآن" : "Subscribe Now"}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Payment methods */}
        <div className="text-center space-y-3">
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">
            {isAr ? "طرق الدفع المدعومة" : "Supported payment methods"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {["فودافون كاش", "اورنج كاش", "اتصالات كاش", "محفظة ذكية"].map((m) => (
              <span
                key={m}
                className="text-xs font-black border-2 border-emerald-500 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
              >
                {m}
              </span>
            ))}
            {["VISA", "Mastercard", "Meeza"].map((m) => (
              <span
                key={m}
                className="text-xs font-black border-2 border-zinc-300 dark:border-zinc-600 px-3 py-1.5 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
              >
                {m}
              </span>
            ))}
          </div>
          <p className="text-xs font-bold text-zinc-400">
            {isAr
              ? "الدفع عبر Vodafone Cash — آمن وسريع"
              : "Pay via Vodafone Cash — safe & fast"}
          </p>
        </div>
      </div>
    </div>
  );
}
