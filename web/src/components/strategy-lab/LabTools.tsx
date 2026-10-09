"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import LabDialogShell from "./LabDialogShell";
import { Search, Loader2 } from "lucide-react";
import {
  STRATEGIES,
  analyzeStrategy,
  compareStrategies,
  calculateTradeSizing,
  buildScenarios,
  detectFalseBreakouts,
  type StrategyId,
  type EquityPoint,
  type Overlay,
  type StrategyParams,
} from "@/lib/strategy-lab";
import { type LabPanel } from "./workspace-state";
import { useLabCandles } from "./StrategyWorkspace";

interface Props {
  panel: LabPanel;
  tool: string;
  ar: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<LabPanel>) => void;
  onApplyComparison: (comparison: ReturnType<typeof compareStrategies>) => void;
  onInvalidateComparison?: () => void;
  serverComparison?: ReturnType<typeof compareStrategies>;
  serverAssumptions?: {
    initialCapital?: number;
    commissionBps?: number;
    slippageBps?: number;
    params?: StrategyParams;
  };
  serverOrigin?: "ai" | "local";
  dataNote?: string;
}
const names: Record<string, string> = {
  wyckoff: "Wyckoff approximation",
  smc: "Market structure",
  harmonic: "Harmonic pivots",
  gann: "Gann slope",
  time_cycles: "Time cycles",
  elliott: "Elliott pivots",
  volume_profile: "Volume Profile",
  price_action: "Price action",
  trend_macd: "Trend / MACD",
  fibonacci_time: "Fibonacci time",
};
const number = (value: number) =>
  Number.isFinite(value) ? value.toFixed(2) : "—";
