"use client";

import { useEffect, useRef, useState, useCallback, Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createChart, IChartApi, ISeriesApi, UTCTimestamp, SeriesMarker, ColorType
} from "lightweight-charts";
import {
  Play, Pause, SkipForward, SkipBack, RefreshCw, Settings2, Search,
  TrendingUp, TrendingDown, Target, Shield, BarChart3, Loader2,
  ChevronDown, ChevronUp, X, Plus, Minus, CheckSquare, Square,
  Activity, AlertCircle, Layers, Zap, Clock, DollarSign, Award,
  ArrowUpRight, ArrowDownRight, ChevronLeft, Info, Trash
} from "lucide-react";
import { getLocalModels, runStrategyTest, searchSymbols, getStockFundamentals, type StrategyTesterBar, type StrategyTesterTrade, type ApiBotConfig } from "@/lib/api";
import {
  filterPrimaryModels,
  getSuggestedModelSettings,
  normalizeAdaptiveModels,
  pickDefaultPrimaryModel,
  type AdaptiveModelInfo,
} from "@/lib/adaptiveModels";

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16"
];

const BOT_MODES = [
  {
    id: "conservative",
    label: "محافظ",
    labelEn: "Conservative",
    icon: Shield,
    color: "#10b981",
    desc: "Threshold ≥ 0.60 | Target +8% | Stop -4%"
  },
  {
    id: "normal",
    label: "عادي",
    labelEn: "Normal",
    icon: Activity,
    color: "#6366f1",
    desc: "Threshold ≥ 0.50 | Target +10% | Stop -5%"
  },
  {
    id: "aggressive",
    label: "جرئ",
    labelEn: "Aggressive",
    icon: Zap,
    color: "#ef4444",
    desc: "Threshold ≥ 0.40 | Target +15% | Stop -7%"
  }
];

const SPEEDS = [
  { label: "0.5×", ms: 400 },
  { label: "1×", ms: 200 },
  { label: "2×", ms: 100 },
  { label: "5×", ms: 40 },
  { label: "10×", ms: 15 },
  { label: "Max", ms: 0 },
];

interface SimTrade extends StrategyTesterTrade {
  modelName: string;
  modelColor: string;
  barIndex: number;       // index into bars array for entry
  exitBarIndex: number;   // index for exit
}

export type ActiveBot = {
  id: string; // unique identifier (e.g. KING-1, NANO-2)
  model_name: string; // e.g. "KING.pkl"
  target_pct: number;
  stop_loss_pct: number;
  hold_days: number;
  threshold: number;
  bot_mode: "conservative" | "normal" | "aggressive";
  isOpen?: boolean; // accordion collapsible open/closed state
};

