"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";

export default function PricingClient() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);
  const [localOrder, setLocalOrder] = useState<string | null>(null);
  const [customerNote, setCustomerNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const local = await fetch("/api/payment/local/config", { cache: "no-store" }).then((r) => r.json());
        setLocalConfig(local);
      } catch {
        setLocalConfig(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const startLocalPayment = async () => {
    if (!user) { toast.error(isAr ? "سجّل الدخول أولاً" : "Please sign in first"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/payment/local/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "تعذر إنشاء طلب الدفع");
      setLocalOrder(data.order_id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const submitLocalPayment = async () => {
    if (!localOrder) return;
    setBusy(true);
    try {
      const res = await fetch("/api/payment/local/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: localOrder, note: customerNote })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "تعذر إرسال الطلب");
      setSubmitted(true);
      toast.success(isAr ? "تم إرسال الطلب للمراجعة" : "Payment sent for review");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
      </div>
    );
  }

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

  if (localConfig?.enabled) {
    return (
      <div className="min-h-[70vh] py-12 px-4">
        <div className="max-w-xl mx-auto neobrutal-card p-8 space-y-5 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
          <h1 className="text-3xl font-black text-black dark:text-white">{isAr ? "الاشتراك في Pro" : "Subscribe to Pro"}</h1>
          <p className="font-bold text-zinc-600 dark:text-zinc-300">{isAr ? `السعر: ${localConfig.amount_egp} جنيه شهريًا` : `Price: EGP ${localConfig.amount_egp} / month`}</p>
          <p className="font-bold">{isAr ? "حوّل المبلغ عبر Vodafone Cash إلى:" : "Transfer via Vodafone Cash to:"}</p>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{localConfig.wallet_number || "رقم المحفظة غير مضبوط"}</p>
          {localConfig.qr_url && (
            <img
              src={`https://quickchart.io/qr?size=280&text=${encodeURIComponent(localConfig.qr_url)}`}
              alt="Vodafone Cash QR"
              className="mx-auto max-w-64 border-2 border-black dark:border-white bg-white p-2"
            />
          )}

          {submitted ? (
            <div className="p-5 bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-500 rounded text-center space-y-2">
              <p className="font-black text-emerald-700 dark:text-emerald-400 text-lg">
                {isAr ? "⏳ الطلب قيد المراجعة" : "⏳ Order Under Review"}
              </p>
              <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                {isAr
                  ? "تم إرسال طلبك بنجاح وهو قيد المراجعة حاليًا من قبل الإدارة. سيتم تفعيل حسابك Pro فور التحقق من التحويل."
                  : "Your payment request was submitted and is being reviewed by the admin. Pro will be activated upon verification."}
              </p>
              {localOrder && <p className="text-xs font-mono font-bold text-zinc-500">Order ID: {localOrder}</p>}
            </div>
          ) : !localOrder ? (
            <button
              onClick={startLocalPayment}
              disabled={busy}
              className="w-full h-12 border-4 border-black dark:border-white bg-emerald-500 text-white font-black hover:bg-emerald-600 transition-colors disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (isAr ? "إنشاء طلب دفع" : "Create payment order")}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-black text-zinc-700 dark:text-zinc-300">
                  {isAr ? "رقم الهاتف المحول منه أو ملاحظة (اختياري):" : "Sender phone number or note (optional):"}
                </label>
                <input
                  type="text"
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                  placeholder={isAr ? "مثال: 01012345678" : "e.g. 01012345678"}
                  className="w-full p-2.5 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-800 text-sm font-bold"
                />
              </div>
              <button
                onClick={submitLocalPayment}
                disabled={busy}
                className="w-full h-12 border-4 border-black dark:border-white bg-emerald-500 text-white font-black hover:bg-emerald-600 transition-colors disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (isAr ? "لقد قمت بالتحويل" : "I have transferred")}
              </button>
              <p className="text-xs font-bold text-zinc-500 text-center break-all">Order: {localOrder}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
