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
  CreditCard,
  Wallet,
  Banknote,
  ArrowLeft,
  ArrowRight,
  LockKeyhole,
} from "lucide-react";
import { toast } from "sonner";

type Step = "plans" | "payment" | "submitted";

const easyKashMethods = [
  { id: "cards", ar: "البطاقات البنكية", en: "Bank cards", arHint: "فيزا وماستركارد", enHint: "Visa & Mastercard", icon: CreditCard },
  { id: "mobile-wallet", ar: "محافظ الموبايل", en: "Mobile wallets", arHint: "ادفع من محفظتك", enHint: "Pay with your wallet", icon: Wallet },
  { id: "cash", ar: "الدفع النقدي", en: "Cash payment", arHint: "أمان أو فوري", enHint: "Aman or Fawry", icon: Banknote },
  { id: "meeza", ar: "ميزة", en: "Meeza", arHint: "بطاقة ميزة", enHint: "Meeza card", icon: CreditCard },
  { id: "apple-pay", ar: "Apple Pay", en: "Apple Pay", arHint: "حسب الجهاز والإتاحة", enHint: "Device availability applies", icon: Smartphone },
] as const;

type EasyKashMethodId = (typeof easyKashMethods)[number]["id"];

const paymentGroups: { ar: string; en: string; ids: EasyKashMethodId[] }[] = [
  { ar: "البطاقات والدفع السريع", en: "Cards & express", ids: ["cards", "meeza", "apple-pay"] },
  { ar: "المحافظ والدفع النقدي", en: "Wallets & cash", ids: ["mobile-wallet", "cash"] },
];

