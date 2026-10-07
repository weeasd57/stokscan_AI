"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  Info,
  Activity,
  Crown,
  Flame,
  Award,
} from "lucide-react";
import { toast } from "sonner";

type Step = "plans" | "payment" | "submitted";

export function broadcastEntitlements(isPro: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("egx:entitlements-updated", { detail: { is_pro: isPro } }));
    localStorage.setItem("egx_pro_active", isPro ? "true" : "false");
    localStorage.setItem("egx_entitlements_timestamp", String(Date.now()));
  } catch {
    // Graceful fallback if storage is restricted
  }
}

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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const planParam = params.get("plan");
      if (planParam && ["pro", "pro_6m", "pro_1y", "lifetime"].includes(planParam)) {
        setSelectedPlan(planParam);
      }
    }
  }, []);
  const [copiedOrder, setCopiedOrder] = useState(false);
  const [pollRestart, setPollRestart] = useState(0);
  const [pollingExhausted, setPollingExhausted] = useState(false);

  // Live founders counter from backend — refreshed every time localConfig is fetched
  const foundersRemaining: number = localConfig?.founders?.remaining ?? null;
  const foundersIsOpen: boolean = localConfig?.founders?.is_open ?? true;

  // Live lifetime spots counter from backend — strictly limited to 20 users
  const lifetimeLimit: number = localConfig?.lifetime?.limit ?? 20;
  const lifetimeCount: number = localConfig?.lifetime?.count ?? 0;
  const lifetimeRemaining: number = localConfig?.lifetime?.remaining ?? Math.max(0, lifetimeLimit - lifetimeCount);
  const lifetimeIsOpen: boolean = localConfig?.lifetime?.is_open ?? (lifetimeRemaining > 0);

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
      // Fast-path: if the quota endpoint already confirmed Pro, no need to poll
      if (isPro) {
        setOrderStatus("approved");
        broadcastEntitlements(true);
        // Fetch the invite link if we don't have it yet
        if (!telegramProUrl) {
          const vip = await fetch("/api/profile/telegram-pro", { cache: "no-store", signal: AbortSignal.timeout(12_000) })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          if (!stopped && vip?.invite_link) setTelegramProUrl(vip.invite_link);
          if (!stopped && vip?.current_period_end) setSubscriptionEnd(vip.current_period_end);
        }
        return;
      }
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
        if (settledStatus === "approved") {
          setIsPro(true);
          broadcastEntitlements(true);
        }
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
  }, [step, localOrder, pollRestart, isPro, telegramProUrl]);

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
      setSubscriptionEnd(null);
      return;
    }
    let active = true;
    let inFlight = false;
    const refreshPlan = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/user/quota", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        const proActive = data?.plan?.is_pro === true;
        setIsPro(proActive);
        setSubscriptionEnd(data?.plan?.current_period_end || null);
        if (proActive) {
          broadcastEntitlements(true);
        }
      } catch {
        // Keep the last known state on a temporary network failure.
      } finally {
        inFlight = false;
      }
    };
    setIsPro(false);
    void refreshPlan();
    const onFocus = () => void refreshPlan();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshPlan();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id, orderStatus]);

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
    { id: "pro", name_ar: "شهر واحد", name_en: "1 Month", days: 30, amount_egp: 200, badge: null, isLifetime: false },
    { id: "pro_6m", name_ar: "6 شهور", name_en: "6 Months", days: 180, amount_egp: 1000, badge: isAr ? "الأكثر طلباً ⭐" : "Most Popular ⭐", isLifetime: false },
    { id: "pro_1y", name_ar: "سنة كاملة", name_en: "1 Year", days: 365, amount_egp: 1800, badge: isAr ? "أكبر توفير 💎" : "Max Value 💎", isLifetime: false },
    {
      id: "lifetime",
      name_ar: "مدى الحياة (VIP)",
      name_en: "Lifetime VIP",
      days: 36500,
      amount_egp: 2250,
      badge: isAr
        ? (lifetimeRemaining > 0 ? `حصري لـ ${lifetimeRemaining} مقعداً 🔥` : "اكتملت المقاعد ❌")
        : (lifetimeRemaining > 0 ? `${lifetimeRemaining} Spots Left 🔥` : "Sold Out ❌"),
      isLifetime: true,
    },
  ].map((plan) => {
    const configured = localConfig?.plans?.find((item: any) => item.id === plan.id);
    const amount = Number(configured?.amount_egp ?? plan.amount_egp);
    const days = Number(configured?.days ?? plan.days);
    const monthlyEquivalent = plan.isLifetime ? null : Math.round((amount / days) * 30);
    return {
      ...plan,
      amount_egp: amount,
      days,
      monthlyEquivalent,
      savingsPct: plan.isLifetime
        ? 95
        : monthlyPrice > 0 && monthlyEquivalent
        ? Math.max(0, Math.round((1 - monthlyEquivalent / monthlyPrice) * 100))
        : 0,
    };
  });

  const selectedPlanDetails = paidPlans.find((plan: any) => plan.id === selectedPlan) || paidPlans[1];
  const proPrice = selectedPlanDetails?.amount_egp ?? 1000;
  const freeLimits = localConfig.limits?.free || { signal_delay_days: 15, chat_messages_per_month: 50, portfolio_stocks: 5 };
  const proLimits = localConfig.limits?.pro || { chat_messages_per_month: 350, portfolio_stocks: 10 };
  const freeFeatures = [
    { icon: <Zap className="w-4 h-4" />, text: isAr ? `تأخير الإشارات المتوسطة ${freeLimits.signal_delay_days} يوماً` : `Medium swings delayed ${freeLimits.signal_delay_days} days`, included: true },
    { icon: <Zap className="w-4 h-4" />, text: isAr ? "الصفقات القصيرة ⚡ PRO (متاحة بأرشيف متأخر 15 يوماً فقط)" : "Short Swings ⚡ PRO (15-day delayed archive only)", included: false },
    { icon: <MessageSquare className="w-4 h-4" />, text: isAr ? "5 رسائل شات بوت يومياً" : "5 chatbot messages / day", included: true },
    { icon: <BarChart3 className="w-4 h-4" />, text: isAr ? `حتى ${freeLimits.portfolio_stocks} أسهم في المحفظة` : `Up to ${freeLimits.portfolio_stocks} portfolio stocks`, included: true },
    { icon: <Activity className="w-4 h-4" />, text: isAr ? "النشاط غير الطبيعي (أسهم ارتفع حجمها بشكل غير طبيعي)" : "Unusual Activity (volume spike detection)", included: false },
    { icon: <ShieldCheck className="w-4 h-4" />, text: isAr ? "قناة VIP على تليجرام (إشارات وتوصيات يومية فورية)" : "VIP Telegram Channel (instant daily signals)", included: false },
  ];

  const proFeatures = [
    { icon: <ShieldCheck className="w-4 h-4" />, text: isAr ? "قناة VIP على تليجرام (إشارات وتوصيات يومية فور صدورها بدون تأخير)" : "VIP Telegram Channel (instant daily signals without delay)", included: true },
    { icon: <Zap className="w-4 h-4" />, text: isAr ? "الصفقات القصيرة ⚡ PRO — صفقات زخم، وقف صارم 4%، وتتبع أرباح EMA10 بدون تشفير" : "Short Swings ⚡ PRO — momentum trades, tight 4% stop, and EMA10 runners unmasked", included: true },
    { icon: <MessageSquare className="w-4 h-4" />, text: isAr ? `${proLimits.chat_messages_per_month} رسالة شات بوت ذكي شهرياً` : `${proLimits.chat_messages_per_month} smart chatbot messages / month`, included: true },
    { icon: <BarChart3 className="w-4 h-4" />, text: isAr ? `حتى ${proLimits.portfolio_stocks} أسهم نشطة في المحفظة` : `Up to ${proLimits.portfolio_stocks} active portfolio stocks`, included: true },
    { icon: <Activity className="w-4 h-4" />, text: isAr ? "النشاط غير الطبيعي — أسهم بحجم تداول غير طبيعي + تقييم AI" : "Unusual Activity — volume spikes + AI scoring", included: true },
  ];

  const lifetimeFeatures = [
    { icon: <Crown className="w-4 h-4 text-purple-600 dark:text-yellow-400" />, text: isAr ? "صلاحية كاملة مدى الحياة للأبد (36,500 يوم بدون أي تجديد أو اشتراك متكرر)" : "Permanent lifetime access (never expires, zero recurring renewals)", included: true },
    { icon: <ShieldCheck className="w-4 h-4 text-emerald-500" />, text: isAr ? "قناة VIP على تليجرام (إشارات وتوصيات يومية فورية للأبد)" : "VIP Telegram Channel forever", included: true },
    { icon: <Zap className="w-4 h-4 text-emerald-500" />, text: isAr ? "الصفقات القصيرة ⚡ PRO ومتابعة الأرباح كاملة بدون تشفير" : "Short Swings ⚡ PRO momentum trades unmasked", included: true },
    { icon: <MessageSquare className="w-4 h-4 text-emerald-500" />, text: isAr ? `${proLimits.chat_messages_per_month} استشارة شات بوت شهرياً تتجدد تلقائياً للأبد` : `${proLimits.chat_messages_per_month} AI chat messages refreshed monthly for life`, included: true },
    { icon: <Activity className="w-4 h-4 text-emerald-500" />, text: isAr ? "النشاط غير الطبيعي للأسهم + المحفظة الموسعة (10 أسهم)" : "Unusual Activity + 10 portfolio stock slots", included: true },
    { icon: <Sparkles className="w-4 h-4 text-yellow-500" />, text: isAr ? "أولوية قصوى لكافة التحديثات والميزات المستقبلية" : "VIP priority for all future updates", included: true },
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
                  ? selectedPlanDetails?.id === "lifetime"
                    ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              }`}
            >
              {orderStatus === "failed"
                ? isAr ? "فشلت العملية" : "Payment Incomplete"
                : orderStatus === "approved"
                ? selectedPlanDetails?.id === "lifetime"
                  ? isAr ? "تم تفعيل باقة مدى الحياة (LIFETIME VIP) 👑" : "Lifetime VIP Activated 👑"
                  : isAr ? "تم التفعيل بنجاح" : "Pro Activated"
                : isAr ? "جاري التحقق من الدفع" : "Verifying Payment"}
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-zinc-950 dark:text-white">
              {orderStatus === "failed"
                ? isAr ? "لم تكتمل عملية الدفع" : "Payment was not completed"
                : orderStatus === "approved"
                ? selectedPlanDetails?.id === "lifetime"
                  ? isAr ? "أهلاً بك في نخبة EGX BOTS مدى الحياة! 👑🎉" : "Welcome to EGX BOTS Lifetime VIP! 👑🎉"
                  : isAr ? "أهلاً بك في EGX BOTS Pro! 🎉" : "Welcome to EGX BOTS Pro! 🎉"
                : isAr ? "في انتظار إشعار تأكيد الدفع ⏳" : "Awaiting payment confirmation ⏳"}
            </h2>
            <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-md mx-auto">
              {orderStatus === "failed"
                ? isAr
                  ? "لم نتلقَ تأكيد إتمام الدفع من EasyKash. يمكنك المحاولة مجددًا باختيار وسيلة أخرى أو التواصل معنا للمساعدة."
                  : "We didn't receive payment confirmation from EasyKash. You can try again or reach out to our team."
                : orderStatus === "approved"
                ? isAr
                  ? selectedPlanDetails?.id === "lifetime"
                    ? "تم تفعيل اشتراكك الدائم في باقة مدى الحياة (Lifetime VIP) بنجاح للأبد! حسابك نشط الآن بكامل الصلاحيات مدى الحياة وبدون أي تجديدات شهرية."
                    : `تم تأكيد اشتراكك في باقة Pro لمدة ${selectedPlanDetails?.days || 30} يوماً بنجاح. حسابك نشط الآن بكامل الصلاحيات!`
                  : selectedPlanDetails?.id === "lifetime"
                  ? "Your Lifetime VIP subscription is now active forever! Full access granted for life with zero recurring renewals."
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
                  {selectedPlanDetails?.id === "lifetime"
                    ? isAr
                      ? "مدة الاشتراك: مدى الحياة للأبد (اشتراك دائم) 👑"
                      : "Subscription Duration: Lifetime Forever 👑"
                    : isAr
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
                  disabled={busy || (!!user && !isMobileValid) || (selectedPlan === "lifetime" && !lifetimeIsOpen)}
                  className="w-full flex items-center justify-center gap-3 border-4 border-black dark:border-white bg-emerald-500 hover:bg-emerald-600 text-zinc-950 dark:text-black font-black text-base py-4 px-6 uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_#ffffff] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <LockKeyhole className="w-5 h-5" />
                      {!user
                        ? isAr ? "سجّل الدخول للمتابعة" : "Sign in to Continue"
                        : selectedPlan === "lifetime" && !lifetimeIsOpen
                        ? isAr ? "عذراً، اكتملت جميع مقاعد باقة مدى الحياة (20/20)" : "Lifetime Deal is Sold Out"
                        : isAr ? `المتابعة للدفع الآمن (${proPrice.toLocaleString()} ج.م) 🔒` : `Proceed to Secure Checkout (${proPrice.toLocaleString()} EGP) 🔒`}
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
                <h3 className="text-2xl font-black flex items-center gap-2">
                  {selectedPlanDetails.isLifetime && <Crown className="w-6 h-6 text-yellow-400" />}
                  {selectedPlanDetails.isLifetime ? "EGX BOTS Lifetime VIP" : "EGX BOTS Pro"}
                </h3>
                <p className="text-xs font-semibold text-zinc-400 mt-1">
                  {isAr ? selectedPlanDetails.name_ar : selectedPlanDetails.name_en}
                </p>
              </div>

              {/* Items Breakdown */}
              <div className="space-y-3 border-b border-zinc-800 pb-4 text-xs font-bold">
                <div className="flex justify-between">
                  <span className="text-zinc-400">{isAr ? "الخطة:" : "Plan:"}</span>
                  <span className="font-black text-emerald-400">
                    {selectedPlanDetails.isLifetime ? (isAr ? "مدى الحياة (Lifetime VIP)" : "Lifetime VIP") : "Pro VIP"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">{isAr ? "فترة الاشتراك:" : "Duration:"}</span>
                  <span className="font-mono">
                    {selectedPlanDetails.isLifetime
                      ? (isAr ? "مدى الحياة للأبد (دائم)" : "Lifetime Forever")
                      : `${selectedPlanDetails.days} ${isAr ? "يوماً" : "days"}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">{isAr ? "وسيلة الدفع:" : "Method:"}</span>
                  <span>{isAr ? "تُحدد داخل EasyKash" : "Chosen on EasyKash"}</span>
                </div>
                {selectedPlanDetails.isLifetime ? (
                  <div className="flex justify-between text-yellow-400">
                    <span>{isAr ? "الميزة الكبرى:" : "Perk:"}</span>
                    <span>{isAr ? "بدون أي تجديد شهري للأبد" : "Zero recurring renewals"}</span>
                  </div>
                ) : (
                  selectedPlanDetails.savingsPct > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>{isAr ? "نسبة التوفير:" : "Savings:"}</span>
                      <span>{isAr ? `وفرت ${selectedPlanDetails.savingsPct}%` : `${selectedPlanDetails.savingsPct}% OFF`}</span>
                    </div>
                  )
                )}
              </div>

              {/* Total */}
              <div className="flex items-baseline justify-between border-b border-zinc-800 pb-5">
                <span className="text-sm font-black">{isAr ? "المبلغ الإجمالي:" : "Total Amount:"}</span>
                <div className="text-end">
                  <span className="text-3xl font-black text-emerald-400">{proPrice.toLocaleString()}</span>
                  <span className="text-xs font-bold text-zinc-400 ms-1">ج.م</span>
                </div>
              </div>

              {/* Included Benefits List */}
              <div className="space-y-2 text-xs font-bold">
                <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider block">
                  {selectedPlanDetails.isLifetime
                    ? (isAr ? "ميزات باقة مدى الحياة VIP:" : "INCLUDED WITH LIFETIME VIP:")
                    : (isAr ? "الميزات المشمولة فوراً:" : "INCLUDED WITH PRO:")}
                </span>
                {selectedPlanDetails.isLifetime ? (
                  <>
                    <div className="flex items-center gap-2 text-yellow-300 font-black">
                      <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                      <span>{isAr ? "صلاحية مدى الحياة للأبد بدون تجديد" : "Permanent lifetime access, zero renewals"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{isAr ? "قناة VIP على تليجرام فورية للأبد" : "VIP Telegram Channel for life"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{isAr ? "الصفقات القصيرة ⚡ PRO ومتابعة الأرباح" : "Short Swings ⚡ PRO unmasked"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{isAr ? `${proLimits.chat_messages_per_month} رسالة ذكاء اصطناعي تتجدد شهرياً للأبد` : `${proLimits.chat_messages_per_month} AI chat messages renewed monthly for life`}</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{isAr ? `محفظة حتى ${proLimits.portfolio_stocks} أسهم + كشف السيولة غير الطبيعية` : `Up to ${proLimits.portfolio_stocks} portfolio stocks + volume spikes`}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{isAr ? "قناة VIP على تليجرام (إشارات وتوصيات يومية فور صدورها بدون تأخير)" : "VIP Telegram Channel (instant daily signals without delay)"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{isAr ? "الصفقات القصيرة ⚡ PRO (إشارات الزخم السريعة والوقف المتحرك بدون تشفير)" : "Short Swings ⚡ PRO (instant momentum runners unmasked)"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{isAr ? `${proLimits.chat_messages_per_month} رسالة ذكاء اصطناعي شهرياً` : `${proLimits.chat_messages_per_month} monthly AI chat messages`}</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{isAr ? `محفظة تداول حتى ${proLimits.portfolio_stocks} أسهم` : `${proLimits.portfolio_stocks} active portfolio stock slots`}</span>
                    </div>
                  </>
                )}
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

        {isPro && (
          <div className="border-3 border-emerald-500 bg-emerald-500/10 px-5 py-3.5 text-center text-sm font-bold text-emerald-800 dark:text-emerald-200 shadow-[3px_3px_0px_#10b981]" role="status">
            {isAr ? "اشتراك Pro نشط على حسابك الآن" : "Your Pro subscription is active"}
            {subscriptionEnd && ` · ${isAr ? "ساري حتى" : "Valid until"} ${new Date(subscriptionEnd).toLocaleDateString(isAr ? "ar-EG" : "en-US")}`}
          </div>
        )}

        {/* ── INTERACTIVE DURATION SWITCHER (سويتشر مدة الاشتراك) ── */}
        <div className="space-y-3">
          <div className="text-center">
            <span className="text-xs font-black uppercase tracking-wider text-zinc-500 block mb-1">
              {isAr ? "اختر مدة الاشتراك المفضلة لك:" : "SELECT BILLING CYCLE:"}
            </span>
          </div>

          <div className="flex justify-center">
            <div className="inline-flex p-1.5 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981] flex-wrap justify-center gap-1.5 sm:gap-2 max-w-full">
              {[
                {
                  id: "pro",
                  name_ar: "شهر واحد",
                  name_en: "1 Month",
                  badge_ar: foundersRemaining !== null ? `50 ج.م (${foundersRemaining} مقعد) 🔥` : "50 ج.م 🔥",
                  badge_en: "50 EGP 🔥",
                  badgeBg: "bg-amber-300 text-black",
                  isLifetime: false,
                },
                {
                  id: "pro_6m",
                  name_ar: "6 شهور",
                  name_en: "6 Months",
                  badge_ar: "الأكثر طلباً ⭐",
                  badge_en: "Most Popular ⭐",
                  badgeBg: "bg-emerald-400 text-black",
                  isLifetime: false,
                },
                {
                  id: "pro_1y",
                  name_ar: "سنة كاملة",
                  name_en: "1 Year",
                  badge_ar: "أكبر توفير 💎",
                  badge_en: "Save 25% 💎",
                  badgeBg: "bg-sky-400 text-black",
                  isLifetime: false,
                },
                {
                  id: "lifetime",
                  name_ar: "مدى الحياة",
                  name_en: "Lifetime VIP",
                  badge_ar: lifetimeIsOpen ? `👑 20 مقعداً (باقي ${lifetimeRemaining})` : "اكتملت المقاعد",
                  badge_en: "👑 20 Spots Only",
                  badgeBg: "bg-[#FFE600] text-black",
                  isLifetime: true,
                },
              ].map((tab) => {
                const isSelected = selectedPlan === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSelectedPlan(tab.id)}
                    className={`flex items-center gap-2 px-3.5 sm:px-5 py-2.5 sm:py-3 border-2 transition-all text-xs sm:text-sm font-black active:translate-y-0.5 cursor-pointer ${
                      isSelected
                        ? tab.isLifetime
                          ? "border-black bg-[#FFE600] text-black shadow-[3px_3px_0px_#7c3aed]"
                          : "border-black dark:border-white bg-black text-white dark:bg-white dark:text-black shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_#10b981]"
                        : "border-transparent bg-transparent hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {tab.isLifetime && <Crown className="w-4 h-4 fill-current shrink-0" />}
                    <span>{isAr ? tab.name_ar : tab.name_en}</span>
                    <span
                      className={`text-[10px] font-black uppercase px-2 py-0.5 border border-black shadow-[1px_1px_0px_#000] whitespace-nowrap ${tab.badgeBg}`}
                    >
                      {isAr ? tab.badge_ar : tab.badge_en}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── 2 SPACIOUS CARDS: FREE VS SELECTED PAID PLAN ── */}
        <div className="grid lg:grid-cols-12 gap-8 items-stretch max-w-5xl mx-auto">
          {/* ── 01. Free Plan Card (5 Cols) ── */}
          <div className="lg:col-span-5 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,0.2)] p-6 sm:p-7 space-y-6 flex flex-col justify-between">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-zinc-950 dark:text-white">
                    {isAr ? "الخطة المجانية" : "Free Plan"}
                  </h3>
                  <span className="text-xs font-bold text-zinc-500 block mt-0.5">
                    {isAr ? "استكشاف المنصة وتجربة التحليلات" : "Explore platform basics"}
                  </span>
                </div>
                <span className="text-[10px] font-black uppercase px-2.5 py-1 border-2 border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                  {isPro ? (isAr ? "متاحة" : "Available") : isAr ? "الخطة الحالية" : "Current"}
                </span>
              </div>

              <div className="border-b-2 border-zinc-200 dark:border-zinc-800 pb-5">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-black text-zinc-950 dark:text-white">0</span>
                  <span className="text-sm font-bold text-zinc-500">ج.م / للأبد</span>
                </div>
                <p className="text-xs font-semibold text-zinc-500 mt-1">
                  {isAr ? "بدون أي بطاقة بنكية أو رسوم خفية" : "No credit card required"}
                </p>
              </div>

              <div className="space-y-3">
                <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400 block">
                  {isAr ? "الميزات المتاحة في المجاني:" : "INCLUDED IN FREE:"}
                </span>
                <ul className="space-y-3.5">
                  {freeFeatures.map((f, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-2.5 text-xs font-bold leading-snug ${
                        f.included ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-600 line-through"
                      }`}
                    >
                      <span className="shrink-0 mt-0.5">{f.included ? <Check className="w-4 h-4 text-emerald-500" /> : <X className="w-4 h-4 text-zinc-400" />}</span>
                      <span>{f.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <button
              type="button"
              disabled
              className="w-full border-3 border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 py-3.5 text-xs font-black uppercase tracking-wider cursor-not-allowed mt-4"
            >
              {isPro ? (isAr ? "الخطة المجانية متاحة" : "Free plan available") : (isAr ? "خطتك الحالية" : "Current Plan")}
            </button>
          </div>

          {/* ── 02. Selected Hero Paid Plan Card (7 Cols) ── */}
          {(() => {
            const isLifetime = selectedPlanDetails.id === "lifetime";
            const isFeatured = selectedPlanDetails.id === "pro_6m";
            const isAnnual = selectedPlanDetails.id === "pro_1y";
            const isMonthly = selectedPlanDetails.id === "pro";
            const planDiscount = isMonthly && monthlyDiscount?.active ? monthlyDiscount : null;
            const featuresList = isLifetime ? lifetimeFeatures : proFeatures;

            return (
              <div
                className={`lg:col-span-7 border-4 p-6 sm:p-8 space-y-6 flex flex-col justify-between relative transition-all duration-300 ${
                  isLifetime
                    ? "border-purple-600 dark:border-purple-400 bg-gradient-to-br from-purple-950/20 via-white to-purple-950/10 dark:from-purple-950/50 dark:via-zinc-950 dark:to-indigo-950/30 shadow-[8px_8px_0px_#FFE600] dark:shadow-[8px_8px_0px_#FFE600]"
                    : isFeatured
                    ? "border-black dark:border-white bg-emerald-50/70 dark:bg-emerald-950/30 ring-4 ring-emerald-500 shadow-[8px_8px_0px_#10b981]"
                    : "border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_#10b981]"
                }`}
              >
                {/* Top Spotlight Badge */}
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span
                    className={`border-2 border-black text-xs font-black uppercase px-4 py-1 tracking-wider shadow-[2px_2px_0px_rgba(0,0,0,1)] whitespace-nowrap flex items-center gap-1.5 ${
                      isLifetime
                        ? "bg-[#FFE600] text-black"
                        : isFeatured
                        ? "bg-emerald-400 text-black"
                        : isAnnual
                        ? "bg-sky-300 text-black"
                        : "bg-amber-300 text-black"
                    }`}
                  >
                    {isLifetime ? (
                      <>
                        <Crown className="w-3.5 h-3.5 fill-black" />
                        {lifetimeIsOpen
                          ? (isAr ? `صفقة العمر · باقي ${lifetimeRemaining} مقعداً فقط` : `Lifetime VIP · ${lifetimeRemaining} Spots Left`)
                          : (isAr ? "اكتملت المقاعد (Sold Out)" : "Sold Out (20/20)")}
                      </>
                    ) : isMonthly && planDiscount ? (
                      foundersRemaining !== null
                        ? `عرض المؤسسين الأوائل (باقي ${foundersRemaining} مقعد)`
                        : planDiscount.label_ar || "عرض محدود"
                    ) : isFeatured ? (
                      isAr ? "⭐ الخطة الأكثر طلباً بين المتداولين" : "⭐ Most Popular Plan"
                    ) : (
                      isAr ? "💎 أكبر توفير وقيمة سنوية" : "💎 Max Value Plan"
                    )}
                  </span>
                </div>

                <div className="space-y-5 pt-1">
                  {/* Plan Name & VIP tag */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-2xl sm:text-3xl font-black text-zinc-950 dark:text-white flex items-center gap-2">
                        {isLifetime && <Crown className="w-6 h-6 text-purple-600 dark:text-yellow-400 shrink-0" />}
                        {isLifetime
                          ? (isAr ? "EGX BOTS Lifetime VIP" : "EGX BOTS Lifetime VIP")
                          : `EGX BOTS Pro · ${isAr ? selectedPlanDetails.name_ar : selectedPlanDetails.name_en}`}
                      </h3>
                      <span className="text-xs font-bold text-zinc-500 block mt-0.5">
                        {isLifetime
                          ? (isAr ? "صلاحية دائمة للأبد (36,500 يوم)" : "Permanent access for life")
                          : `${selectedPlanDetails.days} ${isAr ? "يوماً كاملة من التوصيات الفورية" : "days instant access"}`}
                      </span>
                    </div>
                    <span
                      className={`text-xs font-black border-2 border-black dark:border-white px-2.5 py-1 ${
                        isLifetime
                          ? "bg-purple-600 text-yellow-300 shadow-[2px_2px_0px_#000]"
                          : "bg-emerald-500 text-white"
                      }`}
                    >
                      {isLifetime ? "VIP 20" : "PRO"}
                    </span>
                  </div>

                  {/* Price Section */}
                  <div className="border-b-2 border-zinc-200 dark:border-zinc-800 pb-5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-5xl sm:text-6xl font-black text-zinc-950 dark:text-white">
                        {selectedPlanDetails.amount_egp.toLocaleString()}
                      </span>
                      <span className="text-sm font-bold text-zinc-500">ج.م</span>
                      {planDiscount && (
                        <span className="ms-2 text-2xl font-black text-zinc-400 line-through">
                          {planDiscount.original_amount_egp} ج.م
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 mt-2">
                      {isLifetime ? (
                        <span className="text-xs font-black text-purple-700 dark:text-yellow-400 flex items-center gap-1.5 bg-purple-500/10 border border-purple-500/30 px-2 py-0.5">
                          <Sparkles className="w-3.5 h-3.5" />
                          {isAr ? "دفعة واحدة فقط للأبد · بدون أي تجديد شهري" : "One-time payment · Zero renewals"}
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">
                          {isAr ? `ما يعادل ${selectedPlanDetails.monthlyEquivalent} ج.م / شهر` : `EGP ${selectedPlanDetails.monthlyEquivalent}/mo`}
                        </span>
                      )}

                      {selectedPlanDetails.savingsPct > 0 && (
                        <span
                          className={`border px-2 py-0.5 text-xs font-black rounded ${
                            isLifetime
                              ? "border-purple-600/40 bg-purple-500/15 text-purple-700 dark:text-purple-300"
                              : "border-emerald-600/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {isLifetime
                            ? (isAr ? "وفر للأبد 👑" : "Save Forever 👑")
                            : (isAr ? `توفير ${selectedPlanDetails.savingsPct}%` : `${selectedPlanDetails.savingsPct}% OFF`)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Notice Box inside Card */}
                  {isLifetime && (
                    <div className="bg-black/80 dark:bg-purple-950/40 border-2 border-purple-500/40 p-4 space-y-2 text-white">
                      <div className="flex items-center justify-between text-xs font-black">
                        <span className="text-[#FFE600] flex items-center gap-1.5">
                          <Award className="w-4 h-4 text-[#FFE600]" />
                          {isAr ? "حالة المقاعد المتاحة:" : "Spots Availability:"}
                        </span>
                        <span className="font-mono text-white">
                          {lifetimeIsOpen
                            ? (isAr ? `متبقي ${lifetimeRemaining} من أصل ${lifetimeLimit} مقعداً` : `${lifetimeRemaining} of ${lifetimeLimit} spots left`)
                            : (isAr ? "اكتملت جميع المقاعد (20/20) ❌" : "SOLD OUT (20/20) ❌")}
                        </span>
                      </div>
                      <div className="w-full bg-zinc-800 border border-zinc-700 h-2.5 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-yellow-400 to-[#FFE600] transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(5, (lifetimeCount / lifetimeLimit) * 100))}%` }}
                        />
                      </div>
                      <p className="text-[11px] font-bold text-zinc-300">
                        {isAr
                          ? "⚡ بمجرد اكتمال الـ 20 مقعداً، سيتم إغلاق الباقة نهائياً ولن تُتاح مجدداً."
                          : "⚡ Once all 20 spots are claimed, this offer will be permanently closed."}
                      </p>
                    </div>
                  )}

                  {isMonthly && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 p-3.5 space-y-1 text-black dark:text-amber-200">
                      <div className="flex items-center gap-1.5 text-xs font-black text-amber-900 dark:text-amber-300">
                        <Clock className="w-4 h-4" />
                        <span>{isAr ? "ميزة المؤسسين الأوائل (Founding Members):" : "Founding Member Perk:"}</span>
                      </div>
                      <p className="text-xs font-semibold leading-relaxed text-zinc-800 dark:text-zinc-200">
                        {isAr
                          ? "اشترك الآن بـ 50 ج.م فقط شهرياً مدى الحياة (بدلاً من 200 ج.م). يُمنح المشترك مهلة سماح 72 ساعة بعد انتهاء كل شهر للتجديد بهذا السعر المخفض."
                          : "Lock in 50 EGP/mo for life. Includes 72 hours renewal grace period each month before standard 200 EGP pricing applies."}
                      </p>
                    </div>
                  )}

                  {/* Features List */}
                  <div className="space-y-3">
                    <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block">
                      {isLifetime
                        ? (isAr ? "الميزات الملكية المشمولة مدى الحياة:" : "INCLUDED FOR LIFE:")
                        : (isAr ? "الميزات المشمولة في باقة Pro:" : "INCLUDED IN PRO:")}
                    </span>
                    <ul className="space-y-3.5">
                      {featuresList.map((f, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-xs sm:text-sm font-bold leading-snug text-zinc-800 dark:text-zinc-200">
                          <span className="shrink-0 mt-0.5 text-emerald-500">{f.icon || <Check className="w-4 h-4" />}</span>
                          <span>{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Main CTA Button */}
                <div className="pt-4 space-y-2">
                  <button
                    type="button"
                    disabled={isLifetime && !lifetimeIsOpen}
                    onClick={() => {
                      setSelectedPlan(selectedPlanDetails.id);
                      setStep("payment");
                    }}
                    className={`w-full flex items-center justify-center gap-2.5 border-4 border-black dark:border-white py-4 px-6 text-sm sm:text-base font-black uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 transition-all ${
                      isLifetime
                        ? lifetimeIsOpen
                          ? "bg-[#FFE600] hover:bg-yellow-400 text-black shadow-[4px_4px_0px_#000] cursor-pointer"
                          : "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed"
                        : isFeatured
                        ? "bg-emerald-500 hover:bg-emerald-600 text-zinc-950 dark:text-black font-black"
                        : "bg-zinc-900 hover:bg-black text-white dark:bg-white dark:text-black dark:hover:bg-zinc-100"
                    }`}
                  >
                    {isLifetime ? (
                      <>
                        <Crown className="w-5 h-5 fill-current" />
                        {lifetimeIsOpen
                          ? isPro
                            ? (isAr ? "ترقية لحساب مدى الحياة (2,250 ج.م)" : "Upgrade to Lifetime")
                            : (isAr ? "احجز مقعدك مدى الحياة الآن (2,250 ج.م) 👑" : "Get Lifetime Deal 👑")
                          : (isAr ? "اكتملت المقاعد (Sold Out)" : "Sold Out (20/20)")}
                      </>
                    ) : (
                      <>
                        <LockKeyhole className="w-4 h-4" />
                        {isPro
                          ? (isAr ? `تجديد باقة (${selectedPlanDetails.amount_egp.toLocaleString()} ج.م)` : `Renew Plan (${selectedPlanDetails.amount_egp} EGP)`)
                          : (isAr ? `المتابعة للاشتراك (${selectedPlanDetails.amount_egp.toLocaleString()} ج.م)` : `Subscribe Now (${selectedPlanDetails.amount_egp} EGP)`)}
                      </>
                    )}
                  </button>

                  <div className="flex items-center justify-center gap-3 text-[11px] font-bold text-zinc-500 pt-1">
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                      {isAr ? "بوابة EasyKash مشفرة ومعتمدة" : "Secure Checkout"}
                    </span>
                    <span>•</span>
                    <span>{isAr ? "تفعيل لحظي وآلي" : "Instant Activation"}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── QUICK COMPARISON TABLE (مقارنة سريعة لجميع المدد والأسعار) ── */}
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 sm:p-8 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981] space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-zinc-200 dark:border-zinc-800 pb-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 block mb-0.5">
                {isAr ? "جدول المقارنة السريعة" : "QUICK COMPARISON"}
              </span>
              <h3 className="text-xl font-black text-zinc-950 dark:text-white">
                {isAr ? "مقارنة جميع مدد الاشتراك والأسعار" : "Compare All Durations & Pricing"}
              </h3>
            </div>
            <p className="text-xs font-bold text-zinc-500">
              {isAr ? "اضغط على أي خطة لاختيارها والانتقال للدفع فوراً" : "Click any plan to select and checkout"}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs font-bold">
              <thead>
                <tr className="border-b-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white uppercase text-[11px]">
                  <th className="p-3 text-start">{isAr ? "الخطة / المدة" : "Plan"}</th>
                  <th className="p-3 text-start">{isAr ? "السعر الإجمالي" : "Total Price"}</th>
                  <th className="p-3 text-start">{isAr ? "المعادل الشهري" : "Monthly Rate"}</th>
                  <th className="p-3 text-start">{isAr ? "نسبة التوفير" : "Savings"}</th>
                  <th className="p-3 text-start">{isAr ? "المقاعد والحالة" : "Availability"}</th>
                  <th className="p-3 text-end">{isAr ? "الإجراء" : "Action"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {/* Free */}
                <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                  <td className="p-3 font-black text-zinc-950 dark:text-white flex items-center gap-1.5">
                    <span>{isAr ? "مجاني" : "Free"}</span>
                  </td>
                  <td className="p-3">0 ج.م</td>
                  <td className="p-3 text-zinc-500">0 ج.م</td>
                  <td className="p-3 text-zinc-500">—</td>
                  <td className="p-3"><span className="text-emerald-600">{isAr ? "متاح دائماً" : "Always Free"}</span></td>
                  <td className="p-3 text-end">
                    <span className="text-[10px] text-zinc-400 font-bold uppercase">{isAr ? "الأساسي" : "Basic"}</span>
                  </td>
                </tr>

                {/* Paid Plans */}
                {paidPlans.map((plan) => {
                  const isCur = selectedPlan === plan.id;
                  return (
                    <tr
                      key={plan.id}
                      className={`transition-colors ${
                        isCur
                          ? "bg-emerald-50/60 dark:bg-emerald-950/20 font-black"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                      }`}
                    >
                      <td className="p-3 font-black text-zinc-950 dark:text-white">
                        <div className="flex items-center gap-1.5">
                          {plan.isLifetime && <Crown className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500 shrink-0" />}
                          <span>{isAr ? plan.name_ar : plan.name_en}</span>
                          {plan.badge && (
                            <span className="text-[9px] font-black px-1.5 py-0.2 border border-black bg-amber-300 text-black">
                              {plan.badge}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 font-black text-zinc-950 dark:text-white">
                        {plan.amount_egp.toLocaleString()} ج.م
                      </td>
                      <td className="p-3 text-zinc-600 dark:text-zinc-400">
                        {plan.isLifetime ? (isAr ? "دفعة واحدة للأبد" : "One-time") : `${plan.monthlyEquivalent} ج.م / شهر`}
                      </td>
                      <td className="p-3">
                        {plan.savingsPct > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-black">
                            {plan.isLifetime ? (isAr ? "وفر للأبد 👑" : "Save 95%+") : `وفر ${plan.savingsPct}%`}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {plan.id === "lifetime" ? (
                          <span className={lifetimeIsOpen ? "text-purple-600 dark:text-yellow-400 font-black" : "text-red-500"}>
                            {lifetimeIsOpen ? (isAr ? `متبقي ${lifetimeRemaining} مقعداً` : `${lifetimeRemaining} left`) : (isAr ? "اكتملت المقاعد" : "Sold out")}
                          </span>
                        ) : plan.id === "pro" ? (
                          <span className="text-amber-600 dark:text-amber-400 font-bold">
                            {foundersRemaining !== null ? (isAr ? `باقي ${foundersRemaining} مؤسس` : `${foundersRemaining} spots`) : "متاح"}
                          </span>
                        ) : (
                          <span className="text-emerald-600 font-bold">{isAr ? "متاح فوري" : "Available"}</span>
                        )}
                      </td>
                      <td className="p-3 text-end">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPlan(plan.id);
                            window.scrollTo({ top: 300, behavior: "smooth" });
                          }}
                          className={`px-3 py-1.5 border-2 border-black dark:border-white text-[11px] font-black transition-all ${
                            isCur
                              ? "bg-[#FFE600] text-black shadow-[2px_2px_0px_#000]"
                              : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white"
                          }`}
                        >
                          {isCur ? (isAr ? "✓ محددة الآن" : "✓ Selected") : (isAr ? "اختيار هذه الخطة" : "Select Plan")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Notice: Market Data & Signal Nature */}
        <div className="border-4 border-black dark:border-white bg-amber-50 dark:bg-amber-950/20 p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_#f59e0b]">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="p-2.5 border-2 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black shrink-0 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
              <Info className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-zinc-950 dark:text-white">
                {isAr ? "تنويه هام بشأن طبيعة الأسعار والإشارات الفنية" : "Important Notice on Market Data & Technical Signals"}
              </h4>
              <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {isAr
                  ? "المنصة لا تقدم شاشة بث أسعار لحظية للأسهم (Live Ticker) أثناء جلسة التداول، وإنما تعتمد على بيانات الإغلاق والتحليل الفني والكمي. المقصود بـ «الإشارات الفورية» هو وصول تنبيهات التوصيات للمشتركين فور صدورها واعتمادها من نماذج الذكاء الاصطناعي دون أي تأخير زمني، بينما يتم تنفيذ عمليات الشراء والبيع عبر تطبيق السمسرة المعتمد الخاص بك."
                  : "The platform does not provide a live streaming stock ticker during trading sessions; it relies on closing data and quantitative technical analysis. «Instant Signals» refers to recommendation alerts being delivered to subscribers immediately upon AI model approval without delay. Buy/sell orders are executed through your personal licensed broker."}
              </p>
              <div className="pt-1.5">
                <Link
                  href="/legal-status"
                  className="inline-flex items-center gap-1 text-xs font-black text-amber-800 dark:text-amber-300 underline underline-offset-4 hover:text-amber-950 dark:hover:text-amber-200"
                >
                  {isAr ? "اقرأ بيان الموقف القانوني والتنظيمي للمنصة (الهيئة العامة للرقابة المالية) ←" : "Read our full Legal & Regulatory Compliance Statement (Egyptian FRA) →"}
                </Link>
              </div>
            </div>
          </div>
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
