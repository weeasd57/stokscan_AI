"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Check, Rocket, Lock, Wifi } from "lucide-react";
import { toast } from "sonner";

type Config = {
  mode: "enabled" | "disabled";
  enabled: boolean;
  currency?: string;
  payment_methods?: string[];
  free?: any;
  pro?: any;
};

export default function PricingClient() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user, loading: authLoading } = useAuth();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/payment/config", { cache: "no-store" });
        const data = await res.json();
        setConfig(data);
      } catch {
        setConfig(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const startCheckout = async (planId: string) => {
    if (!user) {
      toast.error(isAr ? "سجّل الدخول أولاً لتتمكن من الاشتراك" : "Please sign in to subscribe");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/payment/kashier/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, plan_id: planId, email: user.email || "" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        toast.error(data?.detail || data?.message || "فشل إنشاء جلسة الدفع");
        return;
      }
      // Persist the order_ref for polling after redirect.
      sessionStorage.setItem("kashier_order_ref", data.order_ref || "");
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(e?.message || "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!config || !config.enabled) {
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

  const proPrice = config.pro?.price_egp ?? 300;
  const freeFeatures = isAr
    ? ["تأخير الإشارات الجديدة 5 أيام", "50 رسالة للشات بوت شهريًا", "حتى 5 أسهم في المحفظة"]
    : ["New signals delayed 5 days", "50 chatbot messages / month", "Up to 5 portfolio stocks"];
  const proFeatures = isAr
    ? ["إشارات يومية فورية", "350 رسالة للشات بوت شهريًا", "حتى 10 أسهم في المحفظة"]
    : ["Daily instant signals", "350 chatbot messages / month", "Up to 10 portfolio stocks"];

  return (
    <div className="min-h-[70vh] py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-10">
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-black text-black dark:text-white">
            {isAr ? "اختر خطتك" : "Choose your plan"}
          </h1>
          <p className="text-zinc-500 font-bold">
            {isAr ? "مزايا واضحة تناسب طريقة تداولك" : "Clear features that fit your trading style"}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Free */}
          <div className="neobrutal-card p-6 space-y-5 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-black dark:text-white">{isAr ? "مجاني" : "Free"}</h2>
              <span className="text-xs font-black bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">{isAr ? "التخطيط" : "Current"}</span>
            </div>
            <div className="text-4xl font-black text-black dark:text-white">EGP 0</div>
            <ul className="space-y-3">
              {freeFeatures.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm font-bold text-zinc-700 dark:text-zinc-300">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0" /> {f}
                </li>
              ))}
            </ul>
            <button disabled className="w-full h-12 border-4 border-black dark:border-white bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-black uppercase tracking-widest disabled:opacity-60">
              {isAr ? "خطتك الحالية" : "Current Plan"}
            </button>
          </div>

          {/* Pro */}
          <div className="neobrutal-card p-6 space-y-5 border-4 border-black dark:border-white bg-emerald-50 dark:bg-emerald-950/20 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-black dark:text-white">Pro</h2>
              <span className="text-xs font-black bg-emerald-500 text-white px-2 py-1 rounded">{isAr ? "الأكثر شيوعًا" : "Popular"}</span>
            </div>
            <div className="text-4xl font-black text-black dark:text-white">
              EGP {proPrice}
              <span className="text-sm font-bold text-zinc-500">/{isAr ? "شهر" : "month"}</span>
            </div>
            <ul className="space-y-3">
              {proFeatures.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm font-bold text-zinc-700 dark:text-zinc-300">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0" /> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => startCheckout("pro")}
              disabled={busy || authLoading}
              className="w-full h-12 flex items-center justify-center gap-2 border-4 border-black dark:border-white bg-emerald-500 text-white font-black uppercase tracking-widest shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {isAr ? "اشترك الآن" : "Subscribe Now"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-zinc-500 font-bold flex items-center justify-center gap-1.5">
          <Wifi className="w-4 h-4" />
          {isAr ? "الدفع عبر Kashier بشكل آمن" : "Pay securely via Kashier"}
        </p>

        <div className="text-center space-y-2">
          <p className="text-xs font-black text-zinc-600 dark:text-zinc-300 uppercase tracking-widest">
            {isAr ? "طرق الدفع المدعومة" : "Supported payment methods"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs font-black border-2 border-black dark:border-white px-3 py-1.5 rounded bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200">VISA</span>
            <span className="text-xs font-black border-2 border-black dark:border-white px-3 py-1.5 rounded bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200">Mastercard</span>
            <span className="text-xs font-black border-2 border-black dark:border-white px-3 py-1.5 rounded bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200">Meeza</span>
            <span className="text-xs font-black border-2 border-emerald-500 px-3 py-1.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              {isAr ? "فودافون كاش" : "Vodafone Cash"}
            </span>
            <span className="text-xs font-black border-2 border-emerald-500 px-3 py-1.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              {isAr ? "أورنج كاش" : "Orange Cash"}
            </span>
            <span className="text-xs font-black border-2 border-emerald-500 px-3 py-1.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              {isAr ? "اتصالات كاش" : "Etisalat Cash"}
            </span>
            <span className="text-xs font-black border-2 border-emerald-500 px-3 py-1.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              {isAr ? "محفظة ذكية" : "Smart Wallet"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
