"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
  ArrowLeft,
  ArrowRight,
  LockKeyhole,
  Sparkles,
  Shield,
  Clock,
  HelpCircle,
  Copy,
  ExternalLink,
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
  const [customerMobile, setCustomerMobile] = useState("");
  const [step, setStep] = useState<Step>("plans");
  const [orderStatus, setOrderStatus] = useState<string>("submitted");
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [telegramProUrl, setTelegramProUrl] = useState("");
  const [isPro, setIsPro] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("pro_6m");
  const [copiedOrder, setCopiedOrder] = useState(false);
  const [pollRestart, setPollRestart] = useState(0);
  const [pollingExhausted, setPollingExhausted] = useState(false);

  const normalizedMobile = customerMobile.trim().replace(/[\s-]/g, "").replace(/^\+20/, "0").replace(/^0020/, "0");
  const isMobileValid = /^01[0125]\d{8}$/.test(normalizedMobile);

  useEffect(() => {
    if (step !== "submitted" || !localOrder) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const startedAt = Date.now();
    setPollingExhausted(false);
    const schedule = () => {
      if (stopped) return;
      if (Date.now() - startedAt >= 15 * 60_000) {
        setPollingExhausted(true);
        return;
      }
      const delay = Math.min(30_000, 5_000 * Math.pow(1.5, attempts));
      attempts += 1;
      timer = setTimeout(check, delay);
    };
    const check = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/payment/easykash/status?order_id=${encodeURIComponent(localOrder)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        const data = res.ok ? await res.json().catch(() => ({})) : {};
        if (stopped) return;
        if (data.status) {
        const settledStatus = ["expired", "rejected", "failed", "canceled", "cancelled"].includes(String(data.status).toLowerCase())
          ? "failed"
          : data.status;
        setOrderStatus(settledStatus);
        if (data.plan_id) setSelectedPlan(data.plan_id);
        setSubscriptionEnd(data.subscription?.current_period_end || null);
        setTelegramProUrl(data.telegram_pro_url || "");
        if (settledStatus === "approved" && !data.telegram_pro_url) {
          const vip = await fetch("/api/profile/telegram-pro", { cache: "no-store", signal: AbortSignal.timeout(12_000) })
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null);
          if (!stopped && vip?.invite_link) {
            setTelegramProUrl(vip.invite_link);
            setSubscriptionEnd(vip.current_period_end || data.subscription?.current_period_end || null);
          }
        }
        if (settledStatus === "approved" || settledStatus === "failed") return;
        }
      } catch {
        // Transient gateway/backend failures are retried with bounded backoff.
      }
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) {
        if (timer) clearTimeout(timer);
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [step, localOrder, pollRestart]);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const response = await fetch("/api/payment/easykash/config", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Payment configuration unavailable");
        const local = await response.json();
        if (!cancelled) setLocalConfig(local);
      } catch {
        if (!cancelled) setLocalConfig(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadConfig();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadConfig();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setIsPro(false);
      return;
    }
    fetch("/api/user/quota", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setIsPro(data?.plan?.is_pro === true))
      .catch(() => setIsPro(false));
  }, [user?.id]);

  const copyOrderId = () => {
    if (!localOrder) return;
    navigator.clipboard.writeText(localOrder);
    setCopiedOrder(true);
    toast.success(isAr ? "تم نسخ رقم الطلب" : "Order ID copied");
    setTimeout(() => setCopiedOrder(false), 2000);
  };

  const startEasyKashPayment = async (planId = selectedPlan) => {
    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent("/pricing")}`);
      return;
    }
    if (!isMobileValid) {
      toast.error(isAr ? "أدخل رقم موبايل مصري صحيح من أي شبكة (010 / 011 / 012 / 015)" : "Enter a valid Egyptian mobile number");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/payment/easykash/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, mobile: normalizedMobile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || (isAr ? "تعذر إنشاء طلب الدفع" : "Could not start checkout"));
      setLocalOrder(data.order_id);
      const checkoutUrl = new URL(String(data.url || ""));
      const checkoutPath = checkoutUrl.pathname.split("/").filter(Boolean);
      if (
        !["https://easykash.net", "https://www.easykash.net"].includes(checkoutUrl.origin) ||
        checkoutUrl.search ||
        checkoutUrl.hash ||
        checkoutPath.length !== 2 ||
        checkoutPath[0] !== "DirectPayV1" ||
        !/^[A-Za-z0-9]+$/.test(checkoutPath[1])
      ) {
        throw new Error(isAr ? "رابط الدفع غير صالح" : "Invalid payment URL");
      }
      window.location.assign(`https://www.easykash.net/DirectPayV1/${checkoutPath[1]}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("customerReference");
    if (params.get("payment") === "easykash" && ref) {
      setLocalOrder(ref);
      setOrderStatus("pending");
      setStep("submitted");
      window.history.replaceState({}, "", "/pricing");
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!localConfig) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6 text-center font-bold text-zinc-900 dark:text-white">
        {isAr ? "تعذر تحميل الخطط الآن. أعد تحميل الصفحة للمحاولة مجددًا." : "Plans are temporarily unavailable. Please reload and try again."}
      </div>
    );
  }

  if (!localConfig.enabled) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="max-w-xl w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-8 text-center space-y-4 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981]">
          <div className="flex justify-center">
            <div className="h-16 w-16 border-4 border-black dark:border-white bg-emerald-500 text-white flex items-center justify-center shadow-[3px_3px_0px_rgba(0,0,0,1)]">
              <Rocket className="h-8 w-8" />
            </div>
          </div>
          <h1 className="text-3xl font-black text-black dark:text-white">
            {isAr ? "المنصة مجانية حاليًا" : "The platform is currently free"}
          </h1>
          <p className="text-zinc-600 dark:text-zinc-300 font-bold leading-relaxed">
            {isAr
              ? "نحن في فترة تجريبية مفتوحة. جميع المزايا متاحة بدون أي رسوم. سنعلن عن خطة الاشتراك المدفوع قريبًا."
              : "We are in an open preview period. All features are available with no charge. Our paid subscription plan will be announced soon."}
          </p>
        </div>
      </div>
    );
  }

  const monthlyDiscount = localConfig?.plans?.find((item: any) => item.id === "pro")?.discount || null;
  const monthlyPrice = Number(monthlyDiscount?.original_amount_egp ?? localConfig?.plans?.find((item: any) => item.id === "pro")?.amount_egp ?? 200);
  const paidPlans = [
    { id: "pro", name_ar: "شهر واحد", name_en: "1 Month", days: 30, amount_egp: 200, badge: null },
    { id: "pro_6m", name_ar: "6 شهور", name_en: "6 Months", days: 180, amount_egp: 1000, badge: isAr ? "الأكثر طلباً ⭐" : "Most Popular ⭐" },
    { id: "pro_1y", name_ar: "سنة كاملة", name_en: "1 Year", days: 365, amount_egp: 1800, badge: isAr ? "أكبر توفير 💎" : "Max Value 💎" },
  ].map((plan) => {
    const configured = localConfig?.plans?.find((item: any) => item.id === plan.id);
    const amount = Number(configured?.amount_egp ?? plan.amount_egp);
    const days = Number(configured?.days ?? plan.days);
    const monthlyEquivalent = Math.round((amount / days) * 30);
    return {
      ...plan,
      amount_egp: amount,
      days,
      monthlyEquivalent,
      savingsPct: monthlyPrice > 0 ? Math.max(0, Math.round((1 - monthlyEquivalent / monthlyPrice) * 100)) : 0,
    };
  });

  const selectedPlanDetails = paidPlans.find((plan: any) => plan.id === selectedPlan) || paidPlans[1];
  const proPrice = selectedPlanDetails?.amount_egp ?? 1000;
  const freeLimits = localConfig.limits?.free || { signal_delay_days: 15, chat_messages_per_month: 50, portfolio_stocks: 5 };
  const proLimits = localConfig.limits?.pro || { chat_messages_per_month: 350, portfolio_stocks: 10 };
  const freeFeatures = [
    { icon: <Zap className="w-4 h-4" />, text: isAr ? `تأخير الإشارات ${freeLimits.signal_delay_days} يوماً` : `Signals delayed ${freeLimits.signal_delay_days} days`, included: true },
    { icon: <MessageSquare className="w-4 h-4" />, text: isAr ? `${freeLimits.chat_messages_per_month} رسالة شات بوت / شهر` : `${freeLimits.chat_messages_per_month} chatbot messages / month`, included: true },
    { icon: <BarChart3 className="w-4 h-4" />, text: isAr ? `حتى ${freeLimits.portfolio_stocks} أسهم في المحفظة` : `Up to ${freeLimits.portfolio_stocks} portfolio stocks`, included: true },
    { icon: <ShieldCheck className="w-4 h-4" />, text: isAr ? "قناة VIP على تليجرام" : "VIP Telegram Channel", included: false },
    { icon: <Sparkles className="w-4 h-4" />, text: isAr ? "توصيات ونماذج الذكاء الاصطناعي لحظياً" : "Live AI models & intraday signals", included: false },
  ];

  const proFeatures = [
    { icon: <Zap className="w-4 h-4" />, text: isAr ? "إشارات وتوصيات يومية فورية ولحظية" : "Daily real-time instant signals", included: true },
    { icon: <MessageSquare className="w-4 h-4" />, text: isAr ? `${proLimits.chat_messages_per_month} رسالة شات بوت ذكي شهرياً` : `${proLimits.chat_messages_per_month} smart chatbot messages / month`, included: true },
    { icon: <BarChart3 className="w-4 h-4" />, text: isAr ? `حتى ${proLimits.portfolio_stocks} أسهم نشطة في المحفظة` : `Up to ${proLimits.portfolio_stocks} active portfolio stocks`, included: true },
    { icon: <ShieldCheck className="w-4 h-4" />, text: isAr ? "رابط دخول خاص لقناة VIP على تليجرام" : "Private invite to VIP Telegram channel", included: true },
    { icon: <Sparkles className="w-4 h-4" />, text: isAr ? "نماذج الذكاء الاصطناعي (EGX Booster & King)" : "Full AI models (EGX Booster & King)", included: true },
  ];

  // ── STEP 3: SUBMITTED / PAYMENT RESULT ─────────────────────────────────────
  if (step === "submitted") {
    return (
      <div className="min-h-[75vh] flex items-center justify-center py-12 px-4" dir={isAr ? "rtl" : "ltr"}>
        <div className="max-w-xl w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 space-y-6 text-center shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_#10b981]">
          {/* Status Icon */}
          <div className="flex justify-center">
            <div
              className={`h-20 w-20 border-4 border-black dark:border-white flex items-center justify-center shadow-[4px_4px_0px_rgba(0,0,0,1)] ${
                orderStatus === "failed"
                  ? "bg-red-500 text-white"
                  : orderStatus === "approved"
                  ? "bg-emerald-500 text-white"
                  : "bg-amber-400 text-zinc-950 animate-pulse"
              }`}
            >
              {orderStatus === "failed" ? (
                <X className="h-10 w-10" />
              ) : orderStatus === "approved" ? (
                <CheckCircle2 className="h-10 w-10" />
              ) : (
                <Clock className="h-10 w-10 animate-spin" />
              )}
            </div>
          </div>

          {/* Heading */}
          <div className="space-y-2">
            <span
              className={`inline-block border-2 border-black dark:border-white px-3 py-1 text-xs font-black uppercase tracking-widest ${
                orderStatus === "failed"
                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  : orderStatus === "approved"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              }`}
            >
              {orderStatus === "failed"
                ? isAr ? "فشلت العملية" : "Payment Incomplete"
                : orderStatus === "approved"
                ? isAr ? "تم التفعيل بنجاح" : "Pro Activated"
                : isAr ? "جاري التحقق من الدفع" : "Verifying Payment"}
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-zinc-950 dark:text-white">
              {orderStatus === "failed"
                ? isAr ? "لم تكتمل عملية الدفع" : "Payment was not completed"
                : orderStatus === "approved"
                ? isAr ? "أهلاً بك في EGX BOTS Pro! 🎉" : "Welcome to EGX BOTS Pro! 🎉"
                : isAr ? "في انتظار إشعار تأكيد الدفع ⏳" : "Awaiting payment confirmation ⏳"}
            </h2>
            <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-md mx-auto">
              {orderStatus === "failed"
                ? isAr
                  ? "لم نتلقَ تأكيد إتمام الدفع من EasyKash. يمكنك المحاولة مجددًا باختيار وسيلة أخرى أو التواصل معنا للمساعدة."
                  : "We didn't receive payment confirmation from EasyKash. You can try again or reach out to our team."
                : orderStatus === "approved"
                ? isAr
                  ? `تم تأكيد اشتراكك في باقة Pro لمدة ${selectedPlanDetails?.days || 30} يوماً بنجاح. حسابك نشط الآن بكامل الصلاحيات!`
                  : `Your Pro plan is now active for ${selectedPlanDetails?.days || 30} days with full benefits!`
                : isAr
                ? "تم استلام طلبك وجاري انتظار تأكيد السداد من EasyKash تلقائياً. الصفحة ستُحدّث الحالة فور وصول الإشعار."
                : "Checkout initiated. We are listening for EasyKash confirmation and will update automatically."}
            </p>
          </div>

          {/* Order Reference Box */}
          {localOrder && (
            <div className="border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-3.5 flex items-center justify-between gap-3 text-start">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block">
                  {isAr ? "رقم مرجع الطلب (Order ID)" : "Order Reference"}
                </span>
                <span className="font-mono font-bold text-xs text-zinc-900 dark:text-zinc-100 break-all">
                  {localOrder}
                </span>
              </div>
              <button
                type="button"
                onClick={copyOrderId}
                className="shrink-0 p-2 border-2 border-black dark:border-white bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-xs font-bold"
                title={isAr ? "نسخ" : "Copy"}
              >
                {copiedOrder ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          )}

          {/* Approved VIP Actions */}
          {orderStatus === "approved" && (
            <div className="space-y-4 pt-2">
              {subscriptionEnd && (
                <p className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                  {isAr
                    ? `تاريخ انتهاء الاشتراك: ${new Date(subscriptionEnd).toLocaleDateString("ar-EG")}`
                    : `Valid until: ${new Date(subscriptionEnd).toLocaleDateString()}`}
                </p>
              )}
              {telegramProUrl ? (
                <a
                  href={telegramProUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3.5 px-6 uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition-all text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  {isAr ? "انضم الآن إلى قناة VIP على تليجرام" : "Join VIP Telegram Channel Now"}
                </a>
              ) : (
                <div className="p-3 border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-xs font-bold text-amber-800 dark:text-amber-200">
                  {isAr ? "لم يتوفر رابط VIP بعد. ستجده في ملفك الشخصي؛ تواصل مع الدعم لو استمرت المشكلة." : "VIP invite is not ready yet. Check your profile or contact support if this persists."}
                </div>
              )}
              <button
                type="button"
                onClick={() => router.push("/profile")}
                className="w-full border-2 border-black dark:border-white bg-white dark:bg-zinc-900 py-3 text-xs font-black hover:bg-zinc-100 transition-all"
              >
                {isAr ? "الانتقال إلى الملف الشخصي والكوتا ←" : "Go to Profile & Quota Dashboard →"}
              </button>
            </div>
          )}

          {/* Failed Retry */}
          {orderStatus === "failed" && (
            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={() => setStep("plans")}
                className="w-full border-4 border-black dark:border-white bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3.5 px-6 uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition-all text-sm"
              >
                {isAr ? "اختيار باقة والمحاولة مجددًا" : "Choose a Plan & Try Again"}
              </button>
            </div>
          )}

          {pollingExhausted && orderStatus !== "approved" && orderStatus !== "failed" && (
            <button type="button" onClick={() => setPollRestart((value) => value + 1)} className="w-full border-2 border-black dark:border-white p-3 font-bold text-zinc-900 dark:text-white">
              {isAr ? "التحقق من حالة الدفع مجددًا" : "Check payment status again"}
            </button>
          )}

          {/* Support Hotline */}
          <div className="border-t-2 border-zinc-200 dark:border-zinc-800 pt-4">
            <a
              href="https://wa.me/201024359109"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              <HelpCircle className="w-4 h-4" />
              {isAr ? "تحتاج مساعدة بخصوص الدفع؟ تواصل معنا عبر واتساب" : "Need help with payment? Contact us on WhatsApp"}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP 2: CHECKOUT / PAYMENT FORM ────────────────────────────────────────
  if (step === "payment") {
    return (
      <div className="min-h-[75vh] py-8 sm:py-12 px-4 relative" dir={isAr ? "rtl" : "ltr"}>
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Top Bar Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-4 sm:p-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981]">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="shrink-0 border-2 border-black dark:border-white bg-white p-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <Image src="/favicon_io/apple-touch-icon.png" alt="EGX Bots" width={36} height={36} className="h-8 w-8 object-contain" />
              </div>
              <div>
                <span className="inline-block border-2 border-black bg-amber-300 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-black">
                  SECURE CHECKOUT · EASYKASH
                </span>
                <h1 className="text-xl sm:text-2xl font-black text-zinc-950 dark:text-white">
                  {isAr ? "إتمام وتأكيد الاشتراك" : "Complete Your Subscription"}
                </h1>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setStep("plans");
                setLocalOrder(null);
              }}
              className="inline-flex items-center justify-center gap-2 border-2 border-black dark:border-white bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 px-4 py-2 text-xs font-black text-zinc-950 dark:text-white shadow-[2px_2px_0px_rgba(0,0,0,1)] transition-transform active:translate-y-0.5 self-start sm:self-auto"
            >
              {isAr ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              {isAr ? "تغيير الخطة" : "Change Plan"}
            </button>
          </div>

          {/* 2-Column Responsive Layout */}
          <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
            {/* Form Column (Main) */}
            <div className="lg:col-span-8 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-5 sm:p-8 space-y-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981]">
              {/* Step 1 Title */}
              <div className="border-b-2 border-zinc-200 dark:border-zinc-800 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    {isAr ? "01 / بوابة الدفع" : "01 / PAYMENT GATEWAY"}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-black text-zinc-600 dark:text-zinc-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    {isAr ? "دفع رسمي ومعتمد" : "Official & Certified"}
                  </span>
                </div>
                <h2 className="text-xl font-black text-zinc-950 dark:text-white mt-1">
                  {isAr ? "اختر وسيلة الدفع داخل EasyKash" : "Choose Your Method on EasyKash"}
                </h2>
              </div>

              <div className="border-2 border-black dark:border-white bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h3 className="text-xs font-black uppercase text-zinc-900 dark:text-white">
                    {isAr ? "كل وسائل حسابك المفعّلة تظهر داخل البوابة" : "All Enabled Methods Appear in the Gateway"}
                  </h3>
                </div>
                <p className="text-xs font-semibold leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {isAr
                    ? "بعد المتابعة ستنتقل إلى صفحة EasyKash الرسمية، ومنها تختار البطاقة أو المحفظة أو الدفع النقدي أو أي وسيلة أخرى مفعّلة. بيانات الدفع لا تمر بموقعنا ولا نحفظها."
                    : "Continue to the official EasyKash page, then choose card, wallet, cash, or any other method enabled for this merchant. Payment details never pass through or get stored by our site."}
                </p>
              </div>

              {/* Contact Phone & Email */}
              <div className="border-t-2 border-zinc-200 dark:border-zinc-800 pt-5 space-y-4">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    {isAr ? "02 / بيانات المشتري" : "02 / BUYER CONTACT"}
                  </span>
                  <h3 className="text-lg font-black text-zinc-950 dark:text-white mt-0.5">
                    {isAr ? "رقم الموبايل للتأكيد" : "Mobile Number for Confirmation"}
                  </h3>
                  <p className="text-xs font-semibold text-zinc-500 mt-1">
                    {isAr
                      ? "رقم موبايل مصري لتلقي كود ورسالة التأكيد من بوابة الدفع."
                      : "Egyptian mobile number to receive confirmation code."}
                  </p>
                </div>

                {user?.email && (
                  <div className="flex items-center justify-between border-2 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs font-bold">
                    <span className="text-zinc-500">{isAr ? "حساب المستخدم:" : "Account:"}</span>
                    <span className="text-zinc-900 dark:text-white font-mono break-all">{user.email}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="mobile-input" className="block text-xs font-black text-zinc-800 dark:text-zinc-200">
                    {isAr ? "رقم الموبايل المصري (11 رقم)" : "Egyptian Mobile (11 digits)"}
                  </label>
                  <div className="flex items-center gap-3 border-3 border-black dark:border-white bg-white dark:bg-zinc-900 px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500">
                    <Smartphone className="w-5 h-5 text-emerald-600 shrink-0" />
                    <input
                      id="mobile-input"
                      type="tel"
                      value={customerMobile}
                      onChange={(e) => setCustomerMobile(e.target.value)}
                      placeholder="01012345678"
                      className="w-full bg-transparent font-mono text-base font-black outline-none placeholder:text-zinc-400 text-zinc-950 dark:text-white"
                      dir="ltr"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs font-bold pt-0.5">
                    <span className={isMobileValid ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}>
                      {isMobileValid
                        ? isAr ? "✓ رقم مصري صحيح" : "✓ Valid Egyptian number"
                        : isAr ? "مقبول: 010 أو 011 أو 012 أو 015" : "Accepted: 010, 011, 012 or 015"}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {customerMobile.length > 0 ? `${customerMobile.length} / 11` : ""}
                    </span>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2 space-y-3">
                <button
                  type="button"
                  onClick={() => startEasyKashPayment()}
                  disabled={busy || (!!user && !isMobileValid)}
                  className="w-full flex items-center justify-center gap-3 border-4 border-black dark:border-white bg-emerald-500 hover:bg-emerald-600 text-zinc-950 dark:text-black font-black text-base py-4 px-6 uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_#ffffff] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <LockKeyhole className="w-5 h-5" />
                      {!user
                        ? isAr ? "سجّل الدخول للمتابعة" : "Sign in to Continue"
                        : isAr ? `المتابعة للدفع الآمن (${proPrice} ج.م) 🔒` : `Proceed to Secure Checkout (${proPrice} EGP) 🔒`}
                    </>
                  )}
                </button>
                <div className="flex items-center justify-center gap-3 text-[11px] font-bold text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-emerald-500" />
                    {isAr ? "دفع آمن 256-bit" : "256-bit SSL"}
                  </span>
                  <span>•</span>
                  <span>{isAr ? "تفعيل فوري للاشتراك" : "Instant Activation"}</span>
                  <span>•</span>
                  <span>{isAr ? "دعم فني 24/7" : "24/7 Support"}</span>
                </div>
              </div>
            </div>

            {/* Sidebar Summary Column */}
            <div className="lg:col-span-4 border-4 border-black dark:border-white bg-zinc-950 text-white p-6 space-y-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981] lg:sticky lg:top-24">
              <div className="border-b border-zinc-800 pb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block mb-1">
                  {isAr ? "فاتورة الاشتراك" : "ORDER INVOICE"}
                </span>
                <h3 className="text-2xl font-black">EGX BOTS Pro</h3>
                <p className="text-xs font-semibold text-zinc-400 mt-1">
                  {isAr ? selectedPlanDetails.name_ar : selectedPlanDetails.name_en}
                </p>
              </div>

              {/* Items Breakdown */}
              <div className="space-y-3 border-b border-zinc-800 pb-4 text-xs font-bold">
                <div className="flex justify-between">
                  <span className="text-zinc-400">{isAr ? "الخطة:" : "Plan:"}</span>
                  <span className="font-black text-emerald-400">Pro VIP</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">{isAr ? "فترة الاشتراك:" : "Duration:"}</span>
                  <span className="font-mono">{selectedPlanDetails.days} {isAr ? "يوماً" : "days"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">{isAr ? "وسيلة الدفع:" : "Method:"}</span>
                  <span>{isAr ? "تُحدد داخل EasyKash" : "Chosen on EasyKash"}</span>
                </div>
                {selectedPlanDetails.savingsPct > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>{isAr ? "نسبة التوفير:" : "Savings:"}</span>
                    <span>{isAr ? `وفرت ${selectedPlanDetails.savingsPct}%` : `${selectedPlanDetails.savingsPct}% OFF`}</span>
                  </div>
                )}
              </div>

              {/* Total */}
              <div className="flex items-baseline justify-between border-b border-zinc-800 pb-5">
                <span className="text-sm font-black">{isAr ? "المبلغ الإجمالي:" : "Total Amount:"}</span>
                <div className="text-end">
                  <span className="text-3xl font-black text-emerald-400">{proPrice}</span>
                  <span className="text-xs font-bold text-zinc-400 ms-1">ج.م</span>
                </div>
              </div>

              {/* Included Benefits List */}
              <div className="space-y-2 text-xs font-bold">
                <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider block">
                  {isAr ? "الميزات المشمولة فوراً:" : "INCLUDED WITH PRO:"}
                </span>
                <div className="flex items-center gap-2 text-zinc-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{isAr ? "قناة VIP على تليجرام فور التفعيل" : "Instant VIP Telegram Channel Invite"}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{isAr ? "إشارات وتوصيات يومية بدون تأخير" : "Zero-delay real-time signals"}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{isAr ? `${proLimits.chat_messages_per_month} رسالة ذكاء اصطناعي شهرياً` : `${proLimits.chat_messages_per_month} monthly AI chat messages`}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{isAr ? `محفظة تداول حتى ${proLimits.portfolio_stocks} أسهم` : `${proLimits.portfolio_stocks} active portfolio stock slots`}</span>
                </div>
              </div>

              {/* Secure Notice */}
              <div className="p-3 border-2 border-emerald-500/50 bg-emerald-950/30 text-[11px] font-semibold text-zinc-300 leading-relaxed">
                {isAr
                  ? "تتم المعاملة عبر بوابة EasyKash المرخصة. يُفعّل اشتراكك آلياً فور السداد دون الحاجة لتدخل يدوي."
                  : "Processed through certified EasyKash gateway. Account activates automatically upon payment."}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP 1: PLANS COMPARISON GRID (DEFAULT) ────────────────────────────────
  return (
    <div className="min-h-[75vh] py-10 sm:py-14 px-4 relative overflow-hidden" dir={isAr ? "rtl" : "ltr"}>
      <div className="max-w-6xl mx-auto space-y-10 relative">
        {/* Main Header */}
        <div className="text-center space-y-3">
          <span className="inline-block border-2 border-black dark:border-white bg-amber-300 px-3 py-1 text-xs font-black uppercase tracking-widest text-black shadow-[3px_3px_0px_rgba(0,0,0,1)]">
            EGX BOTS PRO · خطط واشتراكات
          </span>
          <h1 className="text-3xl sm:text-5xl font-black text-zinc-950 dark:text-white tracking-tight">
            {isAr ? "اختر خطتك الاستثمارية" : "Choose Your Investment Plan"}
          </h1>
          <p className="text-sm sm:text-base font-bold text-zinc-600 dark:text-zinc-300 max-w-2xl mx-auto leading-relaxed">
            {isAr
              ? "تحليلات كمية، وتوصيات مبنية على الذكاء الاصطناعي، وقناة VIP حصرية لتداول البورصة المصرية بثقة."
              : "Quantitative analysis, AI-driven stock signals, and VIP channel access for the Egyptian Stock Exchange."}
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          {/* ── 01. Free Plan Card ── */}
          <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,0.2)] p-6 space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black text-zinc-950 dark:text-white">
                  {isAr ? "مجاني" : "Free"}
                </h3>
                <span className="text-[10px] font-black uppercase px-2.5 py-1 border-2 border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                  {isPro ? (isAr ? "متاحة" : "Available") : isAr ? "الخطة الحالية" : "Current"}
                </span>
              </div>

              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black text-zinc-950 dark:text-white">0</span>
                  <span className="text-xs font-bold text-zinc-500">ج.م / للأبد</span>
                </div>
                <p className="text-xs font-semibold text-zinc-500 mt-1">
                  {isAr ? "مناسبة للتجربة واستكشاف المنصة" : "Good for exploring the basics"}
                </p>
              </div>

              <div className="border-t-2 border-zinc-200 dark:border-zinc-800 pt-4">
                <ul className="space-y-3">
                  {freeFeatures.map((f, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-2.5 text-xs font-bold leading-tight ${
                        f.included ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-600 line-through"
                      }`}
                    >
                      <span className="shrink-0 mt-0.5">{f.included ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <X className="w-3.5 h-3.5 text-zinc-400" />}</span>
                      <span>{f.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <button
              type="button"
              disabled
              className="w-full border-3 border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 py-3 text-xs font-black uppercase tracking-wider cursor-not-allowed"
            >
              {isAr ? "خطتك الحالية" : "Current Plan"}
            </button>
          </div>

          {/* ── 02, 03, 04. Paid Pro Plans ── */}
          {paidPlans.map((plan) => {
            const isFeatured = plan.id === "pro_6m";
            const isMax = plan.id === "pro_1y";
            const planDiscount = plan.id === "pro" && monthlyDiscount?.active ? monthlyDiscount : null;
            return (
              <div
                key={plan.id}
                className={`border-4 border-black dark:border-white p-6 space-y-6 flex flex-col justify-between relative transition-all ${
                  isFeatured
                    ? "bg-emerald-50/70 dark:bg-emerald-950/30 ring-4 ring-emerald-500 shadow-[6px_6px_0px_#10b981]"
                    : "bg-white dark:bg-zinc-950 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981]"
                }`}
              >
                {/* Top Badge */}
                {(planDiscount || plan.badge) && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="border-2 border-black dark:border-white bg-amber-300 text-black text-[10px] font-black uppercase px-3 py-0.5 tracking-wider shadow-[2px_2px_0px_rgba(0,0,0,1)] whitespace-nowrap">
                      {planDiscount ? (isAr ? planDiscount.label_ar || "عرض محدود" : planDiscount.label_en || "Limited offer") : plan.badge}
                    </span>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-black text-zinc-950 dark:text-white">
                        Pro · {isAr ? plan.name_ar : plan.name_en}
                      </h3>
                      <span className="text-[11px] font-bold text-zinc-500">
                        {plan.days} {isAr ? "يوماً كاملة" : "days access"}
                      </span>
                    </div>
                    <span className="text-[10px] font-black border-2 border-black dark:border-white bg-emerald-500 text-white px-2 py-0.5">
                      PRO
                    </span>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-black text-zinc-950 dark:text-white">{plan.amount_egp}</span>
                      <span className="text-xs font-bold text-zinc-500">ج.م</span>
                      {planDiscount && (
                        <span className="ms-1 text-lg font-black text-zinc-400 line-through">
                          {planDiscount.original_amount_egp}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">
                        {isAr ? `ما يعادل ${plan.monthlyEquivalent} ج.م / شهر` : `EGP ${plan.monthlyEquivalent}/mo`}
                      </span>
                      {plan.savingsPct > 0 && (
                        <span className="border border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-black rounded">
                          {isAr ? `توفير ${plan.savingsPct}%` : `${plan.savingsPct}% OFF`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="border-t-2 border-zinc-200 dark:border-zinc-800 pt-4">
                    <ul className="space-y-3">
                      {proFeatures.map((f, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-xs font-bold leading-tight text-zinc-800 dark:text-zinc-200">
                          <span className="shrink-0 mt-0.5 text-emerald-500"><Check className="w-3.5 h-3.5" /></span>
                          <span>{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedPlan(plan.id);
                    setStep("payment");
                  }}
                  className={`w-full flex items-center justify-center gap-2 border-4 border-black dark:border-white py-3.5 px-4 text-xs font-black uppercase tracking-wider shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition-all ${
                    isFeatured
                      ? "bg-emerald-500 hover:bg-emerald-600 text-zinc-950 dark:text-black font-black"
                      : "bg-zinc-900 hover:bg-black text-white dark:bg-white dark:text-black dark:hover:bg-zinc-100"
                  }`}
                >
                  <LockKeyhole className="w-3.5 h-3.5" />
                  {isPro
                    ? isAr ? "تجديد الباقة" : "Renew Plan"
                    : isAr ? "اشترك في هذه الخطة" : "Subscribe to Plan"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Guarantee Banner */}
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981]">
          <div className="grid sm:grid-cols-3 gap-6 text-center">
            <div className="space-y-1.5">
              <div className="w-10 h-10 border-2 border-black dark:border-white bg-amber-300 text-black flex items-center justify-center mx-auto shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-black text-zinc-950 dark:text-white">
                {isAr ? "دفع رسمي ومعتمد" : "Certified Gateway"}
              </h4>
              <p className="text-xs font-semibold text-zinc-500">
                {isAr ? "عبر بوابة EasyKash المشفرة برخصة البنك المركزي" : "Licensed 256-bit encrypted checkout"}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="w-10 h-10 border-2 border-black dark:border-white bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <Zap className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-black text-zinc-950 dark:text-white">
                {isAr ? "تفعيل تلقائي ولحظي" : "Instant Activation"}
              </h4>
              <p className="text-xs font-semibold text-zinc-500">
                {isAr ? "يتم فتح الصلاحيات وتوليد رابط VIP فور اكتمال الدفع" : "Pro perks unlock instantly upon payment"}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="w-10 h-10 border-2 border-black dark:border-white bg-sky-400 text-black flex items-center justify-center mx-auto shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <HelpCircle className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-black text-zinc-950 dark:text-white">
                {isAr ? "دعم مستمر عبر واتساب" : "WhatsApp Support"}
              </h4>
              <p className="text-xs font-semibold text-zinc-500">
                {isAr ? "فريقنا متواجد للإجابة على أي استفسارات 01024359109" : "Direct human assistance anytime"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
