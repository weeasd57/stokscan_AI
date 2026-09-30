"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "./HistoricalSimilarity.module.css";
import { track } from "@vercel/analytics";
import { ArrowUpRight, BarChart2, Clock, History, Info, Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Area, CartesianGrid, Line, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchHistoricalSimilarity, recordFeatureUse } from "@/lib/api";
import { quantile, type SimilarityReport, type SimilarityScan, type SimilarityMatch } from "@/lib/historical-similarity";

const panel = styles.panel;
const pct = (value: number | null | undefined, signed = true) => value == null ? "—" : `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const tone = (value: number | null | undefined) => value == null ? "text-black dark:text-white" : value >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400";

export default function HistoricalSimilarity() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const ar = language === "ar";
  const [report, setReport] = useState<SimilarityReport | null>(null);
  const [detail, setDetail] = useState<SimilarityScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [sort, setSort] = useState("sample");
  const [sufficient, setSufficient] = useState(false);
  const [sameContext, setSameContext] = useState(false);
  const [tab, setTab] = useState<"scenarios" | "cases" | "method">("scenarios");
  const [horizon, setHorizon] = useState("20");
  const [focused, setFocused] = useState("");
  const [generation, setGeneration] = useState(0);
  const lastRefresh = useRef(0);
  const text = (arabic: string, english: string) => ar ? arabic : english;
  const telemetry = useCallback((event: string, metadata: Record<string, string | number | boolean> = {}) => {
    if (user) recordFeatureUse(event, metadata);
    try { track(event, metadata); } catch { /* telemetry must never interrupt research */ }
  }, [user?.id]);

  useEffect(() => {
    telemetry("similarity_open");
    let started = document.hidden ? 0 : Date.now(), activeMs = 0;
    const visibility = () => {
      if (started) activeMs += Date.now() - started;
      started = document.hidden ? 0 : Date.now();
      if (document.hidden && activeMs >= 5000) { telemetry("similarity_engagement", { seconds: Math.round(activeMs / 1000) }); activeMs = 0; }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      if (started) activeMs += Date.now() - started;
      if (activeMs >= 5000) telemetry("similarity_engagement", { seconds: Math.round(activeMs / 1000) });
    };
  }, [telemetry]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void fetchHistoricalSimilarity(undefined, false, controller.signal).then(data => {
      setReport(data);
      setSelected(current => data.scans.some(scan => scan.symbol === current) ? current : data.scans[0]?.symbol || "");
      if (data.forward_days < 20) setHorizon(data.forward_days >= 10 ? "10" : "5");
      lastRefresh.current = Date.now();
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [generation]);

  useEffect(() => {
    const onReturn = () => { if (!document.hidden && Date.now() - lastRefresh.current > 5 * 60_000) setGeneration(value => value + 1); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, []);

  useEffect(() => {
    if (!selected || !report) return;
    const controller = new AbortController();
    setDetail(null); setDetailLoading(true); setDetailError(false); setFocused("");
    void fetchHistoricalSimilarity(selected, sameContext, controller.signal).then(data => {
      if (data.id !== report.id) { setGeneration(value => value + 1); return; }
      setDetail(data.scans[0] || null);
    }).catch(() => { if (!controller.signal.aborted) setDetailError(true); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selected, report, sameContext]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (report?.scans || []).filter(scan => (!q || `${scan.symbol} ${scan.name}`.toLowerCase().includes(q)) && (!sector || scan.sector === sector) && (!sufficient || scan.stats.total_matches >= 5))
      .sort((a, b) => sort === "sample" ? b.stats.total_matches - a.stats.total_matches
        : sort === "similarity" ? (b.stats.average_similarity ?? -Infinity) - (a.stats.average_similarity ?? -Infinity)
        : (b.stats.horizon_stats[horizon]?.median_return ?? -Infinity) - (a.stats.horizon_stats[horizon]?.median_return ?? -Infinity));
  }, [report, query, sector, sufficient, sort, horizon]);
  const sectors = [...new Set(report?.scans.map(scan => scan.sector) || [])].sort();
  const summary = report?.scans.find(scan => scan.symbol === selected);
  const scan = detail || summary;
  const matches = detail?.matches || [];
  const chosen = matches.find(match => `${match.symbol}:${match.date}` === focused) || matches[0];
  const stats = scan?.stats;
  const selectedHorizon = stats?.horizon_stats[horizon];
  const newest = report?.as_of;
  const oldReport = Boolean(newest && Date.now() - Date.parse(newest) > 5 * 86400000);
  const dateLabel = (date: string | null | undefined) => date ? new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { dateStyle: "medium", timeZone: "Africa/Cairo" }).format(new Date(date)) : "—";
  const regime = (value?: string | null) => ({ up: text("صاعد", "Rising"), down: text("هابط", "Falling"), range: text("عرضي", "Sideways"), mixed: text("اتجاهات مختلطة", "Mixed trends"), inflow: text("دخول سيولة", "Inflow"), outflow: text("خروج سيولة", "Outflow"), balanced: text("سيولة متوازنة", "Balanced flow") }[value || ""] || text("غير متاح", "Unavailable"));
  const outcome = (match: SimilarityMatch) => {
    const reason = match.exit_reason || (match.final_return == null ? "incomplete" : Math.abs(match.final_return - (report?.target_return || .05)) < 1e-8 ? "target" : Math.abs(match.final_return - (report?.stop_loss || -.03)) < 1e-8 ? "stop" : match.final_return > 0 ? "horizon_positive" : match.final_return < 0 ? "horizon_negative" : "horizon_flat");
    return { target: text("بلغ الهدف", "Target reached"), stop: text("بلغ الوقف", "Stop reached"), horizon_positive: text("انتهت بربح", "Ended positive"), horizon_negative: text("انتهت بخسارة", "Ended negative"), horizon_flat: text("انتهت متعادلة", "Ended flat"), incomplete: text("غير مكتملة", "Incomplete") }[reason] || reason;
  };
  const paths = useMemo(() => Array.from({ length: report?.forward_days || 20 }, (_, index) => {
    const session = index + 1;
    const values = matches.map(match => match.forward_path.find(point => point.day === session)?.return).filter((value): value is number => value != null && Number.isFinite(value));
    const lower = quantile(values, .25), upper = quantile(values, .75), median = quantile(values, .5);
    return { session, count: values.length, median: median == null ? null : median * 100, band: lower == null || upper == null ? null : [lower * 100, upper * 100], historical: (chosen?.forward_path.find(point => point.day === session)?.return ?? NaN) * 100 };
  }), [matches, chosen, report?.forward_days]);
  const before = useMemo(() => Array.from({ length: 10 }, (_, index) => ({ session: index - 9,
    current: (detail?.target_path?.at(index - 10)?.rel_change ?? NaN) * 100,
    historical: (chosen?.before_path?.at(index - 10)?.rel_change ?? NaN) * 100,
  })), [detail, chosen]);

  const selectScan = (symbol: string) => { setSelected(symbol); setSameContext(false); telemetry("similarity_stock_selected", { symbol }); };
  const header = <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-2 text-sm text-black dark:text-white"><Clock className="h-4 w-4" /><span>{text("آخر تقرير", "Latest report")}: {dateLabel(report?.updated_at)}</span></div>
    <button onClick={() => { setGeneration(value => value + 1); telemetry("similarity_refresh"); }} disabled={loading} className={`${styles.control} inline-flex items-center gap-2 px-4 py-2 text-xs font-bold hover:border-amber-400 disabled:opacity-50`}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{text("تحديث التقرير", "Refresh report")}</button>
  </div>;

  if (!report && loading) return <div className={`${panel} flex min-h-64 items-center justify-center gap-3`}><Loader2 className="h-6 w-6 animate-spin text-amber-500" />{text("جاري تجهيز الحالات التاريخية…", "Preparing historical cases…")}</div>;
  if (!report || error) return <div className={`${panel} p-8 space-y-4`} dir={ar ? "rtl" : "ltr"}>{header}<h2 className="text-lg font-bold">{text("تعذر تحميل التقرير", "Report unavailable")}</h2><p className="text-sm text-black dark:text-white">{text("حاول تحديث التقرير. لن نعرض خطأ التحميل كأنه غياب للبيانات.", "Retry loading the report to see the latest data.")}</p></div>;

  return <section className={`${styles.root} space-y-5 text-black dark:text-white`} dir={ar ? "rtl" : "ltr"} aria-label={text("تحليل التشابه التاريخي", "Historical similarity analysis")}>
    {header}
    {oldReport && <div className="border border-amber-400/50 bg-amber-400/10 p-3 text-sm text-amber-700 dark:text-amber-300">{text("التقرير أقدم من 5 أيام؛ راجع تاريخ الحالة قبل استخدام النتائج.", "This report is over 5 days old. Check each case date before using the results.")}</div>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[
        [text("أسهم في التقرير", "Stocks in report"), String(report.scans.length), text("المؤشرات معروضة في اتجاه السوق", "Indices are shown in Market Direction")],
        [text("بعينة 5 حالات فأكثر", "At least 5 cases"), String(report.scans.filter(row => row.stats.total_matches >= 5).length), text("حالات مقبولة ومكتملة", "Accepted, completed cases")],
        [text("حد التشابه الفني", "Technical similarity cutoff"), pct(report.minimum_similarity, false), text("درجة تشابه وليست احتمال ربح", "A similarity score, not a win probability")],
        [text("نقطة المقارنة", "Comparison date"), dateLabel(report.as_of), text("النتائج التاريخية بعد هذه الحالة", "Historical outcomes after a similar state")],
      ].map(([label, value, note]) => <div key={label} className={`${panel} p-4`}><p className="text-xs text-black dark:text-white">{label}</p><p className="my-2 text-lg sm:text-2xl font-bold" dir="auto">{value}</p><p className="text-sm text-black dark:text-white leading-6">{note}</p></div>)}
    </div>
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
      <aside className={`${panel} self-start p-4 space-y-3 lg:sticky lg:top-24`}>
        <h2 className="font-bold flex items-center gap-2"><Search className="h-4 w-4 text-amber-500" />{text("اختار السهم", "Choose a stock")}</h2>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={text("ابحث بالرمز أو اسم الشركة", "Search symbol or company")} aria-label={text("بحث الأسهم", "Search stocks")} className="w-full bg-transparent px-3 py-2.5 text-sm outline-none focus:border-amber-400 placeholder:text-zinc-700 dark:placeholder:text-slate-200" />
        <div className="grid grid-cols-2 gap-2 text-xs">
          <select value={sector} onChange={event => setSector(event.target.value)} aria-label={text("القطاع", "Sector")} className="bg-white dark:bg-slate-900 p-2 min-w-0"><option value="">{text("كل القطاعات", "All sectors")}</option>{sectors.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <select value={sort} onChange={event => setSort(event.target.value)} aria-label={text("ترتيب الحالات", "Sort stocks")} className="bg-white dark:bg-slate-900 p-2 min-w-0"><option value="median">{text("وسيط العائد", "Median return")}</option><option value="similarity">{text("قوة التشابه", "Similarity")}</option><option value="sample">{text("حجم العينة", "Sample size")}</option></select>
        </div>
        <label className="flex items-center gap-2 text-xs text-black dark:text-white"><input type="checkbox" checked={sufficient} onChange={event => setSufficient(event.target.checked)} className="accent-amber-500" />{text("5 حالات مكتملة فأكثر", "5+ completed cases")}</label>
        <p className="text-xs text-black dark:text-white">{candidates.length} {text("نتيجة • ترتيب حسب الفترة المختارة", "results • sorted for selected horizon")}</p>
        <div className="max-h-72 lg:max-h-[560px] overflow-y-auto space-y-2">
          {candidates.map(row => <button type="button" key={row.symbol} onClick={() => selectScan(row.symbol)} aria-pressed={selected === row.symbol} className={`${styles.stock} w-full text-start border p-3 transition ${selected === row.symbol ? "border-amber-400 bg-amber-400/10" : "border-zinc-100 dark:border-slate-800 hover:border-slate-400"}`}>
            <div className="flex justify-between items-center gap-2"><b className="font-mono text-sm">{row.symbol.split(".")[0]}</b><b className={`font-mono text-sm ${tone(row.stats.horizon_stats[horizon]?.median_return)}`} dir="ltr">{pct(row.stats.horizon_stats[horizon]?.median_return)}</b></div>
            <p className="mt-1 text-sm truncate text-black dark:text-white">{row.name}</p>
            <div className="mt-2 flex justify-between gap-2 text-xs text-black dark:text-white"><span>{row.stats.total_matches} {text("حالة مكتملة", "complete cases")}</span><span>{text("وسيط", "Median")} {horizon} {text("جلسة", "sessions")}</span></div>
          </button>)}
          {!candidates.length && <p className="py-6 text-center text-sm text-black dark:text-white">{text("لا توجد أسهم توافق البحث والفلاتر.", "No stocks match your filters.")}</p>}
        </div>
        <p className="text-xs leading-5 text-black dark:text-white">{text(`استبعدنا ${report.excluded.indices} مؤشرًا و${report.excluded.stale} حالة قديمة من قائمة الأسهم.`, `Excluded ${report.excluded.indices} indices and ${report.excluded.stale} stale setups from this stock list.`)}</p>
      </aside>
      <div className="min-w-0 space-y-4">
        {!scan ? <div className={`${panel} p-8 text-sm`}>{text("لا يوجد تقرير منشور بعد.", "No report has been published yet.")}</div> : <>
          <div className={`${panel} p-5 space-y-4`}>
            <div className="flex flex-wrap justify-between items-start gap-3">
              <div><h2 className="text-xl font-bold"><span className="font-mono">{scan.symbol.split(".")[0]}</span> <span className="text-sm font-normal text-black dark:text-white">{scan.name}</span></h2><p className="mt-1 text-xs text-black dark:text-white">{scan.sector} • {text("تاريخ المقارنة", "As of")} {dateLabel(scan.target_date)}</p></div>
              <Link onClick={() => telemetry("similarity_chart_opened", { symbol: scan.symbol })} href={`/chart?symbol=${encodeURIComponent(scan.symbol.split(".")[0])}&exchange=EGX`} className={`${styles.action} inline-flex gap-2 items-center bg-amber-400 px-4 py-2 text-xs font-bold text-slate-950`}>{text("افتح الشارت الفني", "Open technical chart")}<ArrowUpRight className="h-4 w-4" /></Link>
            </div>
            <div className="bg-zinc-50 dark:bg-slate-900 p-3 flex flex-wrap justify-between gap-3 text-xs">
              <div className="space-y-1"><p className="text-black dark:text-white">{text("السوق عند نقطة المقارنة", "Market at comparison date")}</p><b>{regime(scan.current_market)}</b></div>
              <div className="space-y-1"><p className="text-black dark:text-white">{text("سيولة القطاع • متوسط CMF", "Sector flow • average CMF")}</p><b className={scan.current_sector === "outflow" ? "text-rose-700 dark:text-rose-400" : ""}>{detailLoading ? "…" : regime(detail?.current_sector)}</b></div>
              <Link href="/scanner/market" className="flex items-center gap-1 text-amber-800 dark:text-amber-300">{text("بيانات السوق الكاملة", "Full market context")}<ArrowUpRight className="h-4 w-4" /></Link>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={!detail?.current_market || !detail?.current_sector || detailLoading} checked={sameContext} onChange={event => { setSameContext(event.target.checked); telemetry("similarity_context_filter", { enabled: event.target.checked, symbol: scan.symbol }); }} className="mt-1 accent-amber-500" /><span>{text("حالات في نفس اتجاه السوق والسيولة القطاعية", "Cases with matching market trend and sector flow")}<span className="block mt-1 text-xs text-black dark:text-white">{detailLoading ? text("جارٍ فحص تغطية السياق…", "Checking context coverage…") : text(`${detail?.context_coverage?.matched || 0} حالة بنفس السياق. بيانات المؤشرات متاحة لـ${detail?.context_coverage?.market || 0} والسيولة لـ${detail?.context_coverage?.sector || 0} من ${detail?.context_coverage?.observed || 0} حالة مقبولة.`, `${detail?.context_coverage?.matched || 0} cases share the context. Index history covers ${detail?.context_coverage?.market || 0} and sector flow ${detail?.context_coverage?.sector || 0} of ${detail?.context_coverage?.observed || 0} accepted cases.`)}</span></span></label>
          </div>
          {detailLoading ? <div className={`${panel} p-16 flex items-center justify-center gap-3`}><Loader2 className="h-5 w-5 animate-spin text-amber-500" />{text("جاري تحليل السهم…", "Loading stock analysis…")}</div> : detailError ? <div className={`${panel} p-6`}><p className="text-sm text-rose-700 dark:text-rose-400">{text("تعذر تحميل تفاصيل السهم.", "Unable to load stock details.")}</p><button onClick={() => setReport(current => current ? { ...current } : null)} className="mt-3 underline text-sm">{text("إعادة المحاولة", "Retry")}</button></div> : detail && stats && <>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                { label: text("الحالات المقبولة", "Accepted cases"), value: String(stats.observed_matches), note: text(`${scan.rejected_matches} حالة استُبعدت لضعف التشابه أو تداخل الفترات`, `${scan.rejected_matches} weak or overlapping cases excluded`), color: "" },
                { label: text("تشابه فني متوسط", "Average technical similarity"), value: pct(stats.average_similarity, false), note: text("لا يعبّر عن احتمال النجاح", "Not a probability of success"), color: "text-sky-600 dark:text-sky-400" },
                { label: text("نتائج رابحة بالمحاكاة", "Positive simulated outcomes"), value: `${stats.wins}/${stats.total_matches}`, note: text(`عينة ${stats.total_matches < 5 ? "صغيرة جدًا" : "محدودة"} • قبل تكاليف التداول`, `${stats.total_matches < 5 ? "Very small" : "Limited"} sample • before trading costs`), color: "text-emerald-700 dark:text-emerald-400" },
                { label: text("متوسط نتيجة الهدف والوقف", "Mean target/stop outcome"), value: pct(stats.average_return), note: text(`هدف ${pct(report.target_return)} / وقف ${pct(report.stop_loss)}`, `Target ${pct(report.target_return)} / stop ${pct(report.stop_loss)}`), color: tone(stats.average_return) },
              ].map(metric => <div key={metric.label} className={`${panel} p-4`}><p className="text-xs text-black dark:text-white">{metric.label}</p><p className={`my-2 text-2xl font-bold font-mono ${metric.color}`} dir="ltr">{metric.value}</p><p className="text-xs leading-5 text-black dark:text-white">{metric.note}</p></div>)}
            </div>
            {stats.win_interval && <p className="text-xs leading-6 text-black dark:text-white flex gap-2 items-start"><Info className="h-4 w-4 mt-1 shrink-0" />{text(`نطاق عدم اليقين للعينة: ${pct(stats.win_interval[0], false)} إلى ${pct(stats.win_interval[1], false)} عند مستوى 95%. ده وصف للعينة التاريخية وليس تقديرًا لاحتمال ربح الصفقة القادمة.`, `95% sample uncertainty interval: ${pct(stats.win_interval[0], false)} to ${pct(stats.win_interval[1], false)}. This describes the historical sample, not the next trade's win probability.`)}</p>}
            <div className="grid grid-cols-3 gap-2 bg-zinc-100 dark:bg-slate-900 p-1.5" role="tablist" aria-label={text("تفاصيل التحليل", "Analysis sections")}>
              {([
                ["scenarios", text("السيناريوهات والمخاطر", "Scenarios & risks"), BarChart2],
                ["cases", text("الحالات التاريخية", "Historical cases"), History],
                ["method", text("المنهجية والافتراضات", "Method & assumptions"), ShieldCheck],
              ] as const).map(([id, label, Icon]) => <button type="button" key={id} role="tab" aria-selected={tab === id} aria-controls={`similarity-${id}`} onClick={() => { setTab(id); telemetry("similarity_section", { section: id }); }} className={`p-3 flex flex-col sm:flex-row justify-center items-center gap-2 text-xs sm:text-sm font-bold transition ${tab === id ? "bg-white dark:bg-slate-700 shadow-sm text-amber-800 dark:text-amber-300" : "text-black dark:text-white hover:text-zinc-800 dark:hover:text-white"}`}><Icon className="h-4 w-4" />{label}</button>)}
            </div>
            <div id={`similarity-${tab}`} role="tabpanel" className={`${panel} p-4 sm:p-6 space-y-5`}>
              {tab === "scenarios" && <>
                <div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="font-bold">{text("ماذا حدث بعد التشابه؟", "What happened after a similar state?")}</h3><p className="mt-1 text-xs text-black dark:text-white">{text("احتفاظ حتى إغلاق الفترة، دون تطبيق الهدف والوقف", "Held until the horizon close, without a target or stop")}</p></div><div className="flex gap-1">{Object.keys(stats.horizon_stats).map(value => <button key={value} aria-pressed={horizon === value} onClick={() => { setHorizon(value); telemetry("similarity_horizon", { sessions: Number(value) }); }} className={`${styles.period} px-3 py-2 text-xs font-bold ${horizon === value ? "bg-amber-400 text-slate-950" : "bg-zinc-100 dark:bg-slate-900"}`}>{value} {text("جلسات", "sessions")}</button>)}</div></div>
                {selectedHorizon?.sample_size ? <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      [text("الوسيط • الحالة الوسطى", "Median • middle outcome"), selectedHorizon.median_return],
                      [text("متوسط العائد", "Mean return"), selectedHorizon.average_return],
                      [text("أسوأ عائد مرصود", "Worst observed return"), selectedHorizon.worst_return],
                      [text("أفضل عائد مرصود", "Best observed return"), selectedHorizon.best_return],
                    ].map(([label, value]) => <div key={String(label)} className={`${styles.metric} bg-zinc-50 dark:bg-slate-900 p-3`}><p className="text-xs text-black dark:text-white">{label}</p><p className={`mt-2 text-xl font-bold font-mono ${tone(value as number | null)}`} dir="ltr">{pct(value as number | null)}</p></div>)}
                  </div>
                  <div className="border border-sky-300 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 p-4 text-sm leading-7">
                    {text(`في ${selectedHorizon.sample_size} حالة مكتملة بعد ${horizon} جلسة: ${pct(selectedHorizon.positive_rate, false)} أغلقت بعائد موجب. نصف النتائج كان بين ${pct(selectedHorizon.lower_quartile)} و${pct(selectedHorizon.upper_quartile)}.`, `Across ${selectedHorizon.sample_size} complete ${horizon}-session cases, ${pct(selectedHorizon.positive_rate, false)} ended positive. The middle half of outcomes fell between ${pct(selectedHorizon.lower_quartile)} and ${pct(selectedHorizon.upper_quartile)}.`)}
                  </div>
                </> : <p className="text-sm text-black dark:text-white py-8 text-center">{text("لا توجد حالات مكتملة لهذه الفترة ضمن الفلتر المختار. جرّب فترة أقصر أو ألغِ فلتر السياق.", "No complete cases for this horizon and filter. Try a shorter horizon or disable context matching.")}</p>}
                {matches.length > 0 && <>
                  <h4 className="font-bold text-sm">{text("مسارات كل الحالات المقبولة", "Paths of all accepted cases")}</h4>
                  <p className="text-xs text-black dark:text-white">{text("الأزرق: وسيط العوائد. النطاق المظلل: من الربع الأدنى إلى الربع الأعلى (50% الوسطى). الأصفر: الحالة المختارة.", "Blue: median return. Shaded band: the middle 50% of cases. Yellow: selected historical case.")}</p>
                  <div className="h-72 sm:h-80" dir="ltr"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={paths} margin={{ top: 15, right: 10, left: 0, bottom: 15 }}><CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={.15} /><XAxis dataKey="session" tick={{ fontSize: 11 }} /><YAxis tickFormatter={value => `${value}%`} tick={{ fontSize: 11 }} width={55} /><Tooltip contentStyle={{ background: "var(--app-surface)", border: "1px solid var(--app-border-strong)", color: "var(--app-text)", borderRadius: 0 }} labelFormatter={value => `${text("جلسة", "Session")} ${value} • ${paths.find(point => point.session === Number(value))?.count || 0} ${text("حالات", "cases")}`} formatter={(value: any, name: any) => [Array.isArray(value) ? value.map(v => `${Number(v).toFixed(1)}%`).join(" – ") : `${Number(value).toFixed(1)}%`, name]} /><ReferenceLine y={0} stroke="#94a3b8" /><ReferenceLine x={Number(horizon)} stroke="#fbbf24" strokeDasharray="4 4" /><Area dataKey="band" name={text("50% الوسطى", "Middle 50%")} fill="#38bdf8" stroke="none" fillOpacity={.18} connectNulls={false} /><Line dataKey="median" name={text("الوسيط", "Median")} stroke="#38bdf8" strokeWidth={3} dot={false} connectNulls={false} /><Line dataKey="historical" name={text("الحالة المختارة", "Selected case")} stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls={false} /></ComposedChart></ResponsiveContainer></div>
                  <p className="text-xs text-black dark:text-white">{text("العينة عند كل جلسة تشمل الحالات التي لديها مسار مكتمل حتى هذه الجلسة. قد يقل عددها عند الفترات الأطول.", "Each session uses every accepted case with data through that session. Longer horizons may contain fewer cases.")}</p>
                </>}
                <div className="border-t border-zinc-100 dark:border-slate-800 pt-4"><h4 className="font-bold text-sm">{text("نتائج محاكاة الهدف والوقف", "Target and stop simulation outcomes")}</h4><p className="mt-1 text-xs text-black dark:text-white">{text("نتائج الخروج تختلف عن الاحتفاظ حتى نهاية الفترة بالأعلى.", "Exit outcomes differ from holding to the horizon close above.")}</p><div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">{Object.entries(stats.exit_counts).map(([reason, count]) => <div key={reason} className="bg-zinc-50 dark:bg-slate-900 px-3 py-2 flex justify-between gap-2 text-xs"><span>{outcome({ exit_reason: reason } as SimilarityMatch)}</span><b className="font-mono">{count}</b></div>)}</div></div>
              </>}
              {tab === "cases" && <>
                <div><h3 className="font-bold">{text("راجع كل حالة بنفسك", "Inspect each historical case")}</h3><p className="mt-1 text-xs text-black dark:text-white">{text("اختر تاريخًا لمقارنة شكل السعر ومساره التالي. أقصى صعود وهبوط هنا طوال الفترة، وقد يحدثان بعد خروج المحاكاة.", "Select a date to compare the price shape and subsequent path. High/low moves cover the full horizon and may occur after the simulated exit.")}</p></div>
                <div className="overflow-x-auto"><table className="w-full text-start text-xs whitespace-nowrap"><thead className="text-black dark:text-white"><tr>{[text("التاريخ", "Date"), text("التشابه الفني", "Technical similarity"), text("السوق / السيولة", "Market / flow"), text("أقصى صعود", "High move"), text("أقصى هبوط من الدخول", "Low move from entry"), text("عائد الخروج", "Exit return"), text("سبب الخروج", "Exit reason")].map(label => <th key={label} className="p-3 text-start font-medium">{label}</th>)}</tr></thead><tbody>{matches.map(match => <tr key={`${match.symbol}:${match.date}`} className={`border-t border-zinc-100 dark:border-slate-800 ${chosen?.date === match.date ? "bg-amber-400/5" : ""}`}><td className="p-3"><button onClick={() => { setFocused(`${match.symbol}:${match.date}`); telemetry("similarity_case_selected", { symbol: match.symbol, date: match.date }); }} className="underline decoration-dotted font-mono text-amber-800 dark:text-amber-300">{match.date}</button></td><td className="p-3 font-mono">{pct(match.similarity, false)}</td><td className="p-3">{regime(match.market_context)} / {regime(match.sector_context)}</td><td className="p-3 text-emerald-700 dark:text-emerald-400" dir="ltr">{pct(match.mfe)}</td><td className="p-3 text-rose-700 dark:text-rose-400" dir="ltr">{pct(match.mae)}</td><td className={`p-3 font-mono ${tone(match.final_return)}`} dir="ltr">{pct(match.final_return)}</td><td className="p-3">{outcome(match)}</td></tr>)}</tbody></table></div>
                {!matches.length && <p className="text-center py-8 text-black dark:text-white">{text("لا توجد حالات مقبولة لهذا الاختيار.", "No accepted cases for this selection.")}</p>}
                {chosen && <><h4 className="font-bold text-sm">{text("مقارنة آخر 10 جلسات قبل الحالة", "Compare the 10 sessions before the case")} • <span className="font-mono">{chosen.date}</span></h4><p className="text-xs text-black dark:text-white">{text("السعر معادل إلى 0% عند يوم المقارنة وعلى نفس المحور. الأزرق الحالي، والأصفر التاريخي.", "Prices are normalized to 0% on the comparison date, on a shared axis. Blue is current; yellow is historical.")}</p><div className="h-64" dir="ltr"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={before}><CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={.15} /><XAxis dataKey="session" tick={{ fontSize: 11 }} /><YAxis tickFormatter={value => `${value}%`} tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--app-surface)", border: "1px solid var(--app-border-strong)", color: "var(--app-text)", borderRadius: 0 }} formatter={(value: any) => `${Number(value).toFixed(1)}%`} /><ReferenceLine y={0} stroke="#94a3b8" /><Line dataKey="current" name={text("الحالي", "Current")} stroke="#38bdf8" strokeWidth={3} dot={false} /><Line dataKey="historical" name={text("التاريخي", "Historical")} stroke="#fbbf24" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer></div><button onClick={() => setTab("scenarios")} className="text-sm underline text-amber-800 dark:text-amber-300">{text("شاهد المسار التالي لهذه الحالة", "View this case's subsequent path")}</button></>}
              </>}
              {tab === "method" && <div className="space-y-5 text-sm leading-7">
                <h3 className="font-bold text-lg">{text("كيف تقرأ الدليل؟", "How to interpret the evidence")}</h3>
                {[
                  [text("التشابه الفني", "Technical similarity"), text(`نقارن RSI، Bollinger %B، المسافة من SMA50 وSMA200، MACD، الحجم النسبي، عائد 5 جلسات وشكل آخر 5 جلسات. نقبل درجات ${pct(report.minimum_similarity, false)} فأعلى. هذا حد للعرض وليس احتمال ربح معايرًا.`, `Compare RSI, Bollinger %B, SMA50/200 distances, MACD, relative volume, 5-session return and the last 5 sessions' shape. Cases must score at least ${pct(report.minimum_similarity, false)}. This display threshold is not a calibrated win probability.`)],
                  [text("السياق العام", "Market and sector context"), text("اتجاه السوق يستخدم عائد 5 و20 جلسة لكل من EGX30 وEGX100؛ السيولة تستخدم متوسط CMF القطاعي في التاريخ المتاح. فلتر السياق يقبل الحالات التي توافق الاثنين. التاريخ الناقص يظل غير متاح ولا يُفترض مطابقًا.", "Market direction uses 5- and 20-session returns of EGX30 and EGX100. Sector flow uses the available historical sector CMF average. Context matching requires both to agree; missing history is not treated as a match.")],
                  [text("قوة العينة", "Sample strength"), text("10 حالات تعني أن حالة واحدة تغيّر النسبة 10 نقاط. نطاق عدم اليقين محسوب للعينة بطريقة Wilson عند 95% ولا يعوّض نقص العينات أو اختلاف ظروف السوق.", "With 10 cases, one outcome changes the rate by 10 percentage points. The 95% Wilson interval measures sample uncertainty; it does not solve limited data or changing market conditions.")],
                  [text("نوعان من النتائج", "Two distinct measurements"), text(`السيناريوهات تعرض عائد الإغلاق بعد 5/10/20 جلسة. محاكاة الخروج تطبق الهدف ${pct(report.target_return)} والوقف ${pct(report.stop_loss)} أو تنتهي بعد ${report.forward_days} جلسة. إذا حدث الهدف والوقف في نفس الشمعة نفترض الوقف أولًا.`, `Scenarios show close-to-close returns after 5/10/20 sessions. Exit simulation applies a ${pct(report.target_return)} target and ${pct(report.stop_loss)} stop, or exits after ${report.forward_days} sessions. If both trigger in a bar, the stop is assumed first.`)],
                  [text("افتراضات التنفيذ", "Execution assumptions"), text("العوائد المعروضة قبل الرسوم والانزلاق السعري. الهدف والوقف يفترضان تنفيذًا عند المستوى المحدد. الحالات التاريخية لا تكفي وحدها لتقييم صفقة حالية؛ راجع اتجاه السوق والقطاع والشارت الفني.", "Returns exclude fees and slippage. Targets and stops assume fills at the specified level. Review market direction, sector flow and the technical chart alongside the historical cases.")],
                  [text("تحديث البيانات", "Data updates"), text("التقرير يتحدث بعد التشغيل اليومي. نحمل ملخص الأسهم أولًا، وتفاصيل السهم المختار فقط. يتم فحص التقرير عند العودة للصفحة بعد 5 دقائق، ويظل تاريخ البيانات ظاهرًا.", "Reports follow the daily scan. The stock summary loads first, then only the selected stock's details. The report is checked on return after five minutes, with its data date always visible.")],
                ].map(([title, description]) => <div key={title} className="border-t border-zinc-100 dark:border-slate-800 pt-4"><h4 className="font-bold">{title}</h4><p className="mt-1 text-black dark:text-white">{description}</p></div>)}
              </div>}
            </div>
          </>}
        </>}
      </div>
    </div>
  </section>;
}