export type ComparisonDraft = {
  strategyIds: StrategyId[];
  initialCapital: number;
  commissionBps: number;
  slippageBps: number;
  lookback: number;
  split: number;
  testWindow: "all" | "holdout";
  params?: StrategyParams;
};
function comparisonSeed(
  panel: LabPanel,
  server?: Props["serverComparison"],
  assumptions?: Props["serverAssumptions"],
): ComparisonDraft {
  const saved = panel.comparisonSettings;
  return {
    strategyIds: (
      server?.analyses.map((a) => a.strategyId) || panel.strategyIds
    ).filter((id) => STRATEGIES.some((s) => s.id === id)) as StrategyId[],
    initialCapital:
      assumptions?.initialCapital ??
      saved?.initialCapital ??
      panel.tradeSettings?.capital ??
      100000,
    commissionBps: assumptions?.commissionBps ?? saved?.commissionBps ?? 10,
    slippageBps: assumptions?.slippageBps ?? saved?.slippageBps ?? 10,
    lookback: assumptions?.params?.lookback ?? saved?.lookback ?? 20,
    split: saved?.split ?? 70,
    testWindow: assumptions ? "all" : (saved?.testWindow ?? "holdout"),
    params: assumptions?.params ?? saved?.params,
  };
}
function comparisonOverlays(
  comparison: ReturnType<typeof compareStrategies>,
  previous: Overlay[] = [],
  onOmitted?: (count: number) => void,
): Overlay[] {
  const markers: Overlay[] = comparison.results
    .flatMap((result) =>
      result.trades.flatMap((trade, i) => [
        {
          id: `${result.strategyId}-entry-${i}`,
          label: `${result.strategyId} BUY ${number(trade.entryPrice)}`,
          kind: "time" as const,
          group: "compare",
          color: "#10b981",
          points: [{ time: trade.entryTime, value: trade.entryPrice }],
        },
        {
          id: `${result.strategyId}-exit-${i}`,
          label: `${result.strategyId} SELL ${number(trade.exitPrice)}`,
          kind: "time" as const,
          group: "compare",
          color: "#f43f5e",
          points: [{ time: trade.exitTime, value: trade.exitPrice }],
        },
      ]),
    )
    .slice(-30);
  return mergeToolGroup(previous, markers, "compare", onOmitted);
}
function mergeToolGroup(
  previous: Overlay[],
  incoming: Overlay[],
  group: string,
  onOmitted?: (count: number) => void,
): Overlay[] {
  const ids = new Set(incoming.map((overlay) => overlay.id));
  const retained = previous.filter(
    (overlay) => overlay.group !== group && !ids.has(overlay.id),
  );
  const capacity = Math.max(0, 100 - retained.length);
  onOmitted?.(Math.max(0, incoming.length - capacity));
  return [...retained, ...(capacity ? incoming.slice(-capacity) : [])];
}
export default function LabTools({
  panel,
  tool,
  ar,
  onClose,
  onUpdate,
  onApplyComparison,
  onInvalidateComparison,
  serverComparison,
  serverAssumptions,
  serverOrigin = "ai",
  dataNote,
}: Props) {
  const { candles, loading, error } = useLabCandles(panel);
  const latestProps = useRef({
    panel,
    onUpdate,
    onApplyComparison,
    onInvalidateComparison,
  });
  latestProps.current = {
    panel,
    onUpdate,
    onApplyComparison,
    onInvalidateComparison,
  };
  const ownSelection = useRef<string | null>(null);
  const liveComparisonRef = useRef<Props["serverComparison"]>(undefined);
  const appliedFingerprint = useRef("");
  const [search, setSearch] = useState("");
  const [omittedOverlays, setOmittedOverlays] = useState(0);
  const [draft, setDraft] = useState<ComparisonDraft>(() =>
    comparisonSeed(
      panel,
      serverOrigin === "ai" ? serverComparison : undefined,
      serverOrigin === "ai" ? serverAssumptions : undefined,
    ),
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const {
    initialCapital: capital,
    commissionBps: commission,
    slippageBps: slippage,
    lookback,
    split,
    testWindow,
    strategyIds: selected,
  } = draft;
  const [useServerResult, setUseServerResult] = useState(
    !!serverComparison && serverOrigin === "ai",
  );
  const [editedComparison, setEditedComparison] = useState(false);
  const editComparison = (patch: Partial<ComparisonDraft>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setUseServerResult(false);
    setEditedComparison(true);
    if (
      tool === "compare" &&
      [
        next.initialCapital,
        next.commissionBps,
        next.slippageBps,
        next.lookback,
        next.split,
      ].every(Number.isFinite) &&
      next.initialCapital > 0 &&
      next.commissionBps >= 0 &&
      next.commissionBps <= 1000 &&
      next.slippageBps >= 0 &&
      next.slippageBps <= 1000 &&
      Number.isInteger(next.lookback) &&
      next.lookback >= 2 &&
      next.lookback <= 200 &&
      Number.isInteger(next.split) &&
      next.split >= 10 &&
      next.split <= 90
    )
      onUpdate({ comparisonSettings: next });
  };
  const setCapital = (value: number) =>
    editComparison({ initialCapital: value });
  const setCommission = (value: number) =>
    editComparison({ commissionBps: value });
  const setSlippage = (value: number) => editComparison({ slippageBps: value });
  const setLookback = (value: number) => editComparison({ lookback: value });
  const setSplit = (value: number) => editComparison({ split: value });
  const setTestWindow = (value: ComparisonDraft["testWindow"]) =>
    editComparison({ testWindow: value });
  const setSelected = (update: (current: StrategyId[]) => StrategyId[]) =>
    editComparison({ strategyIds: update(draftRef.current.strategyIds) });
  const panelSelection = JSON.stringify(panel.strategyIds);
  const previousPanelSelection = useRef(panelSelection);
  useEffect(() => {
    if (previousPanelSelection.current === panelSelection) return;
    previousPanelSelection.current = panelSelection;
    if (panelSelection !== ownSelection.current) {
      setDraft((current) => ({
        ...current,
        strategyIds: panel.strategyIds.filter((id) =>
          STRATEGIES.some((s) => s.id === id),
        ) as StrategyId[],
      }));
      setUseServerResult(false);
      setEditedComparison(true);
    }
  }, [panelSelection, panel.strategyIds, editedComparison]);
  const [entry, setEntry] = useState(panel.tradeSettings?.entry || 0);
  const [stop, setStop] = useState(panel.tradeSettings?.stop || 0);
  const [target, setTarget] = useState(panel.tradeSettings?.target || 0);
  const [risk, setRisk] = useState(panel.tradeSettings?.riskPct || 1);
  const [tradeInitialised, setTradeInitialised] = useState(
    !!panel.tradeSettings,
  );
  const [eps, setEps] = useState(0);
  const [multipleLow, setMultipleLow] = useState(8);
  const [multipleHigh, setMultipleHigh] = useState(12);
  const [valuationDate, setValuationDate] = useState("");
  const [valuationSource, setValuationSource] = useState("");
  const valuationFinite = [
    eps,
    multipleLow,
    multipleHigh,
    eps * multipleLow,
    eps * multipleHigh,
  ].every(Number.isFinite);
  const [benchmarkSymbol, setBenchmarkSymbol] = useState("EGX30");
  const [relativeSymbol, setRelativeSymbol] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventLabel, setEventLabel] = useState("");
  const [eventSource, setEventSource] = useState("");
  const [events, setEvents] = useState<
    { date: string; label: string; source: string }[]
  >([]);
  const [storedEvents, setStoredEvents] = useState<
    {
      date: string;
      title: string;
      url: string;
      source: string;
      confidence?: string;
    }[]
  >([]);
  const [eventNote, setEventNote] = useState("");
  const [eventsLoading, setEventsLoading] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<number[]>([]);
  useEffect(() => {
    if (tool !== "events") return;
    const controller = new AbortController();
    setEventsLoading(true);
    fetch(`/api/chart-events?symbol=${encodeURIComponent(panel.symbol)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("source unavailable");
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const rows = Array.isArray(data.events)
          ? data.events
              .filter(
                (event: { date?: string; title?: string; url?: string }) =>
                  typeof event.date === "string" &&
                  Number.isFinite(Date.parse(event.date)) &&
                  typeof event.title === "string" &&
                  typeof event.url === "string" &&
                  /^https?:\/\//.test(event.url),
              )
              .slice(0, 30)
          : [];
        setStoredEvents(rows);
        setSelectedEvents([]);
        setEventNote(
          typeof data.warning === "string"
            ? data.warning
            : typeof data.note === "string"
              ? data.note
              : "",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setEventNote(
            ar
              ? "تعذر تحميل مصدر الأحداث المخزنة؛ يمكن إضافة ملاحظات يدوية."
              : "Stored event source unavailable; manual notes remain available.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventsLoading(false);
      });
    return () => controller.abort();
  }, [panel.symbol, tool, ar]);
  const last = candles.at(-1)?.close || 0;
  useEffect(() => {
    if (last && !tradeInitialised) {
      setEntry(last);
      setStop(last * 0.95);
      setTarget(last * 1.1);
      setTradeInitialised(true);
    }
  }, [last, tradeInitialised]);
  const localComparison = useMemo(() => {
    if (
      !candles.length ||
      !selected.length ||
      ![capital, commission, slippage, split, lookback].every(
        Number.isFinite,
      ) ||
      !Number.isInteger(split) ||
      split < 10 ||
      split > 90 ||
      !Number.isInteger(lookback) ||
      lookback < 2 ||
      lookback > 200 ||
      capital <= 0 ||
      commission < 0 ||
      commission > 1000 ||
      slippage < 0 ||
      slippage > 1000
    )
      return null;
    const data =
      testWindow === "holdout"
        ? candles.slice(Math.floor((candles.length * split) / 100))
        : candles;
    try {
      return compareStrategies(data, selected, {
        initialCapital: capital,
        commissionBps: commission,
        slippageBps: slippage,
        params: { ...draft.params, lookback },
      });
    } catch {
      return null;
    }
  }, [
    candles,
    selected,
    capital,
    commission,
    slippage,
    lookback,
    split,
    testWindow,
    draft.params,
  ]);
  useEffect(() => {
    if (serverComparison && serverComparison === liveComparisonRef.current)
      return;
    setUseServerResult(!!serverComparison && serverOrigin === "ai");
    if (serverComparison && serverOrigin === "ai") {
      setDraft(comparisonSeed(panel, serverComparison, serverAssumptions));
      setEditedComparison(false);
    }
    // A new tool result starts a new comparison; persisted draft echoes never reset in-modal edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverComparison, serverOrigin]);
  useEffect(() => {
    if (tool !== "compare" || !editedComparison) return;
    if (!localComparison) {
      const fingerprint = JSON.stringify({ invalid: draft });
      if (appliedFingerprint.current === fingerprint) return;
      appliedFingerprint.current = fingerprint;
      const latest = latestProps.current;
      if (!selected.length) ownSelection.current = JSON.stringify([]);
      latest.onUpdate({
        toolOverlays: (latest.panel.toolOverlays || []).filter(
          (overlay) => overlay.group !== "compare",
        ),
        ...(!selected.length ? { strategyIds: [] } : {}),
      });
      latest.onInvalidateComparison?.();
      return;
    }
    const fingerprint = JSON.stringify({ draft, comparison: localComparison });
    if (appliedFingerprint.current === fingerprint) return;
    appliedFingerprint.current = fingerprint;
    liveComparisonRef.current = localComparison;
    const latest = latestProps.current;
    ownSelection.current = JSON.stringify(
      localComparison.analyses.map((analysis) => analysis.strategyId),
    );
    latest.onUpdate({
      comparisonSettings: draft,
      strategyIds: localComparison.analyses.map(
        (analysis) => analysis.strategyId,
      ),
      toolOverlays: comparisonOverlays(
        localComparison,
        latest.panel.toolOverlays,
        setOmittedOverlays,
      ),
    });
    latest.onApplyComparison(localComparison);
  }, [localComparison, editedComparison, tool, draft]);
  const comparison = useServerResult ? serverComparison : localComparison;
  const sizing = useMemo(() => {
    try {
      return calculateTradeSizing(entry, stop, target, capital, risk);
    } catch {
      return null;
    }
  }, [entry, stop, target, capital, risk]);
  const titles: Record<string, [string, string]> = {
    strategies: ["مكتبة الاستراتيجيات", "Strategy library"],
    compare: ["المقارنة التاريخية", "Historical comparison"],
    trade: ["إدارة الصفقة", "Trade sizing"],
    scenarios: ["السيناريوهات", "Scenarios"],
    fakeout: ["الاختراقات الكاذبة", "False breakouts"],
    relative: ["القوة النسبية", "Relative strength"],
    events: ["تقويم الأحداث", "Events calendar"],
    valuation: ["نطاق التقييم", "Valuation range"],
  };
  const input =
    "app-control w-full rounded-xl p-2.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
  const label = (arabic: string, english: string) => (ar ? arabic : english);
  const levelLine = (
    id: string,
    title: string,
    value: number,
    color: string,
  ): Overlay => ({
    id,
    label: title,
    kind: "line",
    color,
    points: [
      { time: candles[0]?.time || 0, value },
      { time: candles.at(-1)?.time || 0, value },
    ],
  });
  const apply = (overlays: Overlay[]) => {
    const incoming = overlays.map((overlay) => ({ ...overlay, group: tool }));
    let omitted = 0;
    onUpdate({
      toolOverlays: mergeToolGroup(
        panel.toolOverlays || [],
        incoming,
        tool,
        (count) => {
          omitted = count;
          setOmittedOverlays(count);
        },
      ),
    });
    if (!omitted) onClose();
  };
  return (
    <LabDialogShell
      title={`${titles[tool]?.[ar ? 0 : 1]} · ${panel.symbol}`}
      subtitle={`${panel.timeframe} · ${candles.length} ${label("شمعة", "candles")}`}
      ar={ar}
      onClose={onClose}
    >
      <div className="space-y-5 text-xs">
        {loading && (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {label("جارٍ تحميل البيانات", "Loading data")}
          </div>
        )}
        {error && (
          <p role="alert" className="text-red-500">
            {label(
              "تاريخ السهم غير متاح. يمكن تعديل الإعدادات وإعادة فتح الأداة.",
              "Stock history unavailable. Edit settings and reopen the tool.",
            )}
          </p>
        )}
        {useServerResult && (
          <div className="app-soft-panel rounded-xl p-4">
            <p>
              {label(
                "عرض نتيجة أداة AI كما حُسبت، بإعداداتها وفترتها الأصلية.",
                "Showing the AI tool result with its original settings and window.",
              )}
            </p>
            <p>{dataNote}</p>
            <button
              className="mt-2 underline"
              onClick={() => setUseServerResult(false)}
            >
              {label(
                "بدء مقارنة محلية بالإعدادات أدناه",
                "Start a local comparison using settings below",
              )}
            </button>
          </div>
        )}
        {tool === "compare" && editedComparison && (
          <p role="status" className="app-text-muted">
            {label(
              "النتائج تتحدث فوراً من شموع الشارت الحالية وإعداداتك المعدلة؛ نتيجة AI الأصلية لم تعد معروضة.",
              "Results update immediately from the current chart candles and edited settings; the original AI result is no longer shown.",
            )}
          </p>
        )}
        {omittedOverlays > 0 && (
          <p role="alert" className="app-text-muted">
            {label(
              `لم تُضف ${omittedOverlays} رسومات جديدة بسبب حد 100 إضافة. الإضافات السابقة محفوظة؛ احذف إضافات لإتاحة مساحة.`,
              `${omittedOverlays} new drawings were omitted due to the 100-addition limit. Existing additions are preserved; remove entries to make room.`,
            )}
          </p>
        )}
        {!omittedOverlays && (panel.toolOverlays?.length || 0) >= 100 && (
          <p className="app-text-muted">
            {label(
              "وصل الشارت إلى حد 100 إضافة؛ احذف إضافات من لوحة الإضافات لإتاحة رسومات جديدة. الإضافات السابقة محفوظة.",
              "The chart has reached 100 additions. Remove entries in Additions to make room for new drawings; existing additions are preserved.",
            )}
          </p>
        )}
        {tool === "strategies" && (
          <>
            <label className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              <input
                aria-label={label("بحث الاستراتيجيات", "Search strategies")}
                className={input}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={label(
                  "ابحث بالاسم أو الوصف",
                  "Search name or description",
                )}
              />
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              {STRATEGIES.filter((strategy) =>
                `${strategy.name} ${names[strategy.id]} ${strategy.description}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ).map((strategy) => {
                const enabled = panel.strategyIds.includes(strategy.id);
                return (
                  <article
                    key={strategy.id}
                    className={`app-soft-panel rounded-xl p-4 ${enabled ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-[var(--app-surface-strong)]" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold">
                        {ar ? strategy.name : names[strategy.id]}
                      </h3>
                      <span className="app-chip ms-auto rounded-lg px-2 py-1 text-[9px] font-bold">
                        {strategy.experimental
                          ? label("تجريبي", "Experimental")
                          : strategy.backtestable
                            ? label("قابل للاختبار", "Backtestable")
                            : label("رسم تحليلي", "Drawing only")}
                      </span>
                    </div>
                    <p
                      className="mt-2 app-text-muted leading-relaxed"
                      title={strategy.description}
                    >
                      {strategy.description}
                    </p>
                    <button
                      aria-pressed={enabled}
                      className="app-primary-action mt-3 rounded-xl px-3 py-2 text-xs font-black"
                      onClick={() =>
                        onUpdate({
                          strategyIds: enabled
                            ? panel.strategyIds.filter(
                                (id) => id !== strategy.id,
                              )
                            : [...panel.strategyIds, strategy.id],
                        })
                      }
                    >
                      {enabled
                        ? label("إخفاء الرسومات", "Hide overlays")
                        : label("تطبيق على الشارت", "Apply to chart")}
                    </button>
                  </article>
                );
              })}
            </div>
            {panel.strategyIds.length > 0 && candles.length > 0 && (
              <div className="space-y-1 text-[10px] text-amber-600 dark:text-amber-400">
                {panel.strategyIds.flatMap((id) => {
                  try {
                    return analyzeStrategy(
                      candles,
                      id as StrategyId,
                    ).warnings.map((warning, i) => (
                      <p key={`${id}-${i}`}>{warning}</p>
                    ));
                  } catch {
                    return [];
                  }
                })}
              </div>
            )}
          </>
        )}
        {tool === "compare" && (
          <>
            <p className="app-text-muted">
              {label(
                "تنفيذ الإشارة عند افتتاح الشمعة التالية، شراء فقط. اختر استراتيجيات لها قواعد صفقات. الرسومات الأخرى لا تدخل ترتيب الأداء.",
                "Signals execute at the next candle open, long only. Select strategies with trade rules; drawing studies are excluded from performance ranking.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {STRATEGIES.map((s) => (
                <label
                  key={s.id}
                  className="app-chip flex items-center gap-2 rounded-xl px-3 py-2 font-bold"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, s.id]
                          : current.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {ar ? s.name : names[s.id]}
                  {!s.backtestable && (
                    <span className="app-text-muted text-[9px]">
                      {label("رسم فقط", "Drawing only")}
                    </span>
                  )}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Numeric
                label={label("رأس المال (جنيه)", "Capital (EGP)")}
                value={capital}
                onChange={setCapital}
                min={1}
              />
              <Numeric
                label={label("العمولة (نقطة أساس)", "Commission (bps)")}
                value={commission}
                onChange={setCommission}
                min={0}
                max={1000}
              />
              <Numeric
                label={label("الانزلاق (نقطة أساس)", "Slippage (bps)")}
                value={slippage}
                onChange={setSlippage}
                min={0}
                max={1000}
              />
              <Numeric
                label={label("فترة النطاق", "Lookback")}
                value={lookback}
                onChange={setLookback}
                min={2}
                max={200}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label>
                {label("فترة المقارنة", "Comparison window")}{" "}
                <select
                  className={input}
                  value={testWindow}
                  onChange={(e) =>
                    setTestWindow(e.target.value as "all" | "holdout")
                  }
                >
                  <option value="holdout">
                    {label("الجزء المحجوز للاختبار", "Holdout window")}
                  </option>
                  <option value="all">
                    {label("كل التاريخ المحدد", "All selected history")}
                  </option>
                </select>
              </label>
              <Numeric
                label={label(
                  "جزء الضبط المستبعد %",
                  "Excluded tuning window %",
                )}
                value={split}
                onChange={setSplit}
                min={30}
                max={90}
              />
            </div>
            <p className="text-[10px] app-text-muted">
              {label(
                "الفصل زمني فقط، لا يوجد تحسين تلقائي. الإعدادات تختارها قبل مراجعة الاختبار. تغييرها بناءً على نتيجته يفسد استقلاله. البيانات يجب أن تكون معدلة للأحداث الرأسمالية.",
                "This is a chronological split, without auto optimization. Choose settings before reading holdout results. Tuning against the result invalidates independence. Corporate action adjusted data is required.",
              )}
            </p>
            {comparison ? (
              <>
                <button
                  className="app-primary-action rounded-xl px-4 py-2.5 text-xs font-black"
                  onClick={() => {
                    let omitted = 0;
                    onUpdate({
                      strategyIds: comparison.analyses.map(
                        (analysis) => analysis.strategyId,
                      ),
                      toolOverlays: comparisonOverlays(
                        comparison,
                        panel.toolOverlays,
                        (count) => {
                          omitted = count;
                          setOmittedOverlays(count);
                        },
                      ),
                    });
                    onApplyComparison(comparison);
                    if (!omitted) onClose();
                  }}
                >
                  {label(
                    "عرض الاستراتيجيات وما يصل إلى آخر 30 دخول وخروج على الشارت",
                    "Draw strategies and up to 30 latest trade entries / exits",
                  )}
                </button>
                <p className="text-[10px] app-text-muted">
                  {label(
                    "المقارنة تخص الفترة والإعدادات المعروضة. عينة أقل من 10 صفقات مغلقة غير كافية لترتيب موثوق.",
                    "Results belong to the displayed window and settings. Fewer than 10 closed trades is insufficient for a reliable ranking.",
                  )}
                </p>
                {comparison.excludedStrategyIds.length > 0 && (
                  <p className="app-soft-panel rounded-xl p-3 text-[10px]">
                    {label(
                      "تحليل بصري دون إحصاءات صفقات معتمدة",
                      "Visual analysis without validated trade statistics",
                    )}
                    :{" "}
                    {comparison.excludedStrategyIds
                      .map((id) =>
                        ar
                          ? STRATEGIES.find((s) => s.id === id)!.name
                          : names[id],
                      )
                      .join(" · ")}
                  </p>
                )}
                <EquityChart
                  lines={[
                    ...comparison.results.map((result) => ({
                      label: ar
                        ? STRATEGIES.find((s) => s.id === result.strategyId)!
                            .name
                        : names[result.strategyId],
                      points: result.equity,
                    })),
                    {
                      label: label("شراء واحتفاظ", "Buy & hold"),
                      points: comparison.benchmark,
                    },
                  ]}
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-start">
                    <thead>
                      <tr>
                        {[
                          label("الاستراتيجية", "Strategy"),
                          label("العائد %", "Return %"),
                          label("أقصى هبوط %", "Drawdown %"),
                          label("الفوز %", "Win %"),
                          label("معامل الربح", "Profit factor"),
                          label("صفقات مغلقة", "Closed trades"),
                        ].map((text) => (
                          <th
                            key={text}
                            className="whitespace-nowrap p-2 text-start text-[10px] app-text-muted"
                          >
                            {text}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.results.map((result) => (
                        <tr
                          key={result.strategyId}
                          className="border-t-2 border-[var(--brutal-border)]"
                        >
                          <td className="p-2">
                            {ar
                              ? STRATEGIES.find(
                                  (s) => s.id === result.strategyId,
                                )!.name
                              : names[result.strategyId]}
                          </td>
                          <td>{number(result.metrics.totalReturnPct)}</td>
                          <td>{number(result.metrics.maxDrawdownPct)}</td>
                          <td>
                            {result.metrics.closedTrades
                              ? number(result.metrics.winRatePct)
                              : "—"}
                          </td>
                          <td>
                            {result.metrics.profitFactor == null
                              ? "—"
                              : number(result.metrics.profitFactor)}
                          </td>
                          <td>{result.metrics.closedTrades}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {comparison.results.map((result) => (
                  <details
                    key={result.strategyId}
                    className="app-soft-panel rounded-xl p-4"
                  >
                    <summary className="cursor-pointer font-bold">
                      {ar
                        ? STRATEGIES.find((s) => s.id === result.strategyId)!
                            .name
                        : names[result.strategyId]}{" "}
                      · {label("سجل الصفقات والأدلة", "Trade log and evidence")}
                    </summary>
                    {result.warnings.map((warning, i) => (
                      <p key={i} className="mt-2 text-amber-600">
                        {warning}
                      </p>
                    ))}
                    <div className="mt-2 max-h-48 overflow-auto">
                      {result.trades.length ? (
                        result.trades.map((trade, i) => (
                          <div
                            key={i}
                            className="border-t-2 border-[var(--brutal-border)] py-3"
                          >
                            {new Date(trade.entryTime * 1000)
                              .toISOString()
                              .slice(0, 10)}{" "}
                            →{" "}
                            {new Date(trade.exitTime * 1000)
                              .toISOString()
                              .slice(0, 10)}{" "}
                            · {number(trade.entryPrice)} →{" "}
                            {number(trade.exitPrice)} · {trade.quantity}{" "}
                            {label("سهم", "shares")} · {number(trade.pnl)} EGP
                            <p className="app-text-muted">{trade.reason}</p>
                          </div>
                        ))
                      ) : (
                        <p>
                          {label("لا توجد صفقات مغلقة", "No closed trades")}
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              </>
            ) : (
              <p>
                {label(
                  "اختر استراتيجية واحدة على الأقل وأدخل تكاليف ورأس مال صالحين.",
                  "Select at least one strategy and enter valid capital and costs.",
                )}
              </p>
            )}
          </>
        )}
        {tool === "trade" && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Numeric
                label={label("الدخول", "Entry")}
                value={entry}
                onChange={setEntry}
                min={0.01}
              />
              <Numeric
                label={label("وقف الخسارة", "Stop loss")}
                value={stop}
                onChange={setStop}
                min={0.01}
              />
              <Numeric
                label={label("الهدف", "Target")}
                value={target}
                onChange={setTarget}
                min={0.01}
              />
              <Numeric
                label={label("رأس المال", "Capital")}
                value={capital}
                onChange={setCapital}
                min={1}
              />
              <Numeric
                label={label("المخاطرة %", "Risk %")}
                value={risk}
                onChange={setRisk}
                min={0.01}
                max={100}
              />
            </div>
            {sizing ? (
              <div className="grid grid-cols-2 gap-3 app-soft-panel rounded-xl p-4">
                <Metric
                  name={label("كمية الأسهم", "Shares")}
                  value={String(sizing.quantity)}
                />
                <Metric
                  name={label("قيمة الصفقة", "Position value")}
                  value={`${number(sizing.positionValue)} EGP`}
                />
                <Metric
                  name={label("الخسارة المحتملة", "Potential loss")}
                  value={`${number(sizing.riskAmount)} EGP`}
                />
                <Metric
                  name={label("الربح المستهدف", "Target reward")}
                  value={`${number(sizing.rewardAmount)} EGP`}
                />
                <Metric
                  name={label("العائد / المخاطرة", "Reward / risk")}
                  value={number(sizing.riskReward)}
                />
              </div>
            ) : (
              <p role="alert" className="text-amber-600">
                {label(
                  "للشراء: الوقف أقل من الدخول والهدف أعلى منه، ورأس المال والمخاطرة موجبان.",
                  "For long trades, stop must be below entry and target above entry; capital and risk must be positive.",
                )}
              </p>
            )}
            <p className="app-text-muted">
              {label(
                "التقدير لا يشمل عمولات التنفيذ والفجوات السعرية. عدّل الأسعار لتحديث الحساب فورًا.",
                "Estimate excludes execution costs and price gaps. Edit levels to recalculate immediately.",
              )}
            </p>
          </>
        )}
        {tool === "scenarios" && (
          <>
            {buildScenarios(candles).map((scenario) => (
              <article
                key={scenario.id}
                className="app-soft-panel rounded-xl p-4"
              >
                <h3 className="font-bold">
                  {ar ? scenario.label : scenario.id}
                </h3>
                {scenario.id === "range" ? (
                  <p>
                    {label("داخل النطاق", "Inside range")}:{" "}
                    {number(scenario.support!)} — {number(scenario.resistance!)}
                  </p>
                ) : (
                  <p>
                    {label(
                      "تفعيل بإغلاق بعد المستوى",
                      "Activation by a close beyond",
                    )}
                    : {number(scenario.trigger!)} ·{" "}
                    {label("إلغاء عند", "Invalidation at")}:{" "}
                    {number(scenario.invalidation!)}
                  </p>
                )}
              </article>
            ))}
            <p className="app-text-muted">
              {label(
                "مستويات آخر 20 شمعة، بدون احتمالات نجاح. راقب الإغلاق والحجم، ولا تعتبر لمس السعر تأكيدًا.",
                "Levels from the last 20 candles, without success probabilities. Check close and volume; a price touch is not confirmation.",
              )}
            </p>
          </>
        )}
        {tool === "valuation" && (
          <>
            <p>
              {label(
                "تقدير يدوي بطريقة ربحية السهم × مضاعف الربحية. أدخل ربحية مؤرخة من قوائم الشركة؛ لا يتم تقديمه كقيمة عادلة محسوبة من بيانات غير متاحة.",
                "Manual EPS × P/E valuation. Enter dated EPS from company statements; this is not an automatic fair value estimate from missing data.",
              )}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Numeric label="EPS" value={eps} onChange={setEps} min={0} />
              <Numeric
                label={label("P/E الأدنى", "Low P/E")}
                value={multipleLow}
                onChange={setMultipleLow}
                min={0}
              />
              <Numeric
                label={label("P/E الأعلى", "High P/E")}
                value={multipleHigh}
                onChange={setMultipleHigh}
                min={0}
              />
            </div>
            <label className="block">
              {label("تاريخ القوائم", "Statement date")}
              <input
                type="date"
                className={input}
                value={valuationDate}
                onChange={(e) => setValuationDate(e.target.value)}
              />
            </label>
            <label className="block">
              {label("مصدر الربحية", "EPS source")}
              <input
                className={input}
                placeholder={label(
                  "اسم القوائم أو رابط الإعلان",
                  "Statement name or announcement link",
                )}
                value={valuationSource}
                onChange={(e) => setValuationSource(e.target.value)}
              />
            </label>
            {valuationFinite &&
            eps > 0 &&
            multipleHigh >= multipleLow &&
            multipleLow > 0 &&
            valuationDate &&
            valuationSource.trim() ? (
              <Metric
                name={label(
                  "نطاق حسب افتراضاتك",
                  "Range under your assumptions",
                )}
                value={`${number(eps * multipleLow)} — ${number(eps * multipleHigh)} EGP`}
              />
            ) : (
              <p className="text-amber-600">
                {label(
                  "أدخل EPS موجبًا ومضاعفات متسقة. هذه الطريقة غير مناسبة للشركات الخاسرة.",
                  "Enter positive EPS and consistent multiples. This method does not apply to loss making companies.",
                )}
              </p>
            )}
          </>
        )}
        {tool === "relative" && (
          <>
            <p>
              {label(
                "قارن تغير السعر على تواريخ مشتركة. أدخل رمز مؤشر أو سهم مرجعي له تاريخ متاح في قاعدة البيانات.",
                "Compare price changes on shared dates. Enter a benchmark symbol with available database history.",
              )}
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setRelativeSymbol(benchmarkSymbol.trim().toUpperCase());
              }}
            >
              <input
                className={input}
                aria-label={label("الرمز المرجعي", "Benchmark symbol")}
                value={benchmarkSymbol}
                onChange={(e) => setBenchmarkSymbol(e.target.value)}
                maxLength={40}
              />
              <button className="app-primary-action rounded-xl px-4 py-2 font-black">
                {label("قارن", "Compare")}
              </button>
            </form>
            {relativeSymbol && (
              <RelativeResult panel={panel} symbol={relativeSymbol} ar={ar} />
            )}
          </>
        )}
        {tool === "events" && (
          <>
            <section className="app-soft-panel space-y-3 rounded-xl p-4">
              <h3 className="font-black">
                {label(
                  "أحداث من المصادر المخزنة",
                  "Events from stored sources",
                )}
              </h3>
              {eventsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : storedEvents.length ? (
                storedEvents.map((event, i) => (
                  <label
                    key={`${event.date}-${i}`}
                    className="flex items-start gap-2 border-b-2 border-[var(--brutal-border)] pb-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(i)}
                      onChange={(e) =>
                        setSelectedEvents((current) =>
                          e.target.checked
                            ? [...current, i]
                            : current.filter((index) => index !== i),
                        )
                      }
                    />
                    <span>
                      {event.date} · {event.title}
                      <br />
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-amber-700 underline dark:text-amber-400"
                      >
                        {event.source || label("المصدر", "Source")}
                      </a>{" "}
                      ·{" "}
                      <span className="app-text-muted">
                        {event.confidence || label("غير مصنف", "Unclassified")}
                      </span>
                    </span>
                  </label>
                ))
              ) : (
                <p className="app-text-muted">
                  {label(
                    "لا توجد أحداث مؤرخة بروابط مصادر متاحة لهذا السهم.",
                    "No dated, linked source events are available for this stock.",
                  )}
                </p>
              )}
              <p className="app-text-muted text-[10px]">
                {eventNote ||
                  label(
                    "راجع الإعلان الأصلي وتاريخه؛ التصنيف المخزن لا يعني التحقق من الحدث.",
                    "Check the original announcement and date; stored classification does not mean verified events.",
                  )}
              </p>
              {candles.length > 0 && selectedEvents.length > 0 && (
                <button
                  className="app-primary-action rounded-xl px-4 py-2.5 text-xs font-black"
                  onClick={() =>
                    apply(
                      selectedEvents.map((i) => ({
                        id: `stored-event-${i}`,
                        label: storedEvents[i].title.slice(0, 200),
                        kind: "time",
                        color: "#f59e0b",
                        points: [
                          {
                            time: Date.parse(storedEvents[i].date) / 1000,
                            value: last,
                          },
                        ],
                      })),
                    )
                  }
                >
                  {label("ارسم الأحداث المختارة", "Draw selected events")}
                </button>
              )}
            </section>
            <h3 className="font-black">
              {label("ملاحظات يدوية لهذه الجلسة", "Manual session notes")}
            </h3>
            <p className="app-text-muted">
              {label(
                "أضف حدثًا من إعلان الشركة مع رابط المصدر؛ الإدخالات اليدوية ملاحظات لهذه الجلسة ولا تظهر كأحداث مؤكدة للمنصة.",
                "Add a company announcement with its source link; manual entries are session notes, not platform verified events.",
              )}
            </p>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const url = new URL(eventSource);
                  if (
                    !["http:", "https:"].includes(url.protocol) ||
                    !eventDate ||
                    !eventLabel.trim()
                  )
                    return;
                  setEvents((current) =>
                    [
                      ...current,
                      {
                        date: eventDate,
                        label: eventLabel.trim(),
                        source: url.href,
                      },
                    ].sort((a, b) => a.date.localeCompare(b.date)),
                  );
                  setEventLabel("");
                } catch {
                  /* native input validation below */
                }
              }}
            >
              <input
                required
                type="date"
                className={input}
                aria-label={label("تاريخ الحدث", "Event date")}
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
              <input
                required
                className={input}
                placeholder={label("اسم الحدث", "Event name")}
                aria-label={label("اسم الحدث", "Event name")}
                value={eventLabel}
                onChange={(e) => setEventLabel(e.target.value)}
                maxLength={120}
              />
              <input
                required
                type="url"
                className={input}
                placeholder="https://"
                aria-label={label("رابط المصدر", "Source link")}
                value={eventSource}
                onChange={(e) => setEventSource(e.target.value)}
              />
              <button className="app-primary-action rounded-xl px-4 py-2.5 text-xs font-black">
                {label("إضافة ملاحظة", "Add note")}
              </button>
            </form>
            {events.map((event, i) => (
              <p key={i}>
                {event.date} · {event.label} ·{" "}
                <a
                  className="font-bold text-amber-700 underline dark:text-amber-400"
                  href={event.source}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {label("المصدر", "Source")}
                </a>
              </p>
            ))}
          </>
        )}
        {candles.length > 0 && tool === "trade" && sizing && (
          <button
            className="app-primary-action rounded-xl px-4 py-2.5 text-xs font-black"
            onClick={() => {
              onUpdate({
                tradeSettings: {
                  entry,
                  stop,
                  target,
                  capital,
                  riskPct: risk,
                },
              });
              apply([
                levelLine(
                  "trade-entry",
                  label("دخول", "Entry"),
                  entry,
                  "#6366f1",
                ),
                levelLine("trade-stop", label("وقف", "Stop"), stop, "#f43f5e"),
                levelLine(
                  "trade-target",
                  label("هدف", "Target"),
                  target,
                  "#10b981",
                ),
              ]);
            }}
          >
            {label("ارسم الصفقة على الشارت", "Draw trade on chart")}
          </button>
        )}
        {candles.length > 0 && tool === "scenarios" && (
          <button
            className="app-primary-action rounded-xl px-4 py-2.5 text-xs font-black"
            onClick={() => {
              const scenarios = buildScenarios(candles);
              const time = candles.at(-1)!.time;
              const cadence =
                candles.length > 1
                  ? Math.max(86400, time - candles.at(-2)!.time)
                  : 86400;
              const support = scenarios[2].support!,
                resistance = scenarios[2].resistance!,
                range = resistance - support;
              apply([
                levelLine(
                  "scenario-support",
                  label("دعم / إلغاء الصاعد", "Support / bullish invalidation"),
                  scenarios[2].support!,
                  "#10b981",
                ),
                levelLine(
                  "scenario-resistance",
                  label(
                    "مقاومة / إلغاء الهابط",
                    "Resistance / bearish invalidation",
                  ),
                  scenarios[2].resistance!,
                  "#f59e0b",
                ),
                {
                  id: "scenario-bull-path",
                  label: label(
                    "مسار صاعد افتراضي، ليس توقعًا",
                    "Illustrative bullish path, not a forecast",
                  ),
                  kind: "line",
                  color: "#10b981",
                  points: [
                    { time, value: last },
                    { time: time + cadence * 3, value: resistance },
                    {
                      time: time + cadence * 6,
                      value: resistance + range * 0.5,
                    },
                  ],
                },
                {
                  id: "scenario-bear-path",
                  label: label(
                    "مسار هابط افتراضي، ليس توقعًا",
                    "Illustrative bearish path, not a forecast",
                  ),
                  kind: "line",
                  color: "#f43f5e",
                  points: [
                    { time, value: last },
                    { time: time + cadence * 3, value: support },
                    {
                      time: time + cadence * 6,
                      value: Math.max(support - range * 0.5, support * 0.5),
                    },
                  ],
                },
                {
                  id: "scenario-range-path",
                  label: label("مسار عرضي افتراضي", "Illustrative range path"),
                  kind: "line",
                  color: "#f59e0b",
                  points: [
                    { time, value: last },
                    {
                      time: time + cadence * 2,
                      value: support + range * 0.75,
                    },
                    {
                      time: time + cadence * 4,
                      value: support + range * 0.25,
                    },
                    {
                      time: time + cadence * 6,
                      value: support + range * 0.5,
                    },
                  ],
                },
              ]);
            }}
          >
            {label("ارسم مستويات السيناريوهات", "Draw scenario levels")}
          </button>
        )}
        {candles.length > 0 &&
          tool === "valuation" &&
          valuationFinite &&
          eps > 0 &&
          multipleLow > 0 &&
          valuationDate &&
          valuationSource.trim() &&
          multipleHigh >= multipleLow && (
            <button
              className="app-primary-action rounded-xl px-4 py-2.5 text-xs font-black"
              onClick={() =>
                apply([
                  {
                    id: "valuation-band",
                    label: label("نطاق تقييم يدوي", "Manual valuation band"),
                    kind: "zone",
                    color: "#a855f7",
                    points: [
                      { time: candles[0].time, value: eps * multipleLow },
                      {
                        time: candles.at(-1)!.time,
                        value: eps * multipleHigh,
                      },
                    ],
                  },
                ])
              }
            >
              {label("ارسم نطاق الافتراضات", "Draw assumption range")}
            </button>
          )}
        {candles.length > 0 && tool === "events" && events.length > 0 && (
          <button
            className="app-primary-action rounded-xl px-4 py-2.5 text-xs font-black"
            onClick={() =>
              apply(
                events.slice(-30).map((event, i) => ({
                  id: `event-${i}`,
                  label: event.label,
                  kind: "time",
                  color: "#f59e0b",
                  points: [
                    {
                      time: Date.parse(`${event.date}T00:00:00Z`) / 1000,
                      value: last,
                    },
                  ],
                })),
              )
            }
          >
            {label("ارسم ملاحظات الأحداث", "Draw event notes")}
          </button>
        )}
        {tool === "fakeout" && (
          <>
            <p className="app-text-muted">
              {label(
                "اختراق نطاق سابق ثم إغلاق داخله؛ إشارة محتملة وليست توقعًا مضمونًا.",
                "Penetration of a prior range followed by a close inside; a potential signal, not a guaranteed forecast.",
              )}
            </p>
            <Numeric
              label={label("فترة النطاق", "Range lookback")}
              value={lookback}
              onChange={setLookback}
              min={2}
              max={200}
            />
            <p>
              {detectFalseBreakouts(candles, lookback).length}{" "}
              {label("إشارات محتملة", "potential signals")}
            </p>
            <button
              className="app-primary-action rounded-xl px-4 py-2.5 text-xs font-black"
              onClick={() =>
                apply(
                  detectFalseBreakouts(candles, lookback)
                    .slice(-30)
                    .map((signal, i) => ({
                      id: `fakeout-${i}`,
                      label: signal.reason,
                      kind: "time",
                      color: signal.side === "buy" ? "#10b981" : "#f43f5e",
                      points: [
                        {
                          time: signal.time,
                          value: candles[signal.index].close,
                        },
                      ],
                    })),
                )
              }
            >
              {label("ارسم آخر 30 إشارة", "Draw latest 30 signals")}
            </button>
          </>
        )}
      </div>
    </LabDialogShell>
  );
}
function Numeric({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] app-text-muted">
      {label}
      <input
        type="number"
        step="any"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? NaN : Number(e.target.value))
        }
        className="app-control rounded-xl p-2.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
      />
    </label>
  );
}
function Metric({ name, value }: { name: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] app-text-muted">{name}</p>
      <p className="mt-1 font-mono text-lg font-bold">{value}</p>
    </div>
  );
}
function EquityChart({
  lines,
}: {
  lines: { label: string; points: EquityPoint[] }[];
}) {
  const all = lines.flatMap((line) => line.points.map((p) => p.value));
  const min = Math.min(...all),
    max = Math.max(...all),
    span = max - min || 1;
  const colors = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#64748b"];
  return (
    <figure className="app-soft-panel rounded-xl p-4">
      <svg
        viewBox="0 0 800 180"
        role="img"
        aria-label="Equity comparison"
        className="h-40 w-full"
      >
        {lines.map((line, i) => (
          <polyline
            key={line.label}
            fill="none"
            stroke={colors[i % colors.length]}
            strokeWidth="2"
            points={line.points
              .map(
                (p, index) =>
                  `${10 + (index / Math.max(line.points.length - 1, 1)) * 780},${170 - ((p.value - min) / span) * 160}`,
              )
              .join(" ")}
          />
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-[10px]">
        {lines.map((line, i) => (
          <span key={line.label} style={{ color: colors[i % colors.length] }}>
            {line.label} · {number(line.points.at(-1)?.value || 0)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
function RelativeResult({
  panel,
  symbol,
  ar,
}: {
  panel: LabPanel;
  symbol: string;
  ar: boolean;
}) {
  const stock = useLabCandles(panel),
    benchmark = useLabCandles({ ...panel, symbol });
  const prices = new Map(benchmark.candles.map((c) => [c.time, c.close]));
  const shared = stock.candles.filter((c) => prices.has(c.time));
  if (stock.loading || benchmark.loading)
    return <Loader2 className="h-4 w-4 animate-spin" />;
  if (stock.error || benchmark.error || shared.length < 2)
    return (
      <p className="text-amber-600">
        {ar
          ? "لا تتوفر بيانات مرجعية متوافقة؛ لم يتم حساب القوة النسبية."
          : "Compatible benchmark history unavailable; relative strength was not calculated."}
      </p>
    );
  const first = shared[0],
    last = shared.at(-1)!;
  const stockReturn = (last.close / first.close - 1) * 100,
    benchmarkReturn =
      (prices.get(last.time)! / prices.get(first.time)! - 1) * 100;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Metric name={panel.symbol} value={`${number(stockReturn)}%`} />
      <Metric name={symbol} value={`${number(benchmarkReturn)}%`} />
      <Metric
        name={ar ? "فرق الأداء (نقاط مئوية)" : "Outperformance (pp)"}
        value={number(stockReturn - benchmarkReturn)}
      />
      <p className="col-span-3 app-text-muted">
        {new Date(first.time * 1000).toISOString().slice(0, 10)} →{" "}
        {new Date(last.time * 1000).toISOString().slice(0, 10)} ·{" "}
        {shared.length}{" "}
        {ar ? "تواريخ مشتركة، عائد سعر فقط" : "shared dates, price return only"}
      </p>
    </div>
  );
}
