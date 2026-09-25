"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface BillingSettings {
    pro_price_egp: number | null;
    pro_6m_price_egp: number | null;
    pro_1y_price_egp: number | null;
    discount_enabled: boolean;
    discount_price_egp: number | null;
    discount_ends_at: string | null;
    discount_label_ar: string | null;
    discount_label_en: string | null;
    updated_at: string | null;
}

interface LivePlan {
    id: string;
    amount_egp: number;
    days: number;
    discount?: { active: boolean; ends_at: string; original_amount_egp: number };
}

interface PlanLimits {
    free?: { signal_delay_days: number; chat_messages_per_month: number; portfolio_stocks: number };
    pro?: { chat_messages_per_month: number; portfolio_stocks: number };
}

function toLocalInput(iso: string | null): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
}

export default function BillingTab() {
    const [livePlans, setLivePlans] = useState<LivePlan[]>([]);
    const [planLimits, setPlanLimits] = useState<PlanLimits>({});
    const [syncing, setSyncing] = useState(false);
    const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [proPrice, setProPrice] = useState("");
    const [pro6mPrice, setPro6mPrice] = useState("");
    const [pro1yPrice, setPro1yPrice] = useState("");
    const [discountEnabled, setDiscountEnabled] = useState(false);
    const [discountPrice, setDiscountPrice] = useState("");
    const [discountEndsAt, setDiscountEndsAt] = useState("");
    const [labelAr, setLabelAr] = useState("عرض محدود");
    const [labelEn, setLabelEn] = useState("Limited offer");
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [settingsRes, configRes] = await Promise.all([
                fetch("/api/admin/billing/settings", { cache: "no-store" }),
                fetch("/api/payment/easykash/config", { cache: "no-store" }),
            ]);
            if (!settingsRes.ok) throw new Error((await settingsRes.json().catch(() => ({}))).error || "فشل تحميل الإعدادات");
            const data: BillingSettings = await settingsRes.json();
            setProPrice(data.pro_price_egp != null ? String(data.pro_price_egp) : "");
            setPro6mPrice(data.pro_6m_price_egp != null ? String(data.pro_6m_price_egp) : "");
            setPro1yPrice(data.pro_1y_price_egp != null ? String(data.pro_1y_price_egp) : "");
            setDiscountEnabled(Boolean(data.discount_enabled));
            setDiscountPrice(data.discount_price_egp != null ? String(data.discount_price_egp) : "");
            setDiscountEndsAt(toLocalInput(data.discount_ends_at ?? null));
            setLabelAr(data.discount_label_ar || "عرض محدود");
            setLabelEn(data.discount_label_en || "Limited offer");
            if (configRes.ok) {
                const config = await configRes.json();
                setLivePlans(Array.isArray(config?.plans) ? config.plans : []);
                setPlanLimits(config?.limits || {});
            }
        } catch (err: any) {
            setError(err.message || "خطأ غير معروف");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        return () => {
            if (syncTimer.current) clearTimeout(syncTimer.current);
        };
    }, [load]);

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const body: Record<string, unknown> = {
                pro_price_egp: proPrice === "" ? null : Number(proPrice),
                pro_6m_price_egp: pro6mPrice === "" ? null : Number(pro6mPrice),
                pro_1y_price_egp: pro1yPrice === "" ? null : Number(pro1yPrice),
                discount_enabled: discountEnabled,
                discount_price_egp: discountEnabled ? Number(discountPrice) : null,
                discount_ends_at: discountEnabled ? new Date(discountEndsAt).toISOString() : null,
                discount_label_ar: labelAr,
                discount_label_en: labelEn,
            };
            const res = await fetch("/api/admin/billing/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "فشل الحفظ");
            toast.success("تم حفظ الإعدادات؛ تحديث الأسعار الفعلية خلال 15 ثانية");
            setProPrice(data.pro_price_egp != null ? String(data.pro_price_egp) : "");
            setPro6mPrice(data.pro_6m_price_egp != null ? String(data.pro_6m_price_egp) : "");
            setPro1yPrice(data.pro_1y_price_egp != null ? String(data.pro_1y_price_egp) : "");
            setDiscountEndsAt(toLocalInput(data.discount_ends_at ?? null));
            setSyncing(true);
            if (syncTimer.current) clearTimeout(syncTimer.current);
            syncTimer.current = setTimeout(async () => {
                try {
                    const configRes = await fetch("/api/payment/easykash/config", { cache: "no-store" });
                    if (configRes.ok) {
                        const config = await configRes.json();
                        setLivePlans(Array.isArray(config?.plans) ? config.plans : []);
                        setPlanLimits(config?.limits || {});
                    }
                } catch {
                    setError("تم الحفظ، لكن تعذر تحديث المعاينة. أعد تحميلها بعد قليل.");
                } finally {
                    setSyncing(false);
                }
            }, 16_000);
        } catch (err: any) {
            setError(err.message || "خطأ غير معروف");
        } finally {
            setSaving(false);
        }
    };

    const inputClass = "w-full border-2 border-black dark:border-white bg-white dark:bg-zinc-900 px-3 py-2.5 text-sm font-black text-zinc-950 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500";
    const labelClass = "block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1";

    const discountInvalid = discountEnabled && (!discountPrice || Number(discountPrice) <= 0 || !discountEndsAt);
    const liveMonthly = livePlans.find((plan) => plan.id === "pro");

    return (
        <div className="min-h-[70vh] py-10 px-4" dir="rtl">
            <div className="max-w-4xl mx-auto space-y-8">
                <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_#10b981]">
                    <h2 className="text-2xl font-black text-zinc-950 dark:text-white">إدارة الخطط والعروض</h2>
                    <p className="text-xs font-bold text-zinc-500 mt-1">
                        التغييرات تُحفظ في قاعدة البيانات ويستهلكها الباك-إند والفرونت-إند تلقائياً خلال ثوانٍ. اترك أي حقل فارغ لاستخدام السعر الافتراضي من البيئة.
                    </p>
                </div>

                {loading ? (
                    <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-8 text-center text-sm font-black animate-pulse">جارٍ التحميل...</div>
                ) : (
                    <div className="space-y-6">
                        {/* Plan prices */}
                        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 space-y-4 shadow-[6px_6px_0px_rgba(0,0,0,1)]">
                            <h3 className="text-sm font-black uppercase tracking-widest text-emerald-600">أسعار الباقات (ج.م)</h3>
                            <div className="grid sm:grid-cols-3 gap-4">
                                <label>
                                    <span className={labelClass}>شهر واحد</span>
                                    <input type="number" min="0" value={proPrice} onChange={(e) => setProPrice(e.target.value)} placeholder="200" className={inputClass} dir="ltr" />
                                </label>
                                <label>
                                    <span className={labelClass}>6 شهور</span>
                                    <input type="number" min="0" value={pro6mPrice} onChange={(e) => setPro6mPrice(e.target.value)} placeholder="1000" className={inputClass} dir="ltr" />
                                </label>
                                <label>
                                    <span className={labelClass}>سنة</span>
                                    <input type="number" min="0" value={pro1yPrice} onChange={(e) => setPro1yPrice(e.target.value)} placeholder="1800" className={inputClass} dir="ltr" />
                                </label>
                            </div>
                        </div>

                        {/* Discount */}
                        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 space-y-4 shadow-[6px_6px_0px_rgba(0,0,0,1)]">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-widest text-amber-600">خصم لفترة محدودة — الشهري</h3>
                                <button
                                    type="button"
                                    onClick={() => setDiscountEnabled(!discountEnabled)}
                                    className={`border-2 border-black px-4 py-1.5 text-xs font-black uppercase ${discountEnabled ? "bg-emerald-500 text-white" : "bg-zinc-100 text-zinc-600"}`}
                                >
                                    {discountEnabled ? "مُفعّل" : "متوقف"}
                                </button>
                            </div>
                            {discountEnabled && (
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <label>
                                        <span className={labelClass}>سعر العرض (ج.م)</span>
                                        <input type="number" min="1" value={discountPrice} onChange={(e) => setDiscountPrice(e.target.value)} placeholder="50" className={inputClass} dir="ltr" />
                                    </label>
                                    <label>
                                        <span className={labelClass}>ينتهي في</span>
                                        <input type="datetime-local" value={discountEndsAt} onChange={(e) => setDiscountEndsAt(e.target.value)} className={inputClass} dir="ltr" />
                                    </label>
                                    <label>
                                        <span className={labelClass}>شارة العرض (عربي)</span>
                                        <input type="text" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} className={inputClass} />
                                    </label>
                                    <label>
                                        <span className={labelClass}>شارة العرض (إنجليزي)</span>
                                        <input type="text" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} className={inputClass} dir="ltr" />
                                    </label>
                                </div>
                            )}
                        </div>

                        {error && <div className="border-4 border-red-500 bg-red-50 dark:bg-red-950 p-4 text-sm font-black text-red-700 dark:text-red-300">{error}</div>}

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={save}
                                disabled={saving || discountInvalid}
                                className="border-4 border-black dark:border-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-black px-8 py-3 uppercase tracking-wider shadow-[4px_4px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none text-sm"
                            >
                                {saving ? "جارٍ الحفظ..." : "حفظ التغييرات"}
                            </button>
                            {discountInvalid && <span className="text-xs font-black text-red-600">الخصم محتاج سعر صحيح وتاريخ انتهاء</span>}
                        </div>

                        {/* Live preview */}
                        <div className="border-4 border-black dark:border-white bg-zinc-950 text-white p-6 space-y-3 shadow-[6px_6px_0px_#10b981]">
                            <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400">ما يراه العميل الآن (من الباك-إند)</h3>
                            {syncing && <p className="text-xs font-bold text-amber-300">جاري تحديث المعاينة بعد انتهاء ذاكرة التخزين المؤقت (15 ثانية)...</p>}
                            {livePlans.length === 0 ? (
                                <p className="text-xs font-bold text-zinc-400">لو الدفع متوقف حالياً فلن تظهر خطط. تأكد من PAYMENTS_ENABLED وإعدادات EasyKash.</p>
                            ) : (
                                <ul className="space-y-2 text-xs font-bold">
                                    {livePlans.map((plan) => (
                                        <li key={plan.id} className="flex justify-between items-center border-b border-zinc-800 pb-2">
                                            <span className="font-mono">{plan.id} ({plan.days} يوم)</span>
                                            <span className="flex items-center gap-2">
                                                {plan.discount?.active && (
                                                    <span className="text-zinc-500 line-through">{plan.discount.original_amount_egp} ج.م</span>
                                                )}
                                                <span className="text-emerald-400 font-black">{plan.amount_egp} ج.م</span>
                                                {plan.discount?.active && <span className="text-[10px] bg-amber-300 text-black px-1.5 py-0.5 font-black">عرض محدود</span>}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {liveMonthly?.discount?.active && (
                                <p className="text-[10px] font-bold text-zinc-500">
                                    العرض ينتهي: <span className="font-mono text-zinc-300" dir="ltr">{new Date(liveMonthly.discount.ends_at).toLocaleString("ar-EG")}</span> — بعدها يرجع السعر الأساسي تلقائياً.
                                </p>
                            )}
                        </div>
                        <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                            حدود المزايا المعروضة من إعدادات الخدمة: مجاني {planLimits.free?.signal_delay_days ?? 15} يوم تأخير، {planLimits.free?.chat_messages_per_month ?? 50} رسالة و{planLimits.free?.portfolio_stocks ?? 5} أسهم؛ Pro {planLimits.pro?.chat_messages_per_month ?? 350} رسالة و{planLimits.pro?.portfolio_stocks ?? 10} أسهم.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