// ─── Main Content ─────────────────────────────────────────────────────────────
function StrategyTesterContent() {
  const { language, t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const querySymbol = searchParams.get("symbol") || "COMI";
  const queryExchange = searchParams.get("exchange") || "EGX";

  // ── Setup Form State ──────────────────────────────────────────────────────
  const [symbol, setSymbol] = useState(querySymbol);
  const [exchange, setExchange] = useState(queryExchange);
  const [fundamentals, setFundamentals] = useState<any>(null);
  const [loadingFunds, setLoadingFunds] = useState<boolean>(false);
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState("");
  const [activeBots, setActiveBots] = useState<ActiveBot[]>([]);
  const [capital, setCapital] = useState(100000);
  const [useAdaptiveSelector, setUseAdaptiveSelector] = useState(false);
  const [adaptiveMinConfidence, setAdaptiveMinConfidence] = useState(55);
  const [lastAdaptive, setLastAdaptive] = useState<any>(null);
  const [addBotDropdownOpen, setAddBotDropdownOpen] = useState(false);

  // ── Model Picker ──────────────────────────────────────────────────────────
  const [availableModels, setAvailableModels] = useState<AdaptiveModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelSearch, setModelSearch] = useState("");

  // ── Symbol Search ─────────────────────────────────────────────────────────
  const [symbolSearch, setSymbolSearch] = useState(querySymbol);

  // Sync URL parameter changes to local state
  useEffect(() => {
    if (querySymbol) {
      setSymbol(querySymbol);
      setSymbolSearch(querySymbol);
    }
    if (queryExchange) {
      setExchange(queryExchange);
    }
  }, [querySymbol, queryExchange]);

  // Load stock metadata & fundamentals
  useEffect(() => {
    if (!symbol) return;
    setLoadingFunds(true);
    getStockFundamentals(symbol)
      .then((data) => {
        setFundamentals(data);
      })
      .catch((err) => {
        console.error("Failed to load stock details:", err);
        setFundamentals(null);
      })
      .finally(() => {
        setLoadingFunds(false);
      });
  }, [symbol]);

  // Update document title dynamically
  useEffect(() => {
    if (typeof window !== "undefined") {
      document.title = fundamentals?.name 
        ? `Strategy Tester - ${fundamentals.name} (${symbol})`
        : `Strategy Tester - ${symbol}`;
    }
  }, [symbol, fundamentals]);
  const [symbolResults, setSymbolResults] = useState<any[]>([]);
  const [searchingSymbol, setSearchingSymbol] = useState(false);
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false);

  // ── Simulation State ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bars, setBars] = useState<StrategyTesterBar[]>([]);
  const [allTrades, setAllTrades] = useState<SimTrade[]>([]);
  const [modelStats, setModelStats] = useState<Record<string, any>>({});

  // ── Playback State ────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBarIndex, setCurrentBarIndex] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1); // 1× default
  const [hasResult, setHasResult] = useState(false);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [startBarTime, setStartBarTime] = useState<number | null>(null);
  const [startLineX, setStartLineX] = useState<number | null>(null);
  const [currentLineX, setCurrentLineX] = useState<number | null>(null);

  const startBarTimeRef = useRef<number | null>(null);
  const hasResultRef = useRef(false);

  const [fullHistoryBars, setFullHistoryBars] = useState<StrategyTesterBar[]>([]);
  const fullHistoryBarsRef = useRef<StrategyTesterBar[]>([]);

  // ── UI Tabs ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"trades" | "stats" | "comparison">("stats");
  const [settingsOpen, setSettingsOpen] = useState(true);

  // ── Bot Filter State ──────────────────────────────────────────────────────
  const [selectedBotFilter, setSelectedBotFilter] = useState<string>("all");
  const selectedBotFilterRef = useRef<string>("all");

  // ── Bottom Panel Height Resize State ──────────────────────────────────────
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(256); // default 256px
  const [isResizingBottomPanel, setIsResizingBottomPanel] = useState<boolean>(false);

  // ── Left Sidebar Width Resize State ───────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState<number>(320); // default 320px
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);

  // ── Chart Refs ────────────────────────────────────────────────────────────
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartParentRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const barsRef = useRef<StrategyTesterBar[]>([]);
  const tradesRef = useRef<SimTrade[]>([]);
  const currentBarRef = useRef(0);
  const updateChartRef = useRef<(barIdx: number) => void>(() => {});

  const exchangeAwareModels = useMemo(
    () => filterPrimaryModels(availableModels, exchange).filter((model) => !model.normalizedName.includes("CRYPTO")),
    [availableModels, exchange]
  );

  const filteredAvailableModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return exchangeAwareModels;
    return exchangeAwareModels.filter((model) =>
      model.displayName.toLowerCase().includes(query) || model.name.toLowerCase().includes(query)
    );
  }, [exchangeAwareModels, modelSearch]);

  // ── Load models on mount ──────────────────────────────────────────────────
  useEffect(() => {
    getLocalModels()
      .then((models) => {
        setAvailableModels(normalizeAdaptiveModels(models));
      })
      .catch(() => {})
      .finally(() => setLoadingModels(false));
  }, []);

  // ── Bot Configuration Helper Functions ─────────────────────────────────────
  const addBot = useCallback((model: AdaptiveModelInfo) => {
    const baseName = model.displayName;
    let nextIndex = 1;
    while (activeBots.some(b => b.id === `${baseName} - ${nextIndex}`)) {
      nextIndex++;
    }
    const suggested = getSuggestedModelSettings(model);
    const newBot: ActiveBot = {
      id: `${baseName} - ${nextIndex}`,
      model_name: model.name,
      target_pct: suggested.targetPct,
      stop_loss_pct: suggested.stopLossPct,
      hold_days: suggested.holdDays,
      threshold: suggested.thresholdPct,
      bot_mode: "normal",
      isOpen: true
    };
    setActiveBots([...activeBots, newBot]);
  }, [activeBots]);

  useEffect(() => {
    if (loadingModels) return;
    const eligibleNames = new Set(exchangeAwareModels.map((model) => model.name));
    setActiveBots((prev) => {
      const compatibleBots = prev.filter((bot) => eligibleNames.has(bot.model_name));
      if (compatibleBots.length > 0) return compatibleBots;

      const defaultModel = pickDefaultPrimaryModel(availableModels, exchange);
      if (!defaultModel) return [];

      const suggested = getSuggestedModelSettings(defaultModel);
      return [{
        id: `${defaultModel.displayName} - 1`,
        model_name: defaultModel.name,
        target_pct: suggested.targetPct,
        stop_loss_pct: suggested.stopLossPct,
        hold_days: suggested.holdDays,
        threshold: suggested.thresholdPct,
        bot_mode: "normal",
        isOpen: true
      }];
    });
  }, [availableModels, exchangeAwareModels, exchange, loadingModels]);

  const removeBot = (botId: string) => {
    setActiveBots(activeBots.filter(b => b.id !== botId));
  };

  const updateBotSetting = <K extends keyof ActiveBot>(botId: string, key: K, value: ActiveBot[K]) => {
    setActiveBots(activeBots.map(b => b.id === botId ? { ...b, [key]: value } : b));
  };

  const changeBotMode = (botId: string, mode: "conservative" | "normal" | "aggressive") => {
    setActiveBots(activeBots.map(b => {
      if (b.id !== botId) return b;
      let threshold = b.threshold;
      let target_pct = b.target_pct;
      let stop_loss_pct = b.stop_loss_pct;

      if (mode === "conservative") {
        threshold = 60;
        target_pct = 8;
        stop_loss_pct = 4;
      } else if (mode === "aggressive") {
        threshold = 40;
        target_pct = 15;
        stop_loss_pct = 7;
      } else {
        threshold = 50;
        target_pct = 10;
        stop_loss_pct = 5;
      }

      return {
        ...b,
        bot_mode: mode,
        threshold,
        target_pct,
        stop_loss_pct
      };
    }));
  };

  const toggleBotCollapse = (botId: string) => {
    setActiveBots(activeBots.map(b => b.id === botId ? { ...b, isOpen: !b.isOpen } : b));
  };

  // ── Bottom Panel Drag-to-Resize Handler ────────────────────────────────────
  useEffect(() => {
    if (!isResizingBottomPanel) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging UP (smaller e.clientY) increases bottom panel height
      const newHeight = Math.max(160, Math.min(600, window.innerHeight - e.clientY));
      setBottomPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingBottomPanel(false);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingBottomPanel]);

  // ── Left Sidebar Drag-to-Resize Handler ───────────────────────────────────
  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging RIGHT (larger e.clientX) increases sidebar width
      const newWidth = Math.max(260, Math.min(600, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };

    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar]);

  // ── Symbol search debounce ─────────────────────────────────────────────────
  useEffect(() => {
    if (!symbolSearch.trim()) { setSymbolResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchingSymbol(true);
      try {
        const results = await searchSymbols(symbolSearch, undefined, 20, undefined, undefined, "EGX");
        setSymbolResults(results);
      } catch { setSymbolResults([]); }
      finally { setSearchingSymbol(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [symbolSearch]);

  // ── Load candles when symbol/exchange changes (Always visible chart) ────────
  useEffect(() => {
    if (!symbol) return;

    let isMounted = true;
    setCandlesLoading(true);
    setError(null);
    setHasResult(false);
    setStartBarTime(null);
    setStartLineX(null);

    const fetchInitialCandles = async () => {
      try {
        let url = `/api/ai_bot/candles?symbol=${encodeURIComponent(symbol)}&limit=1000`;
        if (exchange) {
          url += `&exchange=${encodeURIComponent(exchange)}`;
        }
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to load historical candles (Status ${res.status})`);
        }
        const data = await res.json();
        if (!isMounted) return;

        if (!data.candles || data.candles.length === 0) {
          throw new Error("No historical data found in database for this symbol.");
        }

        const loadedBars = data.candles as StrategyTesterBar[];
        barsRef.current = loadedBars;
        setBars(loadedBars);
        setFullHistoryBars(loadedBars);

        // Find initial startBarTime based on startDate state
        const targetTs = Math.floor(new Date(startDate).getTime() / 1000);
        let closestBar = loadedBars[0];
        let minDiff = Math.abs(closestBar.time - targetTs);
        for (let i = 1; i < loadedBars.length; i++) {
          const diff = Math.abs(loadedBars[i].time - targetTs);
          if (diff < minDiff) {
            minDiff = diff;
            closestBar = loadedBars[i];
          }
        }
        if (closestBar) {
          setStartBarTime(closestBar.time);
          const clickedDate = new Date(closestBar.time * 1000).toISOString().split('T')[0];
          setStartDate(clickedDate);
        }

        // Set series data immediately
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData(
            loadedBars.map((b) => ({
              time: b.time as UTCTimestamp,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
            }))
          );
          candleSeriesRef.current.setMarkers([]);
        }

        // Scroll to end of chart
        if (chartRef.current) {
          chartRef.current.timeScale().scrollToPosition(0, false);
        }

      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load candle data.");
        }
      } finally {
        if (isMounted) {
          setCandlesLoading(false);
        }
      }
    };

    fetchInitialCandles();

    return () => {
      isMounted = false;
    };
  }, [symbol, exchange]);

  // ── Sync startLineX when startBarTime changes ──────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      if (chartRef.current && startBarTime !== null) {
        const x = chartRef.current.timeScale().timeToCoordinate(startBarTime as any);
        setStartLineX(x);
      } else {
        setStartLineX(null);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [startBarTime, bars]);

  // ── Sync startBarTime when startDate changes (manually via inputs) ─────────
  useEffect(() => {
    if (!bars.length || !startDate) return;
    const targetTs = Math.floor(new Date(startDate).getTime() / 1000);
    let closestBar = bars[0];
    let minDiff = Math.abs(closestBar.time - targetTs);
    for (let i = 1; i < bars.length; i++) {
      const diff = Math.abs(bars[i].time - targetTs);
      if (diff < minDiff) {
        minDiff = diff;
        closestBar = bars[i];
      }
    }
    if (closestBar && closestBar.time !== startBarTime) {
      setStartBarTime(closestBar.time);
    }
  }, [startDate, bars]);

  // ── Init chart ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const width = chartParentRef.current?.clientWidth || 300;
    const height = chartParentRef.current?.clientHeight || 400;

    const chart = createChart(chartContainerRef.current, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#0d0f17" },
        textColor: "#787b86",
        fontFamily: "Inter, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1e2130" },
        horzLines: { color: "#1e2130" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#2a2e39" },
      timeScale: {
        borderColor: "#2a2e39",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const updateLines = () => {
      if (!chart) return;
      if (startBarTimeRef.current !== null) {
        const x = chart.timeScale().timeToCoordinate(startBarTimeRef.current as any);
        setStartLineX(x);
      } else {
        setStartLineX(null);
      }
      
      if (currentBarRef.current !== null && barsRef.current[currentBarRef.current]) {
        const currentTs = barsRef.current[currentBarRef.current].time;
        const x = chart.timeScale().timeToCoordinate(currentTs as any);
        setCurrentLineX(x);
      } else {
        setCurrentLineX(null);
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(updateLines);

    // Set starting position by clicking on the chart
    chart.subscribeClick((param) => {
      if (!param.time || !barsRef.current.length) return;
      const clickedTime = param.time;
      const clickedIndex = barsRef.current.findIndex((b) => b.time === clickedTime);
      if (clickedIndex !== -1) {
        if (hasResultRef.current) {
          setCurrentBarIndex(clickedIndex);
          updateChartRef.current(clickedIndex);
        } else {
          const clickedDate = new Date(clickedTime as number * 1000).toISOString().split('T')[0];
          setStartDate(clickedDate);
          setStartBarTime(clickedTime as number);
        }
      }
    });

    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (w > 0 && h > 0) {
        chart.resize(w, h);
        setTimeout(updateLines, 50);
      }
    });
    if (chartParentRef.current) {
      observer.observe(chartParentRef.current);
    }

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  // ── Sync refs ─────────────────────────────────────────────────────────────
  useEffect(() => { barsRef.current = bars; }, [bars]);
  useEffect(() => { tradesRef.current = allTrades; }, [allTrades]);
  useEffect(() => { currentBarRef.current = currentBarIndex; }, [currentBarIndex]);
  useEffect(() => { startBarTimeRef.current = startBarTime; }, [startBarTime]);
  useEffect(() => { hasResultRef.current = hasResult; }, [hasResult]);
  useEffect(() => { fullHistoryBarsRef.current = fullHistoryBars; }, [fullHistoryBars]);

  const activeBotsSerialized = JSON.stringify(
    activeBots.map(({ id, model_name, target_pct, stop_loss_pct, hold_days, threshold, bot_mode }) => ({
      id,
      model_name,
      target_pct,
      stop_loss_pct,
      hold_days,
      threshold,
      bot_mode,
    }))
  );

  // ── Reset simulation results when settings change ──────────────────────────
  // Commented out so that adjustments to settings do not instantly reset the simulation results.
  // The results will only reset when the user explicitly clicks the "Run Backtest" button.
  /*
  useEffect(() => {
    if (!hasResultRef.current) return; // Only reset if we currently have results
    setHasResult(false);
    // Restore bars state
    if (fullHistoryBarsRef.current.length > 0) {
      setBars(fullHistoryBarsRef.current);
      barsRef.current = fullHistoryBarsRef.current;
    }
    // Restore all bars from the full history on the chart
    if (candleSeriesRef.current && fullHistoryBarsRef.current.length > 0) {
      candleSeriesRef.current.setData(
        fullHistoryBarsRef.current.map((b) => ({
          time: b.time as UTCTimestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
      candleSeriesRef.current.setMarkers([]);
    }
  }, [startDate, endDate, activeBotsSerialized, capital]);
  */

  // ── Chart update when bar index changes ───────────────────────────────────
  const updateChart = useCallback((barIdx: number) => {
    const series = candleSeriesRef.current;
    if (!series || barsRef.current.length === 0) return;

    // Show all candles if backtest has results to prevent chart cut-off
    const showAll = hasResultRef.current;
    const visible = showAll ? barsRef.current : barsRef.current.slice(0, barIdx + 1);

    series.setData(
      visible.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
    );

    // Draw trade markers for trades that have entered by barIdx
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    tradesRef.current.forEach((trade) => {
      if (selectedBotFilterRef.current !== "all" && trade.modelName !== selectedBotFilterRef.current) {
        return;
      }
      if (trade.barIndex <= barIdx) {
        const color = trade.modelColor;
        markers.push({
          time: barsRef.current[trade.barIndex].time as UTCTimestamp,
          position: "belowBar",
          color,
          shape: "arrowUp",
          text: `B ${(trade.Radar_Score * 100).toFixed(0)}%`,
          size: 1,
        });
      }
      if (trade.exitBarIndex <= barIdx) {
        const won = trade.PnL_Pct > 0;
        markers.push({
          time: barsRef.current[trade.exitBarIndex].time as UTCTimestamp,
          position: "aboveBar",
          color: won ? "#26a69a" : "#ef5350",
          shape: "arrowDown",
          text: `${won ? "+" : ""}${(trade.PnL_Pct * 100).toFixed(1)}%`,
          size: 1,
        });
      }
    });

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    series.setMarkers(markers);

    // Update current playback line coordinate
    if (chartRef.current && barsRef.current[barIdx]) {
      const currentTs = barsRef.current[barIdx].time;
      const x = chartRef.current.timeScale().timeToCoordinate(currentTs as any);
      setCurrentLineX(x);

      // Focus view range around current index during playback simulation
      if (showAll) {
        const timeScale = chartRef.current.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
          const currentLogical = barIdx;
          const width = logicalRange.to - logicalRange.from;
          if (currentLogical < logicalRange.from + 5 || currentLogical > logicalRange.to - 5) {
            timeScale.setVisibleLogicalRange({
              from: currentLogical - Math.floor(width / 2),
              to: currentLogical + Math.ceil(width / 2)
            });
          }
        }
      } else {
        chartRef.current.timeScale().scrollToPosition(0, false);
      }
    }
  }, []);

  // ── Sync updateChartRef ──────────────────────────────────────────────────
  useEffect(() => {
    updateChartRef.current = updateChart;
  }, [updateChart]);

  // ── Sync bot filter ref and update chart ───────────────────────────────────
  useEffect(() => {
    selectedBotFilterRef.current = selectedBotFilter;
    if (hasResultRef.current) {
      updateChart(currentBarRef.current);
    }
  }, [selectedBotFilter, updateChart]);

  // ── Playback control ──────────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (!barsRef.current.length) return;
    const speed = SPEEDS[speedIndex];

    stopPlayback();
    setIsPlaying(true);

    if (speed.ms === 0) {
      // Max speed: show all at once
      const total = barsRef.current.length - 1;
      setCurrentBarIndex(total);
      updateChart(total);
      setIsPlaying(false);
      return;
    }

    playIntervalRef.current = setInterval(() => {
      setCurrentBarIndex((prev) => {
        const next = prev + 1;
        if (next >= barsRef.current.length) {
          stopPlayback();
          return prev;
        }
        updateChart(next);
        return next;
      });
    }, speed.ms);
  }, [speedIndex, stopPlayback, updateChart]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      if (currentBarIndex >= bars.length - 1) {
        // Reset and replay
        setCurrentBarIndex(0);
        updateChart(0);
        setTimeout(startPlayback, 50);
      } else {
        startPlayback();
      }
    }
  }, [isPlaying, currentBarIndex, bars.length, stopPlayback, startPlayback, updateChart]);

  const stepForward = useCallback(() => {
    stopPlayback();
    setCurrentBarIndex((prev) => {
      const next = Math.min(prev + 1, barsRef.current.length - 1);
      updateChart(next);
      return next;
    });
  }, [stopPlayback, updateChart]);

  const stepBackward = useCallback(() => {
    stopPlayback();
    setCurrentBarIndex((prev) => {
      const next = Math.max(prev - 1, 0);
      updateChart(next);
      return next;
    });
  }, [stopPlayback, updateChart]);

  const resetPlayback = useCallback(() => {
    stopPlayback();
    setCurrentBarIndex(0);
    updateChart(0);
  }, [stopPlayback, updateChart]);

  // ── Jump to bar when slider changes ──────────────────────────────────────
  const handleSliderChange = useCallback((val: number) => {
    stopPlayback();
    setCurrentBarIndex(val);
    updateChart(val);
  }, [stopPlayback, updateChart]);

  // ── Run simulation ────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!symbol || activeBots.length === 0) return;

    stopPlayback();
    setLoading(true);
    setError(null);
    setHasResult(false);
    hasResultRef.current = false;
    setBars([]);
    setAllTrades([]);
    tradesRef.current = [];          // ← مسح فوري للـ ref قبل أي API call
    setModelStats({});
    setSelectedBotFilter("all");
    setLastAdaptive(null);
    // Clear chart markers immediately to prevent stale arrows from prev run
    if (candleSeriesRef.current) {
      candleSeriesRef.current.setMarkers([]);
    }

    try {
      const result = await runStrategyTest({
        symbol,
        exchange,
        start_date: startDate,
        end_date: endDate || undefined,
        capital,
        bots: activeBots.map((bot) => ({
          id: bot.id,
          model_name: bot.model_name,
          target_pct: bot.target_pct / 100,
          stop_loss_pct: bot.stop_loss_pct / 100,
          hold_days: bot.hold_days,
          threshold: bot.threshold / 100,
          bot_mode: bot.bot_mode,
        })),
        // Fallbacks for backward compatibility
        models: activeBots.map((bot) => bot.model_name),
        target_pct: (activeBots[0]?.target_pct || 10) / 100,
        stop_loss_pct: (activeBots[0]?.stop_loss_pct || 5) / 100,
        hold_days: activeBots[0]?.hold_days || 20,
        threshold: (activeBots[0]?.threshold || 50) / 100,
        bot_mode: activeBots[0]?.bot_mode || "normal",
        use_adaptive_model_selector: useAdaptiveSelector,
        adaptive_model_pool: activeBots.map((bot) => bot.model_name),
        adaptive_min_confidence: adaptiveMinConfidence / 100,
      });

      const loadedBars = result.bars;
      barsRef.current = loadedBars;
      setBars(loadedBars);

      // Build bar timestamp → index map
      const timeToIdx: Record<number, number> = {};
      loadedBars.forEach((b, i) => { timeToIdx[b.time] = i; });

      // Process trades from all models
      const combined: SimTrade[] = [];
      const stats: Record<string, any> = {};

      Object.entries(result.models).forEach(([botId, modelResult], mi) => {
        const color = MODEL_COLORS[mi % MODEL_COLORS.length];
        stats[botId] = { ...modelResult.stats, color, error: modelResult.error };

        (modelResult.trades || []).forEach((trade) => {
          // Find bar indices for entry and exit
          const entryTs = Math.floor(new Date(trade.Entry_Date).getTime() / 1000);
          const exitTs = Math.floor(new Date(trade.Exit_Date).getTime() / 1000);

          // Find closest bar
          let entryIdx = 0;
          let exitIdx = loadedBars.length - 1;
          for (let i = 0; i < loadedBars.length; i++) {
            if (loadedBars[i].time >= entryTs) { entryIdx = i; break; }
          }
          for (let i = 0; i < loadedBars.length; i++) {
            if (loadedBars[i].time >= exitTs) { exitIdx = i; break; }
          }

          combined.push({
            ...trade,
            modelName: botId,
            modelColor: color,
            barIndex: entryIdx,
            exitBarIndex: exitIdx,
          });
        });
      });

      combined.sort((a, b) => a.barIndex - b.barIndex);
      tradesRef.current = combined;
      setAllTrades(combined);
      setModelStats(stats);
      setLastAdaptive(result.adaptive || null);
      setHasResult(true);
      hasResultRef.current = true;

      // Jump to last bar so all trade markers are visible immediately
      const lastBarIdx = loadedBars.length - 1;
      setCurrentBarIndex(lastBarIdx);
      if (candleSeriesRef.current) {
        candleSeriesRef.current.setData(
          loadedBars.map((b) => ({
            time: b.time as UTCTimestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          }))
        );
        candleSeriesRef.current.setMarkers([]);
      }
      updateChart(lastBarIdx);
    } catch (e: any) {
      setError(e?.message || "فشل تشغيل الاختبار");
    } finally {
      setLoading(false);
    }
  }, [
    symbol, exchange, startDate, endDate, activeBots, capital, useAdaptiveSelector, adaptiveMinConfidence,
    stopPlayback, updateChart,
  ]);

  // Hide root layout's footer so it doesn't show through
  useEffect(() => {
    const footerEl = document.querySelector("footer") as HTMLElement | null;
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    if (footerEl) footerEl.style.display = "none";
    htmlEl.style.overflow = "hidden";
    bodyEl.style.overflow = "hidden";
    return () => {
      if (footerEl) footerEl.style.display = "";
      htmlEl.style.overflow = "";
      bodyEl.style.overflow = "";
    };
  }, []);

  // ── Cleanup playback on unmount ───────────────────────────────────────────
  useEffect(() => () => stopPlayback(), [stopPlayback]);


  // ─── Helper formatters ────────────────────────────────────────────────────
  const fmtPct = (v: number | undefined) =>
    v === undefined ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fmtMoney = (v: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

  // ─── Visible trades (only ones that have entered by current bar) ──────────
  const visibleTrades = allTrades.filter((t) => t.barIndex <= currentBarIndex);

  // ─── Filtered visible trades based on the selected bot ───────────────────
  const filteredVisibleTrades = visibleTrades.filter(
    (t) => selectedBotFilter === "all" || t.modelName === selectedBotFilter
  );

  // ── Running P&L per model (only entered trades) ───────────────────────────
  const runningPnl: Record<string, number> = {};
  visibleTrades.forEach((t) => {
    if (!runningPnl[t.modelName]) runningPnl[t.modelName] = 0;
    if (t.exitBarIndex <= currentBarIndex) {
      runningPnl[t.modelName] += t.PnL_Pct;
    }
  });

  const filteredModels = filteredAvailableModels;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 page-below-header bg-[#0d0f17] text-[#d1d4dc] flex flex-col overflow-hidden z-50"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >

      {/* ── Main layout ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* LEFT: Config Panel */}
        {settingsOpen && (
          <aside 
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 border-r border-[#1e2130] flex flex-col overflow-hidden bg-[#0c0e16]/80 backdrop-blur relative z-30"
            style={{ width: `${sidebarWidth}px` }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e2130] shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <Layers className="w-3 h-3 text-indigo-400" />
                </div>
                <span className="text-[11px] font-black text-white">{t("backtest.tester.title")}</span>
                <span className="text-[8px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded-full border border-indigo-500/20">AI BOT</span>
              </div>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[9px] text-indigo-400 font-bold uppercase shrink-0">{exchange}</span>
                <span className="text-[11px] font-black text-white shrink-0">{symbol}</span>
                {fundamentals?.name && (
                  <span className="text-[10px] text-zinc-400 font-bold truncate max-w-[80px]" title={fundamentals.name}>
                    - {fundamentals.name}
                  </span>
                )}
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="p-1 rounded-md text-zinc-600 hover:text-white hover:bg-zinc-800 transition-all ml-1 shrink-0"
                  title={t("backtest.hide")}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-5 flex-1 overflow-y-auto min-h-0">

              {/* Symbol */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("backtest.ticker")}</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input
                    value={symbolSearch}
                    onChange={(e) => setSymbolSearch(e.target.value)}
                    onFocus={() => setSymbolDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setSymbolDropdownOpen(false), 150)}
                    placeholder={t("backtest.search_placeholder")}
                    className="w-full pl-8 pr-3 py-2 text-sm font-semibold bg-zinc-900/60 border border-[#2a2e39] rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-all"
                  />
                  {searchingSymbol && (
                    <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-indigo-400 animate-spin" />
                  )}
                  {symbolDropdownOpen && symbolResults.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#131722] border border-[#2a2e39] rounded-xl overflow-hidden shadow-2xl max-h-48 overflow-y-auto">
                      {symbolResults.map((r) => (
                        <button
                          key={r.symbol}
                          onMouseDown={() => {
                            setSymbol(r.symbol);
                            setSymbolSearch(r.symbol);
                            setExchange(r.exchange || "EGX");
                            setSymbolDropdownOpen(false);
                            router.replace(`/backtest?symbol=${encodeURIComponent(r.symbol)}&exchange=${encodeURIComponent(r.exchange || "EGX")}`);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-indigo-600/10 text-left transition-colors"
                        >
                          <span className="text-xs font-black text-white">{r.symbol}</span>
                          <span className="text-[10px] text-zinc-500 truncate">{r.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Date Range */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("backtest.date_range")}</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-[9px] text-zinc-600 font-bold uppercase">{t("backtest.from")}</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-2.5 py-2 text-[11px] font-semibold bg-zinc-900/60 border border-[#2a2e39] rounded-xl text-white focus:outline-none focus:border-indigo-500/50 transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] text-zinc-600 font-bold uppercase">{t("backtest.to")}</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-2.5 py-2 text-[11px] font-semibold bg-zinc-900/60 border border-[#2a2e39] rounded-xl text-white focus:outline-none focus:border-indigo-500/50 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Capital */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-zinc-500">{t("backtest.capital")}</span>
                  <span className="text-[11px] font-black text-white font-mono">
                    {fmtMoney(capital)} EGP
                  </span>
                </div>
                <input
                  type="range"
                  min={10000}
                  max={1000000}
                  step={10000}
                  value={capital}
                  onChange={(e) => setCapital(Number(e.target.value))}
                  className="w-full h-1 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: "#6366f1" }}
                />
              </div>

              {/* Add Bot Picker */}
              <div className="space-y-2 border-t border-white/5 pt-4">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{t("backtest.add_bot")}</span>
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setAddBotDropdownOpen(!addBotDropdownOpen)}
                    className="w-full h-10 px-3 flex items-center justify-between text-[11px] bg-zinc-900/60 border border-[#2a2e39] rounded-xl text-zinc-300 hover:text-white hover:border-zinc-700 transition-all font-bold"
                  >
                    <span>{t("backtest.select_model")}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${addBotDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {addBotDropdownOpen && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#131722] border border-[#2a2e39] rounded-xl overflow-hidden shadow-2xl max-h-48 overflow-y-auto p-1.5 space-y-0.5">
                      {filteredModels.map((m) => (
                        <button
                          key={m.name}
                          type="button"
                          onClick={() => {
                            addBot(m);
                            setAddBotDropdownOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-indigo-600/10 text-right rounded-lg text-[10px] font-bold text-zinc-300 transition-colors"
                        >
                          <span>{m.displayName}</span>
                          <span className="text-[8px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded uppercase">PICKLE</span>
                        </button>
                      ))}
                      {filteredModels.length === 0 && (
                        <div className="text-center py-3 text-[10px] text-zinc-600 font-bold">{t("backtest.no_models")}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Active Bots List */}
              <div className="space-y-3 border-t border-white/5 pt-4">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                  <span>{t("backtest.active_bots")}</span>
                  <span className="text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md text-[9px] font-black font-mono">
                    {activeBots.length}
                  </span>
                </label>

                <div className="space-y-2.5 max-h-96 overflow-y-auto pr-0.5 custom-scrollbar">
                  {activeBots.map((bot) => (
                    <div
                      key={bot.id}
                      className="rounded-xl border border-white/5 bg-zinc-950/60 overflow-hidden shadow-lg transition-all duration-300 hover:border-white/10"
                    >
                      {/* Card Header */}
                      <div
                        className="flex items-center justify-between px-3 py-2.5 bg-zinc-900/40 border-b border-white/5 cursor-pointer hover:bg-zinc-900/60"
                        onClick={() => toggleBotCollapse(bot.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-5 h-5 rounded-lg flex items-center justify-center bg-indigo-500/10 text-indigo-400 font-black text-[9px] uppercase">
                            {bot.model_name.slice(0, 2)}
                          </div>
                          <div className="text-left min-w-0">
                            <div className="text-[10px] font-black text-white truncate">{bot.id}</div>
                            <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold">
                              {t("backtest.mode." + bot.bot_mode)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => removeBot(bot.id)}
                            className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            title={t("backtest.delete_bot")}
                          >
                            <Trash className="w-3.5 h-3.5" />
                          </button>
                          {/* Toggle Collapse */}
                          <button
                            type="button"
                            onClick={() => toggleBotCollapse(bot.id)}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-white transition-all"
                          >
                            {bot.isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Card Body (Accordion Content) */}
                      {bot.isOpen ? (
                        <div className="p-3.5 space-y-4 bg-zinc-950/20 border-t border-white/5">
                          {/* Bot Mode */}
                          <div className="space-y-1">
                            <span className="text-[9px] text-zinc-500 font-black uppercase tracking-wider">{t("backtest.exec_mode")}</span>
                            <div className="grid grid-cols-3 gap-1">
                              {["conservative", "normal", "aggressive"].map((mode) => {
                                const isActive = bot.bot_mode === mode;
                                return (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => changeBotMode(bot.id, mode as any)}
                                    className={`py-1 text-[9px] font-black uppercase rounded-lg border transition-all ${
                                      isActive
                                        ? "border-indigo-500/40 bg-indigo-600/10 text-white"
                                        : "border-white/5 bg-zinc-900/10 text-zinc-500 hover:text-zinc-300"
                                    }`}
                                  >
                                    {t("backtest.mode." + mode)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Sliders */}
                          {[
                            { label: "Target %", value: bot.target_pct, key: "target_pct", min: 2, max: 50, step: 1, color: "#26a69a" },
                            { label: "Stop Loss %", value: bot.stop_loss_pct, key: "stop_loss_pct", min: 1, max: 30, step: 1, color: "#ef5350" },
                            { label: "Hold Days", value: bot.hold_days, key: "hold_days", min: 3, max: 60, step: 1, color: "#6366f1" },
                            { label: "Threshold %", value: bot.threshold, key: "threshold", min: 20, max: 90, step: 1, color: "#f59e0b" },
                          ].map((slider) => (
                            <div key={slider.label} className="space-y-1">
                              <div className="flex justify-between items-center text-[9px]">
                                <span className="font-bold text-zinc-500">{slider.label}</span>
                                <span className="font-black text-white font-mono">
                                  {slider.value}{slider.label.includes('%') ? '%' : 'd'}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={slider.min}
                                max={slider.max}
                                step={slider.step}
                                value={slider.value}
                                onChange={(e) => updateBotSetting(bot.id, slider.key as any, Number(e.target.value))}
                                className="w-full h-1 rounded-full appearance-none cursor-pointer"
                                style={{ accentColor: slider.color }}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* Collapsed Summary Badge Row */
                        <div className="px-3 py-2 bg-[#0c0e16]/30 text-[9px] font-mono text-zinc-500 font-semibold flex items-center justify-between border-t border-white/5">
                          <span className="truncate max-w-[150px]">
                            🎯 {bot.target_pct}% | 🛡️ {bot.stop_loss_pct}% | 🕒 {bot.hold_days}d | ⚡ {bot.threshold}%
                          </span>
                          <span className="capitalize text-[8px] bg-white/5 px-1.5 py-0.5 rounded text-zinc-400 border border-white/5 font-sans font-bold shrink-0">
                            {t("backtest.mode." + bot.bot_mode)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                  {activeBots.length === 0 && (
                    <div className="text-center py-6 border border-dashed border-white/5 rounded-xl text-[10px] text-zinc-500 font-bold uppercase">
                      {t("backtest.add_bot_warning")}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3 border-t border-white/5 pt-4">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-wider text-white">Adaptive Selector</div>
                    <div className="text-[9px] text-zinc-500 font-semibold">
                      يختار موديلًا من البوتات المضافة حسب نظام السوق ويضيفه كنتيجة مستقلة.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseAdaptiveSelector((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border transition-all ${
                      useAdaptiveSelector
                        ? "bg-indigo-600/15 border-indigo-500/40 text-indigo-300"
                        : "bg-zinc-900 border-white/5 text-zinc-500"
                    }`}
                  >
                    {useAdaptiveSelector ? "On" : "Off"}
                  </button>
                </div>

                {useAdaptiveSelector && (
                  <div className="rounded-xl border border-white/5 bg-zinc-950/30 p-3 space-y-2">
                    <div className="flex items-center justify-between text-[9px] font-bold text-zinc-500">
                      <span>Min Confidence</span>
                      <span className="font-mono text-white">{adaptiveMinConfidence}%</span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={95}
                      step={1}
                      value={adaptiveMinConfidence}
                      onChange={(e) => setAdaptiveMinConfidence(Number(e.target.value))}
                      className="w-full h-1 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "#6366f1" }}
                    />
                    <div className="text-[9px] text-zinc-600 font-semibold">
                      Pool: {activeBots.map((bot) => bot.model_name.replace(".pkl", "")).join(", ") || "No models"}
                    </div>
                    {lastAdaptive && (
                      <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-2.5 text-[10px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-black text-indigo-300">{lastAdaptive.recommended_model?.replace(".pkl", "")}</span>
                          <span className="text-zinc-400">{lastAdaptive.regime}</span>
                        </div>
                        <div className="mt-1 text-zinc-500">
                          Confidence: {(Number(lastAdaptive.confidence || 0) * 100).toFixed(1)}%
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Run Button */}
              <button
                onClick={handleRun}
                disabled={loading || activeBots.length === 0 || !symbol}
                className="w-full py-3 rounded-xl font-black text-[12px] uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-lg shadow-indigo-900/30"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("backtest.run_loading")}
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    {t("backtest.run_btn")}
                  </>
                )}
              </button>
            </div>

            {/* Draggable Resizer Border */}
            <div
              onMouseDown={() => setIsResizingSidebar(true)}
              className="absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500/80 transition-all z-40 group"
              title="Drag to resize panel"
            >
              <div className="w-[1.5px] h-full bg-white/5 group-hover:bg-indigo-500/50 mx-auto" />
            </div>
          </aside>
        )}

        {/* CENTER + BOTTOM: Chart + Controls + Panels */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">

          {/* Chart Area */}
          <div ref={chartParentRef} className="flex-1 min-h-0 relative overflow-hidden">
            {/* Chart */}
            <div ref={chartContainerRef} className="absolute inset-0" />

            {/* Toggle Settings Button (when closed) */}
            {!settingsOpen && (
              <button
                onClick={() => setSettingsOpen(true)}
                className="absolute top-3 left-3 z-30 p-2 rounded-xl bg-[#0c0e16]/90 backdrop-blur-md border border-[#1e2130] text-zinc-400 hover:text-white hover:border-zinc-700 transition-all flex items-center gap-1.5 shadow-lg active:scale-95 cursor-pointer font-sans"
                title={t("backtest.show_settings")}
              >
                <Settings2 className="w-4 h-4 text-indigo-400 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-wider">{t("backtest.settings")}</span>
              </button>
            )}

            {/* Start Line (Yellow vertical line) */}
            {startLineX !== null && !hasResult && !loading && (
              <div
                className="absolute top-0 bottom-0 w-[1.5px] bg-[#f59e0b] pointer-events-none z-10"
                style={{ left: startLineX }}
              >
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-[#f59e0b] text-[8px] font-black text-black px-1.5 py-0.5 rounded shadow whitespace-nowrap uppercase tracking-wider">
                  {t("backtest.start_point")}
                </div>
              </div>
            )}

            {/* Current Line (Blue vertical line representing current simulation progress) */}
            {currentLineX !== null && hasResult && !loading && (
              <div
                className="absolute top-0 bottom-0 w-[1.5px] bg-indigo-500 pointer-events-none z-10"
                style={{ left: currentLineX }}
              >
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-indigo-600 border border-indigo-500/30 text-[8px] font-black text-white px-2 py-0.5 rounded shadow whitespace-nowrap uppercase tracking-wider font-mono">
                  {bars[currentBarIndex] ? new Date(bars[currentBarIndex].time * 1000).toISOString().split('T')[0] : ""}
                </div>
              </div>
            )}



            {/* Candle Loading overlay */}
            {candlesLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0d0f17]/70 backdrop-blur-sm z-30 pointer-events-none">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider font-sans">{t("backtest.loading_chart")}</span>
              </div>
            )}

            {/* Loading overlay */}
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0d0f17]/95 backdrop-blur-sm pointer-events-none">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-2 border-indigo-500/20 animate-ping absolute inset-0" />
                  <div className="w-16 h-16 rounded-full border-2 border-indigo-500/40 flex items-center justify-center relative">
                    <BarChart3 className="w-7 h-7 text-indigo-400 animate-pulse" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-black text-white">{t("backtest.running_test")}</p>
                  <p className="text-[11px] text-zinc-600 mt-1">{t("backtest.running_test_sub")}</p>
                </div>
              </div>
            )}

            {/* Error overlay */}
            {error && !loading && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-semibold shadow-xl">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                  <button onClick={() => setError(null)} className="ml-2 text-red-400/60 hover:text-red-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Live model P&L overlay (top-left) */}
            {hasResult && Object.keys(runningPnl).length > 0 && (
              <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5">
                {Object.entries(modelStats).map(([name, s]) => {
                  const pnl = runningPnl[name] ?? 0;
                  const isPos = pnl >= 0;
                  const color = s.color || "#6366f1";
                  const isSelected = selectedBotFilter === name;
                  return (
                    <button
                      key={name}
                      onClick={() => setSelectedBotFilter(isSelected ? "all" : name)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg backdrop-blur border text-left transition-all ${
                        isSelected
                          ? "bg-indigo-600/35 border-indigo-500 text-white shadow-lg shadow-indigo-500/10"
                          : "bg-[#0d0f17]/80 border-white/5 text-[#d1d4dc] hover:bg-zinc-800/80"
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-[9px] font-bold max-w-[80px] truncate">{name.replace('.pkl', '')}</span>
                      <span
                        className="text-[10px] font-black font-mono"
                        style={{ color: isSelected ? "#fff" : (isPos ? "#26a69a" : "#ef5350") }}
                      >
                        {isPos ? "+" : ""}{(pnl * 100).toFixed(1)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {hasResult && lastAdaptive && (
              <div className="absolute top-3 right-3 z-20 max-w-xs rounded-xl border border-indigo-500/20 bg-[#0d0f17]/90 backdrop-blur px-3 py-2.5 text-left shadow-lg">
                <div className="text-[9px] font-black uppercase tracking-wider text-indigo-300">Adaptive Pick</div>
                <div className="mt-1 text-sm font-black text-white">{lastAdaptive.recommended_model?.replace(".pkl", "")}</div>
                <div className="mt-1 text-[10px] text-zinc-400">
                  {lastAdaptive.regime} | {(Number(lastAdaptive.confidence || 0) * 100).toFixed(1)}%
                </div>
              </div>
            )}
          </div>

          {/* Playback Controls Bar */}
          {hasResult && (
            <div className="h-14 shrink-0 border-t border-[#1e2130] bg-[#0c0e16] flex items-center px-4 gap-3">
              {/* Transport buttons */}
              <div className="flex items-center gap-1">
                <button
                  onClick={resetPlayback}
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                  title="Reset"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={stepBackward}
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                  title="Step Back"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={togglePlay}
                  className={`p-2.5 rounded-xl transition-all ${
                    isPlaying
                      ? "bg-indigo-600/20 border border-indigo-500/40 text-indigo-400"
                      : "bg-zinc-800 text-white hover:bg-zinc-700"
                  }`}
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button
                  onClick={stepForward}
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                  title="Step Forward"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    stopPlayback();
                    setCurrentBarIndex(bars.length - 1);
                    updateChart(bars.length - 1);
                  }}
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                  title="Skip to End"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Progress slider */}
              <div className="flex-1 flex items-center gap-2">
                <span className="text-[10px] text-zinc-600 font-mono w-12 text-right">{currentBarIndex + 1}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, bars.length - 1)}
                  value={currentBarIndex}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: "#6366f1" }}
                />
                <span className="text-[10px] text-zinc-600 font-mono w-12">{bars.length}</span>
              </div>

              {/* Speed selector */}
              <div className="flex items-center gap-1 bg-zinc-900/60 rounded-lg p-1 border border-[#1e2130]">
                {SPEEDS.map((s, i) => (
                  <button
                    key={s.label}
                    onClick={() => {
                      setSpeedIndex(i);
                      if (isPlaying) {
                        stopPlayback();
                        setTimeout(startPlayback, 10);
                      }
                    }}
                    className={`px-2 py-1 text-[9px] font-black rounded-md transition-all ${
                      speedIndex === i
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-500 hover:text-white"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Bar date */}
              {bars[currentBarIndex] && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900/40 border border-[#2a2e39]">
                  <Clock className="w-3 h-3 text-zinc-600" />
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {new Date(bars[currentBarIndex].time * 1000).toLocaleDateString("en-US", {
                      year: "numeric", month: "short", day: "numeric"
                    })}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Bottom Panels: Stats + Trades */}
          {hasResult && (
            <div 
              style={{ height: bottomPanelHeight }} 
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 border-t border-[#1e2130] flex flex-col relative"
            >
              {/* Resize Handle at the top border of the bottom panel */}
              <div
                onMouseDown={() => setIsResizingBottomPanel(true)}
                className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-indigo-500/50 hover:h-1.5 transition-all z-30"
              />
              {/* Tab bar */}
              <div className="flex items-center justify-between border-b border-[#1e2130] h-9 shrink-0 px-3 bg-[#0c0e16]">
                <div className="flex h-full">
                  <button
                    onClick={() => setActiveTab("stats")}
                    className={`px-5 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                      activeTab === "stats"
                        ? "border-indigo-500 text-white"
                        : "border-transparent text-zinc-600 hover:text-zinc-400"
                    }`}
                  >
                    <BarChart3 className="w-3 h-3" />
                    {t("backtest.stats_tab")}
                  </button>
                  <button
                    onClick={() => setActiveTab("trades")}
                    className={`px-5 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                      activeTab === "trades"
                        ? "border-indigo-500 text-white"
                        : "border-transparent text-zinc-600 hover:text-zinc-400"
                    }`}
                  >
                    <Activity className="w-3 h-3" />
                    {t("backtest.trades_tab").replace("{count}", filteredVisibleTrades.length.toString())}
                  </button>
                  <button
                    onClick={() => setActiveTab("comparison")}
                    className={`px-5 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                      activeTab === "comparison"
                        ? "border-indigo-500 text-white"
                        : "border-transparent text-zinc-600 hover:text-zinc-400"
                    }`}
                  >
                    <TrendingUp className="w-3 h-3" />
                    {t("backtest.comparison_tab")}
                  </button>
                </div>

                {/* Bot Selector / Filter */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] text-zinc-500 font-black uppercase tracking-wider">{t("backtest.filter_bot")}</span>
                  <div className="flex bg-zinc-900/60 rounded-lg p-0.5 border border-white/5 gap-0.5">
                    <button
                      onClick={() => setSelectedBotFilter("all")}
                      className={`px-2 py-0.5 text-[9px] font-black rounded-md transition-all ${
                        selectedBotFilter === "all"
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {t("backtest.all")}
                    </button>
                    {Object.keys(modelStats).map((botId) => {
                      const color = modelStats[botId]?.color || "#6366f1";
                      const isSelected = selectedBotFilter === botId;
                      return (
                        <button
                          key={botId}
                          onClick={() => setSelectedBotFilter(botId)}
                          className={`px-2 py-0.5 text-[9px] font-black rounded-md transition-all flex items-center gap-1 ${
                            isSelected
                              ? "bg-indigo-600 text-white"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span>{botId.replace('.pkl', '')}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Comparison panel */}
              {activeTab === "comparison" && (
                <div className="flex-1 overflow-auto p-4 custom-scrollbar bg-zinc-950/20">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Comparative Table */}
                    <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-4 space-y-3.5 shadow-xl">
                      <div className="flex items-center gap-2 border-b border-white/5 pb-2.5">
                        <TrendingUp className="w-4 h-4 text-indigo-400" />
                        <h4 className="text-[11px] font-black text-white uppercase tracking-wider">{t("backtest.comparison.table_title")}</h4>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[10px] border-collapse">
                          <thead>
                            <tr className="border-b border-white/5 text-zinc-500">
                              <th className="py-2 text-left font-black">{t("backtest.comparison.col_bot")}</th>
                              <th className="py-2 text-right font-black">{t("backtest.comparison.col_net_pnl")}</th>
                              <th className="py-2 text-right font-black">{t("backtest.comparison.col_winrate")}</th>
                              <th className="py-2 text-right font-black">{t("backtest.comparison.col_trades")}</th>
                              <th className="py-2 text-right font-black">{t("backtest.comparison.col_pl")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(modelStats).map(([name, s]) => {
                              const color = s.color || "#6366f1";
                              const pnl = runningPnl[name] ?? 0;
                              const isPos = pnl >= 0;
                              const tradesForModel = visibleTrades.filter(
                                (t) => t.modelName === name && t.exitBarIndex <= currentBarIndex
                              );
                              const wins = tradesForModel.filter((t) => t.PnL_Pct > 0).length;
                              const losses = tradesForModel.length - wins;
                              const winRate = tradesForModel.length > 0
                                ? (wins / tradesForModel.length * 100).toFixed(0)
                                : "—";

                              return (
                                <tr key={name} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                  <td className="py-2.5 font-black flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                    <span className="text-white truncate max-w-[120px]">{name.replace('.pkl', '')}</span>
                                  </td>
                                  <td className="py-2.5 text-right font-mono font-black" style={{ color: isPos ? "#26a69a" : "#ef5350" }}>
                                    {isPos ? "+" : ""}{(pnl * 100).toFixed(1)}%
                                  </td>
                                  <td className="py-2.5 text-right font-mono font-black text-indigo-400">
                                    {winRate !== "—" ? `${winRate}%` : "—"}
                                  </td>
                                  <td className="py-2.5 text-right font-mono font-bold text-zinc-400">
                                    {tradesForModel.length}
                                  </td>
                                  <td className="py-2.5 text-right font-mono text-zinc-500">
                                    <span className="text-[#26a69a] font-bold">{wins}W</span> / <span className="text-[#ef5350] font-bold">{losses}L</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Visual Comparison Charts */}
                    <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-4 space-y-4 shadow-xl">
                      <div className="flex items-center gap-2 border-b border-white/5 pb-2.5">
                        <BarChart3 className="w-4 h-4 text-indigo-400" />
                        <h4 className="text-[11px] font-black text-white uppercase tracking-wider">{t("backtest.comparison.chart_title")}</h4>
                      </div>
                      <div className="space-y-4">
                        {Object.entries(modelStats).map(([name, s]) => {
                          const color = s.color || "#6366f1";
                          const pnl = (runningPnl[name] ?? 0) * 100;
                          
                          // Find max absolute pnl of all models to scale bars properly
                          const allPnls = Object.keys(modelStats).map(k => Math.abs((runningPnl[k] ?? 0) * 100));
                          const maxPnl = Math.max(...allPnls, 10);
                          const widthPct = Math.min(100, (Math.abs(pnl) / maxPnl) * 100);

                          return (
                            <div key={name} className="space-y-1.5">
                              <div className="flex justify-between items-center text-[9px] font-bold">
                                <span className="text-zinc-300">{name.replace('.pkl', '')}</span>
                                <span className="font-mono font-black" style={{ color: pnl >= 0 ? "#26a69a" : "#ef5350" }}>
                                  {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden border border-white/5 flex">
                                {pnl >= 0 ? (
                                  <div className="flex-1 flex justify-start">
                                    <div 
                                      className="h-full rounded-full transition-all duration-500" 
                                      style={{ 
                                        width: `${widthPct}%`, 
                                        backgroundColor: "#26a69a",
                                        boxShadow: "0 0 8px rgba(38, 166, 154, 0.4)"
                                      }} 
                                    />
                                  </div>
                                ) : (
                                  <div className="flex-1 flex justify-start">
                                    <div 
                                      className="h-full rounded-full transition-all duration-500" 
                                      style={{ 
                                        width: `${widthPct}%`, 
                                        backgroundColor: "#ef5350",
                                        boxShadow: "0 0 8px rgba(239, 83, 80, 0.4)"
                                      }} 
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Stats panel */}
              {activeTab === "stats" && (
                <div className="flex-1 overflow-x-auto overflow-y-auto p-3">
                  <div className="flex gap-3 min-w-max">
                    {Object.entries(modelStats)
                      .filter(([name]) => selectedBotFilter === "all" || name === selectedBotFilter)
                      .map(([name, s]) => {
                        const color = s.color || "#6366f1";
                        const pnl = runningPnl[name] ?? 0;
                      const isPos = pnl >= 0;
                      const tradesForModel = visibleTrades.filter(
                        (t) => t.modelName === name && t.exitBarIndex <= currentBarIndex
                      );
                      const wins = tradesForModel.filter((t) => t.PnL_Pct > 0).length;
                      const winRate = tradesForModel.length > 0
                        ? (wins / tradesForModel.length * 100).toFixed(0)
                        : "—";

                      return (
                        <div
                          key={name}
                          className="min-w-[220px] p-3 rounded-xl border border-white/5 bg-zinc-950/40 flex flex-col gap-2"
                          style={{ borderLeftColor: color, borderLeftWidth: 2 }}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-[10px] font-black text-zinc-300 truncate">{name.replace('.pkl', '')}</span>
                          </div>

                          {s.error ? (
                            <p className="text-[10px] text-red-400">{s.error}</p>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                {
                                  label: "P&L",
                                  value: `${isPos ? "+" : ""}${(pnl * 100).toFixed(1)}%`,
                                  color: isPos ? "#26a69a" : "#ef5350",
                                  Icon: isPos ? ArrowUpRight : ArrowDownRight
                                },
                                {
                                  label: "Win Rate",
                                  value: `${winRate}%`,
                                  color: "#6366f1",
                                  Icon: Award
                                },
                                {
                                  label: "Trades",
                                  value: tradesForModel.length,
                                  color: "#f59e0b",
                                  Icon: Activity
                                },
                                {
                                  label: "Wins",
                                  value: wins,
                                  color: "#26a69a",
                                  Icon: Target
                                },
                              ].map(({ label, value, color: c, Icon }) => (
                                <div key={label} className="flex flex-col gap-0.5">
                                  <span className="text-[8px] text-zinc-600 uppercase tracking-wider">{label}</span>
                                  <div className="flex items-center gap-1">
                                    <Icon className="w-2.5 h-2.5" style={{ color: c }} />
                                    <span
                                      className="text-[11px] font-black font-mono"
                                      style={{ color: c }}
                                    >
                                      {value}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Trades panel */}
              {activeTab === "trades" && (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead className="sticky top-0 bg-[#0c0e16] z-10">
                      <tr className="border-b border-[#1e2130]">
                        {[
                          t("backtest.table.model"),
                          t("backtest.table.entry_date"),
                          t("backtest.table.exit_date"),
                          t("backtest.table.entry_price"),
                          t("backtest.table.exit_price"),
                          t("backtest.table.pl"),
                          t("backtest.table.days"),
                          t("backtest.table.result"),
                          t("backtest.table.confidence"),
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left font-black text-zinc-600 uppercase tracking-wider whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVisibleTrades.map((trade, i) => {
                        const closed = trade.exitBarIndex <= currentBarIndex;
                        const isPos = trade.PnL_Pct > 0;
                        return (
                          <tr
                            key={i}
                            className={`border-b border-[#1e2130]/50 hover:bg-zinc-900/20 transition-colors ${
                              !closed ? "opacity-50" : ""
                            }`}
                          >
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <div
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: trade.modelColor }}
                                />
                                <span className="text-zinc-400 max-w-[80px] truncate">
                                  {trade.modelName.replace('.pkl', '')}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-zinc-500 font-mono whitespace-nowrap">
                              {trade.Entry_Date}
                            </td>
                            <td className="px-3 py-2 text-zinc-500 font-mono whitespace-nowrap">
                              {closed ? trade.Exit_Date : "—"}
                            </td>
                            <td className="px-3 py-2 text-white font-mono font-bold whitespace-nowrap">
                              {trade.Entry?.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-white font-mono font-bold whitespace-nowrap">
                              {closed ? trade.Exit?.toFixed(2) : "—"}
                            </td>
                            <td className="px-3 py-2 font-mono font-black whitespace-nowrap">
                              {closed ? (
                                <span style={{ color: isPos ? "#26a69a" : "#ef5350" }}>
                                  {isPos ? "+" : ""}{(trade.PnL_Pct * 100).toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-zinc-600">{t("backtest.trade.open")}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-zinc-500 font-mono whitespace-nowrap">
                              {closed ? trade.Days_Held : "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {closed ? (
                                <span
                                  className="px-1.5 py-0.5 rounded-md text-[9px] font-bold"
                                  style={{
                                    backgroundColor: isPos ? "#26a69a22" : "#ef535022",
                                    color: isPos ? "#26a69a" : "#ef5350"
                                  }}
                                >
                                  {trade.Result?.replace(" 🎯", "").replace(" [X]", "").replace(" [OK]", "") || "—"}
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-indigo-500/10 text-indigo-400">
                                  {t("backtest.trade.open")}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-zinc-500 font-mono whitespace-nowrap">
                              {trade.Radar_Score
                                ? `${(trade.Radar_Score * 100).toFixed(0)}%`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredVisibleTrades.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-3 py-8 text-center text-zinc-600">
                            {t("backtest.trade.empty")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StrategyTesterPage() {
  return (
    <Suspense fallback={
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#0d0f17] text-[#787b86]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
        <span className="text-xs font-bold uppercase tracking-wider">Loading Strategy Tester...</span>
      </div>
    }>
      <StrategyTesterContent />
    </Suspense>
  );
}
