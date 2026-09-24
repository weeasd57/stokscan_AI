"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Activity, ArrowUpRight } from "lucide-react";
import { fetchUnusualActivity, type UnusualActivitySnapshot } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isPro } from "@/lib/ai/plan-gate";

export default function UnusualActivity() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const ar = language === "ar";
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [snapshot, setSnapshot] = useState<UnusualActivitySnapshot | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pro, setPro] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!user) {
      setPro(false);
      return () => { mounted = false; };
    }
    void (async () => {
      try {
        const { data } = await supabase.from("subscriptions").select("plan_id,status,current_period_end").eq("user_id", user.id).limit(10);
        if (mounted) setPro(isPro(data || []));
      } catch {
        if (mounted) setPro(false);
      }
    })();
    return () => { mounted = false; };
  }, [supabase, user]);

  useEffect(() => {
    const controller = new AbortController();
    fetchUnusualActivity(controller.signal)
      .then(setSnapshot)
      .catch((cause) => { if (cause?.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, []);

  const visible = pro
    ? (expanded ? snapshot?.rows : snapshot?.rows.slice(0, 6))
    : snapshot?.rows.slice(0, 1);
  return (
    <section className="border-y-2 border-zinc-200 bg-zinc-50 px-3 py-4 text-zinc-950 dark:border-[#2a2e39] dark:bg-[#10151e] dark:text-white sm:px-6 sm:py-5" aria-label={ar ? "نشاط غير طبيعي" : "Unusual activity"} dir={ar ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 border border-black bg-white p-1 dark:border-white">
            <Image src="/favicon_io/apple-touch-icon.png" alt="" width={20} height={20} className="h-5 w-5 object-contain" />
          </span>
          <Activity className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <h2 className="text-sm font-black text-zinc-950 dark:text-white">{ar ? "نشاط غير طبيعي" : "Unusual Activity"}</h2>
          {snapshot && <span className="shrink-0 border border-amber-500/40 bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900 dark:bg-amber-400/10 dark:text-amber-300">{snapshot.totalMatches}</span>}
        </div>
        <span className="text-[10px] leading-5 text-zinc-600 dark:text-[#b4bac6] sm:text-right">
          {snapshot ? (ar ? `جلسة ${snapshot.asOf} · تغطية ${snapshot.coverage} سهم · حجم ≥ ${snapshot.threshold}× المتوسط` : `Session ${snapshot.asOf} · ${snapshot.coverage} stocks covered · volume ≥ ${snapshot.threshold}× average`) : null}
        </span>
      </div>
      {error ? <p className="mt-3 text-xs font-semibold text-amber-800 dark:text-amber-300">{ar ? "تعذر تحميل النشاط الآن." : "Activity is temporarily unavailable."}</p>
        : !snapshot ? <p className="mt-3 text-xs text-zinc-600 dark:text-[#b4bac6]">{ar ? "جاري تحميل آخر جلسة…" : "Loading latest session…"}</p>
        : !snapshot.rows.length ? <p className="mt-3 text-xs text-zinc-600 dark:text-[#b4bac6]">{ar ? "لا توجد أسهم حققت شرط حجم التداول في آخر جلسة محفوظة." : "No stocks met the volume threshold in the latest stored session."}</p>
        : <>
          {!pro && <p className="mt-3 border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
            {ar ? "الخطة المجانية تعرض آخر حالة فقط — السعر وRSI ظاهرين، وباقي التفاصيل متاحة في Pro." : "The free plan shows the latest match only — price and RSI are visible; full details are available in Pro."}
          </p>}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {visible?.map((row) => <div key={row.symbol} className={`group relative min-w-0 border-2 border-zinc-200 bg-white p-3 transition-colors dark:border-[#303744] dark:bg-[#171e29] ${pro ? "hover:border-amber-500 dark:hover:border-amber-400/70" : ""}`}>
              <div className="flex items-center justify-between gap-2"><b className="text-sm font-black text-zinc-950 dark:text-white">{row.symbol}</b><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-zinc-500 group-hover:text-amber-600 dark:text-[#b4bac6] dark:group-hover:text-amber-400" /></div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span className="text-zinc-600 dark:text-[#b4bac6]">{ar ? "السعر" : "Price"} <b className={row.changePct != null && row.changePct >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>{row.close?.toFixed(2) ?? "—"}</b></span>
                <span className="text-zinc-600 dark:text-[#b4bac6]">RSI <b className="text-zinc-950 dark:text-white">{row.rsi?.toFixed(0) ?? "—"}</b></span>
                <div className={!pro ? "select-none blur-[5px] opacity-60" : "contents"}>
                  <span className="text-zinc-600 dark:text-[#b4bac6]">{ar ? "الحجم" : "Volume"} <b className="text-amber-700 dark:text-amber-300">{row.relativeVolume.toFixed(1)}×</b></span>
                  <span className="text-zinc-600 dark:text-[#b4bac6]">{ar ? "تقييم AI" : "AI Score"} <b className="text-zinc-950 dark:text-white">{row.aiScore?.toFixed(0) ?? "—"}/100</b></span>
                </div>
              </div>
              <p className={`mt-2 break-words text-[10px] leading-5 text-zinc-600 dark:text-[#b4bac6] ${!pro ? "select-none blur-[5px] opacity-60" : ""}`}>{row.distanceToResistancePct == null ? (ar ? "مقاومة 20 جلسة: تاريخ غير كافٍ" : "20-session resistance: insufficient history") : row.distanceToResistancePct >= 0 ? (ar ? `أسفل أعلى سعر في 20 جلسة بـ${row.distanceToResistancePct.toFixed(1)}%` : `${row.distanceToResistancePct.toFixed(1)}% below prior 20-session high`) : (ar ? `أعلى من قمة 20 جلسة بـ${Math.abs(row.distanceToResistancePct).toFixed(1)}%` : `${Math.abs(row.distanceToResistancePct).toFixed(1)}% above prior 20-session high`)}</p>
              {pro && <Link aria-label={`${ar ? "فتح" : "Open"} ${row.symbol}`} href={`/chart?symbol=${encodeURIComponent(row.symbol)}&exchange=EGX`} className="absolute inset-0" />}
            </div>)}
          </div>
          {pro && snapshot.rows.length > 6 && <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-3 text-xs font-bold text-amber-800 hover:underline dark:text-amber-300">{expanded ? (ar ? "عرض أقل" : "Show fewer") : (ar ? "عرض كل الحالات" : "Show all matches")}</button>}
          <p className="mt-2 text-[10px] leading-5 text-zinc-600 dark:text-[#b4bac6]">{ar ? "بيانات نهاية آخر جلسة محفوظة، وليست أسعارًا لحظية أو إشارة شراء. المقاومة = أعلى سعر خلال 20 جلسة سابقة؛ لا تُعرض عند نقص التاريخ." : "Latest stored end-of-session data, not live quotes or a buy signal. Resistance is the prior 20-session high and is omitted without enough history."}</p>
        </>}
    </section>
  );
}
