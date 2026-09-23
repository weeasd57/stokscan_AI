"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Loader2,
  Rocket,
  Check,
  X,
  Smartphone,
  CheckCircle2,
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
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);
  const [localOrder, setLocalOrder] = useState<string | null>(null);
  const [customerNote, setCustomerNote] = useState("");
  const [step, setStep] = useState<Step>("plans");
  const [orderStatus, setOrderStatus] = useState<string>("submitted");
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [telegramProUrl, setTelegramProUrl] = useState("");
  const [isPro, setIsPro] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("pro_6m");

  useEffect(() => {
    if (step !== "submitted" || !localOrder) return;
    let stopped = false;
    const check = async () => {
      const res = await fetch(`/api/payment/local/status?order_id=${encodeURIComponent(localOrder)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
        if (!stopped && data.status) {
          setOrderStatus(data.status);
          setSubscriptionEnd(data.subscription?.current_period_end || null);
          setTelegramProUrl(data.telegram_pro_url || "");
          if (data.status === "approved" && !data.telegram_pro_url) {
            const vip = await fetch("/api/profile/telegram-pro", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null);
            if (!stopped && vip?.invite_link) {
              setTelegramProUrl(vip.invite_link);
              setSubscriptionEnd(vip.current_period_end || data.subscription?.current_period_end || null);
            }
          }
        }
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [step, localOrder]);

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

  useEffect(() => {
    if (!user) {
      setIsPro(false);
      return;
    }
    fetch("/api/user/quota", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setIsPro(data?.plan?.is_pro === true))
      .catch(() => setIsPro(false));
  }, [user?.id]);

  const startLocalPayment = async (planId = selectedPlan) => {
    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent("/pricing")}`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/payment/local/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "تعذر إنشاء طلب الدفع");
      setLocalOrder(data.order_id);
      setStep("payment");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitLocalPayment = async () => {
    if (!localOrder) return;
    const senderPhone = customerNote.trim().replace(/[\s-]/g, "");
    if (!/^01[0125]\d{8}$/.test(senderPhone)) {
      toast.error(isAr ? "اكتب رقم الهاتف المحوّل منه صحيحاً (11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015)" : "Enter a valid Egyptian sender phone number (11 digits starting with 010, 011, 012 or 015)");
      return;
    }
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

  const paidPlans = localConfig?.plans || [
    { id: "pro", name_ar: "شهري", name_en: "Monthly", amount_egp: localConfig?.amount_egp ?? 300, days: 30 },
    { id: "pro_6m", name_ar: "6 شهور", name_en: "6 Months", amount_egp: 1000, days: 180 },
    { id: "pro_1y", name_ar: "سنة", name_en: "1 Year", amount_egp: 1800, days: 365 },
  ];
  const selectedPlanDetails = paidPlans.find((plan: any) => plan.id === selectedPlan) || paidPlans[0];
  const proPrice = selectedPlanDetails?.amount_egp ?? 200;

  const freeFeatures = [
    {
      icon: <Zap className="w-4 h-4" />,
      text: isAr ? "تأخير الإشارات 15 يوماً" : "Signals delayed 15 days",
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
            <div className={`h-20 w-20 border-4 ${orderStatus === "rejected" ? "border-red-500 bg-red-50 text-red-500" : "border-emerald-500 bg-emerald-50 text-emerald-500"} flex items-center justify-center`}>
              {orderStatus === "rejected" ? <X className="h-10 w-10" /> : <CheckCircle2 className="h-10 w-10" />}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-black dark:text-white">
              {orderStatus === "rejected" ? (isAr ? "تم رفض الطلب ❌" : "Payment request rejected ❌") : orderStatus === "approved" ? (isAr ? "تم تفعيل Pro بنجاح ✅" : "Pro activated successfully ✅") : (isAr ? "الطلب قيد المراجعة ⏳" : "Order Under Review ⏳")}
            </h2>
            <p className="text-sm font-bold text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {isAr
                ? orderStatus === "rejected" ? "لم يتم اعتماد التحويل. يمكنك المحاولة مرة أخرى أو التواصل معنا عبر واتساب." : orderStatus === "approved" ? `تم تأكيد الدفع وتفعيل حساب Pro لمدة ${selectedPlanDetails?.days || 30} يومًا.` : "تم إرسال طلبك بنجاح! سيتم مراجعة التحويل من قبل الإدارة وتفعيل حسابك Pro فور التحقق."
                : orderStatus === "rejected" ? "The transfer was not approved. Try again or contact us on WhatsApp." : orderStatus === "approved" ? `Your Pro plan is active for ${selectedPlanDetails?.days || 30} days.` : "Your request was submitted! The transfer will be reviewed by admin and your Pro account will be activated upon verification."}
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
          {orderStatus === "rejected" && <div className="flex flex-col gap-2"><button onClick={() => startLocalPayment()} disabled={busy} className="w-full h-11 border-4 border-black bg-emerald-500 text-white font-black">{isAr ? "إعادة المحاولة" : "Try again"}</button><a href="https://wa.me/201024359109" target="_blank" rel="noreferrer" className="text-sm font-black text-emerald-600 underline">{isAr ? "محتاج مساعدة؟ كلمنا على واتساب" : "Need help? Contact us on WhatsApp"}</a></div>}
          {orderStatus === "approved" && <div className="space-y-3"><p className="font-black text-emerald-600">{subscriptionEnd ? (isAr ? `صالح حتى ${new Date(subscriptionEnd).toLocaleDateString("ar-EG")}` : `Valid until ${new Date(subscriptionEnd).toLocaleDateString()}`) : ""}</p>{telegramProUrl ? <a href={telegramProUrl} target="_blank" rel="noreferrer" className="block border-4 border-black bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-[3px_3px_0px_rgba(0,0,0,1)]">{isAr ? "انضم إلى قناة VIP على تليجرام" : "Join VIP Telegram Channel"}<span className="block text-[10px] font-bold mt-1 opacity-80">{isAr ? "الرابط صالح لمدة 30 يوماً" : "Invite expires in 30 days"}</span></a> : <p className="text-xs font-bold text-amber-600">{isAr ? "جاري إنشاء رابط دعوة قناة VIP... حدّث الصفحة بعد لحظات." : "Creating your VIP invite link... refresh in a moment."}</p>}</div>}
          <a href="https://wa.me/201024359109" target="_blank" rel="noreferrer" className="block text-sm font-black text-emerald-600 underline">{isAr ? "محتاج مساعدة؟ كلمنا على واتساب" : "Need help? Contact us on WhatsApp"}</a>
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

            {/* Professional Vodafone QR */}
            {localConfig.qr_url && (
              <div className="space-y-2">
                <p className="text-xs font-black text-zinc-500 uppercase tracking-widest text-center">
                  {isAr ? "أو امسح رمز QR" : "Or scan QR code"}
                </p>
                <div className="flex justify-center">
                  <div className="relative inline-block p-3 bg-white border-4 border-red-600 shadow-[4px_4px_0px_#be0000]">
                    {/* QR image — red Vodafone style, high error correction to allow logo */}
                    <img
                      src={`https://quickchart.io/qr?size=240&text=${encodeURIComponent(
                        localConfig.qr_url
                      )}&dark=BE0000&light=FFFFFF&ecLevel=H&margin=1`}
                      alt="Vodafone Cash QR"
                      className="block w-[200px] h-[200px]"
                    />
                    {/* Vodafone logo overlay centered */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center border-2 border-red-600 shadow-sm">
                        {/* Vodafone "V" SVG */}
                        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none">
                          <circle cx="12" cy="12" r="12" fill="#BE0000" />
                          <path
                            d="M8 7c0 0 1.5 4.5 4 8c2.5-3.5 4-8 4-8"
                            stroke="white"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      </div>
                    </div>
                    {/* Top label */}
                    <p className="text-center text-[10px] font-black text-red-700 mt-1.5 tracking-widest uppercase">
                      Vodafone Cash
                    </p>
                  </div>
                </div>
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
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
          {/* ── Free ── */}
          <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] p-6 space-y-6 flex flex-col">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black text-black dark:text-white">
                  {isAr ? "مجاني" : "Free"}
                </h2>
                <span className="text-xs font-black bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 px-3 py-1 border-2 border-zinc-200 dark:border-zinc-700">
                  {isPro ? (isAr ? "متاحة" : "Available") : (isAr ? "الخطة الحالية" : "Current plan")}
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

          {paidPlans.map((plan: any) => {
            const isSelected = selectedPlan === plan.id;
            const planName = isAr ? plan.name_ar : plan.name_en;
            return (
              <div key={plan.id} className={`border-4 border-black dark:border-white ${isSelected ? "bg-emerald-50 dark:bg-emerald-950/30 ring-4 ring-emerald-400" : "bg-white dark:bg-zinc-900"} shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] p-6 space-y-5 flex flex-col relative`}>
                {plan.id === "pro_6m" && <div className="absolute -top-4 left-1/2 -translate-x-1/2"><span className="bg-emerald-500 text-white text-xs font-black px-4 py-1 border-2 border-black dark:border-white uppercase tracking-widest">{isAr ? "الأكثر طلبًا" : "Best value"}</span></div>}
                <button type="button" onClick={() => setSelectedPlan(plan.id)} className="text-left pt-1">
                  <div className="flex items-center justify-between mb-4 gap-2">
                    <h2 className="text-xl font-black text-black dark:text-white">Pro · {planName}</h2>
                    <span className="text-[10px] font-black bg-emerald-500 text-white px-2 py-1 border-2 border-black dark:border-white">{isPro ? (isAr ? "فعالة" : "Active") : "PRO"}</span>
                  </div>
                  <div className="flex items-end gap-1 mb-1"><span className="text-3xl font-black text-black dark:text-white">EGP {plan.amount_egp}</span><span className="text-xs font-bold text-zinc-500 mb-1">/{plan.days} {isAr ? "يوم" : "days"}</span></div>
                  <p className="text-xs font-bold text-zinc-500">{isAr ? "وصول فوري لكل مزايا Pro" : "Full Pro access"}</p>
                </button>
                <ul className="space-y-3 flex-1">
                  {proFeatures.map((f, i) => <li key={i} className="flex items-center gap-3 text-sm font-bold text-zinc-700 dark:text-zinc-200"><Check className="w-4 h-4 text-emerald-500 shrink-0" /><span className="flex items-center gap-1.5">{f.icon}{f.text}</span></li>)}
                </ul>
                <button onClick={() => startLocalPayment(plan.id)} disabled={busy || isPro} className="w-full h-12 flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-emerald-500 text-white font-black uppercase tracking-widest shadow-[3px_3px_0px_rgba(0,0,0,1)] disabled:opacity-60 transition-all">
                  {busy && isSelected ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Smartphone className="h-4 w-4" />{isPro ? (isAr ? "اشتراكك فعال" : "Active subscription") : !user ? (isAr ? "سجّل الدخول للاشتراك" : "Sign in to subscribe") : (isAr ? "اشترك الآن" : "Subscribe Now")}</>}
                </button>
              </div>
            );
          })}
        </div>

        {/* Payment methods */}
        <div className="text-center space-y-3">
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">
            {isAr ? "طرق الدفع المدعومة" : "Supported payment methods"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[
              { ar: "فودافون كاش", en: "Vodafone Cash", color: "border-red-500 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400" },
              { ar: "أورنج كاش", en: "Orange Cash", color: "border-orange-500 bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400" },
              { ar: "اتصالات كاش", en: "Etisalat Cash", color: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400" },
              { ar: "وي كاش", en: "WE Pay", color: "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400" },
            ].map((wallet) => (
              <span key={wallet.en} className={`text-xs font-black border-2 px-3 py-1.5 ${wallet.color}`}>
                {isAr ? wallet.ar : wallet.en}
              </span>
            ))}
          </div>
          <p className="text-xs font-bold text-zinc-400">
            {isAr
              ? "يمكنك التحويل من أي محفظة إلكترونية مصرية إلى رقم Vodafone Cash الموضح أعلاه"
              : "Transfer from any Egyptian mobile wallet to the Vodafone Cash number shown above"}
          </p>
        </div>
      </div>
    </div>
  );
}