function EasyKashMethods({ isAr, selected, onSelect }: { isAr: boolean; selected: EasyKashMethodId; onSelect: (method: EasyKashMethodId) => void }) {
  return (
    <div className="space-y-5" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h2 className="text-xl font-black text-zinc-900 dark:text-white">
          {isAr ? "اختار طريقة الدفع المناسبة" : "Choose how to pay"}
        </h2>
        <p className="mt-1 text-xs font-medium leading-relaxed text-zinc-600 dark:text-zinc-300">
          {isAr
            ? "الوسائل النهائية المتاحة يحددها حسابنا لدى EasyKash. اختار وسيلة لعرض خطواتها."
            : "Final availability depends on our EasyKash account. Choose a method to see its steps."}
        </p>
      </div>
      <div className="space-y-4">
        {paymentGroups.map((group) => (
          <div key={group.en} role="group" aria-label={isAr ? group.ar : group.en}>
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.13em] text-zinc-500 dark:text-zinc-400">{isAr ? group.ar : group.en}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.ids.map((id) => {
                const method = easyKashMethods.find((item) => item.id === id)!;
                const Icon = method.icon;
                return (
                  <button key={id} type="button" onClick={() => onSelect(id)} aria-pressed={selected === id} className={`group flex min-h-[72px] items-center gap-3 border-2 px-3.5 py-3 text-start transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${selected === id ? "border-zinc-950 bg-emerald-50 shadow-[4px_4px_0px_#10b981] dark:border-white dark:bg-emerald-950/50" : "border-zinc-200 bg-white hover:border-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-300 dark:hover:bg-zinc-800"}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center border-2 ${selected === id ? "border-zinc-950 bg-emerald-500 text-zinc-950 dark:border-white" : "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-black leading-tight text-zinc-950 dark:text-zinc-100">{isAr ? method.ar : method.en}</span><span className="mt-1 block text-xs font-medium leading-tight text-zinc-500 dark:text-zinc-400">{isAr ? method.arHint : method.enHint}</span></span>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected === id ? "border-emerald-600 bg-emerald-500 text-white" : "border-zinc-400 dark:border-zinc-500"}`}>{selected === id && <Check className="h-3.5 w-3.5" aria-hidden="true" />}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
  const [paymentMethod, setPaymentMethod] = useState<EasyKashMethodId>("cards");

  const normalizedMobile = customerMobile.trim().replace(/[\s-]/g, "").replace(/^\+20/, "0").replace(/^0020/, "0");
  const isMobileValid = /^01[0125]\d{8}$/.test(normalizedMobile);

  useEffect(() => {
    if (step !== "submitted" || !localOrder) return;
    let stopped = false;
    const check = async () => {
      const res = await fetch(`/api/payment/easykash/status?order_id=${encodeURIComponent(localOrder)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
        if (!stopped && data.status) {
          const settledStatus = ["expired", "rejected", "failed", "canceled", "cancelled"].includes(String(data.status).toLowerCase()) ? "failed" : data.status;
          setOrderStatus(settledStatus);
          if (data.plan_id) setSelectedPlan(data.plan_id);
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
        const local = await fetch("/api/payment/easykash/config", {
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

  const startEasyKashPayment = async (planId = selectedPlan) => {
    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent("/pricing")}`);
      return;
    }
    if (!isMobileValid) {
      toast.error(isAr ? "أدخل رقم موبايل مصري صحيح من أي شبكة" : "Enter a valid Egyptian mobile number");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/payment/easykash/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, mobile: normalizedMobile, method_id: paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || (isAr ? "تعذر إنشاء طلب الدفع" : "Could not start checkout"));
      setLocalOrder(data.order_id);
      const checkoutUrl = new URL(String(data.url || ""));
      const checkoutPath = checkoutUrl.pathname.split("/").filter(Boolean);
      if (!["https://easykash.net", "https://www.easykash.net"].includes(checkoutUrl.origin) || checkoutUrl.search || checkoutUrl.hash || checkoutPath.length !== 2 || checkoutPath[0] !== "DirectPayV1" || !/^[A-Za-z0-9]+$/.test(checkoutPath[1])) {
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

  // Display the same plan amounts the checkout API will actually charge.
  const monthlyPrice = Number(localConfig?.plans?.find((item: any) => item.id === "pro")?.amount_egp ?? 200);
  const paidPlans = [
    { id: "pro", name_ar: "30 يومًا", name_en: "30 days", amount_egp: 200, days: 30 },
    { id: "pro_6m", name_ar: "180 يومًا", name_en: "180 days", amount_egp: 1000, days: 180 },
    { id: "pro_1y", name_ar: "365 يومًا", name_en: "365 days", amount_egp: 1800, days: 365 },
  ].map((plan) => {
    const configured = localConfig?.plans?.find((item: any) => item.id === plan.id);
    const amount = Number(configured?.amount_egp ?? plan.amount_egp);
    const days = Number(configured?.days ?? plan.days);
    const monthlyEquivalent = Math.round((amount / days) * 30);
    return { ...plan, amount_egp: amount, days, monthlyEquivalent, savingsPct: monthlyPrice > 0 ? Math.max(0, Math.round((1 - monthlyEquivalent / monthlyPrice) * 100)) : 0 };
  });
  const selectedPlanDetails = paidPlans.find((plan: any) => plan.id === selectedPlan) || paidPlans[0];
  const proPrice = selectedPlanDetails?.amount_egp ?? 200;
  const selectedMethod = easyKashMethods.find((method) => method.id === paymentMethod) || easyKashMethods[0];
  const isCardMethod = paymentMethod === "cards" || paymentMethod === "meeza" || paymentMethod === "apple-pay";
  const methodExplanation = isCardMethod
      ? (isAr ? "بيانات البطاقة أو Apple Pay تُدخل على صفحة EasyKash الآمنة فقط؛ لا نطلبها هنا." : "Enter card or Apple Pay details only on EasyKash's secure page; we never collect them here.")
      : paymentMethod === "mobile-wallet"
        ? (isAr ? "اختار Mobile Wallet داخل EasyKash، ثم اتبع خطوات تأكيد الدفع من محفظتك." : "Select Mobile Wallet on EasyKash, then follow the wallet confirmation steps.")
        : (isAr ? "اختار طريقة السداد النقدي المتاحة داخل EasyKash واتبع تعليمات أو كود السداد اللي هيظهر لك." : "Choose an available cash method on EasyKash and follow its voucher or payment instructions.");

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
          <div className={`h-20 w-20 border-4 ${orderStatus === "failed" ? "border-red-500 bg-red-50 text-red-500" : "border-emerald-500 bg-emerald-50 text-emerald-500"} flex items-center justify-center`}>
              {orderStatus === "failed" ? <X className="h-10 w-10" /> : <CheckCircle2 className="h-10 w-10" />}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-black dark:text-white">
              {orderStatus === "failed" ? (isAr ? "لم يكتمل الدفع ❌" : "Payment was not completed ❌") : orderStatus === "approved" ? (isAr ? "تم تفعيل Pro بنجاح ✅" : "Pro activated successfully ✅") : (isAr ? "في انتظار تأكيد الدفع ⏳" : "Waiting for payment confirmation ⏳")}
            </h2>
            <p className="text-sm font-bold text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {isAr
                ? orderStatus === "failed" ? "لم يصل تأكيد دفع مكتمل. يمكنك اختيار الخطة والمحاولة مرة أخرى." : orderStatus === "approved" ? `تم تأكيد الدفع وتفعيل حساب Pro لمدة ${selectedPlanDetails?.days || 30} يومًا.` : "طلب الدفع جاهز؛ سنحدّث الحالة تلقائيًا بعد تأكيد EasyKash."
                : orderStatus === "failed" ? "Payment was not completed. Choose a plan and try again." : orderStatus === "approved" ? `Your Pro plan is active for ${selectedPlanDetails?.days || 30} days.` : "Checkout started. We will update this status after EasyKash confirms payment."}
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
          {orderStatus === "failed" && <div className="flex flex-col gap-2"><button onClick={() => setStep("plans")} className="w-full h-11 border-4 border-black bg-emerald-500 text-white font-black">{isAr ? "اختيار خطة والمحاولة مجددًا" : "Choose a plan and try again"}</button><a href="https://wa.me/201024359109" target="_blank" rel="noreferrer" className="text-sm font-black text-emerald-600 underline">{isAr ? "محتاج مساعدة؟ كلمنا على واتساب" : "Need help? Contact us on WhatsApp"}</a></div>}
          {orderStatus === "approved" && <div className="space-y-3"><p className="font-black text-emerald-600">{subscriptionEnd ? (isAr ? `صالح حتى ${new Date(subscriptionEnd).toLocaleDateString("ar-EG")}` : `Valid until ${new Date(subscriptionEnd).toLocaleDateString()}`) : ""}</p>{telegramProUrl ? <a href={telegramProUrl} target="_blank" rel="noreferrer" className="block border-4 border-black bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-[3px_3px_0px_rgba(0,0,0,1)]">{isAr ? "انضم إلى قناة VIP على تليجرام" : "Join VIP Telegram Channel"}<span className="block text-[10px] font-bold mt-1 opacity-80">{isAr ? `الرابط صالح حتى ${subscriptionEnd ? new Date(subscriptionEnd).toLocaleDateString("ar-EG") : "نهاية الاشتراك"}` : `Invite valid through ${subscriptionEnd ? new Date(subscriptionEnd).toLocaleDateString() : "subscription end"}`}</span></a> : <p className="text-xs font-bold text-amber-600">{isAr ? "جاري إنشاء رابط دعوة قناة VIP... حدّث الصفحة بعد لحظات." : "Creating your VIP invite link... refresh in a moment."}</p>}</div>}
          <a href="https://wa.me/201024359109" target="_blank" rel="noreferrer" className="block text-sm font-black text-emerald-600 underline">{isAr ? "محتاج مساعدة؟ كلمنا على واتساب" : "Need help? Contact us on WhatsApp"}</a>
        </div>
      </div>
    );
  }

  // ── Payment step ─────────────────────────────────────────────────────────
  if (step === "payment") {
    return (
      <div className="relative min-h-[70vh] overflow-hidden bg-slate-50 px-4 py-8 dark:bg-[#0c1220] sm:py-12" dir={isAr ? "rtl" : "ltr"}>
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,#94a3b81c_1px,transparent_1px),linear-gradient(to_bottom,#94a3b81c_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative mx-auto max-w-6xl">
          <header className="mb-6 flex flex-col gap-4 border-4 border-zinc-950 bg-white p-4 text-zinc-950 shadow-[5px_5px_0px_#18181b] dark:border-white dark:bg-zinc-950 dark:text-white dark:shadow-[5px_5px_0px_#fafafa33] sm:p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-3 sm:gap-4"><div className="shrink-0 border-2 border-zinc-950 bg-white p-1.5 dark:border-white"><Image src="/favicon_io/apple-touch-icon.png" alt="EGX Bots" width={40} height={40} className="h-8 w-8 object-contain sm:h-10 sm:w-10" /></div><div><p className="mb-2 inline-flex border-2 border-zinc-950 bg-amber-300 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-950">EGX BOTS × EASYKASH</p><h1 className="text-2xl font-black leading-tight sm:text-3xl">{isAr ? "إتمام الاشتراك" : "Complete your subscription"}</h1><p className="mt-2 text-xs font-semibold leading-6 text-zinc-600 dark:text-zinc-300 sm:text-sm">{isAr ? "اختر وسيلة الدفع، راجع متطلباتها، ثم انتقل لصفحة EasyKash الآمنة." : "Choose a payment method, review its requirements, then continue to secure EasyKash checkout."}</p></div></div>
            <button type="button" onClick={() => { setStep("plans"); setLocalOrder(null); }} className="inline-flex shrink-0 items-center gap-2 self-start border-2 border-zinc-950 bg-white px-4 py-2.5 text-sm font-black text-zinc-950 shadow-[3px_3px_0px_#10b981] transition-transform hover:-translate-y-0.5 dark:border-white dark:bg-zinc-900 dark:text-white">{isAr ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}{isAr ? "تغيير الخطة" : "Change plan"}</button>
          </header>

          <div dir="ltr" className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
            <section dir={isAr ? "rtl" : "ltr"} className="order-1 min-w-0 border-4 border-zinc-950 bg-white shadow-[6px_6px_0px_#10b981] dark:border-white dark:bg-zinc-950 lg:order-2" aria-label={isAr ? "اختيار طريقة الدفع" : "Choose payment method"}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-zinc-950 bg-emerald-400 px-5 py-3 text-zinc-950 dark:border-white sm:px-7">
                <span className="text-xs font-black uppercase tracking-[0.14em]">{isAr ? "01 / وسيلة الدفع" : "01 / PAYMENT METHOD"}</span>
                <span className="flex items-center gap-1 text-xs font-black"><ShieldCheck className="h-4 w-4" aria-hidden="true" />{isAr ? "دفع آمن عبر EasyKash" : "Secure EasyKash checkout"}</span>
              </div>
              <div className="space-y-7 p-5 sm:p-7">
                <EasyKashMethods isAr={isAr} selected={paymentMethod} onSelect={setPaymentMethod} />

                <div aria-live="polite" className="border-2 border-zinc-900 bg-zinc-50 p-4 dark:border-zinc-500 dark:bg-zinc-900 sm:p-5">
                  <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /><h3 className="text-base font-black text-zinc-950 dark:text-white">{isAr ? `متطلبات ${selectedMethod.ar}` : `What you need for ${selectedMethod.en}`}</h3></div>
                  <p className="mt-2 text-sm font-medium leading-6 text-zinc-700 dark:text-zinc-200">{methodExplanation}</p>
                  <p className="mt-2 text-xs font-bold leading-5 text-amber-700 dark:text-amber-300">{isAr ? "داخل EasyKash اضغط على الوسيلة الظاهرة لتحديدها، وبعدها اضغط Pay Now." : "On EasyKash, select the displayed method before pressing Pay Now."}</p>
                </div>

                <div className="space-y-4 border-t-2 border-zinc-200 pt-6 dark:border-zinc-800">
                  <div><h3 className="text-lg font-black text-zinc-950 dark:text-white">{isAr ? "بيانات التواصل المشتركة" : "Contact details"}</h3><p className="mt-1 text-xs font-medium leading-5 text-zinc-600 dark:text-zinc-300">{isAr ? "EasyKash تطلب رقم موبايل مصري للمشتري مع كل وسائل الدفع، حتى البطاقة. مش لازم يكون عليه محفظة." : "EasyKash requires an Egyptian buyer phone number for every method, including cards. It does not need a wallet."}</p></div>
                  {user?.email && <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-zinc-200 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"><span className="font-black text-zinc-600 dark:text-zinc-300">{isAr ? "البريد الإلكتروني" : "Email"}</span><span dir="ltr" className="break-all font-bold text-zinc-950 dark:text-white">{user.email}</span></div>}
                  <div className="space-y-2"><label htmlFor="easykash-contact-mobile" className="block text-sm font-black text-zinc-900 dark:text-white">{isAr ? "رقم الموبايل للتواصل" : "Contact mobile number"}</label><div className="flex items-center gap-3 border-2 border-zinc-400 bg-white px-4 py-3 focus-within:border-emerald-600 dark:border-zinc-600 dark:bg-zinc-950 dark:focus-within:border-emerald-400"><Smartphone className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" /><input id="easykash-contact-mobile" type="tel" inputMode="tel" autoComplete="tel-national" value={customerMobile} onChange={(event) => setCustomerMobile(event.target.value)} placeholder="01012345678" aria-invalid={customerMobile.length > 0 && !isMobileValid} aria-describedby="easykash-mobile-help" className="w-full bg-transparent text-lg font-bold text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-white" dir="ltr" /></div><p id="easykash-mobile-help" className={`text-xs font-semibold ${isMobileValid ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>{isMobileValid ? (isAr ? "✓ الرقم صحيح" : "✓ Valid number") : (isAr ? "رقم من أي شبكة: 010 أو 011 أو 012 أو 015" : "Any network: 010, 011, 012 or 015")}</p></div>
                </div>

                <button type="button" onClick={() => startEasyKashPayment()} disabled={busy || (!!user && !isMobileValid)} className="flex w-full items-center justify-center gap-2 border-2 border-zinc-950 bg-emerald-500 px-5 py-4 text-sm font-black text-zinc-950 shadow-[4px_4px_0px_#18181b] transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-700 dark:border-white dark:shadow-[4px_4px_0px_#fafafa] dark:disabled:bg-zinc-800 dark:disabled:text-zinc-200">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><LockKeyhole className="h-4 w-4" aria-hidden="true" />{!user ? (isAr ? "سجّل الدخول للمتابعة" : "Sign in to continue") : (isAr ? "المتابعة إلى EasyKash" : "Continue to EasyKash")}</>}</button>
                <p className="text-center text-xs font-medium leading-5 text-zinc-500 dark:text-zinc-400">{isAr ? "لن نطلب بيانات البطاقة أو الرقم السري على EGX BOTS." : "EGX BOTS never asks for your card details or PIN."}</p>
              </div>
            </section>

            <aside dir={isAr ? "rtl" : "ltr"} className="order-2 border-4 border-zinc-950 bg-zinc-950 p-5 text-white shadow-[6px_6px_0px_#10b981] dark:border-white sm:p-6 lg:order-1 lg:sticky lg:top-24">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">{isAr ? "ملخص الاشتراك" : "Subscription summary"}</p>
              <div className="mt-5 border-b border-zinc-700 pb-5"><p className="text-2xl font-black">EGX BOTS Pro</p><p className="mt-1 text-sm font-semibold text-zinc-300">{isAr ? selectedPlanDetails.name_ar : selectedPlanDetails.name_en}</p></div>
              <div className="space-y-3 border-b border-zinc-700 py-5 text-sm"><div className="flex justify-between gap-3"><span className="text-zinc-400">{isAr ? "الخطة" : "Plan"}</span><span className="font-bold">Pro</span></div><div className="flex justify-between gap-3"><span className="text-zinc-400">{isAr ? "المدة" : "Duration"}</span><span className="font-bold">{selectedPlanDetails.days} {isAr ? "يوم" : "days"}</span></div><div className="flex justify-between gap-3"><span className="text-zinc-400">{isAr ? "وسيلة الدفع" : "Method"}</span><span className="font-bold">{isAr ? selectedMethod.ar : selectedMethod.en}</span></div></div>
              <div className="flex items-end justify-between gap-3 py-5"><span className="text-sm font-black">{isAr ? "الإجمالي" : "Total"}</span><span className="text-3xl font-black text-emerald-400">{proPrice} <span className="text-sm">EGP</span></span></div>
              <div className="border-s-4 border-emerald-400 bg-white/10 p-3 text-xs font-semibold leading-6 text-zinc-200">{isAr ? "بيانات الدفع تُدخل على EasyKash، والاشتراك يتفعل بعد تأكيد عملية الدفع." : "Payment details stay on EasyKash. Your plan activates after payment confirmation."}</div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  // ── Plans page (default) ─────────────────────────────────────────────────
  return (
    <div className="min-h-[70vh] py-10 sm:py-14 px-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-400/10 blur-3xl motion-safe:animate-pulse" />
      <div className="max-w-6xl mx-auto space-y-10 relative">
        {/* Title */}
        <div className="text-center space-y-3 animate-in fade-in slide-in-from-top-3 duration-700">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-600 dark:text-emerald-400">EGX BOTS PRO</p>
          <h1 className="text-3xl sm:text-4xl font-black text-black dark:text-white">
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
          <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] p-6 space-y-6 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-700">
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

          {paidPlans.map((plan: any, planIndex) => {
            const isSelected = selectedPlan === plan.id;
            const planName = isAr ? plan.name_ar : plan.name_en;
            return (
              <div key={plan.id} style={{ animationDelay: `${(planIndex + 1) * 100}ms` }} className={`border-4 border-black dark:border-white ${isSelected ? "bg-emerald-50 dark:bg-emerald-950/30 ring-4 ring-emerald-400" : "bg-white dark:bg-zinc-900"} shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] p-6 space-y-5 flex flex-col relative animate-in fade-in slide-in-from-bottom-4 duration-700`}>
                {plan.id === "pro_6m" && <div className="absolute -top-4 left-1/2 -translate-x-1/2"><span className="bg-emerald-500 text-white text-xs font-black px-4 py-1 border-2 border-black dark:border-white uppercase tracking-widest">{isAr ? "الأكثر طلبًا" : "Best value"}</span></div>}
                <button type="button" onClick={() => setSelectedPlan(plan.id)} className="text-left pt-1">
                  <div className="flex items-center justify-between mb-4 gap-2">
                    <h2 className="text-xl font-black text-black dark:text-white">Pro · {planName}</h2>
                    <span className="text-[10px] font-black bg-emerald-500 text-white px-2 py-1 border-2 border-black dark:border-white">PRO</span>
                  </div>
                  <div className="flex items-end gap-1 mb-1"><span className="text-3xl font-black text-black dark:text-white">EGP {plan.amount_egp}</span><span className="text-xs font-bold text-zinc-500 mb-1">/{plan.days} {isAr ? "يوم" : "days"}</span></div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-zinc-500">
                    <span>{isAr ? `ما يعادله ${plan.monthlyEquivalent} ج.م شهريًا` : `EGP ${plan.monthlyEquivalent}/month equivalent`}</span>
                    {plan.savingsPct > 0 && <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400">{isAr ? `توفير ${plan.savingsPct}%` : `${plan.savingsPct}% saved`}</span>}
                  </div>
                </button>
                <ul className="space-y-3 flex-1">
                  {proFeatures.map((f, i) => <li key={i} className="flex items-center gap-3 text-sm font-bold text-zinc-700 dark:text-zinc-200"><Check className="w-4 h-4 text-emerald-500 shrink-0" /><span className="flex items-center gap-1.5">{f.icon}{f.text}</span></li>)}
                </ul>
                <button onClick={() => { setSelectedPlan(plan.id); setStep("payment"); }} disabled={busy} className="w-full h-12 flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-emerald-500 text-white font-black uppercase tracking-widest shadow-[3px_3px_0px_rgba(0,0,0,1)] disabled:opacity-60 transition-all">
                  {busy && isSelected ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Smartphone className="h-4 w-4" />{isPro ? (isAr ? "جدّد اشتراكك" : "Renew subscription") : !user ? (isAr ? "سجّل الدخول للاشتراك" : "Sign in to subscribe") : (isAr ? "اشترك الآن" : "Subscribe Now")}</>}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mx-auto max-w-2xl border-2 border-zinc-300 bg-white p-4 text-center text-sm font-bold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 sm:p-5">
          {isAr ? "البطاقات، المحافظ والدفع النقدي — اختار الوسيلة المناسبة بعد تحديد الخطة." : "Cards, wallets and cash — choose your method after selecting a plan."}
        </div>
      </div>
    </div>
  );
}
