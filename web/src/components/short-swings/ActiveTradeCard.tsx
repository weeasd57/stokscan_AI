"use client";

import { ArrowUpRight, Clock, Lock, ShieldCheck, AlertTriangle } from "lucide-react";
import type { ShortSwingTrade } from "../ShortSwingsTab";
import StockLogo from "../StockLogo";
import { formatShortSwingReturn, shortSwingQuote } from "@/lib/short-swings-view";
import { isShariaCompliant } from "@/lib/shariaStocks";

export default function ActiveTradeCard({ trade, session, previousSession, isAr, onDetails }: {
  trade: ShortSwingTrade; session?: string; previousSession: boolean; isAr: boolean;
  onDetails: (trade: ShortSwingTrade) => void;
}) {
  const quote = shortSwingQuote(trade, session);
  const pending = trade.is_pending_entry;
  const price = (value?: number | null) => value != null && Number.isFinite(value) ? `${value.toFixed(2)} ${isAr ? "ج.م" : "EGP"}` : "—";
  const tone = quote.returnPct == null || previousSession ? "text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800" : quote.returnPct >= 0
    ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40" : "text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40";
  const status = trade.is_locked ? (isAr ? "متاح لـ PRO" : "PRO access") : pending ? (isAr ? "تنتظر الافتتاح" : "Awaiting open")
    : quote.issue ? (isAr ? "سعر غير متاح للتقييم" : "Quote unavailable") : previousSession ? (isAr ? "متابعة جلسة سابقة" : "Previous session")
    : (isAr ? "قيد المتابعة" : "Monitoring");

  return (
    <article aria-label={trade.is_locked ? (isAr ? "صفقة مشفرة" : "Locked trade") : `${isAr ? "صفقة" : "Trade"} ${trade.symbol}`}
      className="min-w-0 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 sm:p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0">{trade.is_locked ? <div className="rounded-xl bg-amber-100 dark:bg-amber-950/50 p-3"><Lock className="w-5 h-5 text-amber-600" /></div> : <StockLogo symbol={trade.symbol} size="md" />}</div>
          <div className="min-w-0">
            <h4 className="font-mono text-lg font-black text-zinc-950 dark:text-white" dir="ltr">{trade.is_locked ? "••••" : trade.symbol}</h4>
            <p className="text-xs text-zinc-500 truncate max-w-[200px]">{trade.is_locked ? (isAr ? "تفاصيل السهم للمشتركين" : "Subscriber details") : trade.name_ar || trade.name_en || trade.sector || "EGX"}</p>
          </div>
        </div>
        {!trade.is_locked && isShariaCompliant(trade.symbol) && <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{isAr ? "حلال" : "Sharia"}</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500"><Clock className="w-3.5 h-3.5 shrink-0" />{status}</span>
        <span dir={pending || trade.is_locked ? undefined : "ltr"} className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ${tone}`}>
          {trade.is_locked ? "PRO" : pending ? (isAr ? "لم يبدأ العائد" : "Not entered") : formatShortSwingReturn(quote.returnPct)}
        </span>
      </div>
      {trade.is_locked ? <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-4 text-sm text-zinc-500 leading-relaxed flex-1">{isAr ? "رمز السهم وأسعار الدخول والوقف متاحة للمشتركين. يمكنك مراجعة الصفقات التاريخية من الأرشيف." : "Ticker, entry and stop prices require PRO. Historical trades remain in the archive."}</div> : <>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/70 p-3 sm:p-4">
          {[
            [pending ? (isAr ? "الإغلاق المرجعي" : "Reference close") : (isAr ? "سعر الدخول" : "Entry price"), price(pending ? trade.reference_close ?? trade.entry_price : trade.entry_price)],
            [isAr ? "آخر سعر محفوظ" : "Last saved price", pending ? (isAr ? "في انتظار الافتتاح" : "Awaiting open") : price(quote.price)],
            [isAr ? "الوقف المحفوظ" : "Saved stop", price(trade.trailing_stop)],
            [pending ? (isAr ? "جلسة الدخول المقترحة" : "Proposed entry session") : (isAr ? "تاريخ الدخول" : "Entry date"), trade.entry_date || "—"],
          ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[11px] text-zinc-500 mb-1">{label}</dt><dd className="text-sm font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums break-words"><bdi>{value}</bdi></dd></div>)}
        </dl>
        {quote.issue && !pending ? <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-300 leading-relaxed"><AlertTriangle className="w-4 h-4 shrink-0" />{quote.issue === "unverified" ? (isAr ? "السعر المحفوظ متعارض مع بيانات الصفقة؛ العائد غير مؤكد." : "Saved quote conflicts with trade data; return is unverified.") : (isAr ? "لا يوجد سعر محفوظ صالح لحساب العائد." : "No valid saved quote to calculate the return.")}</p>
          : trade.is_breakeven_protected && !pending ? <p className="flex gap-1.5 text-xs text-zinc-500"><ShieldCheck className="w-4 h-4 shrink-0" />{isAr ? "الوقف مرفوع حسب السجل؛ فجوات السعر قد تؤثر على التنفيذ." : "Stop raised in the record; gaps can affect execution."}</p> : null}
      </>}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-3">
        <span className="text-[11px] text-zinc-500">{isAr ? "جلسة البيانات" : "Data session"}: <bdi>{session || "—"}</bdi></span>
        <button onClick={() => onDetails(trade)} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-neutral-950 dark:bg-amber-300 px-3 py-2 text-xs font-bold text-white dark:text-zinc-950 hover:bg-neutral-800 dark:hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500">
          {isAr ? "التفاصيل" : "Details"}<ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </article>
  );
}
