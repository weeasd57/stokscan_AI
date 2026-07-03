"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  SeriesMarker,
  ColorType,
} from "lightweight-charts";
import {
  Loader2,
  Eye,
  EyeOff,
  BarChart3,
  AlertCircle,
  Search,
  X,
  Trash2,
  Plus,
  Sliders,
} from "lucide-react";
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateATR,
  calculateStochastic,
  calculateCCI,
  Candle,
} from "@/lib/indicators";

interface ChartPoint {
  x: number;
  y: number;
  price: number;
  time: number;
}

type DrawingLineStyle = "solid" | "dashed" | "dotted";

interface DrawingStyle {
  color: string;
  lineWidth: number;
  lineStyle: DrawingLineStyle;
  fillColor?: string;
  textColor?: string;
  label?: string;
}

interface StoredChartPoint {
  price: number;
  time: number;
}

interface HorizontalDrawing {
  id: string;
  type: "horizontal";
  point: StoredChartPoint;
  style: DrawingStyle;
}

interface TrendDrawing {
  id: string;
  type: "trend";
  start: StoredChartPoint;
  end: StoredChartPoint;
  style: DrawingStyle;
}

interface RectangleDrawing {
  id: string;
  type: "rectangle";
  start: StoredChartPoint;
  end: StoredChartPoint;
  style: DrawingStyle;
}

interface FibDrawing {
  id: string;
  type: "fib";
  start: StoredChartPoint;
  end: StoredChartPoint;
  style: DrawingStyle;
}

interface RayDrawing {
  id: string;
  type: "ray";
  start: StoredChartPoint;
  end: StoredChartPoint;
  style: DrawingStyle;
}

interface ExtendedLineDrawing {
  id: string;
  type: "extendedLine";
  start: StoredChartPoint;
  end: StoredChartPoint;
  style: DrawingStyle;
}

interface TextDrawing {
  id: string;
  type: "text";
  point: StoredChartPoint;
  style: DrawingStyle;
  text: string;
}

type ChartDrawing =
  | HorizontalDrawing
  | TrendDrawing
  | RectangleDrawing
  | FibDrawing
  | RayDrawing
  | ExtendedLineDrawing
  | TextDrawing;

interface DrawingCollectionRow {
  id: string;
  drawings: ChartDrawing[];
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  color: "#22c55e",
  lineWidth: 2,
  lineStyle: "solid",
  fillColor: "rgba(34,197,94,0.14)",
  textColor: "#f8fafc",
  label: "",
};

const TOOL_DEFAULT_STYLES: Record<string, DrawingStyle> = {
  horizontal: {
    color: "#6366f1",
    lineWidth: 2,
    lineStyle: "dashed",
    textColor: "#c7d2fe",
    label: "S/R",
  },
  trend: {
    color: "#22c55e",
    lineWidth: 2,
    lineStyle: "solid",
    textColor: "#dcfce7",
    label: "Trend",
  },
  rectangle: {
    color: "#38bdf8",
    lineWidth: 2,
    lineStyle: "solid",
    fillColor: "rgba(56,189,248,0.15)",
    textColor: "#e0f2fe",
    label: "Zone",
  },
  fib: {
    color: "#f59e0b",
    lineWidth: 2,
    lineStyle: "dashed",
    fillColor: "rgba(245,158,11,0.08)",
    textColor: "#fde68a",
    label: "Fib",
  },
  ray: {
    color: "#f97316",
    lineWidth: 2,
    lineStyle: "solid",
    textColor: "#ffedd5",
    label: "Ray",
  },
  extendedLine: {
    color: "#a855f7",
    lineWidth: 2,
    lineStyle: "dotted",
    textColor: "#f3e8ff",
    label: "Ext",
  },
  text: {
    color: "#f8fafc",
    lineWidth: 1,
    lineStyle: "solid",
    textColor: "#f8fafc",
    label: "Note",
  },
};

const DRAWINGS_STORAGE_KEY = "chart_drawings_guest";

function lineStyleToSvgDash(lineStyle: DrawingLineStyle) {
  if (lineStyle === "dashed") return "8 6";
  if (lineStyle === "dotted") return "3 5";
  return undefined;
}

