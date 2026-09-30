"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { fetchPortfolioPerformance } from "@/lib/api";
import type { PortfolioPerformance } from "@/lib/portfolio-performance";
import type { PortfolioSnapshot } from "@/contexts/PortfolioContext";

const Chart = dynamic(() => import("./PortfolioPerformanceChart"), { ssr: false });
const money = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const pct = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const tile = "border-2 border-black dark:border-white bg-white dark:bg-zinc-900 p-4 shadow-[3px_3px_0px_#000] dark:shadow-[3px_3px_0px_#fff]";

export default function PortfolioPerformanceDashboard({ userId, snapshot, isAr }: {
  userId: string | null; snapshot: PortfolioSnapshot | null; isAr: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [period, setPeriod] = useState(90);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<{ key: string; report: PortfolioPerformance } | null>(null);
  const fingerprint = JSON.stringify((snapshot?.positions || []).map(row => [row.id, row.symbol, row.quantity, row.entry_price]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const key = `${userId}:${fingerprint}:${revision}`;
  const report = result?.key === key && userId ? result.report : null;

  useEffect(() => {
    if (!expanded || !userId || !snapshot || result?.key === key) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetchPortfolioPerformance(controller.signal).then(report => {
      if (!controller.signal.aborted) setResult({ key, report });
    }).catch(() => {
      if (!controller.signal.aborted) { setResult(null); setError(true); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Snapshot price refreshes do not trigger a second daily-history read; holdings edits do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, userId, key, Boolean(snapshot)]);

  const comparison = report?.comparisons.find(item => item.days === period);
  const ranking = useMemo(() => report ? [...report.holdings].sort((a, b) => (b.profitPct ?? -Infinity) - (a.profitPct ?? -Infinity)) : [], [report]);
  const knownValue = report?.holdings.reduce((sum, row) => sum + (row.value || 0), 0) || 0;
  const completeValues = Boolean(report?.holdings.every(row => row.value !== null));

  if (!userId) return null;
  return <div className="space-y-4" dir={isAr ? "rtl" : "ltr"}>
    <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="portfolio-performance-details"
      className="flex w-full items-center justify-between gap-3 border-4 border-black bg-[#FFDC58] p-4 text-black shadow-[3px_3px_0px_#000] dark:border-white dark:shadow-[3px_3px_0px_#fff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">
      <span className="flex items-center gap-2 text-sm font-black"><Activity className="h-5 w-5" />{isAr ? "لوحة أداء المحفظة" : "Portfolio performance"}</span>
      {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
    </button>
    {expanded && <div id="portfolio-performance-details" className="space-y-5 border-2 border-black bg-zinc-50 p-4 text-black dark:border-white dark:bg-zinc-950/35 dark:text-white sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400">{isAr ? "إغلاق يومي من كاش السوق · بدون تشغيل AI جديد" : "Daily closes from the market cache · no new AI run"}</p>
        <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-xs font-black text-black disabled:opacity-50 dark:border-white dark:bg-zinc-900 dark:text-white">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />{isAr ? "تحديث" : "Refresh"}
        </button>
      </div>
      {loading && !report && <p role="status" className="flex items-center gap-2 py-6 text-sm font-bold"><Loader2 className="h-4 w-4 animate-spin" />{isAr ? "تحميل سجل المحفظة والمقارنة…" : "Loading portfolio history and comparison…"}</p>}
      {error && <p role="alert" className="border-s-4 border-rose-500 bg-rose-500/10 p-4 text-sm">{isAr ? "تعذر تحميل الأداء. اضغط تحديث للمحاولة مرة أخرى." : "Performance could not be loaded. Press Refresh to retry."}</p>}
      {report && <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={tile}><h4 className="text-xs font-black text-zinc-500 dark:text-zinc-400">{isAr ? "ربح / خسارة غير محققة — إغلاق يومي" : "Unrealized P/L — daily closes"}</h4><p className="mt-2 font-mono text-xl font-black" dir="ltr">{money(report.unrealized)} <span className="text-xs">{isAr ? "ج.م" : "EGP"}</span></p></div>
          <div className={tile}><h4 className="text-xs font-black text-zinc-500 dark:text-zinc-400">{report.unknownSales || report.historyTruncated ? (isAr ? "ربح البيع المعروف فقط — سجل غير مكتمل" : "Known realized P/L — incomplete history") : (isAr ? "ربح / خسارة البيع المسجل" : "Recorded realized P/L")}</h4><p className="mt-2 font-mono text-xl font-black" dir="ltr">{money(report.realized)} <span className="text-xs">{isAr ? "ج.م" : "EGP"}</span></p><p className="mt-1 text-[11px] text-zinc-500">{report.knownSales} {isAr ? "عملية بسعر تكلفة محفوظ" : "sales with recorded cost basis"}</p></div>
        </div>
        {(report.unknownSales > 0 || report.historyTruncated) && <p className="border-s-4 border-amber-500 bg-amber-500/10 p-3 text-xs leading-relaxed">{isAr ? `${report.unknownSales} عملية بيع قديمة لا تحتوي تكلفة وقت البيع؛ لم نعتبر حصيلتها أرباحاً. ${report.historyTruncated ? "السجل المعروض محدود بأحدث 10,000 عملية." : ""}` : `${report.unknownSales} older sales lack sale-time cost basis; proceeds were not treated as profit. ${report.historyTruncated ? "History is limited to the latest 10,000 sales." : ""}`}</p>}
        {report.unrealized === null && <p className="text-xs text-amber-700 dark:text-amber-300">{isAr ? "بعض المراكز ناقصة السعر أو التكلفة؛ لذلك لا نعرض إجمالي ربح غير مكتمل." : "Some positions lack price or cost; an incomplete unrealized total is not shown."}</p>}

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-black">{isAr ? "محاكاة الحيازات الحالية مقابل EGX30" : "Current holdings simulation vs EGX30"}</h4>
            <div className="flex gap-2">{[30, 90, 365].map(days => <button type="button" key={days} aria-pressed={period === days} onClick={() => setPeriod(days)} className={`border-2 border-black px-3 py-2 text-xs font-black dark:border-white ${period === days ? "bg-[#FFDC58] text-black" : "bg-white dark:bg-zinc-900"}`}>{isAr ? days === 30 ? "شهر" : days === 90 ? "٣ شهور" : "سنة" : days === 30 ? "1M" : days === 90 ? "3M" : "1Y"}</button>)}</div>
          </div>
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{isAr ? "ماذا لو احتفظت بنفس كميات الأسهم الموجودة الآن طوال الفترة؟ يبدأ الخطان من 100 في نفس الجلسة. هذه ليست عوائد حسابك الفعلية؛ تستبعد السيولة والإيداعات والبيع والشراء والرسوم والتوزيعات النقدية المنفصلة." : "What if you held today's share quantities throughout the period? Both lines start at 100 on the same session. These are not actual account returns; cash, deposits, trades, fees and separate cash distributions are excluded."}</p>
          {comparison && comparison.points.length >= 2 ? <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
              [isAr ? "عائد المحاكاة" : "Simulated return", pct(comparison.returnPct)],
              [isAr ? "عائد EGX30" : "EGX30 return", pct(comparison.benchmarkPct)],
              [isAr ? "الفرق — نقطة مئوية" : "Difference — percentage points", comparison.excessPct === null ? "—" : money(comparison.excessPct)],
              [isAr ? "أقصى هبوط للمحاكاة" : "Simulation max drawdown", pct(comparison.maxDrawdownPct)],
            ].map(([label, value]) => <div className={tile} key={label}><h5 className="text-[10px] font-black text-zinc-500 dark:text-zinc-400">{label}</h5><p className="mt-2 font-mono text-lg font-black" dir="ltr">{value}</p></div>)}</div>
            <div className="border-2 border-black bg-white p-2 dark:border-white dark:bg-zinc-900"><Chart points={comparison.points} isAr={isAr} /></div>
            <p className="text-[11px] text-zinc-500" dir="ltr">{comparison.from} → {comparison.to} · {comparison.points.length} {isAr ? "جلسة مشتركة" : "common sessions"} · {comparison.includedSymbols.length}/{report.holdings.length} {isAr ? "سهم" : "holdings"}</p>
            {!comparison.adjusted && <p className="text-[11px] text-amber-700 dark:text-amber-300">{isAr ? "سلسلة سعرية معدّلة غير مكتملة؛ استُخدمت إغلاقات عادية لبعض الأسهم. التجزئة والمنح قد تؤثر على المقارنة." : "Adjusted prices are incomplete; raw closes were used for some holdings. Splits/bonus shares may affect the comparison."}</p>}
          </> : <p className="border-2 border-dashed border-zinc-400 p-5 text-sm">{isAr ? "لا توجد جلسات مشتركة كافية للمقارنة. أضف حيازات أو انتظر اكتمال بيانات السوق." : "Not enough common sessions to compare. Add holdings or wait for market data."}</p>}
          {comparison && comparison.excludedSymbols.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{isAr ? "أسهم مستبعدة لنقص التاريخ:" : "Excluded due to missing history:"} {comparison.excludedSymbols.join(", ")}</p>}
        </div>

        {ranking.length > 0 && <div className="overflow-x-auto border-2 border-black dark:border-white">
          <table className="w-full min-w-[420px] text-start text-xs"><caption className="bg-[#FFDC58] p-3 text-start font-black text-black">{isAr ? "توزيع الحيازات وترتيب الربح غير المحقق" : "Holdings allocation & unrealized P/L ranking"}</caption><thead className="bg-zinc-100 dark:bg-zinc-800"><tr>{[isAr ? "السهم" : "Symbol", isAr ? "القيمة — ج.م" : "Value — EGP", isAr ? "الوزن بالأسهم فقط" : "Weight (stocks only)", isAr ? "ربح / خسارة" : "P/L"].map(label => <th className="p-3 text-start" key={label}>{label}</th>)}</tr></thead><tbody>
            {ranking.map(row => <tr key={row.symbol} className="border-t border-zinc-200 dark:border-white/10"><td className="p-3 font-black"><a href={`/stocks/${row.symbol.toLowerCase()}`} className="hover:underline">{row.symbol}</a><span className="mt-1 block text-[10px] font-normal text-zinc-500">{row.priceDate || "—"}</span></td><td className="p-3 font-mono">{money(row.value)}</td><td className="p-3 font-mono">{completeValues && knownValue > 0 && row.value !== null ? pct(row.value / knownValue * 100) : "—"}</td><td className={`p-3 font-mono ${row.profit !== null && row.profit < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{money(row.profit)}<span className="block text-[10px]">{pct(row.profitPct)}</span></td></tr>)}
          </tbody></table>
        </div>}
        <p className="text-[11px] leading-relaxed text-zinc-500">{isAr ? "سجل البيع خاص بحسابك ولا يُخزّن في كاش عام. مقارنة السوق محسوبة من الأسعار اليومية المخزّنة؛ تغيير الفترة لا يرسل طلباً جديداً. الأرقام قبل الرسوم والضرائب، وليست توصية استثمارية." : "Your sale history is private and never publicly cached. Comparisons use cached daily market prices; changing periods sends no new request. Figures exclude fees and taxes, and are not investment advice."}</p>
      </>}
    </div>}
  </div>;
}
