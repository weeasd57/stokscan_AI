"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Camera,
  Maximize2,
  Minimize2,
  X,
  Loader2,
  LayoutGrid,
  RefreshCw,
  Layers3,
  Eye,
  EyeOff,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import TradingViewChart from "@/components/TradingViewChartDynamic";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createWorkspace,
  parseWorkspace,
  setWorkspaceLayout,
  type LabWorkspace,
  type LabPanel,
} from "./workspace-state";
import LabTools from "./LabTools";
import PanelSymbolSearch from "./PanelSymbolSearch";

interface Props {
  symbol: string;
  exchange: string;
  theme: "dark" | "light";
  activeTool: string;
  focusTimestamp?: number;
  focusRequestId?: number;
  onToolDrawComplete: () => void;
}
export default function StrategyWorkspace(props: Props) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const ar = language === "ar";
  const [workspace, setWorkspace] = useState<LabWorkspace>(() =>
    createWorkspace(props.symbol, props.exchange),
  );
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "local" | "cloud" | "saving" | "error"
  >("local");
  const [tool, setTool] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState("");
  const [serverResults, setServerResults] = useState<
    Record<
      string,
      {
        analysisById?: Record<
          string,
          import("@/lib/strategy-lab").StrategyAnalysis
        >;
        comparison?: ReturnType<
          typeof import("@/lib/strategy-lab").compareStrategies
        >;
        data_note?: string;
        origin?: "ai" | "local";
        assumptions?: {
          initialCapital?: number;
          commissionBps?: number;
          slippageBps?: number;
          params?: import("@/lib/strategy-lab").StrategyParams;
          timeframe?: string;
          bar_limit?: number;
          start_date?: string;
          end_date?: string;
        };
      }
    >
  >({});
  const containers = useRef(new Map<string, HTMLDivElement>());
  const previousRoute = useRef(`${props.symbol}:${props.exchange}`);
  const latestRoute = useRef({
    symbol: props.symbol,
    exchange: props.exchange,
  });
  latestRoute.current = { symbol: props.symbol, exchange: props.exchange };
  const stateRef = useRef(workspace);
  stateRef.current = workspace;
  const storageKey = `stokscan:strategy-workspace:v1:${user?.id || "guest"}`;

  useEffect(() => {
    const controller = new AbortController();
    setHydrated(false);
    setServerResults({});
    setSaveStatus("local");
    const fallback = createWorkspace(props.symbol, props.exchange);
    let local = fallback;
    try {
      local =
        parseWorkspace(
          JSON.parse(localStorage.getItem(storageKey) || "null"),
        ) || fallback;
    } catch {
      /* unavailable browser storage */
    }
    setWorkspace(local);
    if (!user) {
      setHydrated(true);
      return () => controller.abort();
    }
    fetch("/api/chart-workspace", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("storage unavailable");
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          const loaded = parseWorkspace(data.workspace) || local;
          const route = latestRoute.current;
          if (
            route.symbol !== props.symbol ||
            route.exchange !== props.exchange
          )
            loaded.panels = loaded.panels.map((panel) =>
              panel.id === loaded.activePanelId
                ? {
                    ...panel,
                    ...route,
                    drawings: [],
                    toolOverlays: [],
                    tradeSettings: undefined,
                  }
                : panel,
            );
          setWorkspace(loaded);
          setSaveStatus("cloud");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSaveStatus("local");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHydrated(true);
      });
    return () => controller.abort();
    // Route changes update the active panel below; identity changes load isolated storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, user?.id]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(workspace));
      } catch {
        setSaveStatus("error");
      }
      if (!user || saveStatus === "local") return;
      setSaveStatus("saving");
      fetch("/api/chart-workspace", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace }),
        signal: controller.signal,
      })
        .then((response) => {
          if (!controller.signal.aborted)
            setSaveStatus(response.ok ? "cloud" : "local");
        })
        .catch(() => {
          if (!controller.signal.aborted) setSaveStatus("local");
        });
    }, 800);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
    // Save status is output, not a reason to save the same settings again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, storageKey, hydrated, user?.id]);

  useEffect(() => {
    const route = `${props.symbol}:${props.exchange}`;
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    setServerResults({});
    setWorkspace((current) => ({
      ...current,
      panels: current.panels.map((panel) =>
        panel.id === current.activePanelId
          ? {
              ...panel,
              symbol: props.symbol,
              exchange: props.exchange,
              drawings: [],
              toolOverlays: [],
              tradeSettings: undefined,
            }
          : panel,
      ),
    }));
  }, [props.symbol, props.exchange]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("strategy-lab-context", {
        detail: {
          active_chart_id: workspace.activePanelId,
          charts: workspace.panels.slice(0, workspace.layout).map((panel) => ({
            id: panel.id,
            symbol: panel.symbol,
            timeframe: panel.timeframe.toLowerCase(),
            period: panel.period,
            strategy_ids: panel.strategyIds,
          })),
        },
      }),
    );
  }, [workspace]);
  useEffect(() => {
    const receive = (event: Event) => {
      const action = (event as CustomEvent).detail;
      const current = stateRef.current;
      const panel = current.panels
        .slice(0, current.layout)
        .find((row) => row.id === (action?.chart_id || current.activePanelId));
      if (
        !panel ||
        panel.symbol.toUpperCase() !== String(action.symbol).toUpperCase()
      )
        return;
      const timeframe: LabPanel["timeframe"] = "1D";
      const changedFrame = false;
      setServerResults((results) => ({
        ...results,
        [panel.id]: {
          ...(changedFrame ? {} : results[panel.id]),
          ...action.result,
          origin: "ai",
          analysisById: {
            ...(changedFrame ? {} : results[panel.id]?.analysisById),
            ...(Array.isArray(action.result?.comparison?.analyses)
              ? Object.fromEntries(
                  action.result.comparison.analyses.map(
                    (
                      analysis: import("@/lib/strategy-lab").StrategyAnalysis,
                    ) => [analysis.strategyId, analysis],
                  ),
                )
              : {}),
            ...(action.result?.analysis
              ? { [action.result.analysis.strategyId]: action.result.analysis }
              : {}),
          },
        },
      }));
      if (
        action.type === "apply_strategy" &&
        STRATEGIES.some((s) => s.id === action.result?.analysis?.strategyId)
      ) {
        setWorkspace((state) => ({
          ...state,
          activePanelId: panel.id,
          panels: state.panels.map((row) =>
            row.id === panel.id
              ? {
                  ...row,
                  timeframe,
                  strategyIds: [
                    ...new Set<string>([
                      ...row.strategyIds,
                      action.result.analysis.strategyId,
                    ]),
                  ],
                }
              : row,
          ),
        }));
      }
      if (
        action.type === "compare_strategies" &&
        Array.isArray(action.result?.comparison?.results)
      ) {
        const ids = (
          action.result.comparison.analyses || action.result.comparison.results
        )
          .map((row: { strategyId: string }) => row.strategyId)
          .filter((id: string) => STRATEGIES.some((s) => s.id === id));
        setWorkspace((state) => ({
          ...state,
          activePanelId: panel.id,
          panels: state.panels.map((row) =>
            row.id === panel.id ? { ...row, timeframe, strategyIds: ids } : row,
          ),
        }));
        setTool("compare");
      }
    };
    window.addEventListener("strategy-lab-result", receive);
    return () => {
      window.removeEventListener("strategy-lab-result", receive);
      window.dispatchEvent(
        new CustomEvent("strategy-lab-context", { detail: null }),
      );
    };
  }, []);

  const emitChartContext = useCallback(() => {
    if (typeof window === "undefined") return;
    const chartContext = {
      active_chart_id: workspace.activePanelId,
      charts: workspace.panels.slice(0, workspace.layout).map((p) => ({
        id: p.id,
        symbol: p.symbol,
        timeframe: "1d" as const,
        period: p.period || 500,
        strategy_ids: p.strategyIds,
      })),
    };
    window.dispatchEvent(
      new CustomEvent("strategy-lab-context", { detail: chartContext }),
    );
  }, [workspace]);

  useEffect(() => {
    emitChartContext();
  }, [emitChartContext]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const updatePanel = useCallback((id: string, patch: Partial<LabPanel>) => {
    if (patch.symbol || patch.timeframe || patch.period)
      setServerResults((results) => {
        const next = { ...results };
        delete next[id];
        return next;
      });
    else if (patch.strategyIds)
      setServerResults((results) => {
        const previous = results[id];
        if (!previous) return results;
        return {
          ...results,
          [id]: {
            ...previous,
            comparison: undefined,
            analysisById: Object.fromEntries(
              Object.entries(previous.analysisById || {}).filter(
                ([strategyId]) => patch.strategyIds!.includes(strategyId),
              ),
            ),
          },
        };
      });
    setWorkspace((current) => ({
      ...current,
      panels: current.panels.map((panel) =>
        panel.id === id
          ? {
              ...panel,
              ...(patch.symbol && patch.symbol !== panel.symbol
                ? { drawings: [], toolOverlays: [] }
                : {}),
              ...patch,
            }
          : panel,
      ),
    }));
  }, []);
  const active =
    workspace.panels.find((panel) => panel.id === workspace.activePanelId) ||
    workspace.panels[0];
  const capture = async (id: string) => {
    const node = containers.current.get(id);
    if (!node) return;
    setCaptureError("");
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: props.theme === "dark" ? "#050816" : "#ffffff",
      });
      const anchor = document.createElement("a");
      anchor.download = `${active.symbol}-chart.png`;
      anchor.href = url;
      anchor.click();
    } catch {
      setCaptureError(
        ar
          ? "تعذر حفظ الصورة، حاول مرة أخرى."
          : "Could not save image. Try again.",
      );
    }
  };
  const toolLabels = [
    { id: "strategies", ar: "الاستراتيجيات", en: "Strategies" },
    { id: "compare", ar: "المقارنة", en: "Compare" },
    { id: "scenarios", ar: "السيناريوهات", en: "Scenarios" },
    { id: "trade", ar: "إدارة الصفقة", en: "Trade sizing" },
    { id: "fakeout", ar: "اختراق كاذب", en: "False breakout" },
    { id: "relative", ar: "القوة النسبية", en: "Relative strength" },
    { id: "events", ar: "الأحداث", en: "Events" },
    { id: "valuation", ar: "القيمة العادلة", en: "Valuation" },
  ];
  if (!hydrated)
    return (
      <div
        className="flex h-full items-center justify-center gap-2 text-xs"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {ar ? "تحميل مساحة العمل" : "Loading workspace"}
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col" dir={ar ? "rtl" : "ltr"}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-white/10">
        <LayoutGrid className="h-4 w-4 text-indigo-500" />
        <span className="text-xs font-bold">
          {ar ? "معمل استراتيجيات AI" : "AI strategy lab"}
        </span>
        <div
          className="flex gap-1"
          aria-label={ar ? "تقسيم الشاشة" : "Chart layout"}
        >
          {([1, 2, 3, 4, 6, 8] as const).map((count) => (
            <button
              key={count}
              aria-pressed={workspace.layout === count}
              onClick={() =>
                setWorkspace((current) => setWorkspaceLayout(current, count))
              }
              className={`rounded px-2 py-1 text-xs ${workspace.layout === count ? "app-primary-action" : "app-chip"}`}
            >
              {count}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[10px]">
          <input
            type="checkbox"
            checked={workspace.syncTime}
            onChange={(e) =>
              setWorkspace((current) => ({
                ...current,
                syncTime: e.target.checked,
              }))
            }
          />
          {ar ? "مزامنة الفترة" : "Sync period"}
        </label>
        <span className="ms-auto text-[10px] text-zinc-500" role="status">
          {saveStatus === "cloud"
            ? ar
              ? "محفوظ بحسابك"
              : "Saved to account"
            : saveStatus === "saving"
              ? ar
                ? "جارٍ الحفظ"
                : "Saving"
              : saveStatus === "error"
                ? ar
                  ? "تعذر الحفظ"
                  : "Save unavailable"
                : ar
                  ? "حفظ على هذا الجهاز"
                  : "Saved on this device"}
        </span>
      </header>
      {workspace.layout > 1 && (
        <nav
          className="flex gap-1 overflow-x-auto p-1 md:hidden"
          aria-label={ar ? "الشارت النشط" : "Active chart"}
        >
          {workspace.panels.slice(0, workspace.layout).map((panel, i) => (
            <button
              key={panel.id}
              onClick={() =>
                setWorkspace((current) => ({
                  ...current,
                  activePanelId: panel.id,
                }))
              }
              className={`rounded px-3 py-1 text-xs ${panel.id === active.id ? "app-primary-action" : "app-chip"}`}
            >
              {i + 1} · {panel.symbol}
            </button>
          ))}
        </nav>
      )}
      <div
        className={`grid flex-1 min-h-0 gap-1 p-1 ${workspace.layout === 8 ? "md:grid-cols-4" : workspace.layout === 6 ? "md:grid-cols-3" : workspace.layout > 1 ? "md:grid-cols-2" : "grid-cols-1"} ${workspace.layout > 2 ? "md:grid-rows-2" : "grid-rows-1"}`}
      >
        {workspace.panels.slice(0, workspace.layout).map((panel, index) => (
          <div
            key={panel.id}
            ref={(node) => {
              if (node) containers.current.set(panel.id, node);
              else containers.current.delete(panel.id);
            }}
            onPointerDown={() =>
              setWorkspace((current) =>
                current.activePanelId === panel.id
                  ? current
                  : { ...current, activePanelId: panel.id },
              )
            }
            onFocus={() =>
              setWorkspace((current) =>
                current.activePanelId === panel.id
                  ? current
                  : { ...current, activePanelId: panel.id },
              )
            }
            className={`${fullscreen === panel.id ? "fixed inset-0 z-[100]" : "relative min-h-0"} ${panel.id !== active.id ? "hidden md:flex" : "flex"} group flex-col overflow-hidden rounded-lg border ${panel.id === active.id ? "border-indigo-500" : "border-zinc-200 dark:border-white/10"} bg-[var(--app-surface-strong)]`}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-2 py-1 dark:border-white/10">
              <span className="text-[10px] text-zinc-500">{index + 1}</span>
              <PanelSymbolSearch
                symbol={panel.symbol}
                index={index}
                ar={ar}
                onSelect={(symbol) => updatePanel(panel.id, { symbol })}
              />
              <span className="ms-auto truncate text-[10px] text-zinc-500">
                {panel.exchange} · {ar ? "بيانات يومية" : "Daily data"}
              </span>
              {fullscreen === panel.id && (
                <button
                  className="app-icon-button rounded-xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                  aria-label={ar ? "إنهاء ملء الشاشة" : "Exit fullscreen"}
                  onClick={() => setFullscreen(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {layersOpen !== panel.id &&
              (panel.strategyIds.length > 0 ||
                !!panel.toolOverlays?.length ||
                !!panel.drawings?.length) && (
                <ChartAdditions
                  compact
                  panel={panel}
                  ar={ar}
                  onClose={() => {}}
                  onUpdate={(patch) => updatePanel(panel.id, patch)}
                />
              )}
            <LabPanelChart
              panel={panel}
              theme={props.theme}
              activeTool={panel.id === active.id ? props.activeTool : "cursor"}
              onToolDrawComplete={props.onToolDrawComplete}
              focusTimestamp={
                panel.id === active.id || workspace.syncTime
                  ? props.focusTimestamp
                  : undefined
              }
              focusRequestId={props.focusRequestId}
              sync={workspace.syncTime}
              updatePanel={updatePanel}
              serverAnalyses={serverResults[panel.id]?.analysisById}
              compact={workspace.layout > 1}
            />
            <div
              className={`absolute z-30 transition-all duration-200 end-3 flex items-center gap-1.5 ${
                panel.toolbarHidden ? "bottom-2" : "bottom-[44px]"
              }`}
            >
              {panel.toolbarHidden && (
                <button
                  className="app-icon-button rounded-xl p-2 shadow-md"
                  aria-label={ar ? "الإضافات" : "Chart additions"}
                  onClick={() => setLayersOpen(panel.id)}
                >
                  <Layers3 className="h-4 w-4" />
                </button>
              )}
              <button
                className="app-primary-action flex items-center gap-1 rounded-t-xl rounded-b-lg px-2.5 py-1 text-[10px] font-black shadow-md border border-[var(--brutal-border)]"
                aria-label={
                  panel.toolbarHidden
                    ? ar
                      ? "إظهار الأدوات"
                      : "Show tools"
                    : ar
                      ? "إخفاء الأدوات"
                      : "Hide tools"
                }
                onClick={() =>
                  updatePanel(panel.id, { toolbarHidden: !panel.toolbarHidden })
                }
              >
                {panel.toolbarHidden ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    <span>{ar ? "إظهار الأدوات" : "Show tools"}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    <span>{ar ? "إخفاء الأدوات" : "Hide tools"}</span>
                  </>
                )}
              </button>
            </div>
            {!panel.toolbarHidden && (
              <footer
                style={{
                  background: "var(--brutal-bg-card)",
                  backdropFilter: "none",
                }}
                className={`app-panel-strong !transform-none shrink-0 border-t border-zinc-200 dark:border-white/10 z-20 flex items-center gap-2 overflow-x-auto p-2 ${panel.id === active.id ? "opacity-100" : "opacity-80 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"}`}
              >
                <button
                  className="app-icon-button shrink-0 rounded-lg p-1.5"
                  aria-label={ar ? "الإضافات" : "Chart additions"}
                  onClick={() => setLayersOpen(panel.id)}
                >
                  <Layers3 className="h-4 w-4" />
                </button>
                {toolLabels.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setWorkspace((current) => ({
                        ...current,
                        activePanelId: panel.id,
                      }));
                      setTool(item.id);
                    }}
                    className="app-chip shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold"
                  >
                    {ar ? item.ar : item.en}
                  </button>
                ))}
                <button
                  aria-label={ar ? "تحليل AI" : "AI analysis"}
                  onClick={() => {
                    emitChartContext();
                    window.dispatchEvent(
                      new CustomEvent("open-chat-with-message", {
                        detail: ar
                          ? `حلل سهم ${panel.symbol} في الشارت ${panel.id} باستخدام استراتيجيات معمل التحليل (مثل وايكوف أو SMC أو البرايس أكشن) واشرح الأدلة ومستويات الدعم والمقاومة والنتائج الفنية`
                          : `Analyze ${panel.symbol} in chart ${panel.id} using strategy lab tools (such as Wyckoff, SMC, or Price Action); explain evidence, levels, and technical results`,
                      }),
                    );
                  }}
                  className="app-icon-button shrink-0 rounded-lg p-1.5"
                >
                  <BrainCircuit className="h-4 w-4" />
                </button>
                <button
                  aria-label={ar ? "حفظ الصورة" : "Save image"}
                  onClick={() => void capture(panel.id)}
                  className="app-icon-button shrink-0 rounded-lg p-1.5"
                >
                  <Camera className="h-4 w-4" />
                </button>
                <button
                  aria-label={
                    fullscreen === panel.id
                      ? ar
                        ? "إنهاء ملء الشاشة"
                        : "Exit fullscreen"
                      : ar
                        ? "ملء الشاشة"
                        : "Fullscreen"
                  }
                  onClick={() =>
                    setFullscreen((current) =>
                      current === panel.id ? null : panel.id,
                    )
                  }
                  className="app-icon-button shrink-0 rounded-lg p-1.5"
                >
                  {fullscreen === panel.id ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </button>
              </footer>
            )}
            {layersOpen === panel.id && (
              <ChartAdditions
                panel={panel}
                ar={ar}
                onClose={() => setLayersOpen(null)}
                onUpdate={(patch) => updatePanel(panel.id, patch)}
              />
            )}
          </div>
        ))}
      </div>
      {captureError && (
        <p className="text-xs text-red-500" role="alert">
          {captureError}
        </p>
      )}
      {serverResults[active.id]?.data_note && (
        <p className="app-text-muted px-3 py-1 text-[10px]" role="status">
          {serverResults[active.id].data_note}
        </p>
      )}
      {tool && (
        <LabTools
          key={`${active.id}:${tool}`}
          panel={active}
          tool={tool}
          ar={ar}
          onClose={() => setTool(null)}
          onUpdate={(patch) => updatePanel(active.id, patch)}
          onInvalidateComparison={() =>
            setServerResults((results) => {
              const previous = results[active.id];
              if (!previous?.comparison) return results;
              const comparedIds = new Set(
                previous.comparison.analyses.map(
                  (analysis) => analysis.strategyId,
                ),
              );
              return {
                ...results,
                [active.id]: {
                  ...previous,
                  comparison: undefined,
                  assumptions: undefined,
                  data_note: undefined,
                  analysisById: Object.fromEntries(
                    Object.entries(previous.analysisById || {}).filter(
                      ([id]) => !comparedIds.has(id as StrategyId),
                    ),
                  ),
                },
              };
            })
          }
          onApplyComparison={(comparison) =>
            setServerResults((results) => ({
              ...results,
              [active.id]: {
                ...results[active.id],
                comparison,
                origin: "local",
                assumptions: undefined,
                data_note: undefined,
                analysisById: {
                  ...Object.fromEntries(
                    Object.entries(
                      results[active.id]?.analysisById || {},
                    ).filter(
                      ([id]) =>
                        !(results[active.id]?.comparison?.analyses || []).some(
                          (analysis) => analysis.strategyId === id,
                        ),
                    ),
                  ),
                  ...Object.fromEntries(
                    comparison.analyses.map((analysis) => [
                      analysis.strategyId,
                      analysis,
                    ]),
                  ),
                },
              },
            }))
          }
          serverComparison={serverResults[active.id]?.comparison}
          dataNote={serverResults[active.id]?.data_note}
          serverAssumptions={serverResults[active.id]?.assumptions}
          serverOrigin={serverResults[active.id]?.origin}
        />
      )}
    </div>
  );
}

function ChartAdditions({
  panel,
  ar,
  onClose,
  onUpdate,
  compact = false,
}: {
  panel: LabPanel;
  ar: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<LabPanel>) => void;
  compact?: boolean;
}) {
  useEffect(() => {
    if (compact) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, compact]);
  const deleteOverlay = (id: string) => {
    const deletingTrade =
      id.startsWith("trade-") ||
      panel.toolOverlays?.find((item) => item.id === id)?.group === "trade";
    const removed = new Set(
      (panel.toolOverlays || [])
        .filter((item) =>
          deletingTrade
            ? item.id.startsWith("trade-") || item.group === "trade"
            : item.id === id,
        )
        .map((item) => item.id),
    );
    onUpdate({
      toolOverlays: panel.toolOverlays?.filter((item) => !removed.has(item.id)),
      hiddenOverlayIds: panel.hiddenOverlayIds?.filter(
        (value) => !removed.has(value),
      ),
      ...(deletingTrade ? { tradeSettings: undefined } : {}),
    });
  };
  const toggle = (
    key: "hiddenStrategyIds" | "hiddenOverlayIds" | "hiddenDrawingIds",
    id: string,
  ) => {
    const ids = panel[key] || [];
    onUpdate({
      [key]: ids.includes(id)
        ? ids.filter((value) => value !== id)
        : [...ids, id],
    });
  };
  const headings = {
    strategies: ar ? "الاستراتيجيات" : "Strategies",
    overlays: ar ? "إضافات الأدوات" : "Tool additions",
    drawings: ar ? "الرسومات اليدوية" : "Manual drawings",
  };
  const overlayGroups: Record<string, string> = ar
    ? {
        trade: "إدارة الصفقة",
        scenarios: "السيناريوهات",
        valuation: "التقييم",
        events: "الأحداث",
        fakeout: "اختراق كاذب",
        compare: "المقارنة",
      }
    : {
        trade: "Trade sizing",
        scenarios: "Scenarios",
        valuation: "Valuation",
        events: "Events",
        fakeout: "False breakouts",
        compare: "Comparison",
      };
  const sortedOverlays = [...(panel.toolOverlays || [])].sort((a, b) =>
    String(a.group || "").localeCompare(String(b.group || "")),
  );
  const englishNames: Record<string, string> = {
    wyckoff: "Wyckoff",
    smc: "SMC",
    harmonic: "Harmonic",
    gann: "Gann",
    time_cycles: "Time cycles",
    elliott: "Elliott",
    volume_profile: "Volume Profile",
    price_action: "Price action",
    trend_macd: "Trend / MACD",
    fibonacci_time: "Fibonacci time",
  };
  const drawingNames: Record<string, string> = ar
    ? {
        horizontal: "خط أفقي",
        trend: "خط اتجاه",
        rectangle: "منطقة",
        fib: "فيبوناتشي",
        ray: "شعاع",
        extendedLine: "خط ممتد",
        text: "نص",
      }
    : {
        horizontal: "Horizontal line",
        trend: "Trend line",
        rectangle: "Zone",
        fib: "Fibonacci",
        ray: "Ray",
        extendedLine: "Extended line",
        text: "Text",
      };
  return (
    <section
      role="region"
      aria-label={
        compact
          ? ar
            ? "العناصر المطبقة"
            : "Applied chart items"
          : ar
            ? "إضافات الشارت"
            : "Chart additions list"
      }
      className={
        compact
          ? "shrink-0 overflow-x-auto border-b-2 border-[var(--brutal-border)]"
          : "app-panel-strong !transform-none absolute end-2 top-12 bottom-16 z-30 flex w-[min(320px,calc(100%-1rem))] flex-col overflow-hidden rounded-xl"
      }
      style={{ background: "var(--brutal-bg-card)" }}
    >
      {!compact && (
        <header className="flex items-center gap-2 border-b-2 border-[var(--brutal-border)] p-3">
          <Layers3 className="h-4 w-4" />
          <h3 className="text-xs font-black">
            {ar ? "إضافات الشارت" : "Chart additions"}
          </h3>
          <button
            aria-label={ar ? "إغلاق الإضافات" : "Close additions"}
            className="app-icon-button ms-auto rounded-lg p-1.5"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </button>
        </header>
      )}
      <div
        className={
          compact
            ? "flex min-w-max items-center gap-2 px-2 py-1 [&>div]:flex [&>div]:items-center [&>div]:gap-2 [&_h4]:hidden [&_h5]:hidden [&_.mb-2]:mb-0"
            : "min-h-0 space-y-4 overflow-y-auto p-3"
        }
      >
        {!panel.strategyIds.length &&
          !panel.toolOverlays?.length &&
          !panel.drawings?.length && (
            <p className="app-text-muted text-xs">
              {ar
                ? "أضف استراتيجية أو رسمًا لتظهر عناصره هنا."
                : "Add a strategy or drawing to see its layers here."}
            </p>
          )}
        {panel.strategyIds.length > 0 && (
          <div>
            <h4 className="app-text-muted mb-2 text-[10px] font-black">
              {headings.strategies}
            </h4>
            {panel.strategyIds.map((id) => {
              const name = ar
                ? STRATEGIES.find((strategy) => strategy.id === id)?.name || id
                : englishNames[id] || id;
              return (
                <AdditionRow
                  key={id}
                  name={name}
                  ar={ar}
                  hidden={!!panel.hiddenStrategyIds?.includes(id)}
                  onToggle={() => toggle("hiddenStrategyIds", id)}
                  onDelete={() =>
                    onUpdate({
                      strategyIds: panel.strategyIds.filter(
                        (value) => value !== id,
                      ),
                      hiddenStrategyIds: panel.hiddenStrategyIds?.filter(
                        (value) => value !== id,
                      ),
                    })
                  }
                />
              );
            })}
          </div>
        )}
        {panel.toolOverlays?.length ? (
          <div>
            <h4 className="app-text-muted mb-2 text-[10px] font-black">
              {headings.overlays}
            </h4>
            {sortedOverlays.map((overlay, index) => (
              <div key={overlay.id}>
                {overlay.group &&
                  sortedOverlays[index - 1]?.group !== overlay.group && (
                    <h5 className="app-text-muted mb-2 text-[10px] font-bold">
                      {overlayGroups[overlay.group] || overlay.group}
                    </h5>
                  )}
                <AdditionRow
                  key={overlay.id}
                  name={overlay.label || overlay.id}
                  ar={ar}
                  hidden={!!panel.hiddenOverlayIds?.includes(overlay.id)}
                  onToggle={() => toggle("hiddenOverlayIds", overlay.id)}
                  onDelete={() => deleteOverlay(overlay.id)}
                />
              </div>
            ))}
          </div>
        ) : null}
        {panel.drawings?.length ? (
          <div>
            <h4 className="app-text-muted mb-2 text-[10px] font-black">
              {headings.drawings}
            </h4>
            {panel.drawings.map((drawing, i) => (
              <AdditionRow
                key={drawing.id}
                name={
                  drawing.style.label ||
                  (drawing.type === "text"
                    ? drawing.text
                    : `${drawingNames[drawing.type]} ${i + 1}`)
                }
                ar={ar}
                hidden={!!panel.hiddenDrawingIds?.includes(drawing.id)}
                onToggle={() => toggle("hiddenDrawingIds", drawing.id)}
                onDelete={() =>
                  onUpdate({
                    drawings: panel.drawings?.filter(
                      (value) => value.id !== drawing.id,
                    ),
                    hiddenDrawingIds: panel.hiddenDrawingIds?.filter(
                      (value) => value !== drawing.id,
                    ),
                  })
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
function AdditionRow({
  name,
  ar,
  hidden,
  onToggle,
  onDelete,
}: {
  name: string;
  ar: boolean;
  hidden: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border-2 border-[var(--brutal-border)] p-2">
      <span
        className={`min-w-0 flex-1 break-words text-[10px] font-semibold ${hidden ? "app-text-muted line-through" : "app-text-primary"}`}
      >
        {name}
      </span>
      <button
        aria-label={`${hidden ? (ar ? "إظهار" : "Show") : ar ? "إخفاء" : "Hide"} ${name}`}
        aria-pressed={!hidden}
        onClick={onToggle}
        className="app-icon-button shrink-0 rounded-lg p-1.5"
      >
        {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        aria-label={`${ar ? "حذف" : "Delete"} ${name}`}
        onClick={onDelete}
        className="app-icon-button shrink-0 rounded-lg p-1.5"
      >
        <Trash2 className="h-3 w-3 text-red-500" />
      </button>
    </div>
  );
}

// Shared candles are loaded once per symbol; all panels use the same bounded daily snapshot.
import {
  type Candle,
  type Overlay,
  type StrategyId,
  STRATEGIES,
  analyzeStrategy,
  aggregateCandles,
  normalizeCandles,
  calculateTradeSizing,
} from "@/lib/strategy-lab";
const snapshots = new Map<string, Promise<Candle[]>>();
function loadCandles(symbol: string, exchange: string): Promise<Candle[]> {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const key = `${day}:${exchange}:${symbol}`;
  const previous = snapshots.get(key);
  if (previous) return previous;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const promise = fetch(
    `/api/ai_bot/candles?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}&limit=5000&all=true&include_markers=false`,
    { signal: controller.signal },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("Could not load daily history");
      const data = await response.json();
      if (!Array.isArray(data.candles))
        throw new Error("Invalid candle response");
      return normalizeCandles(data.candles);
    })
    .finally(() => clearTimeout(timer));
  snapshots.set(key, promise);
  promise.catch(() => snapshots.delete(key));
  if (snapshots.size > 16) snapshots.delete(snapshots.keys().next().value!);
  return promise;
}
export function useLabCandles(panel: LabPanel) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setCandles([]);
    loadCandles(panel.symbol, panel.exchange)
      .then((data) => {
        if (live) setCandles(data);
      })
      .catch(() => {
        if (live) setError("history");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [panel.symbol, panel.exchange, revision]);
  const selected = useMemo(
    () => aggregateCandles(candles, "daily"),
    [candles],
  );
  return {
    candles: selected,
    error,
    loading,
    retry: () => setRevision((n) => n + 1),
  };
}
function LabPanelChart(
  props: Pick<
    Props,
    | "theme"
    | "activeTool"
    | "onToolDrawComplete"
    | "focusTimestamp"
    | "focusRequestId"
  > & {
    panel: LabPanel;
    sync: boolean;
    updatePanel: (id: string, patch: Partial<LabPanel>) => void;
    serverAnalyses?: Record<
      string,
      import("@/lib/strategy-lab").StrategyAnalysis
    >;
    compact: boolean;
  },
) {
  const { candles, loading, error, retry } = useLabCandles(props.panel);
  const { language } = useLanguage();
  const { user } = useAuth();
  const onDrawingsChange = useCallback(
    (drawings: import("@/components/TradingViewChart").ChartDrawing[]) =>
      props.updatePanel(props.panel.id, { drawings }),
    [props.updatePanel, props.panel.id],
  );
  const onStrategyLevelChange = useCallback(
    (id: string, value: number) => {
      const field =
        id === "trade-entry"
          ? "entry"
          : id === "trade-stop"
            ? "stop"
            : id === "trade-target"
              ? "target"
              : null;
      if (!field || !props.panel.tradeSettings) return;
      const tradeSettings = { ...props.panel.tradeSettings, [field]: value };
      try {
        calculateTradeSizing(
          tradeSettings.entry,
          tradeSettings.stop,
          tradeSettings.target,
          tradeSettings.capital,
          tradeSettings.riskPct,
        );
      } catch {
        return;
      }
      props.updatePanel(props.panel.id, {
        tradeSettings,
        toolOverlays: props.panel.toolOverlays?.map((overlay) =>
          overlay.id === id
            ? {
                ...overlay,
                points: overlay.points.map((point) => ({ ...point, value })),
              }
            : overlay,
        ),
      });
    },
    [
      props.panel.tradeSettings,
      props.panel.toolOverlays,
      props.panel.id,
      props.updatePanel,
    ],
  );
  const trade = useMemo(() => {
    const settings = props.panel.tradeSettings;
    if (!settings) return null;
    try {
      return calculateTradeSizing(
        settings.entry,
        settings.stop,
        settings.target,
        settings.capital,
        settings.riskPct,
      );
    } catch {
      return null;
    }
  }, [props.panel.tradeSettings]);
  const analyses = useMemo(
    () =>
      candles.length
        ? props.panel.strategyIds
            .filter((id) => !props.panel.hiddenStrategyIds?.includes(id))
            .flatMap((id) => {
              try {
                if (props.serverAnalyses?.[id])
                  return [props.serverAnalyses[id]];
                return [analyzeStrategy(candles, id as StrategyId)];
              } catch {
                return [];
              }
            })
        : [],
    [
      candles,
      props.panel.strategyIds,
      props.panel.hiddenStrategyIds,
      props.serverAnalyses,
    ],
  );
  const overlays: Overlay[] = useMemo(
    () => [
      ...analyses.flatMap((analysis) => analysis.overlays),
      ...(props.panel.toolOverlays || []).filter(
        (overlay) => !props.panel.hiddenOverlayIds?.includes(overlay.id),
      ),
    ],
    [analyses, props.panel.toolOverlays, props.panel.hiddenOverlayIds],
  );
  const markers = useMemo(
    () =>
      analyses.flatMap((analysis) =>
        analysis.signals.map((signal) => ({
          time: signal.time,
          position:
            signal.side === "buy"
              ? ("belowBar" as const)
              : ("aboveBar" as const),
          color: signal.side === "buy" ? "#10b981" : "#f43f5e",
          shape:
            signal.side === "buy"
              ? ("arrowUp" as const)
              : ("arrowDown" as const),
          text: `${analysis.strategyId}: ${signal.side}`,
        })),
      ),
    [analyses],
  );
  if (loading)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
      </div>
    );
  if (error || !candles.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs">
        <p>
          {language === "ar"
            ? "تعذر تحميل تاريخ السهم"
            : "Could not load stock history"}
        </p>
        <button onClick={retry} className="flex items-center gap-1">
          <RefreshCw className="h-3 w-3" />
          {language === "ar" ? "إعادة المحاولة" : "Retry"}
        </button>
      </div>
    );
  return (
    <div className="flex-1 min-h-0 relative">
      <TradingViewChart
        symbol={props.panel.symbol}
        exchange={props.panel.exchange}
        theme={props.theme}
        activeTool={props.activeTool}
        onToolDrawComplete={props.onToolDrawComplete}
        externalCandles={candles}
        externalTimeframe={"1d"}
        strategyOverlays={overlays}
        compact={props.compact}
        hideIndicators={props.compact}
        customMarkers={markers}
        focusTimestamp={props.focusTimestamp}
        focusRequestId={props.focusRequestId}
        chartPanelId={props.panel.id}
        syncGroup={props.sync ? "strategy-workspace" : undefined}
        drawingScope={`${user?.id || "guest"}:${props.panel.id}:${props.panel.symbol}`}
        initialDrawings={props.panel.drawings}
        hiddenDrawingIds={props.panel.hiddenDrawingIds}
        onDrawingsChange={onDrawingsChange}
        onStrategyLevelChange={onStrategyLevelChange}
      />
      {props.panel.tradeSettings && (
        <div
          className="absolute top-12 start-3 z-10 rounded bg-white/90 px-2 py-1 text-[10px] dark:bg-zinc-950/90"
          role="status"
        >
          {trade
            ? `${language === "ar" ? "كمية" : "Shares"}: ${trade.quantity} · ${language === "ar" ? "مخاطرة" : "Risk"}: ${trade.riskAmount.toFixed(2)} EGP · R/R ${trade.riskReward.toFixed(2)}`
            : language === "ar"
              ? "مستويات صفقة غير صالحة؛ عدّل الوقف والهدف"
              : "Invalid trade levels; adjust stop and target"}
        </div>
      )}
    </div>
  );
}