function withAlpha(hexColor: string, alpha: number) {
  if (!hexColor.startsWith("#") || (hexColor.length !== 7 && hexColor.length !== 4)) {
    return hexColor;
  }

  const hex =
    hexColor.length === 4
      ? `#${hexColor[1]}${hexColor[1]}${hexColor[2]}${hexColor[2]}${hexColor[3]}${hexColor[3]}`
      : hexColor;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface CustomMarker {
  time: number; // unix timestamp (seconds)
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
  size?: number;
}

interface TradingViewChartProps {
  symbol: string;
  theme?: "dark" | "light";
  exchange?: string;
  activeTool?: string;
  onToolDrawComplete?: () => void;
  customMarkers?: CustomMarker[];
  focusTimestamp?: number; // unix seconds — scrolls chart to this candle
  hideIndicators?: boolean;
  showApiMarkers?: boolean;
}

export interface ActiveIndicator {
  id: string;
  type: "EMA" | "SMA" | "BB" | "RSI" | "MACD" | "ATR" | "STOCH" | "CCI";
  params: Record<string, number>;
  color: string;
  visible: boolean;
}

const AVAILABLE_INDICATORS = [
  {
    type: "EMA",
    name: "Exponential Moving Average (EMA)",
    desc: "Exponential moving average of close prices.",
    category: "Overlays",
  },
  {
    type: "SMA",
    name: "Simple Moving Average (SMA)",
    desc: "Arithmetic mean of close prices over a specified period.",
    category: "Overlays",
  },
  {
    type: "BB",
    name: "Bollinger Bands (BB)",
    desc: "Volatility bands placed above and below a moving average.",
    category: "Overlays",
  },
  {
    type: "RSI",
    name: "Relative Strength Index (RSI)",
    desc: "Momentum oscillator that measures velocity and change of price.",
    category: "Oscillators",
  },
  {
    type: "MACD",
    name: "Moving Average Convergence Divergence (MACD)",
    desc: "Trend-following momentum indicator showing EMA relationship.",
    category: "Oscillators",
  },
  {
    type: "ATR",
    name: "Average True Range (ATR)",
    desc: "Market volatility indicator showing average price range movement.",
    category: "Volatility",
  },
  {
    type: "STOCH",
    name: "Stochastic Oscillator",
    desc: "Compares closing price to its price range over a period.",
    category: "Oscillators",
  },
  {
    type: "CCI",
    name: "Commodity Channel Index (CCI)",
    desc: "Measures current price relative to average price level.",
    category: "Oscillators",
  },
];

const COLOR_PALETTE = [
  "#2196f3",
  "#ff9800",
  "#e91e63",
  "#9c27b0",
  "#4caf50",
  "#00bcd4",
  "#ffeb3b",
];

const DEFAULT_CUSTOM_MARKERS: CustomMarker[] = [];

export default function TradingViewChart({
  symbol,
  theme = "dark",
  exchange,
  activeTool = "cursor",
  onToolDrawComplete,
  customMarkers = DEFAULT_CUSTOM_MARKERS,
  focusTimestamp,
  hideIndicators = false,
  showApiMarkers = true,
}: TradingViewChartProps) {
  const { user } = useAuth();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const priceContainerRef = useRef<HTMLDivElement>(null);
  const paneContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const activeChartIdRef = useRef<string | null>(null);

  // States
  const [candlesData, setCandlesData] = useState<Candle[]>([]);
  const [markersData, setMarkersData] = useState<any[]>([]);
  const [timeframe, setTimeframe] = useState<string>("15m");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showIndicatorModal, setShowIndicatorModal] = useState<boolean>(false);
  const [indicatorSearchQuery, setIndicatorSearchQuery] = useState<string>("");

  // Dynamic active indicators list
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>(
    hideIndicators
      ? []
      : [
          {
            id: "ema-50",
            type: "EMA",
            params: { period: 50 },
            color: "#e91e63",
            visible: true,
          },
          {
            id: "ema-200",
            type: "EMA",
            params: { period: 200 },
            color: "#9c27b0",
            visible: true,
          },
          {
            id: "rsi-14",
            type: "RSI",
            params: { period: 14 },
            color: "#7e57c2",
            visible: true,
          },
        ],
  );

  // Hover details legend state
  const [hoverData, setHoverData] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    indicatorValues: Record<string, any>;
  } | null>(null);

  // Refs for charts and series for update/destroy lifecycle
  const chartRefs = useRef<{
    priceChart: IChartApi | null;
    candlestickSeries: ISeriesApi<"Candlestick"> | null;
    volumeSeries: ISeriesApi<"Histogram"> | null;
    lowerCharts: Map<string, IChartApi>;
    indicatorSeries: Map<string, ISeriesApi<any>[]>;
  }>({
    priceChart: null,
    candlestickSeries: null,
    volumeSeries: null,
    lowerCharts: new Map(),
    indicatorSeries: new Map(),
  });

  const lastSize = useRef({ width: 0, height: 0 });
  const savedLogicalRangeRef = useRef<{ from: number; to: number } | null>(
    null,
  );
  const priceLinesRef = useRef<any[]>([]);
  const drawnPriceLevelsRef = useRef<number[]>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [drawingPreview, setDrawingPreview] = useState<ChartDrawing | null>(
    null,
  );
  const drawingStartPointRef = useRef<ChartPoint | null>(null);
  const [drawingStartPoint, setDrawingStartPoint] = useState<ChartPoint | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [drawingStyle, setDrawingStyle] = useState<DrawingStyle>(
    TOOL_DEFAULT_STYLES[activeTool] ?? DEFAULT_DRAWING_STYLE,
  );
  const [overlayVersion, setOverlayVersion] = useState(0);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  // Drag-to-move drawing state
  const [isDraggingDrawing, setIsDraggingDrawing] = useState(false);
  const dragStateRef = useRef<{
    drawingId: string;
    mode: "move" | "start" | "end" | "point";
    lastX: number;
    lastY: number;
  } | null>(null);
  const moveDrawingRef = useRef<(id: string, dx: number, dy: number) => void>(() => {});
  const moveDrawingHandleRef = useRef<(id: string, mode: "start" | "end" | "point", dx: number, dy: number) => void>(() => {});
  const stopDrawingDragRef = useRef<(() => void) | null>(null);

  // Properties panel position/size state (persisted to localStorage)
  const PROPS_PANEL_STORAGE_KEY = "chart_props_panel_state";
  const loadPropsPanelState = () => {
    if (typeof window === "undefined") return { x: 10, y: 10, width: 260 };
    try {
      const raw = localStorage.getItem(PROPS_PANEL_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { x: 10, y: 10, width: 260 };
  };
  const [propsPanelPos, setPropsPanelPos] = useState<{ x: number; y: number; width: number }>(loadPropsPanelState);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const panelDragOffsetRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });
  const panelResizeStartRef = useRef<{ mouseX: number; startYWidth: number }>({ mouseX: 0, startYWidth: 0 });
  const isDraggingPanelRef = useRef(false);
  const isResizingPanelRef = useRef(false);

  const persistPropsPanelState = (pos: { x: number; y: number; width: number }) => {
    if (typeof window === "undefined") return;
    try { localStorage.setItem(PROPS_PANEL_STORAGE_KEY, JSON.stringify(pos)); } catch {}
  };

  const createDrawingId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const getDrawingStorageScope = () =>
    `${String(exchange || "").toUpperCase()}::${String(symbol || "").toUpperCase()}`;

  const toStoredPoint = (point: ChartPoint): StoredChartPoint => ({
    price: point.price,
    time: point.time,
  });

  const cloneStyle = (style: DrawingStyle): DrawingStyle => ({
    ...style,
    fillColor:
      style.fillColor ??
      withAlpha(style.color, style.lineStyle === "dotted" ? 0.08 : 0.14),
    textColor: style.textColor ?? style.color,
    label: style.label ?? "",
  });

  const persistGuestDrawings = (nextDrawings: ChartDrawing[]) => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, ChartDrawing[]>) : {};
      parsed[getDrawingStorageScope()] = nextDrawings;
      localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify(parsed));
    } catch {}
  };

  const saveDrawings = async (nextDrawings: ChartDrawing[]) => {
    persistGuestDrawings(nextDrawings);
    if (!user) return;

    await supabase.from("chart_drawings").upsert(
      {
        user_id: user.id,
        symbol: String(symbol).toUpperCase(),
        exchange: String(exchange || "EGX").toUpperCase(),
        drawings: nextDrawings,
      },
      { onConflict: "user_id,symbol,exchange" },
    );
  };

  const updateDrawings = (updater: (prev: ChartDrawing[]) => ChartDrawing[]) => {
    setDrawings((prev) => {
      const next = updater(prev);
      void saveDrawings(next);
      return next;
    });
  };

  const updateDrawingStyle = (drawingId: string, newStyle: DrawingStyle) => {
    updateDrawings((prev) =>
      prev.map((d) =>
        d.id === drawingId ? { ...d, style: newStyle } : d,
      ),
    );
    nudgeOverlay();
  };

  const deleteDrawing = (drawingId: string) => {
    updateDrawings((prev) => prev.filter((d) => d.id !== drawingId));
    setSelectedDrawingId(null);
    nudgeOverlay();
  };

  const moveDrawing = (drawingId: string, deltaX: number, deltaY: number) => {
    const chart = chartRefs.current.priceChart;
    const series = chartRefs.current.candlestickSeries;
    if (!chart || !series) return;

    updateDrawings((prev) =>
      prev.map((d) => {
        if (d.id !== drawingId) return d;

        if (d.type === "horizontal" || d.type === "text") {
          const point = d.type === "horizontal" ? d.point : d.point;
          const currentY = series.priceToCoordinate(point.price);
          if (currentY === null) return d;
          const newPrice = series.coordinateToPrice(currentY + deltaY);
          if (newPrice === null) return d;
          const newTime = chart.timeScale().coordinateToTime(
            chart.timeScale().timeToCoordinate(point.time as UTCTimestamp)! + deltaX
          );
          if (newTime === null) return d;
          return {
            ...d,
            point: { price: newPrice, time: Number(newTime) },
          };
        }

        // Two-point drawings
        const startY = series.priceToCoordinate(d.start.price);
        const endY = series.priceToCoordinate(d.end.price);
        const startX = chart.timeScale().timeToCoordinate(d.start.time as UTCTimestamp);
        const endX = chart.timeScale().timeToCoordinate(d.end.time as UTCTimestamp);
        if (startY === null || endY === null || startX === null || endX === null) return d;

        const newStartPrice = series.coordinateToPrice(startY + deltaY);
        const newEndPrice = series.coordinateToPrice(endY + deltaY);
        const newStartTime = chart.timeScale().coordinateToTime(startX + deltaX);
        const newEndTime = chart.timeScale().coordinateToTime(endX + deltaX);
        if (newStartPrice === null || newEndPrice === null || newStartTime === null || newEndTime === null) return d;

        return {
          ...d,
          start: { price: newStartPrice, time: Number(newStartTime) },
          end: { price: newEndPrice, time: Number(newEndTime) },
        };
      }),
    );
    nudgeOverlay();
  };

  const moveDrawingHandle = (
    drawingId: string,
    handle: "start" | "end" | "point",
    deltaX: number,
    deltaY: number,
  ) => {
    const chart = chartRefs.current.priceChart;
    const series = chartRefs.current.candlestickSeries;
    if (!chart || !series) return;

    const movePoint = (point: StoredChartPoint): StoredChartPoint | null => {
      const currentX = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp);
      const currentY = series.priceToCoordinate(point.price);
      if (currentX === null || currentY === null) return null;
      const newTime = chart.timeScale().coordinateToTime(currentX + deltaX);
      const newPrice = series.coordinateToPrice(currentY + deltaY);
      if (newTime === null || newPrice === null) return null;
      return { time: Number(newTime), price: newPrice };
    };

    updateDrawings((prev) =>
      prev.map((d) => {
        if (d.id !== drawingId) return d;

        if ((d.type === "horizontal" || d.type === "text") && handle === "point") {
          const nextPoint = movePoint(d.point);
          return nextPoint ? { ...d, point: nextPoint } : d;
        }

        if (d.type !== "horizontal" && d.type !== "text") {
          if (handle === "start") {
            const nextStart = movePoint(d.start);
            return nextStart ? { ...d, start: nextStart } : d;
          }
          if (handle === "end") {
            const nextEnd = movePoint(d.end);
            return nextEnd ? { ...d, end: nextEnd } : d;
          }
        }

        return d;
      }),
    );
    nudgeOverlay();
  };

  moveDrawingRef.current = moveDrawing;
  moveDrawingHandleRef.current = moveDrawingHandle;

  const selectedDrawing = selectedDrawingId
    ? drawings.find((d) => d.id === selectedDrawingId)
    : null;
  const startDrawingDrag = (
    drawing: ChartDrawing,
    e: React.MouseEvent<SVGElement>,
    mode: "move" | "start" | "end" | "point" = "move",
  ) => {
    if (activeTool !== "cursor") return;
    if (e.button !== 0) return;

    setSelectedDrawingId(drawing.id);
    setDrawingStyle(cloneStyle(drawing.style));
    setIsDraggingDrawing(true);

    dragStateRef.current = {
      drawingId: drawing.id,
      mode,
      lastX: e.clientX,
      lastY: e.clientY,
    };

    document.body.style.cursor = mode === "move" ? "grabbing" : "crosshair";
    document.body.style.userSelect = "none";

    e.stopPropagation();
    e.preventDefault();
  };

  const toCanvasPoint = (point: StoredChartPoint): ChartPoint | null => {
    const chart = chartRefs.current.priceChart;
    const series = chartRefs.current.candlestickSeries;
    if (!chart || !series) return null;

    const x = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp);
    const y = series.priceToCoordinate(point.price);
    if (x === null || y === null) return null;

    return { x, y, price: point.price, time: point.time };
  };

  const getCurrentChartWidth = () => priceContainerRef.current?.clientWidth || 0;

  const nudgeOverlay = () => setOverlayVersion((prev) => prev + 1);

  const buildChartPoint = (param: any): ChartPoint | null => {
    if (!param?.point || !chartRefs.current.candlestickSeries || !chartRefs.current.priceChart) {
      return null;
    }
    const price = chartRefs.current.candlestickSeries.coordinateToPrice(
      param.point.y,
    );
    if (price === null || price === undefined) return null;
    const time = chartRefs.current.priceChart.timeScale().coordinateToTime(param.point.x);
    if (time === null || time === undefined) return null;
    return {
      x: param.point.x,
      y: param.point.y,
      price,
      time: Number(time),
    };
  };

  const finalizeTwoPointDrawing = (
    tool: string,
    start: ChartPoint,
    end: ChartPoint,
  ): ChartDrawing | null => {
    const id = createDrawingId();
    const style = cloneStyle(drawingStyle);
    if (tool === "trend") {
      return { id, type: "trend", start: toStoredPoint(start), end: toStoredPoint(end), style };
    }
    if (tool === "rectangle") {
      return {
        id,
        type: "rectangle",
        start: toStoredPoint(start),
        end: toStoredPoint(end),
        style: {
          ...style,
          fillColor: style.fillColor ?? withAlpha(style.color, 0.15),
        },
      };
    }
    if (tool === "fib") {
      return { id, type: "fib", start: toStoredPoint(start), end: toStoredPoint(end), style };
    }
    if (tool === "ray") {
      return { id, type: "ray", start: toStoredPoint(start), end: toStoredPoint(end), style };
    }
    if (tool === "extendedLine") {
      return { id, type: "extendedLine", start: toStoredPoint(start), end: toStoredPoint(end), style };
    }
    return null;
  };

  useEffect(() => {
    setDrawingStyle((prev) => {
      const defaults = TOOL_DEFAULT_STYLES[activeTool];
      return defaults ? { ...defaults, color: prev.color ?? defaults.color } : prev;
    });
  }, [activeTool]);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedDrawings() {
      if (typeof window === "undefined") return;

      const scope = getDrawingStorageScope();
      let guestDrawings: ChartDrawing[] = [];
      try {
        const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Record<string, ChartDrawing[]>) : {};
        guestDrawings = parsed[scope] ?? [];
      } catch {}

      if (!user) {
        if (!cancelled) setDrawings(guestDrawings);
        return;
      }

      const { data } = await supabase
        .from("chart_drawings")
        .select("id, drawings")
        .eq("user_id", user.id)
        .eq("symbol", String(symbol).toUpperCase())
        .eq("exchange", String(exchange || "EGX").toUpperCase())
        .maybeSingle<DrawingCollectionRow>();

      if (cancelled) return;
      const next = data?.drawings && Array.isArray(data.drawings) ? data.drawings : guestDrawings;
      setDrawings(next);
    }

    void loadSavedDrawings();
    return () => {
      cancelled = true;
    };
  }, [exchange, supabase, symbol, user]);

  // 1. Fetch OHLCV candles data from our FastAPI backend
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    savedLogicalRangeRef.current = null;

    async function fetchCandles() {
      try {
        let url = `/api/ai_bot/candles?symbol=${encodeURIComponent(symbol)}&limit=800`;
        if (exchange) {
          url += `&exchange=${encodeURIComponent(exchange)}`;
        }
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(
            `Failed to load historical candles (Status ${res.status})`,
          );
        }
        const data = await res.json();
        if (!isMounted) return;

        if (!data.candles || data.candles.length === 0) {
          throw new Error(
            "No historical data found in database for this symbol.",
          );
        }

        setCandlesData(data.candles);
        setMarkersData(data.markers || []);
        setTimeframe(data.timeframe || "15m");
        setLoading(false);
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load candle data.");
          setLoading(false);
        }
      }
    }

    void fetchCandles();

    return () => {
      isMounted = false;
    };
  }, [symbol, exchange]);

  // Indicators that render in separate lower panes
  const lowerPaneIndicators = useMemo(() => {
    return activeIndicators.filter(
      (ind) =>
        ind.visible &&
        ["RSI", "MACD", "ATR", "STOCH", "CCI"].includes(ind.type),
    );
  }, [activeIndicators]);

  // 2. Initialize and draw charts (Lightweight Charts Canvas)
  useEffect(() => {
    if (loading || error || candlesData.length === 0) return;

    const handleResize = (newWidth?: number, newHeight?: number) => {
      const width =
        newWidth !== undefined
          ? newWidth
          : mainContainerRef.current?.clientWidth || 0;
      const height =
        newHeight !== undefined
          ? newHeight
          : mainContainerRef.current?.clientHeight || 0;

      if (width <= 0 || height <= 0) return;

      if (chartRefs.current.priceChart) {
        const paneHeight = 120;
        const activeLowerPanesCount = lowerPaneIndicators.length;
        const pricePaneHeight = Math.max(
          150,
          height - activeLowerPanesCount * paneHeight - 45,
        );

        chartRefs.current.priceChart.resize(width, pricePaneHeight);
        lowerPaneIndicators.forEach((ind) => {
          const lowerChart = chartRefs.current.lowerCharts.get(ind.id);
          if (lowerChart) {
            lowerChart.resize(width, paneHeight);
          }
        });
      }
    };

    const width = mainContainerRef.current?.clientWidth || 0;
    const height = mainContainerRef.current?.clientHeight || 450;

    const paneHeight = 120;
    const activeLowerPanesCount = lowerPaneIndicators.length;
    const priceHeight = Math.max(
      150,
      height - activeLowerPanesCount * paneHeight - 45,
    );

    const chartTheme = theme === "light"
      ? {
          gridColor: "#e4e4e7",
          backgroundColor: "#fafafa",
          textColor: "#18181b",
          borderColor: "#d4d4d8",
          crosshairColor: "#4f46e5",
          volumeUp: "#16a34a33",
          volumeDown: "#dc262633",
        }
      : {
          gridColor: "#1f222e",
          backgroundColor: "#050816",
          textColor: "#d1d4dc",
          borderColor: "#2a2e39",
          crosshairColor: "#2962ff",
          volumeUp: "#26a69a40",
          volumeDown: "#ef535040",
        };

    // Create main Price Chart
    const priceChart = createChart(priceContainerRef.current!, {
      width: width,
      height: priceHeight,
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.backgroundColor },
        textColor: chartTheme.textColor,
      },
      grid: {
        vertLines: { color: chartTheme.gridColor },
        horzLines: { color: chartTheme.gridColor },
      },
      crosshair: {
        mode: 1, // Magnet mode
        vertLine: { labelBackgroundColor: chartTheme.crosshairColor },
        horzLine: { labelBackgroundColor: chartTheme.crosshairColor },
      },
      timeScale: {
        borderColor: chartTheme.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 30,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        borderColor: chartTheme.borderColor,
        minimumWidth: 80,
      },
      handleScroll: {
        mouseWheel: true, // ✅ allow scroll on main chart
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: false,
          price: true,
        },
        axisDoubleClickReset: {
          time: true,
          price: true,
        },
      },
    });
    chartRefs.current.priceChart = priceChart;

    // Add Candlestick Series
    const candlestickSeries = priceChart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
  const parseCandleTime = (rawTime: unknown): UTCTimestamp | null => {
    if (typeof rawTime === "number" && Number.isFinite(rawTime)) {
      return rawTime as UTCTimestamp;
    }

    if (rawTime instanceof Date && !Number.isNaN(rawTime.getTime())) {
      return Math.floor(rawTime.getTime() / 1000) as UTCTimestamp;
    }

    if (typeof rawTime === "string") {
      const parsed = new Date(rawTime);
      if (!Number.isNaN(parsed.getTime())) {
        return Math.floor(parsed.getTime() / 1000) as UTCTimestamp;
      }
      const numeric = Number(rawTime);
      if (Number.isFinite(numeric)) {
        return numeric as UTCTimestamp;
      }
      return null;
    }

    if (rawTime && typeof rawTime === "object") {
      const maybeDay = rawTime as { year?: unknown; month?: unknown; day?: unknown };
      const year = Number(maybeDay.year);
      const month = Number(maybeDay.month);
      const day = Number(maybeDay.day);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (!Number.isNaN(parsed.getTime())) {
          return Math.floor(parsed.getTime() / 1000) as UTCTimestamp;
        }
      }
    }

    return null;
  };

  const normalizedCandles = (Array.isArray(candlesData) ? candlesData : [])
    .map((c) => {
      if (!c || typeof c !== "object") return null;

      const time = parseCandleTime((c as any).time);

      const open = Number((c as any).open);
      const high = Number((c as any).high);
      const low = Number((c as any).low);
      const close = Number((c as any).close);

      if (time === null || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
        return null;
      }

      return {
        ...c,
        time: time as UTCTimestamp,
        open,
        high,
        low,
        close,
      };
    })
    .filter((c): c is any => c !== null);

  if (normalizedCandles.length === 0) {
    return;
  }

  candlestickSeries.setData(normalizedCandles);
    chartRefs.current.candlestickSeries = candlestickSeries;

    if (activeTool === "trash") {
      drawnPriceLevelsRef.current = [];
      if (onToolDrawComplete) {
        onToolDrawComplete();
      }
    }

    // Add Volume Overlay on Price Chart (scaled at bottom)
    const volumeSeries = priceChart.addHistogramSeries({
      color: chartTheme.volumeUp,
      priceFormat: { type: "volume" },
      priceScaleId: "", // Overlay
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });
    const volumeData = candlesData.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume || 0,
      color: c.close >= c.open ? chartTheme.volumeUp : chartTheme.volumeDown,
    }));
    volumeSeries.setData(volumeData);
    chartRefs.current.volumeSeries = volumeSeries;

    // --- Precalculate indicator data maps ---
    const calculatedIndicatorData = new Map<string, any>();
    activeIndicators.forEach((ind) => {
      if (!ind.visible) return;
      if (ind.type === "EMA") {
        calculatedIndicatorData.set(
          ind.id,
          calculateEMA(candlesData, ind.params.period || 9),
        );
      } else if (ind.type === "SMA") {
        calculatedIndicatorData.set(
          ind.id,
          calculateSMA(candlesData, ind.params.period || 20),
        );
      } else if (ind.type === "BB") {
        calculatedIndicatorData.set(
          ind.id,
          calculateBollingerBands(
            candlesData,
            ind.params.period || 20,
            ind.params.stdDev || 2,
          ),
        );
      } else if (ind.type === "RSI") {
        calculatedIndicatorData.set(
          ind.id,
          calculateRSI(candlesData, ind.params.period || 14),
        );
      } else if (ind.type === "MACD") {
        calculatedIndicatorData.set(
          ind.id,
          calculateMACD(
            candlesData,
            ind.params.fast || 12,
            ind.params.slow || 26,
            ind.params.signal || 9,
          ),
        );
      } else if (ind.type === "ATR") {
        calculatedIndicatorData.set(
          ind.id,
          calculateATR(candlesData, ind.params.period || 14),
        );
      } else if (ind.type === "STOCH") {
        calculatedIndicatorData.set(
          ind.id,
          calculateStochastic(
            candlesData,
            ind.params.k || 14,
            ind.params.d || 3,
          ),
        );
      } else if (ind.type === "CCI") {
        calculatedIndicatorData.set(
          ind.id,
          calculateCCI(candlesData, ind.params.period || 20),
        );
      }
    });

    // --- Draw Overlay Indicators on priceChart ---
    activeIndicators.forEach((ind) => {
      if (!ind.visible || !["EMA", "SMA", "BB"].includes(ind.type)) return;
      const data = calculatedIndicatorData.get(ind.id);
      if (!data) return;

      const seriesList: ISeriesApi<any>[] = [];

      if (ind.type === "EMA" || ind.type === "SMA") {
        const series = priceChart.addLineSeries({
          color: ind.color,
          lineWidth: 2,
          title: `${ind.type} (${ind.params.period})`,
        });
        series.setData(
          data.map((p: any) => ({
            time: p.time as UTCTimestamp,
            value: p.value,
          })),
        );
        seriesList.push(series);
      } else if (ind.type === "BB") {
        const upper = priceChart.addLineSeries({
          color: "#90caf9",
          lineWidth: 1,
          lineStyle: 2,
          title: "BB Upper",
        });
        upper.setData(
          data.map((p: any) => ({
            time: p.time as UTCTimestamp,
            value: p.upper,
          })),
        );

        const middle = priceChart.addLineSeries({
          color: "#42a5f5",
          lineWidth: 1,
          lineStyle: 0,
          title: "BB Basis",
        });
        middle.setData(
          data.map((p: any) => ({
            time: p.time as UTCTimestamp,
            value: p.middle,
          })),
        );

        const lower = priceChart.addLineSeries({
          color: "#90caf9",
          lineWidth: 1,
          lineStyle: 2,
          title: "BB Lower",
        });
        lower.setData(
          data.map((p: any) => ({
            time: p.time as UTCTimestamp,
            value: p.lower,
          })),
        );

        seriesList.push(upper, middle, lower);
      }

      chartRefs.current.indicatorSeries.set(ind.id, seriesList);
    });

    // --- Initialize dynamic lower pane charts ---
    const activeCharts: IChartApi[] = [priceChart];

    lowerPaneIndicators.forEach((ind) => {
      const container = paneContainersRef.current.get(ind.id);
      if (!container) return;

      const lowerChart = createChart(container, {
        width: width,
        height: paneHeight,
        layout: {
          background: { type: ColorType.Solid, color: chartTheme.backgroundColor },
          textColor: chartTheme.textColor,
        },
        grid: {
          vertLines: { color: chartTheme.gridColor },
          horzLines: { color: chartTheme.gridColor },
        },
        crosshair: { mode: 1 },
        timeScale: {
          borderColor: chartTheme.borderColor,
          visible: false, // hide time scale, sync with price chart
          rightOffset: 30,
          fixLeftEdge: false,
          fixRightEdge: false,
        },
        rightPriceScale: {
          borderColor: chartTheme.borderColor,
          entireTextOnly: true,
          minimumWidth: 80,
        },
        handleScroll: {
          mouseWheel: true, // ✅ allow scroll on lower pane charts too
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: {
            time: false,
            price: true,
          },
          axisDoubleClickReset: {
            time: true,
            price: true,
          },
        },
      });

      chartRefs.current.lowerCharts.set(ind.id, lowerChart);
      activeCharts.push(lowerChart);

      // Add indicator series to this chart
      const data = calculatedIndicatorData.get(ind.id);
      if (!data) return;

      const seriesList: ISeriesApi<any>[] = [];

      if (ind.type === "RSI" || ind.type === "ATR" || ind.type === "CCI") {
        const series = lowerChart.addLineSeries({
          color: ind.color,
          lineWidth: 2,
        });
        const seriesData = candlesData.map((c) => {
          const p = data.find((pt: any) => pt.time === c.time);
          return p !== undefined
            ? { time: c.time as UTCTimestamp, value: p.value }
            : { time: c.time as UTCTimestamp };
        });
        series.setData(seriesData);
        seriesList.push(series);

        series.priceScale().applyOptions({
          scaleMargins: {
            top: 0.15,
            bottom: 0.15,
          },
        });
      } else if (ind.type === "MACD") {
        const macdLine = lowerChart.addLineSeries({
          color: "#2962ff",
          lineWidth: 2,
        });
        const macdLineData = candlesData.map((c) => {
          const p = data.find((pt: any) => pt.time === c.time);
          return p !== undefined
            ? { time: c.time as UTCTimestamp, value: p.macd }
            : { time: c.time as UTCTimestamp };
        });
        macdLine.setData(macdLineData);
        seriesList.push(macdLine);

        const macdSignal = lowerChart.addLineSeries({
          color: "#ff6d00",
          lineWidth: 2,
        });
        const macdSignalData = candlesData.map((c) => {
          const p = data.find((pt: any) => pt.time === c.time);
          return p !== undefined
            ? { time: c.time as UTCTimestamp, value: p.signal }
            : { time: c.time as UTCTimestamp };
        });
        macdSignal.setData(macdSignalData);
        seriesList.push(macdSignal);

        const macdHist = lowerChart.addHistogramSeries({ color: "#26a69a" });
        const macdHistData = candlesData.map((c) => {
          const p = data.find((pt: any) => pt.time === c.time);
          return p !== undefined
            ? {
                time: c.time as UTCTimestamp,
                value: p.histogram,
                color: p.histogram >= 0 ? "#26a69a80" : "#ef535080",
              }
            : { time: c.time as UTCTimestamp };
        });
        macdHist.setData(macdHistData);
        seriesList.push(macdHist);
      } else if (ind.type === "STOCH") {
        const kSeries = lowerChart.addLineSeries({
          color: "#2196f3",
          lineWidth: 2,
        });
        const dSeries = lowerChart.addLineSeries({
          color: "#ff9800",
          lineWidth: 2,
          lineStyle: 2,
        });

        const kData = candlesData.map((c) => {
          const p = data.find((pt: any) => pt.time === c.time);
          return p !== undefined
            ? { time: c.time as UTCTimestamp, value: p.k }
            : { time: c.time as UTCTimestamp };
        });
        const dData = candlesData.map((c) => {
          const p = data.find((pt: any) => pt.time === c.time);
          return p !== undefined
            ? { time: c.time as UTCTimestamp, value: p.d }
            : { time: c.time as UTCTimestamp };
        });
        kSeries.setData(kData);
        dSeries.setData(dData);
        seriesList.push(kSeries, dSeries);
      }

      chartRefs.current.indicatorSeries.set(ind.id, seriesList);
    });

    // Sync visual timescales across active pane charts
    if (activeCharts.length >= 1) {
      const totalBars = candlesData.length;

      // Helper to get chart ID
      const getChartId = (chart: IChartApi) => {
        if (chart === priceChart) return "price";
        for (const [
          id,
          lowerChart,
        ] of chartRefs.current.lowerCharts.entries()) {
          if (lowerChart === chart) return id;
        }
      };

      for (let i = 0; i < activeCharts.length; i++) {
        const chartA = activeCharts[i];
        const chartAId = getChartId(chartA);

        chartA.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!range) return;
          nudgeOverlay();

          // Only sync if the range change is originating from the chart currently being hovered/touched
          if (activeChartIdRef.current !== chartAId) {
            return;
          }

          let from = range.from;
          let to = range.to;
          const width = to - from;

          const maxFrom = totalBars - 5;
          const minTo = 5;

          let needsClamping = false;
          if (from > maxFrom) {
            from = maxFrom as any;
            to = (from + width) as any;
            needsClamping = true;
          }
          if (to < minTo) {
            to = minTo as any;
            from = (to - width) as any;
            needsClamping = true;
          }

          const targetRange = needsClamping ? { from, to } : range;
          for (let j = 0; j < activeCharts.length; j++) {
            if (needsClamping || i !== j) {
              const targetChart = activeCharts[j];
              const currentRange = targetChart
                .timeScale()
                .getVisibleLogicalRange();
              if (
                !currentRange ||
                Math.abs(currentRange.from - targetRange.from) > 0.01 ||
                Math.abs(currentRange.to - targetRange.to) > 0.01
              ) {
                targetChart.timeScale().setVisibleLogicalRange(targetRange);
              }
            }
          }
        });
      }
    }

    // --- Render Strategy Trade Markers (API + custom injected) ---
    {
      const candleTimes = new Set(candlesData.map((c) => c.time));

      const getSafeISOString = (time: any): string | null => {
        if (!time) return null;
        try {
          if (typeof time === "string") {
            if (/^\d{4}-\d{2}-\d{2}/.test(time)) {
              return time.slice(0, 10);
            }
            const d = new Date(time);
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
          }
          if (typeof time === "number") {
            const isMs = time > 5e10;
            const d = new Date(isMs ? time : time * 1000);
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
          }
          if (typeof time === "object") {
            if (typeof time.year === "number" && typeof time.month === "number" && typeof time.day === "number") {
              const year = String(time.year);
              const month = String(time.month).padStart(2, "0");
              const day = String(time.day).padStart(2, "0");
              return `${year}-${month}-${day}`;
            }
          }
        } catch (e) {}
        return null;
      };

      // Build date-string → candle-time map for daily candle matching
      // (trade dates are YYYY-MM-DD midnight UTC; candles may use market-open time)
      const dateMap = new Map<string, string | number>();
      for (const c of candlesData) {
        const dateStr = getSafeISOString(c.time);
        if (dateStr && !dateMap.has(dateStr)) {
          dateMap.set(dateStr, c.time);
        }
      }

      // Build sorted candle times for nearest-candle fallback
      const sortedCandleTimes = candlesData
        .map((c) => {
          let tsVal = 0;
          if (typeof c.time === "number") {
            tsVal = c.time > 5e10 ? Math.floor(c.time / 1000) : c.time;
          } else {
            const dateStr = getSafeISOString(c.time);
            tsVal = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : NaN;
          }
          return { time: c.time, tsVal };
        })
        .filter((item) => !isNaN(item.tsVal))
        .sort((a, b) => a.tsVal - b.tsVal);

      // Helper: snap a unix-seconds timestamp to the nearest candle
      const snapToCandle = (ts: number): UTCTimestamp | null => {
        if (isNaN(ts)) return null;

        // 1. Exact match
        if (candleTimes.has(ts)) return ts as any as UTCTimestamp;

        // 2. Date-string match (handles timezone offset for daily bars)
        const dateStr = getSafeISOString(ts);
        if (dateStr && dateMap.has(dateStr)) return dateMap.get(dateStr)! as any as UTCTimestamp;

        // 3. Nearest candle fallback
        let bestTime: any = null;
        let bestDiff = Infinity;
        for (const item of sortedCandleTimes) {
          const diff = Math.abs(item.tsVal - ts);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestTime = item.time;
          } else if (diff > bestDiff) break;
        }
        return bestTime !== null ? (bestTime as any as UTCTimestamp) : null;
      };

      const apiMarkers: SeriesMarker<UTCTimestamp>[] = (
        showApiMarkers && markersData ? markersData : []
      )
        .filter((m) => candleTimes.has(m.time))
        .map((m) => ({
          time: m.time as UTCTimestamp,
          position: m.position,
          color: m.color,
          shape: m.shape,
          text: m.text,
          size: 1.5,
        }));

      const injectedMarkers: SeriesMarker<UTCTimestamp>[] = (
        customMarkers || []
      )
        .map((m) => {
          const snapped = snapToCandle(m.time as number);
          if (!snapped) return null;
          return {
            time: snapped,
            position: m.position,
            color: m.color,
            shape: m.shape,
            text: m.text || "",
            size: m.size ?? 2,
          } as SeriesMarker<UTCTimestamp>;
        })
        .filter(Boolean) as SeriesMarker<UTCTimestamp>[];

      const allMarkers = [...apiMarkers, ...injectedMarkers].sort(
        (a, b) => (a.time as number) - (b.time as number),
      );

      if (allMarkers.length > 0) {
        candlestickSeries.setMarkers(allMarkers);
      }
    }

    // --- Setup drawing interactions ---
    priceChart.subscribeClick((param) => {
      if (!param.point || !candlestickSeries) return;

      const tool = activeToolRef.current;

      if (tool === "cursor") {
        setSelectedDrawingId(null);
        return;
      }

      if (tool === "horizontal") {
        const clickedPrice = candlestickSeries.coordinateToPrice(param.point.y);
        if (clickedPrice === null || clickedPrice === undefined) return;

        const point = buildChartPoint(param);
        if (!point) return;
        updateDrawings((prev) => [
          ...prev,
          {
            id: createDrawingId(),
            type: "horizontal",
            point: toStoredPoint(point),
            style: cloneStyle(drawingStyle),
          },
        ]);

        if (onToolDrawComplete) {
          onToolDrawComplete();
        }
        nudgeOverlay();
        return;
      }

      if (tool === "text") {
        const point = buildChartPoint(param);
        if (!point) return;

        const nextLabel = window.prompt("Text label", drawingStyle.label || "Note");
        if (!nextLabel) return;

        updateDrawings((prev) => [
          ...prev,
          {
            id: createDrawingId(),
            type: "text",
            point: toStoredPoint(point),
            text: nextLabel,
            style: { ...cloneStyle(drawingStyle), label: nextLabel },
          },
        ]);

        if (onToolDrawComplete) {
          onToolDrawComplete();
        }
        nudgeOverlay();
        return;
      }

      if (!["trend", "rectangle", "fib", "ray", "extendedLine"].includes(tool)) {
        return;
      }

      const point = buildChartPoint(param);
      if (!point) return;

      if (!drawingStartPointRef.current) {
        drawingStartPointRef.current = point;
        setDrawingStartPoint(point);
        setDrawingPreview(null);
        nudgeOverlay();
        return;
      }

      const nextDrawing = finalizeTwoPointDrawing(
        tool,
        drawingStartPointRef.current,
        point,
      );
      drawingStartPointRef.current = null;
      setDrawingStartPoint(null);
      setDrawingPreview(null);

      if (nextDrawing) {
        updateDrawings((prev) => [...prev, nextDrawing]);
        if (onToolDrawComplete) {
          onToolDrawComplete();
        }
        nudgeOverlay();
      }
    });

    // --- Setup Crosshair Tooltip Hover Legend details ---
    priceChart.subscribeCrosshairMove((param) => {
      const tool = activeToolRef.current;
      if (
        ["trend", "rectangle", "fib", "ray", "extendedLine"].includes(tool) &&
        drawingStartPointRef.current &&
        param.point
      ) {
        const point = buildChartPoint(param);
        if (point) {
          setDrawingPreview(
            finalizeTwoPointDrawing(
              tool,
              drawingStartPointRef.current,
              point,
            ),
          );
          nudgeOverlay();
        }
      }

      if (!param.time || !param.point) {
        setHoverData(null);
        return;
      }

      const candle = candlesData.find((c) => c.time === param.time);
      if (!candle) return;

      const t = param.time as number;
      const values: Record<string, any> = {};

      activeIndicators.forEach((ind) => {
        if (!ind.visible) return;
        const data = calculatedIndicatorData.get(ind.id);
        if (!data) return;

        if (
          ind.type === "EMA" ||
          ind.type === "SMA" ||
          ind.type === "RSI" ||
          ind.type === "ATR" ||
          ind.type === "CCI"
        ) {
          const pt = data.find((p: any) => p.time === t);
          if (pt) values[ind.id] = pt.value;
        } else if (ind.type === "BB") {
          const pt = data.find((p: any) => p.time === t);
          if (pt)
            values[ind.id] = {
              upper: pt.upper,
              middle: pt.middle,
              lower: pt.lower,
            };
        } else if (ind.type === "MACD") {
          const pt = data.find((p: any) => p.time === t);
          if (pt)
            values[ind.id] = {
              macd: pt.macd,
              signal: pt.signal,
              histogram: pt.histogram,
            };
        } else if (ind.type === "STOCH") {
          const pt = data.find((p: any) => p.time === t);
          if (pt) values[ind.id] = { k: pt.k, d: pt.d };
        }
      });

      setHoverData({
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        indicatorValues: values,
      });
    });

    // Setup resize hook using ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      const roundedWidth = Math.floor(width);
      const roundedHeight = Math.floor(height);
      if (
        roundedWidth > 0 &&
        roundedHeight > 0 &&
        (roundedWidth !== lastSize.current.width ||
          roundedHeight !== lastSize.current.height)
      ) {
        lastSize.current = { width: roundedWidth, height: roundedHeight };
        handleResize(roundedWidth, roundedHeight);
      }
    });

    if (mainContainerRef.current) {
      resizeObserver.observe(mainContainerRef.current);
    }

    priceChart.timeScale().subscribeVisibleTimeRangeChange(() => {
      nudgeOverlay();
    });

    // Initial resize and scale sync
    handleResize();

    if (chartRefs.current.priceChart) {
      let range = savedLogicalRangeRef.current;
      if (!range) {
        const totalBars = candlesData.length;
        const from = Math.max(0, totalBars - 150);
        range = { from, to: totalBars };
      }

      chartRefs.current.priceChart.timeScale().setVisibleLogicalRange(range);

      const currentRange = chartRefs.current.priceChart
        .timeScale()
        .getVisibleLogicalRange();
      if (currentRange) {
        lowerPaneIndicators.forEach((ind) => {
          const lowerChart = chartRefs.current.lowerCharts.get(ind.id);
          if (lowerChart) {
            lowerChart.timeScale().setVisibleLogicalRange(currentRange);
          }
        });
      }
    }

    return () => {
      resizeObserver.disconnect();

      // Save current logical range
      if (chartRefs.current.priceChart) {
        const range = chartRefs.current.priceChart
          .timeScale()
          .getVisibleLogicalRange();
        if (range) {
          savedLogicalRangeRef.current = { from: range.from, to: range.to };
        }
      }

      // Clean up price chart and series
      if (chartRefs.current.priceChart) {
        if (chartRefs.current.candlestickSeries) {
          try {
            chartRefs.current.priceChart.removeSeries(
              chartRefs.current.candlestickSeries,
            );
          } catch {}
          chartRefs.current.candlestickSeries = null;
        }
        if (chartRefs.current.volumeSeries) {
          try {
            chartRefs.current.priceChart.removeSeries(
              chartRefs.current.volumeSeries,
            );
          } catch {}
          chartRefs.current.volumeSeries = null;
        }

        chartRefs.current.indicatorSeries.forEach((seriesList) => {
          seriesList.forEach((series) => {
            try {
              chartRefs.current.priceChart?.removeSeries(series);
            } catch {}
          });
        });

        chartRefs.current.priceChart.remove();
        chartRefs.current.priceChart = null;
      }

      // Clean up lower charts
      chartRefs.current.lowerCharts.forEach((lowerChart) => {
        try {
          lowerChart.remove();
        } catch {}
      });
      chartRefs.current.lowerCharts.clear();
      chartRefs.current.indicatorSeries.clear();
    };
  }, [
    candlesData,
    activeIndicators,
    loading,
    error,
    markersData,
    lowerPaneIndicators,
    customMarkers,
    theme,
  ]);

  useEffect(() => {
    if (activeTool === "trash") {
      drawnPriceLevelsRef.current = [];
      drawingStartPointRef.current = null;
      setDrawingStartPoint(null);
      setDrawingPreview(null);
      setSelectedDrawingId(null);
      updateDrawings(() => []);
      if (onToolDrawComplete) {
        onToolDrawComplete();
      }
    }

    if (!["trend", "rectangle", "fib", "ray", "extendedLine"].includes(activeTool)) {
      drawingStartPointRef.current = null;
      setDrawingStartPoint(null);
      setDrawingPreview(null);
    }
  }, [activeTool, onToolDrawComplete]);

  const renderSingleDrawing = (drawing: ChartDrawing, preview = false) => {
    const className = preview ? "opacity-70" : "opacity-100";
    const isSelected = selectedDrawingId === drawing.id && !preview;
    const strokeDasharray = lineStyleToSvgDash(drawing.style.lineStyle);
    const selectedStroke = drawing.style.color;
    const selectedWidth = drawing.style.lineWidth;
    const chartWidth = getCurrentChartWidth();

    if (drawing.type === "horizontal") {
      const point = toCanvasPoint(drawing.point);
      if (!point) return null;
      return (
        <g key={drawing.id} className={className}>
          <line
            x1={0}
            y1={point.y}
            x2={chartWidth}
            y2={point.y}
            stroke={selectedStroke}
            strokeWidth={selectedWidth}
            strokeDasharray={strokeDasharray}
          />
          <text
            x={Math.max(12, chartWidth - 88)}
            y={point.y - 6}
            fill={drawing.style.textColor || drawing.style.color}
            fontSize="10"
            fontWeight="700"
          >
            {drawing.style.label || `${drawing.point.price.toFixed(2)}`}
          </text>
        </g>
      );
    }

    if (drawing.type === "text") {
      const point = toCanvasPoint(drawing.point);
      if (!point) return null;
      return (
        <g key={drawing.id} className={className}>
          <text
            x={point.x}
            y={point.y}
            fill={drawing.style.textColor || drawing.style.color}
            fontSize="12"
            fontWeight="700"
          >
            {drawing.text}
          </text>
        </g>
      );
    }

    if (drawing.type === "trend" || drawing.type === "ray" || drawing.type === "extendedLine") {
      const start = toCanvasPoint(drawing.start);
      const end = toCanvasPoint(drawing.end);
      if (!start || !end) return null;

      let x1 = start.x;
      let y1 = start.y;
      let x2 = end.x;
      let y2 = end.y;

      if (drawing.type === "ray" || drawing.type === "extendedLine") {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (Math.abs(dx) > 0.001) {
          const slope = dy / dx;
          if (drawing.type === "ray") {
            x2 = chartWidth + 120;
            y2 = start.y + slope * (x2 - start.x);
          } else {
            x1 = -120;
            y1 = start.y + slope * (x1 - start.x);
            x2 = chartWidth + 120;
            y2 = start.y + slope * (x2 - start.x);
          }
        }
      }

      return (
        <g key={drawing.id} className={className}>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={selectedStroke}
            strokeWidth={selectedWidth}
            strokeDasharray={strokeDasharray}
          />
        </g>
      );
    }

    if (drawing.type === "rectangle") {
      const start = toCanvasPoint(drawing.start);
      const end = toCanvasPoint(drawing.end);
      if (!start || !end) return null;

      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      return (
        <g key={drawing.id} className={className}>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill={drawing.style.fillColor || withAlpha(drawing.style.color, 0.14)}
            stroke={selectedStroke}
            strokeWidth={selectedWidth}
            strokeDasharray={strokeDasharray}
          />
          {(drawing.style.label || "") && (
            <text
              x={x + 8}
              y={y + 16}
              fill={drawing.style.textColor || drawing.style.color}
              fontSize="10"
              fontWeight="700"
            >
              {drawing.style.label}
            </text>
          )}
          {isSelected && (
            <>
              <circle cx={start.x} cy={start.y} r="5" fill={drawing.style.color} stroke="white" strokeWidth="2" />
              <circle cx={end.x} cy={end.y} r="5" fill={drawing.style.color} stroke="white" strokeWidth="2" />
            </>
          )}
        </g>
      );
    }

    if (drawing.type === "fib") {
      const start = toCanvasPoint(drawing.start);
      const end = toCanvasPoint(drawing.end);
      if (!start || !end) return null;

      const minX = Math.min(start.x, end.x);
      const width = Math.max(40, Math.abs(end.x - start.x));
      const high = Math.max(drawing.start.price, drawing.end.price);
      const low = Math.min(drawing.start.price, drawing.end.price);
      const range = high - low || 1;
      const topY = drawing.start.price >= drawing.end.price ? start.y : end.y;
      const bottomY = drawing.start.price >= drawing.end.price ? end.y : start.y;

      return (
        <g key={drawing.id} className={className}>
          <rect
            x={minX}
            y={Math.min(topY, bottomY)}
            width={width}
            height={Math.abs(bottomY - topY)}
            fill={drawing.style.fillColor || withAlpha(drawing.style.color, 0.08)}
            stroke={withAlpha(drawing.style.color, 0.3)}
            strokeWidth="1"
          />
          {FIB_LEVELS.map((level) => {
            const price = high - range * level;
            const y = start.y + (end.y - start.y) * level;
            return (
              <g key={`${drawing.id}-${level}`}>
                <line
                  x1={minX}
                  y1={y}
                  x2={minX + width}
                  y2={y}
                  stroke={drawing.style.color}
                  strokeWidth={level === 0 || level === 1 ? selectedWidth : Math.max(1, selectedWidth - 0.5)}
                  strokeDasharray={level === 0 || level === 1 ? undefined : strokeDasharray || "5 4"}
                />
                <text
                  x={minX + width + 6}
                  y={y + 3}
                  fill={drawing.style.textColor || drawing.style.color}
                  fontSize="10"
                  fontWeight="700"
                >
                  {`${level.toFixed(3)}  ${price.toFixed(2)}`}
                </text>
              </g>
            );
          })}
          {isSelected && (
            <>
              <circle cx={start.x} cy={start.y} r="5" fill={drawing.style.color} stroke="white" strokeWidth="2" />
              <circle cx={end.x} cy={end.y} r="5" fill={drawing.style.color} stroke="white" strokeWidth="2" />
            </>
          )}
        </g>
      );
    }

    return null;
  };

  const renderDrawingHitArea = (drawing: ChartDrawing) => {
    const chartWidth = getCurrentChartWidth();
    const isSelected = selectedDrawingId === drawing.id;

    if (drawing.type === "horizontal") {
      const point = toCanvasPoint(drawing.point);
      if (!point) return null;
      return (
        <g key={`hit-${drawing.id}`} data-drawing-id={drawing.id} style={{ cursor: isSelected ? "grab" : "pointer" }}>
          <line
            x1={0}
            y1={point.y}
            x2={chartWidth}
            y2={point.y}
            stroke="rgba(0,0,0,0.001)"
            strokeWidth={Math.max(drawing.style.lineWidth, 16)}
            style={{ pointerEvents: "stroke" }}
            onMouseDown={(e) => startDrawingDrag(drawing, e)}
          />
          {isSelected && (
            <circle
              cx={chartWidth - 10}
              cy={point.y}
              r="8"
              fill="rgba(255,255,255,0.001)"
              style={{ cursor: "ns-resize", pointerEvents: "fill" }}
              onMouseDown={(e) => startDrawingDrag(drawing, e, "point")}
            />
          )}
        </g>
      );
    }

    if (drawing.type === "text") {
      const point = toCanvasPoint(drawing.point);
      if (!point) return null;
      const estW = drawing.text.length * 8 + 12;
      return (
        <g key={`hit-${drawing.id}`} data-drawing-id={drawing.id} style={{ cursor: isSelected ? "grab" : "pointer" }}>
          <rect
            x={point.x - 6}
            y={point.y - 14}
            width={estW}
            height="18"
            fill="rgba(0,0,0,0.001)"
            style={{ pointerEvents: "fill" }}
            onMouseDown={(e) => startDrawingDrag(drawing, e)}
          />
          {isSelected && (
            <circle
              cx={point.x}
              cy={point.y}
              r="8"
              fill="rgba(255,255,255,0.001)"
              style={{ cursor: "move", pointerEvents: "fill" }}
              onMouseDown={(e) => startDrawingDrag(drawing, e, "point")}
            />
          )}
        </g>
      );
    }

    if (drawing.type === "trend" || drawing.type === "ray" || drawing.type === "extendedLine") {
      const start = toCanvasPoint(drawing.start);
      const end = toCanvasPoint(drawing.end);
      if (!start || !end) return null;
      let x1 = start.x, y1 = start.y, x2 = end.x, y2 = end.y;
      if (drawing.type === "ray" || drawing.type === "extendedLine") {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (Math.abs(dx) > 0.001) {
          const slope = dy / dx;
          if (drawing.type === "ray") { x2 = chartWidth + 120; y2 = start.y + slope * (x2 - start.x); }
          else { x1 = -120; y1 = start.y + slope * (x1 - start.x); x2 = chartWidth + 120; y2 = start.y + slope * (x2 - start.x); }
        }
      }
      return (
        <g key={`hit-${drawing.id}`} data-drawing-id={drawing.id} style={{ cursor: isSelected ? "grab" : "pointer" }}>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="rgba(0,0,0,0.001)"
            strokeWidth={Math.max(drawing.style.lineWidth, 16)}
            style={{ pointerEvents: "stroke" }}
            onMouseDown={(e) => startDrawingDrag(drawing, e)}
          />
          {isSelected && (
            <>
              <circle
                cx={start.x}
                cy={start.y}
                r="8"
                fill="rgba(255,255,255,0.001)"
                style={{ cursor: "crosshair", pointerEvents: "fill" }}
                onMouseDown={(e) => startDrawingDrag(drawing, e, "start")}
              />
              <circle
                cx={end.x}
                cy={end.y}
                r="8"
                fill="rgba(255,255,255,0.001)"
                style={{ cursor: "crosshair", pointerEvents: "fill" }}
                onMouseDown={(e) => startDrawingDrag(drawing, e, "end")}
              />
            </>
          )}
        </g>
      );
    }

    if (drawing.type === "rectangle") {
      const start = toCanvasPoint(drawing.start);
      const end = toCanvasPoint(drawing.end);
      if (!start || !end) return null;
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      return (
        <g key={`hit-${drawing.id}`} data-drawing-id={drawing.id} style={{ cursor: isSelected ? "grab" : "pointer" }}>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="rgba(0,0,0,0.001)"
            style={{ pointerEvents: "fill" }}
            onMouseDown={(e) => startDrawingDrag(drawing, e)}
          />
          {isSelected && (
            <>
              <circle
                cx={start.x}
                cy={start.y}
                r="8"
                fill="rgba(255,255,255,0.001)"
                style={{ cursor: "nwse-resize", pointerEvents: "fill" }}
                onMouseDown={(e) => startDrawingDrag(drawing, e, "start")}
              />
              <circle
                cx={end.x}
                cy={end.y}
                r="8"
                fill="rgba(255,255,255,0.001)"
                style={{ cursor: "nwse-resize", pointerEvents: "fill" }}
                onMouseDown={(e) => startDrawingDrag(drawing, e, "end")}
              />
            </>
          )}
        </g>
      );
    }

    if (drawing.type === "fib") {
      const start = toCanvasPoint(drawing.start);
      const end = toCanvasPoint(drawing.end);
      if (!start || !end) return null;
      const minX = Math.min(start.x, end.x);
      const w = Math.max(40, Math.abs(end.x - start.x));
      const topY = Math.min(start.y, end.y);
      const h = Math.abs(end.y - start.y);
      return (
        <g key={`hit-${drawing.id}`} data-drawing-id={drawing.id} style={{ cursor: isSelected ? "grab" : "pointer" }}>
          <rect
            x={minX}
            y={topY}
            width={w}
            height={Math.max(h, 12)}
            fill="rgba(0,0,0,0.001)"
            style={{ pointerEvents: "fill" }}
            onMouseDown={(e) => startDrawingDrag(drawing, e)}
          />
          {isSelected && (
            <>
              <circle
                cx={start.x}
                cy={start.y}
                r="8"
                fill="rgba(255,255,255,0.001)"
                style={{ cursor: "crosshair", pointerEvents: "fill" }}
                onMouseDown={(e) => startDrawingDrag(drawing, e, "start")}
              />
              <circle
                cx={end.x}
                cy={end.y}
                r="8"
                fill="rgba(255,255,255,0.001)"
                style={{ cursor: "crosshair", pointerEvents: "fill" }}
                onMouseDown={(e) => startDrawingDrag(drawing, e, "end")}
              />
            </>
          )}
        </g>
      );
    }

    return null;
  };

  // --- Scroll chart to focusTimestamp when it changes (e.g. navigating between trades) ---
  useEffect(() => {
    if (
      !focusTimestamp ||
      !chartRefs.current.priceChart ||
      candlesData.length === 0
    )
      return;
    const chart = chartRefs.current.priceChart;
    const ts = chart.timeScale();

    const getSafeISOString = (time: any): string | null => {
      if (!time) return null;
      try {
        if (typeof time === "string") {
          if (/^\d{4}-\d{2}-\d{2}/.test(time)) {
            return time.slice(0, 10);
          }
          const d = new Date(time);
          return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        }
        if (typeof time === "number") {
          const isMs = time > 5e10;
          const d = new Date(isMs ? time : time * 1000);
          return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        }
        if (typeof time === "object") {
          if (typeof time.year === "number" && typeof time.month === "number" && typeof time.day === "number") {
            const year = String(time.year);
            const month = String(time.month).padStart(2, "0");
            const day = String(time.day).padStart(2, "0");
            return `${year}-${month}-${day}`;
          }
        }
      } catch (e) {}
      return null;
    };

    // Build date-string → index map to find bar index of focusTimestamp
    const dateStr = getSafeISOString(focusTimestamp);
    let targetIndex = -1;
    if (dateStr) {
      for (let i = 0; i < candlesData.length; i++) {
        const cDate = getSafeISOString(candlesData[i].time);
        if (cDate === dateStr) {
          targetIndex = i;
          break;
        }
      }
    }

    // Fall back to nearest timestamp
    if (targetIndex === -1) {
      let best = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < candlesData.length; i++) {
        const diff = Math.abs((candlesData[i].time as number) - focusTimestamp);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      }
      targetIndex = best;
    }

    // Show a window of ~60 bars centered on the target
    const half = 30;
    const from = Math.max(0, targetIndex - half);
    const to = Math.min(candlesData.length - 1, targetIndex + half);
    ts.setVisibleLogicalRange({ from, to });
  }, [focusTimestamp, candlesData]);

  // --- Drawing drag (move) lifecycle ---
  // Permanent global listeners so the drag ends reliably on pointer/mouse up,
  // blur, tab switch, or pointer leaving the document — even if the up event is
  // swallowed by the chart canvas. Movement only happens while the primary
  // button is held; the moment it is released the drawing drops.
  useEffect(() => {
    const stopDrag = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      setIsDraggingDrawing(false);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };
    stopDrawingDragRef.current = stopDrag;

    const onMove = (ev: PointerEvent | MouseEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      // Primary button no longer pressed -> drop immediately.
      if ((ev.buttons & 1) !== 1) {
        stopDrag();
        return;
      }
      const deltaX = ev.clientX - st.lastX;
      const deltaY = ev.clientY - st.lastY;
      st.lastX = ev.clientX;
      st.lastY = ev.clientY;
      if (deltaX === 0 && deltaY === 0) return;

      if (st.mode === "move") {
        moveDrawingRef.current(st.drawingId, deltaX, deltaY);
      } else {
        moveDrawingHandleRef.current(st.drawingId, st.mode, deltaX, deltaY);
      }
    };

    const onLeave = (ev: MouseEvent) => {
      if (!ev.relatedTarget) stopDrag();
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", stopDrag, true);
    window.addEventListener("pointercancel", stopDrag, true);
    window.addEventListener("mouseup", stopDrag, true);
    window.addEventListener("blur", stopDrag);
    document.addEventListener("mouseleave", onLeave, true);
    document.addEventListener("visibilitychange", stopDrag);

    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", stopDrag, true);
      window.removeEventListener("pointercancel", stopDrag, true);
      window.removeEventListener("mouseup", stopDrag, true);
      window.removeEventListener("blur", stopDrag);
      document.removeEventListener("mouseleave", onLeave, true);
      document.removeEventListener("visibilitychange", stopDrag);
      stopDrawingDragRef.current = null;
    };
  }, []);

  // --- Properties panel drag & resize effects ---
  useEffect(() => {
    const handleMove = (e: PointerEvent | MouseEvent) => {
      // 1. Panel Dragging
      if (isDraggingPanelRef.current) {
        // If left click is released, stop dragging immediately
        if ((e.buttons & 1) !== 1) {
          stopAll();
          return;
        }
        setPropsPanelPos((prev) => {
          const container = priceContainerRef.current;
          const maxX = Math.max(0, (container?.clientWidth || window.innerWidth) - prev.width - 8);
          const maxY = Math.max(0, (container?.clientHeight || window.innerHeight) - 80);
          const next = {
            x: Math.max(0, Math.min(maxX, panelDragOffsetRef.current.startX + e.clientX - panelDragOffsetRef.current.mouseX)),
            y: Math.max(0, Math.min(maxY, panelDragOffsetRef.current.startY + e.clientY - panelDragOffsetRef.current.mouseY)),
            width: prev.width,
          };
          persistPropsPanelState(next);
          return next;
        });
      }

      // 2. Panel Resizing
      if (isResizingPanelRef.current) {
        // If left click is released, stop resizing immediately
        if ((e.buttons & 1) !== 1) {
          stopAll();
          return;
        }
        setPropsPanelPos((prev) => {
          const newWidth = Math.max(220, Math.min(420, prev.width + (e.clientX - panelResizeStartRef.current.mouseX)));
          panelResizeStartRef.current.mouseX = e.clientX;
          const next = { ...prev, width: newWidth };
          persistPropsPanelState(next);
          return next;
        });
      }
    };

    const stopAll = () => {
      if (isDraggingPanelRef.current || isResizingPanelRef.current) {
        isDraggingPanelRef.current = false;
        isResizingPanelRef.current = false;
        setIsDraggingPanel(false);
        setIsResizingPanel(false);
        document.body.style.cursor = "default";
        document.body.style.userSelect = "auto";
      }
    };

    const onLeave = (ev: MouseEvent) => {
      if (!ev.relatedTarget) stopAll();
    };

    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", stopAll, true);
    window.addEventListener("pointercancel", stopAll, true);
    window.addEventListener("mouseup", stopAll, true);
    window.addEventListener("blur", stopAll);
    document.addEventListener("mouseleave", onLeave, true);
    document.addEventListener("visibilitychange", stopAll);

    return () => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", stopAll, true);
      window.removeEventListener("pointercancel", stopAll, true);
      window.removeEventListener("mouseup", stopAll, true);
      window.removeEventListener("blur", stopAll);
      document.removeEventListener("mouseleave", onLeave, true);
      document.removeEventListener("visibilitychange", stopAll);
    };
  }, []);

  // Add new indicator instance
  const addIndicator = (type: string) => {
    const id = `${type.toLowerCase()}-${Date.now()}`;
    let params: Record<string, number> = {};

    const currentCount = activeIndicators.filter((i) => i.type === type).length;
    let color = COLOR_PALETTE[currentCount % COLOR_PALETTE.length];

    switch (type) {
      case "EMA":
        const emaPeriods = [9, 20, 50, 200];
        params = { period: emaPeriods[currentCount % emaPeriods.length] };
        break;
      case "SMA":
        const smaPeriods = [20, 50, 200];
        params = { period: smaPeriods[currentCount % smaPeriods.length] };
        break;
      case "BB":
        params = { period: 20, stdDev: 2 };
        break;
      case "RSI":
        params = { period: 14 };
        color = "#7e57c2";
        break;
      case "MACD":
        params = { fast: 12, slow: 26, signal: 9 };
        color = "#2962ff";
        break;
      case "ATR":
        params = { period: 14 };
        color = "#26a69a";
        break;
      case "STOCH":
        params = { k: 14, d: 3 };
        color = "#2196f3";
        break;
      case "CCI":
        params = { period: 20 };
        color = "#e91e63";
        break;
    }

    setActiveIndicators((prev) => [
      ...prev,
      { id, type: type as any, params, color, visible: true },
    ]);
  };

  // Remove indicator instance
  const removeIndicator = (id: string) => {
    setActiveIndicators((prev) => prev.filter((ind) => ind.id !== id));
  };

  // Toggle indicator visibility
  const toggleIndicatorVisibility = (id: string) => {
    setActiveIndicators((prev) =>
      prev.map((ind) =>
        ind.id === id ? { ...ind, visible: !ind.visible } : ind,
      ),
    );
  };

  const formatHoverDetails = (ind: ActiveIndicator, hoverVal: any) => {
    if (!hoverVal) return "";
    if (ind.type === "RSI" || ind.type === "ATR" || ind.type === "CCI") {
      return `: ${hoverVal.toFixed(2)}`;
    }
    if (ind.type === "MACD") {
      return `: M ${hoverVal.macd?.toFixed(2)} S ${hoverVal.signal?.toFixed(2)} H ${hoverVal.histogram?.toFixed(2)}`;
    }
    if (ind.type === "STOCH") {
      return `: K ${hoverVal.k?.toFixed(2)} D ${hoverVal.d?.toFixed(2)}`;
    }
    return "";
  };

  const filteredIndicatorsList = useMemo(() => {
    if (!indicatorSearchQuery) return AVAILABLE_INDICATORS;
    const q = indicatorSearchQuery.toLowerCase();
    return AVAILABLE_INDICATORS.filter(
      (ind) =>
        ind.name.toLowerCase().includes(q) ||
        ind.desc.toLowerCase().includes(q),
    );
  }, [indicatorSearchQuery]);

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-50 text-zinc-500 gap-3 dark:bg-[#050816] dark:text-[#787b86]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 dark:text-[#2962ff]" />
        <span className="text-xs font-bold uppercase tracking-wider">
          Retrieving Candle Data...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-50 text-red-500 p-6 gap-3 text-center dark:bg-[#050816] dark:text-[#ef5350]">
        <AlertCircle className="w-8 h-8 text-[#ef5350]/60" />
        <span className="text-xs font-bold uppercase tracking-wider">
          {error}
        </span>
        <p className="text-[10px] text-zinc-500 dark:text-[#787b86]">
          Please select another stock ticker or verify database price logs.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={mainContainerRef}
      dir="ltr"
      className="w-full h-full flex flex-col bg-zinc-50 dark:bg-[#050816] relative select-none overflow-hidden"
      style={{ touchAction: "none" }}
      onWheel={(e) => {
        // ✅ Stop wheel events from bubbling to the page scroller
        e.stopPropagation();
      }}
    >
      {/* Custom Interactive Toolbar */}
      <div className="h-10 border-b border-zinc-200 bg-white/90 px-3 flex items-center justify-between text-xs text-zinc-700 z-30 select-none shadow-sm dark:border-[#2a2e39] dark:bg-[#1c2030]/30 dark:text-[#d1d4dc] dark:shadow-none">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar flex-1 mr-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="font-bold text-zinc-950 dark:text-white uppercase tracking-tight">
              {symbol}
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-[#787b86] font-mono">
              ({timeframe})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowIndicatorModal(true)}
            className="flex items-center gap-1.5 h-7 px-3 rounded transition-all active:scale-95 text-[11px] font-black bg-indigo-600 hover:bg-indigo-700 text-white uppercase tracking-wider"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Indicators</span>
          </button>

          {["trend", "rectangle", "fib"].includes(activeTool) &&
            drawingStartPointRef.current && (
              <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400 uppercase tracking-wider font-mono shrink-0">
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                <span>Select 2nd Point</span>
              </div>
            )}

          {markersData.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-[#26a69a] uppercase tracking-wider font-mono shrink-0">
              <BarChart3 className="w-3.5 h-3.5 text-[#26a69a]" />
              <span>{markersData.length} Trades</span>
            </div>
          )}
        </div>
      </div>

      {/* Sub-Legend containing exact Candlestick metrics and Overlay Indicator values */}
      <div className="absolute top-12 left-4 z-20 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-zinc-500 dark:text-[#787b86] max-w-[90%] pointer-events-none">
        {hoverData ? (
          <>
            <span className="text-zinc-700 dark:text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">
              O: <span className="text-zinc-950 dark:text-white">{hoverData.open.toFixed(2)}</span>
            </span>
            <span className="text-zinc-700 dark:text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">
              H: <span className="text-zinc-950 dark:text-white">{hoverData.high.toFixed(2)}</span>
            </span>
            <span className="text-zinc-700 dark:text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">
              L: <span className="text-zinc-950 dark:text-white">{hoverData.low.toFixed(2)}</span>
            </span>
            <span className="text-zinc-700 dark:text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">
              C:{" "}
              <span className="text-zinc-950 dark:text-white">{hoverData.close.toFixed(2)}</span>
            </span>
            {hoverData.volume !== undefined && (
              <span className="text-zinc-700 dark:text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">
                V:{" "}
                <span className="text-zinc-950 dark:text-white">
                  {hoverData.volume.toLocaleString()}
                </span>
              </span>
            )}

            {/* Render active overlay indicators values */}
            {activeIndicators.map((ind) => {
              if (
                !ind.visible ||
                !["EMA", "SMA", "BB"].includes(ind.type) ||
                !hoverData.indicatorValues
              )
                return null;
              const val = hoverData.indicatorValues[ind.id];
              if (val === undefined) return null;

              if (ind.type === "EMA" || ind.type === "SMA") {
                return (
                  <span
                    key={ind.id}
                    style={{ color: ind.color }}
                    className="shrink-0 font-bold"
                  >
                    {ind.type}({ind.params.period}):{" "}
                    <span className="text-zinc-950 dark:text-white">{val.toFixed(2)}</span>
                  </span>
                );
              }
              if (ind.type === "BB") {
                return (
                  <span
                    key={ind.id}
                    style={{ color: ind.color }}
                    className="shrink-0 font-bold"
                  >
                    BB({ind.params.period},{ind.params.stdDev}):{" "}
                    <span className="text-zinc-950 dark:text-white">
                      U {val.upper?.toFixed(2)}
                    </span>{" "}
                    M {val.middle?.toFixed(2)}{" "}
                    <span className="text-zinc-950 dark:text-white">
                      L {val.lower?.toFixed(2)}
                    </span>
                  </span>
                );
              }
              return null;
            })}
          </>
        ) : (
          <span className="text-zinc-500 dark:text-[#787b86] italic tracking-wide">
            Hover crosshair over candles for OHLCV & Indicator metrics
          </span>
        )}
      </div>

      {/* TradingView Legend Active Indicators Widget (Top-Left overlay) */}
      <div className="absolute top-24 left-4 z-20 flex flex-col gap-1.5 pointer-events-none max-h-[40%] overflow-y-auto no-scrollbar">
        {activeIndicators.map((ind) => (
          <div
            key={ind.id}
            className="pointer-events-auto flex items-center justify-between gap-3 bg-white/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-zinc-200 text-[10px] text-zinc-700 font-mono font-bold select-none hover:border-zinc-300 transition-all shadow-sm dark:bg-[#0c0d12]/80 dark:border-white/5 dark:text-zinc-300 dark:hover:border-zinc-700 dark:shadow-none"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full border border-zinc-200 shrink-0 dark:border-white/10"
                style={{ backgroundColor: ind.color }}
              />
              <span className="text-zinc-950 dark:text-white tracking-tight">
                {ind.type} ({Object.values(ind.params).join(", ")})
              </span>
            </div>

            <div className="flex items-center gap-1.5 border-l border-zinc-200 pl-2 dark:border-white/10">
              <button
                onClick={() => toggleIndicatorVisibility(ind.id)}
                className="text-zinc-500 hover:text-zinc-950 transition-colors p-0.5 rounded hover:bg-zinc-100 dark:hover:text-white dark:hover:bg-white/5"
                title={ind.visible ? "Hide" : "Show"}
              >
                {ind.visible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => removeIndicator(ind.id)}
                className="text-zinc-500 hover:text-red-500 transition-colors p-0.5 rounded hover:bg-zinc-100 dark:hover:text-red-400 dark:hover:bg-white/5"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Containers for Price and Lower Pane charts */}
      <div className="flex-1 flex flex-col min-h-0 bg-zinc-50 dark:bg-[#050816] p-1 overflow-hidden">
        {/* 1. Candlestick Chart */}
        <div
          className="flex-1 w-full min-h-0 overflow-hidden relative"
          onMouseEnter={() => {
            activeChartIdRef.current = "price";
          }}
          onTouchStart={() => {
            activeChartIdRef.current = "price";
          }}
        >
          <div
            ref={priceContainerRef}
            className="absolute inset-0 overflow-hidden"
          />
          <svg
            className="absolute inset-0 w-full h-full overflow-visible z-10"
            style={{ pointerEvents: "none" }}
          >
            {drawings.map((d) => renderSingleDrawing(d))}
            {drawingPreview && renderSingleDrawing(drawingPreview, true)}
            {/* First-point indicator */}
            {drawingStartPoint && (
              <circle
                cx={drawingStartPoint.x}
                cy={drawingStartPoint.y}
                r="5"
                fill="#fbbf24"
                stroke="#f59e0b"
                strokeWidth="2"
                className="animate-pulse"
                style={{ pointerEvents: "none" }}
              />
            )}
          </svg>

          {/* Invisible interaction overlay for drawing click/drag detection */}
          {activeTool === "cursor" && (
            <svg
              className="absolute inset-0 w-full h-full overflow-visible z-20"
              style={{ pointerEvents: "none" }}
            >
              {drawings.map((d) => renderDrawingHitArea(d))}
            </svg>
          )}

          {/* Drawing Properties Panel (TradingView-like floating editor) */}
          {selectedDrawing && activeTool === "cursor" && (
            <div
              className="absolute z-40 bg-white/95 backdrop-blur-xl border border-zinc-200 rounded-2xl shadow-2xl select-none overflow-hidden animate-fade-in dark:bg-[#1c2030]/95 dark:border-[#2a2e39]"
              style={{ left: propsPanelPos.x, top: propsPanelPos.y, width: propsPanelPos.width }}
            >
              {/* Resize handle */}
              <div
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  isResizingPanelRef.current = true;
                  setIsResizingPanel(true);
                  document.body.style.cursor = "ew-resize";
                  document.body.style.userSelect = "none";
                  panelResizeStartRef.current = { mouseX: e.clientX, startYWidth: propsPanelPos.width };
                }}
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-indigo-500/40 transition-all z-50"
              />

              <div
                className="px-3 py-2.5 border-b border-zinc-200 flex items-center justify-between cursor-grab active:cursor-grabbing dark:border-[#2a2e39]"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  isDraggingPanelRef.current = true;
                  setIsDraggingPanel(true);
                  document.body.style.cursor = "grabbing";
                  document.body.style.userSelect = "none";
                  panelDragOffsetRef.current = {
                    mouseX: e.clientX,
                    mouseY: e.clientY,
                    startX: propsPanelPos.x,
                    startY: propsPanelPos.y,
                  };
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: drawingStyle.color }} />
                  <span className="text-[11px] font-black text-zinc-950 dark:text-white uppercase tracking-wider">
                    {selectedDrawing.type === "horizontal" ? "Horizontal Line" :
                     selectedDrawing.type === "trend" ? "Trend Line" :
                     selectedDrawing.type === "rectangle" ? "Rectangle" :
                     selectedDrawing.type === "fib" ? "Fibonacci" :
                     selectedDrawing.type === "ray" ? "Ray" :
                     selectedDrawing.type === "extendedLine" ? "Extended Line" :
                     selectedDrawing.type === "text" ? "Text" : "Drawing"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => deleteDrawing(selectedDrawing.id)}
                    className="p-1 rounded hover:bg-red-500/20 text-[#787b86] hover:text-red-400 transition-all"
                    title="Delete Drawing"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setSelectedDrawingId(null)}
                    className="p-1 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-950 transition-all dark:hover:bg-[#2a2e39] dark:text-[#787b86] dark:hover:text-white"
                    title="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="px-3 py-3 space-y-3">
                {/* Line Color */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-[#787b86] uppercase tracking-wider shrink-0">Color</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={drawingStyle.color}
                      onChange={(e) => {
                        const newColor = e.target.value;
                        const newStyle: DrawingStyle = {
                          ...drawingStyle,
                          color: newColor,
                          fillColor: (selectedDrawing.type === "rectangle" || selectedDrawing.type === "fib")
                            ? withAlpha(newColor, selectedDrawing.type === "fib" ? 0.08 : 0.15)
                            : drawingStyle.fillColor,
                        };
                        setDrawingStyle(newStyle);
                        updateDrawingStyle(selectedDrawing.id, newStyle);
                      }}
                      className="h-7 w-7 cursor-pointer rounded border border-zinc-200 bg-transparent p-0 dark:border-white/10"
                    />
                    {(["#ef5350","#26a69a","#6366f1","#38bdf8","#f59e0b","#a855f7","#f97316","#22c55e","#e91e63","#2196f3","#ffffff","#787b86"] as const).map((preset) => (
                      <button
                        key={preset}
                        onClick={() => {
                          const newStyle: DrawingStyle = {
                            ...drawingStyle,
                            color: preset,
                            fillColor: (selectedDrawing.type === "rectangle" || selectedDrawing.type === "fib")
                              ? withAlpha(preset, selectedDrawing.type === "fib" ? 0.08 : 0.15)
                              : drawingStyle.fillColor,
                          };
                          setDrawingStyle(newStyle);
                          updateDrawingStyle(selectedDrawing.id, newStyle);
                        }}
                        className={`w-5 h-5 rounded-full border-2 transition-all hover:scale-125 active:scale-110 ${
                          drawingStyle.color === preset ? "border-zinc-950 scale-110 dark:border-white" : "border-zinc-300 dark:border-white/20"
                        }`}
                        style={{ backgroundColor: preset }}
                      />
                    ))}
                  </div>
                </div>

                {/* Line Width */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-[#787b86] uppercase tracking-wider shrink-0">Width</span>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((w) => (
                      <button
                        key={w}
                        onClick={() => {
                          const newStyle: DrawingStyle = { ...drawingStyle, lineWidth: w };
                          setDrawingStyle(newStyle);
                          updateDrawingStyle(selectedDrawing.id, newStyle);
                        }}
                        className={`h-7 w-7 rounded-lg border transition-all flex items-center justify-center ${
                          drawingStyle.lineWidth === w ? "border-indigo-500 bg-indigo-500/20 text-zinc-950 dark:text-white" : "border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-400 hover:text-zinc-950 dark:border-white/10 dark:bg-[#131722] dark:text-[#787b86] dark:hover:border-white/30 dark:hover:text-white"
                        }`}
                      >
                        <div
                          className="rounded-full"
                          style={{
                            width: `${w * 2 + 2}px`,
                            height: `${w}px`,
                            backgroundColor: drawingStyle.color,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Line Style */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-[#787b86] uppercase tracking-wider shrink-0">Style</span>
                  <div className="flex items-center gap-1.5">
                    {(["solid", "dashed", "dotted"] as DrawingLineStyle[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          const newStyle: DrawingStyle = { ...drawingStyle, lineStyle: s };
                          setDrawingStyle(newStyle);
                          updateDrawingStyle(selectedDrawing.id, newStyle);
                        }}
                        className={`h-7 px-3 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-wider ${
                          drawingStyle.lineStyle === s ? "border-indigo-500 bg-indigo-500/20 text-zinc-950 dark:text-white" : "border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-400 hover:text-zinc-950 dark:border-white/10 dark:bg-[#131722] dark:text-[#787b86] dark:hover:border-white/30 dark:hover:text-white"
                        }`}
                      >
                        <svg className="w-12 h-3" viewBox="0 0 48 6">
                          <line
                            x1="0" y1="3" x2="48" y2="3"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray={s === "dashed" ? "8 4" : s === "dotted" ? "2 4" : undefined}
                          />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fill Color (for rectangle & fib only) */}
                {(selectedDrawing.type === "rectangle" || selectedDrawing.type === "fib") && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold text-zinc-500 dark:text-[#787b86] uppercase tracking-wider shrink-0">Fill</span>
                    <input
                      type="color"
                      value={(() => {
                        const fc = drawingStyle.fillColor || withAlpha(drawingStyle.color, 0.15);
                        if (fc.startsWith("rgba")) {
                          const match = fc.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
                          if (match) {
                            const r = parseInt(match[1]).toString(16).padStart(2, "0");
                            const g = parseInt(match[2]).toString(16).padStart(2, "0");
                            const b = parseInt(match[3]).toString(16).padStart(2, "0");
                            return `#${r}${g}${b}`;
                          }
                        }
                        return fc.startsWith("#") ? fc.slice(0, 7) : "#000000";
                      })()}
                      onChange={(e) => {
                        const newStyle: DrawingStyle = {
                          ...drawingStyle,
                          fillColor: withAlpha(e.target.value, selectedDrawing.type === "fib" ? 0.08 : 0.15),
                        };
                        setDrawingStyle(newStyle);
                        updateDrawingStyle(selectedDrawing.id, newStyle);
                      }}
                      className="h-7 w-7 cursor-pointer rounded border border-zinc-200 bg-transparent p-0 dark:border-white/10"
                    />
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="text-[10px] text-zinc-500 dark:text-[#787b86] font-bold shrink-0">Opacity</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={(() => {
                          const fc = drawingStyle.fillColor || withAlpha(drawingStyle.color, 0.15);
                          if (fc.startsWith("rgba")) {
                            const match = fc.match(/rgba\(\d+,\d+,\d+,([\d.]+)\)/);
                            if (match) return Math.round(parseFloat(match[1]) * 100);
                          }
                          return 15;
                        })()}
                        onChange={(e) => {
                          const opacity = parseInt(e.target.value) / 100;
                          const baseColor = (() => {
                            const fc = drawingStyle.fillColor || withAlpha(drawingStyle.color, 0.15);
                            if (fc.startsWith("rgba")) {
                              const match = fc.match(/rgba\((\d+),(\d+),(\d+)/);
                              if (match) return `#${parseInt(match[1]).toString(16).padStart(2,"0")}${parseInt(match[2]).toString(16).padStart(2,"0")}${parseInt(match[3]).toString(16).padStart(2,"0")}`;
                            }
                            return drawingStyle.color;
                          })();
                          const newStyle: DrawingStyle = { ...drawingStyle, fillColor: withAlpha(baseColor, opacity) };
                          setDrawingStyle(newStyle);
                          updateDrawingStyle(selectedDrawing.id, newStyle);
                        }}
                        className="flex-1 h-1.5 accent-indigo-500"
                      />
                    </div>
                  </div>
                )}

                {/* Label */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-[#787b86] uppercase tracking-wider shrink-0">Label</span>
                  <input
                    type="text"
                    value={drawingStyle.label || ""}
                    onChange={(e) => {
                      const newStyle: DrawingStyle = { ...drawingStyle, label: e.target.value };
                      setDrawingStyle(newStyle);
                      updateDrawingStyle(selectedDrawing.id, newStyle);
                    }}
                    placeholder="Label..."
                    className="h-7 w-[140px] rounded-lg bg-zinc-50 border border-zinc-200 px-2 text-[10px] font-bold text-zinc-950 placeholder:text-zinc-400 outline-none focus:border-indigo-500 transition-all dark:bg-[#131722] dark:border-white/10 dark:text-white dark:placeholder:text-[#787b86]"
                  />
                </div>

                {/* Text Color (for drawings with text) */}
                {(selectedDrawing.type === "horizontal" || selectedDrawing.type === "fib" || selectedDrawing.type === "text" || selectedDrawing.type === "rectangle") && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold text-zinc-500 dark:text-[#787b86] uppercase tracking-wider shrink-0">Text</span>
                    <input
                      type="color"
                      value={drawingStyle.textColor || drawingStyle.color}
                      onChange={(e) => {
                        const newStyle: DrawingStyle = { ...drawingStyle, textColor: e.target.value };
                        setDrawingStyle(newStyle);
                        updateDrawingStyle(selectedDrawing.id, newStyle);
                      }}
                      className="h-7 w-7 cursor-pointer rounded border border-zinc-200 bg-transparent p-0 dark:border-white/10"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Lower Panes */}
        {lowerPaneIndicators.map((ind) => (
          <div
            key={ind.id}
            className="w-full h-[120px] relative border-t border-zinc-200 dark:border-[#2a2e39] mt-1 shrink-0 overflow-hidden"
          >
            <div className="absolute top-1.5 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-zinc-500 dark:text-[#787b86] uppercase tracking-wider flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: ind.color }}
              />
              <span>
                {ind.type} ({Object.values(ind.params).join(", ")})
              </span>
              {hoverData &&
                hoverData.indicatorValues &&
                hoverData.indicatorValues[ind.id] !== undefined && (
                  <span className="font-semibold ml-1">
                    {formatHoverDetails(ind, hoverData.indicatorValues[ind.id])}
                  </span>
                )}
            </div>

            {/* Visual guidelines for RSI / STOCH / CCI */}
            {ind.type === "RSI" && (
              <>
                <div className="absolute right-0 top-[35px] w-full border-t border-[#7e57c2]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">
                  70
                </div>
                <div className="absolute right-0 bottom-[35px] w-full border-t border-[#7e57c2]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">
                  30
                </div>
              </>
            )}
            {ind.type === "STOCH" && (
              <>
                <div className="absolute right-0 top-[25px] w-full border-t border-[#2196f3]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">
                  80
                </div>
                <div className="absolute right-0 bottom-[25px] w-full border-t border-[#2196f3]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">
                  20
                </div>
              </>
            )}
            {ind.type === "CCI" && (
              <>
                <div className="absolute right-0 top-[35px] w-full border-t border-white/5 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">
                  100
                </div>
                <div className="absolute right-0 bottom-[35px] w-full border-t border-white/5 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">
                  -100
                </div>
              </>
            )}

            <div
              id={`pane-chart-${ind.id}`}
              ref={(el) => {
                if (el) {
                  paneContainersRef.current.set(ind.id, el);
                } else {
                  paneContainersRef.current.delete(ind.id);
                }
              }}
              className="w-full h-full overflow-hidden"
              onMouseEnter={() => {
                activeChartIdRef.current = ind.id;
              }}
              onTouchStart={() => {
                activeChartIdRef.current = ind.id;
              }}
            />
          </div>
        ))}

        {/* Indicators Modal Overlay */}
        {showIndicatorModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none" style={{ zIndex: 999999 }}>
            <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] dark:bg-[#131722] dark:border-[#2a2e39]">
              {/* Header */}
              <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between dark:border-[#2a2e39]">
                <span className="text-sm font-bold text-zinc-950 dark:text-white uppercase tracking-wider">
                  Indicators Workspace
                </span>
                <button
                  onClick={() => {
                    setShowIndicatorModal(false);
                    setIndicatorSearchQuery("");
                  }}
                  className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-950 transition-colors dark:hover:bg-[#1c2030] dark:text-[#b2b5be] dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search Input */}
              <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50 relative dark:border-[#2a2e39] dark:bg-[#1c2030]/20">
                <input
                  type="text"
                  placeholder="Search indicators..."
                  value={indicatorSearchQuery}
                  onChange={(e) => setIndicatorSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-4 rounded bg-white border border-zinc-200 text-zinc-950 text-xs placeholder-zinc-400 focus:outline-none focus:border-indigo-500 transition-all dark:bg-[#1c2030] dark:border-[#2a2e39] dark:text-white dark:placeholder-[#787b86] dark:focus:border-[#2962ff]"
                  autoFocus
                />
                <Search className="absolute left-8 top-5 w-4 h-4 text-zinc-400 dark:text-[#787b86]" />
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6 min-h-0">
                {/* Catalog indicators catalog grid list */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest border-b border-zinc-200 dark:border-[#2a2e39] pb-1.5">
                    Catalog (Click to add indicator)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredIndicatorsList.map((ind) => (
                      <button
                        key={ind.type}
                        onClick={() => addIndicator(ind.type)}
                        className="p-3.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-all text-left flex flex-col justify-between h-24 group relative overflow-hidden active:scale-[0.98] dark:border-white/5 dark:bg-[#1c2030]/20 dark:hover:bg-[#1c2030]/60 dark:hover:border-zinc-700"
                      >
                        <div className="space-y-1 z-10 relative">
                          <div className="text-[11px] font-black text-zinc-950 dark:text-white uppercase group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">
                            {ind.name}
                          </div>
                          <div className="text-[9px] text-zinc-500 dark:text-[#787b86] font-semibold leading-snug line-clamp-2">
                            {ind.desc}
                          </div>
                        </div>
                        <div className="z-10 relative flex justify-between items-center w-full">
                          <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200 dark:bg-zinc-800 dark:text-[#787b86] dark:border-white/5">
                            {ind.category}
                          </span>
                          <span className="text-[9px] font-black text-indigo-400 group-hover:translate-x-1 transition-transform uppercase tracking-wider flex items-center gap-0.5">
                            + Add
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
