"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { createChart, IChartApi, ISeriesApi, UTCTimestamp, SeriesMarker, ColorType } from "lightweight-charts";
import { Loader2, Eye, EyeOff, BarChart3, AlertCircle, Search, X, Trash2, Plus, Sliders } from "lucide-react";
import { 
    calculateEMA, 
    calculateRSI, 
    calculateMACD, 
    calculateBollingerBands, 
    calculateSMA,
    calculateATR,
    calculateStochastic,
    calculateCCI,
    Candle
} from "@/lib/indicators";

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
    { type: "EMA", name: "Exponential Moving Average (EMA)", desc: "Exponential moving average of close prices.", category: "Overlays" },
    { type: "SMA", name: "Simple Moving Average (SMA)", desc: "Arithmetic mean of close prices over a specified period.", category: "Overlays" },
    { type: "BB", name: "Bollinger Bands (BB)", desc: "Volatility bands placed above and below a moving average.", category: "Overlays" },
    { type: "RSI", name: "Relative Strength Index (RSI)", desc: "Momentum oscillator that measures velocity and change of price.", category: "Oscillators" },
    { type: "MACD", name: "Moving Average Convergence Divergence (MACD)", desc: "Trend-following momentum indicator showing EMA relationship.", category: "Oscillators" },
    { type: "ATR", name: "Average True Range (ATR)", desc: "Market volatility indicator showing average price range movement.", category: "Volatility" },
    { type: "STOCH", name: "Stochastic Oscillator", desc: "Compares closing price to its price range over a period.", category: "Oscillators" },
    { type: "CCI", name: "Commodity Channel Index (CCI)", desc: "Measures current price relative to average price level.", category: "Oscillators" }
];

const COLOR_PALETTE = ["#2196f3", "#ff9800", "#e91e63", "#9c27b0", "#4caf50", "#00bcd4", "#ffeb3b"];

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
    showApiMarkers = true
}: TradingViewChartProps) {
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
        hideIndicators ? [] : [
            { id: "ema-50", type: "EMA", params: { period: 50 }, color: "#e91e63", visible: true },
            { id: "ema-200", type: "EMA", params: { period: 200 }, color: "#9c27b0", visible: true },
            { id: "rsi-14", type: "RSI", params: { period: 14 }, color: "#7e57c2", visible: true },
        ]
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
    const savedLogicalRangeRef = useRef<{ from: number; to: number } | null>(null);
    const priceLinesRef = useRef<any[]>([]);
    const drawnPriceLevelsRef = useRef<number[]>([]);

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
                    throw new Error(`Failed to load historical candles (Status ${res.status})`);
                }
                const data = await res.json();
                if (!isMounted) return;

                if (!data.candles || data.candles.length === 0) {
                    throw new Error("No historical data found in database for this symbol.");
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
        return activeIndicators.filter(ind => 
            ind.visible && ["RSI", "MACD", "ATR", "STOCH", "CCI"].includes(ind.type)
        );
    }, [activeIndicators]);

    // 2. Initialize and draw charts (Lightweight Charts Canvas)
    useEffect(() => {
        if (loading || error || candlesData.length === 0) return;

        const handleResize = (newWidth?: number, newHeight?: number) => {
            const width = newWidth !== undefined ? newWidth : (mainContainerRef.current?.clientWidth || 0);
            const height = newHeight !== undefined ? newHeight : (mainContainerRef.current?.clientHeight || 0);
            
            if (width <= 0 || height <= 0) return;
            
            if (chartRefs.current.priceChart) {
                const paneHeight = 120;
                const activeLowerPanesCount = lowerPaneIndicators.length;
                const pricePaneHeight = Math.max(150, height - (activeLowerPanesCount * paneHeight) - 45);
                
                chartRefs.current.priceChart.resize(width, pricePaneHeight);
                lowerPaneIndicators.forEach(ind => {
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
        const priceHeight = Math.max(150, height - (activeLowerPanesCount * paneHeight) - 45);

        // Chart styling colors (Dark theme replication)
        const gridColor = "#1f222e";
        const backgroundColor = "#131722";
        const textColor = "#d1d4dc";

        // Create main Price Chart
        const priceChart = createChart(priceContainerRef.current!, {
            width: width,
            height: priceHeight,
            layout: {
                background: { type: ColorType.Solid, color: backgroundColor },
                textColor: textColor,
            },
            grid: {
                vertLines: { color: gridColor },
                horzLines: { color: gridColor },
            },
            crosshair: {
                mode: 1, // Magnet mode
                vertLine: { labelBackgroundColor: "#2962ff" },
                horzLine: { labelBackgroundColor: "#2962ff" },
            },
            timeScale: {
                borderColor: "#2a2e39",
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 30,
                fixLeftEdge: false,
                fixRightEdge: false,
            },
            rightPriceScale: {
                borderColor: "#2a2e39",
                minimumWidth: 80,
            },
            handleScroll: {
                mouseWheel: true,   // ✅ allow scroll on main chart
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
                }
            }
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
        candlestickSeries.setData(candlesData.map(c => ({ ...c, time: c.time as UTCTimestamp })));
        chartRefs.current.candlestickSeries = candlestickSeries;

        if (activeTool === "trash") {
            drawnPriceLevelsRef.current = [];
            if (onToolDrawComplete) {
                onToolDrawComplete();
            }
        }

        // Redraw existing S/R levels
        priceLinesRef.current = [];
        drawnPriceLevelsRef.current.forEach((priceVal) => {
            const line = candlestickSeries.createPriceLine({
                price: priceVal,
                color: '#6366f1',
                lineWidth: 2,
                lineStyle: 2, // Dotted
                axisLabelVisible: true,
                title: 'S/R Level',
            });
            priceLinesRef.current.push(line);
        });

        // Add Volume Overlay on Price Chart (scaled at bottom)
        const volumeSeries = priceChart.addHistogramSeries({
            color: "#26a69a30",
            priceFormat: { type: "volume" },
            priceScaleId: "", // Overlay
        });
        volumeSeries.priceScale().applyOptions({
            scaleMargins: {
                top: 0.8,
                bottom: 0,
            },
        });
        const volumeData = candlesData.map(c => ({
            time: c.time as UTCTimestamp,
            value: c.volume || 0,
            color: c.close >= c.open ? "#26a69a40" : "#ef535040"
        }));
        volumeSeries.setData(volumeData);
        chartRefs.current.volumeSeries = volumeSeries;

        // --- Precalculate indicator data maps ---
        const calculatedIndicatorData = new Map<string, any>();
        activeIndicators.forEach(ind => {
            if (!ind.visible) return;
            if (ind.type === "EMA") {
                calculatedIndicatorData.set(ind.id, calculateEMA(candlesData, ind.params.period || 9));
            } else if (ind.type === "SMA") {
                calculatedIndicatorData.set(ind.id, calculateSMA(candlesData, ind.params.period || 20));
            } else if (ind.type === "BB") {
                calculatedIndicatorData.set(ind.id, calculateBollingerBands(candlesData, ind.params.period || 20, ind.params.stdDev || 2));
            } else if (ind.type === "RSI") {
                calculatedIndicatorData.set(ind.id, calculateRSI(candlesData, ind.params.period || 14));
            } else if (ind.type === "MACD") {
                calculatedIndicatorData.set(ind.id, calculateMACD(candlesData, ind.params.fast || 12, ind.params.slow || 26, ind.params.signal || 9));
            } else if (ind.type === "ATR") {
                calculatedIndicatorData.set(ind.id, calculateATR(candlesData, ind.params.period || 14));
            } else if (ind.type === "STOCH") {
                calculatedIndicatorData.set(ind.id, calculateStochastic(candlesData, ind.params.k || 14, ind.params.d || 3));
            } else if (ind.type === "CCI") {
                calculatedIndicatorData.set(ind.id, calculateCCI(candlesData, ind.params.period || 20));
            }
        });

        // --- Draw Overlay Indicators on priceChart ---
        activeIndicators.forEach(ind => {
            if (!ind.visible || !["EMA", "SMA", "BB"].includes(ind.type)) return;
            const data = calculatedIndicatorData.get(ind.id);
            if (!data) return;

            const seriesList: ISeriesApi<any>[] = [];

            if (ind.type === "EMA" || ind.type === "SMA") {
                const series = priceChart.addLineSeries({ 
                    color: ind.color, 
                    lineWidth: 2, 
                    title: `${ind.type} (${ind.params.period})` 
                });
                series.setData(data.map((p: any) => ({ time: p.time as UTCTimestamp, value: p.value })));
                seriesList.push(series);
            } else if (ind.type === "BB") {
                const upper = priceChart.addLineSeries({ color: "#90caf9", lineWidth: 1, lineStyle: 2, title: "BB Upper" });
                upper.setData(data.map((p: any) => ({ time: p.time as UTCTimestamp, value: p.upper })));
                
                const middle = priceChart.addLineSeries({ color: "#42a5f5", lineWidth: 1, lineStyle: 0, title: "BB Basis" });
                middle.setData(data.map((p: any) => ({ time: p.time as UTCTimestamp, value: p.middle })));
                
                const lower = priceChart.addLineSeries({ color: "#90caf9", lineWidth: 1, lineStyle: 2, title: "BB Lower" });
                lower.setData(data.map((p: any) => ({ time: p.time as UTCTimestamp, value: p.lower })));

                seriesList.push(upper, middle, lower);
            }

            chartRefs.current.indicatorSeries.set(ind.id, seriesList);
        });

        // --- Initialize dynamic lower pane charts ---
        const activeCharts: IChartApi[] = [priceChart];
        
        lowerPaneIndicators.forEach(ind => {
            const container = paneContainersRef.current.get(ind.id);
            if (!container) return;

            const lowerChart = createChart(container, {
                width: width,
                height: paneHeight,
                layout: {
                    background: { type: ColorType.Solid, color: backgroundColor },
                    textColor: textColor,
                },
                grid: {
                    vertLines: { color: gridColor },
                    horzLines: { color: gridColor },
                },
                crosshair: { mode: 1 },
                timeScale: {
                    borderColor: "#2a2e39",
                    visible: false, // hide time scale, sync with price chart
                    rightOffset: 30,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                },
                rightPriceScale: {
                    borderColor: "#2a2e39",
                    entireTextOnly: true,
                    minimumWidth: 80,
                },
                handleScroll: {
                    mouseWheel: true,   // ✅ allow scroll on lower pane charts too
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
                    }
                }
            });

            chartRefs.current.lowerCharts.set(ind.id, lowerChart);
            activeCharts.push(lowerChart);

            // Add indicator series to this chart
            const data = calculatedIndicatorData.get(ind.id);
            if (!data) return;

            const seriesList: ISeriesApi<any>[] = [];

            if (ind.type === "RSI" || ind.type === "ATR" || ind.type === "CCI") {
                const series = lowerChart.addLineSeries({ color: ind.color, lineWidth: 2 });
                const seriesData = candlesData.map(c => {
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
                const macdLine = lowerChart.addLineSeries({ color: "#2962ff", lineWidth: 2 });
                const macdLineData = candlesData.map(c => {
                    const p = data.find((pt: any) => pt.time === c.time);
                    return p !== undefined 
                        ? { time: c.time as UTCTimestamp, value: p.macd } 
                        : { time: c.time as UTCTimestamp };
                });
                macdLine.setData(macdLineData);
                seriesList.push(macdLine);

                const macdSignal = lowerChart.addLineSeries({ color: "#ff6d00", lineWidth: 2 });
                const macdSignalData = candlesData.map(c => {
                    const p = data.find((pt: any) => pt.time === c.time);
                    return p !== undefined 
                        ? { time: c.time as UTCTimestamp, value: p.signal } 
                        : { time: c.time as UTCTimestamp };
                });
                macdSignal.setData(macdSignalData);
                seriesList.push(macdSignal);

                const macdHist = lowerChart.addHistogramSeries({ color: "#26a69a" });
                const macdHistData = candlesData.map(c => {
                    const p = data.find((pt: any) => pt.time === c.time);
                    return p !== undefined 
                        ? { 
                            time: c.time as UTCTimestamp, 
                            value: p.histogram, 
                            color: p.histogram >= 0 ? "#26a69a80" : "#ef535080" 
                          } 
                        : { time: c.time as UTCTimestamp };
                });
                macdHist.setData(macdHistData);
                seriesList.push(macdHist);
            } else if (ind.type === "STOCH") {
                const kSeries = lowerChart.addLineSeries({ color: "#2196f3", lineWidth: 2 });
                const dSeries = lowerChart.addLineSeries({ color: "#ff9800", lineWidth: 2, lineStyle: 2 });
                
                const kData = candlesData.map(c => {
                    const p = data.find((pt: any) => pt.time === c.time);
                    return p !== undefined 
                        ? { time: c.time as UTCTimestamp, value: p.k } 
                        : { time: c.time as UTCTimestamp };
                });
                const dData = candlesData.map(c => {
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
                for (const [id, lowerChart] of chartRefs.current.lowerCharts.entries()) {
                    if (lowerChart === chart) return id;
                }
                return null;
            };

            for (let i = 0; i < activeCharts.length; i++) {
                const chartA = activeCharts[i];
                const chartAId = getChartId(chartA);

                chartA.timeScale().subscribeVisibleLogicalRangeChange((range) => {
                    if (!range) return;
                    
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
                            const currentRange = targetChart.timeScale().getVisibleLogicalRange();
                            if (!currentRange || Math.abs(currentRange.from - targetRange.from) > 0.01 || Math.abs(currentRange.to - targetRange.to) > 0.01) {
                                targetChart.timeScale().setVisibleLogicalRange(targetRange);
                            }
                        }
                    }
                });
            }
        }

        // --- Render Strategy Trade Markers (API + custom injected) ---
        {
            const candleTimes = new Set(candlesData.map(c => c.time));

            // Build date-string → candle-time map for daily candle matching
            // (trade dates are YYYY-MM-DD midnight UTC; candles may use market-open time)
            const dateMap = new Map<string, number>();
            for (const c of candlesData) {
                const dateStr = new Date((c.time as number) * 1000).toISOString().slice(0, 10);
                if (!dateMap.has(dateStr)) dateMap.set(dateStr, c.time as number);
            }

            // Build sorted candle times for nearest-candle fallback
            const sortedCandleTimes = [...candleTimes].sort((a, b) => (a as number) - (b as number));

            // Helper: snap a unix-seconds timestamp to the nearest candle
            const snapToCandle = (ts: number): UTCTimestamp | null => {
                // 1. Exact match
                if (candleTimes.has(ts)) return ts as UTCTimestamp;
                // 2. Date-string match (handles timezone offset for daily bars)
                const dateStr = new Date(ts * 1000).toISOString().slice(0, 10);
                if (dateMap.has(dateStr)) return dateMap.get(dateStr)! as UTCTimestamp;
                // 3. Nearest candle fallback
                let best: number | null = null;
                let bestDiff = Infinity;
                for (const ct of sortedCandleTimes) {
                    const diff = Math.abs((ct as number) - ts);
                    if (diff < bestDiff) { bestDiff = diff; best = ct as number; }
                    else if (diff > bestDiff) break;
                }
                return best !== null ? best as UTCTimestamp : null;
            };

            const apiMarkers: SeriesMarker<UTCTimestamp>[] = (showApiMarkers && markersData ? markersData : [])
                .filter(m => candleTimes.has(m.time))
                .map(m => ({
                    time: m.time as UTCTimestamp,
                    position: m.position,
                    color: m.color,
                    shape: m.shape,
                    text: m.text,
                    size: 1.5,
                }));

            const injectedMarkers: SeriesMarker<UTCTimestamp>[] = (customMarkers || [])
                .map(m => {
                    const snapped = snapToCandle(m.time);
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

            const allMarkers = [...apiMarkers, ...injectedMarkers]
                .sort((a, b) => (a.time as number) - (b.time as number));

            if (allMarkers.length > 0) {
                candlestickSeries.setMarkers(allMarkers);
            }
        }

        // --- Setup click subscription to draw horizontal levels ---
        priceChart.subscribeClick((param) => {
            if (activeTool === "horizontal" && param.point && candlestickSeries) {
                const clickedPrice = candlestickSeries.coordinateToPrice(param.point.y);
                if (clickedPrice === null || clickedPrice === undefined) return;
                
                // Add to persistent list
                drawnPriceLevelsRef.current.push(clickedPrice);
                
                // Draw immediately
                const line = candlestickSeries.createPriceLine({
                    price: clickedPrice,
                    color: '#6366f1',
                    lineWidth: 2,
                    lineStyle: 2, // Dotted
                    axisLabelVisible: true,
                    title: 'S/R Level',
                });
                priceLinesRef.current.push(line);
                
                // Complete drawing
                if (onToolDrawComplete) {
                    onToolDrawComplete();
                }
            }
        });

        // --- Setup Crosshair Tooltip Hover Legend details ---
        priceChart.subscribeCrosshairMove((param) => {
            if (!param.time || !param.point) {
                setHoverData(null);
                return;
            }

            const candle = candlesData.find(c => c.time === param.time);
            if (!candle) return;

            const t = param.time as number;
            const values: Record<string, any> = {};

            activeIndicators.forEach(ind => {
                if (!ind.visible) return;
                const data = calculatedIndicatorData.get(ind.id);
                if (!data) return;

                if (ind.type === "EMA" || ind.type === "SMA" || ind.type === "RSI" || ind.type === "ATR" || ind.type === "CCI") {
                    const pt = data.find((p: any) => p.time === t);
                    if (pt) values[ind.id] = pt.value;
                } else if (ind.type === "BB") {
                    const pt = data.find((p: any) => p.time === t);
                    if (pt) values[ind.id] = { upper: pt.upper, middle: pt.middle, lower: pt.lower };
                } else if (ind.type === "MACD") {
                    const pt = data.find((p: any) => p.time === t);
                    if (pt) values[ind.id] = { macd: pt.macd, signal: pt.signal, histogram: pt.histogram };
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
                indicatorValues: values
            });
        });

        // Setup resize hook using ResizeObserver
        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries || entries.length === 0) return;
            const { width, height } = entries[0].contentRect;
            const roundedWidth = Math.floor(width);
            const roundedHeight = Math.floor(height);
            if (roundedWidth > 0 && roundedHeight > 0 && 
                (roundedWidth !== lastSize.current.width || roundedHeight !== lastSize.current.height)) {
                lastSize.current = { width: roundedWidth, height: roundedHeight };
                handleResize(roundedWidth, roundedHeight);
            }
        });

        if (mainContainerRef.current) {
            resizeObserver.observe(mainContainerRef.current);
        }
        
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

            const currentRange = chartRefs.current.priceChart.timeScale().getVisibleLogicalRange();
            if (currentRange) {
                lowerPaneIndicators.forEach(ind => {
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
                const range = chartRefs.current.priceChart.timeScale().getVisibleLogicalRange();
                if (range) {
                    savedLogicalRangeRef.current = { from: range.from, to: range.to };
                }
            }
            
            // Clean up price chart and series
            if (chartRefs.current.priceChart) {
                if (chartRefs.current.candlestickSeries) {
                    try {
                        chartRefs.current.priceChart.removeSeries(chartRefs.current.candlestickSeries);
                    } catch {}
                    chartRefs.current.candlestickSeries = null;
                }
                if (chartRefs.current.volumeSeries) {
                    try {
                        chartRefs.current.priceChart.removeSeries(chartRefs.current.volumeSeries);
                    } catch {}
                    chartRefs.current.volumeSeries = null;
                }
                
                chartRefs.current.indicatorSeries.forEach(seriesList => {
                    seriesList.forEach(series => {
                        try {
                            chartRefs.current.priceChart?.removeSeries(series);
                        } catch {}
                    });
                });
                
                chartRefs.current.priceChart.remove();
                chartRefs.current.priceChart = null;
            }

            // Clean up lower charts
            chartRefs.current.lowerCharts.forEach(lowerChart => {
                try {
                    lowerChart.remove();
                } catch {}
            });
            chartRefs.current.lowerCharts.clear();
            chartRefs.current.indicatorSeries.clear();
        };
    }, [candlesData, activeIndicators, loading, error, markersData, lowerPaneIndicators, activeTool, customMarkers]);

    // --- Scroll chart to focusTimestamp when it changes (e.g. navigating between trades) ---
    useEffect(() => {
        if (!focusTimestamp || !chartRefs.current.priceChart || candlesData.length === 0) return;
        const chart = chartRefs.current.priceChart;
        const ts = chart.timeScale();

        // Build date-string → index map to find bar index of focusTimestamp
        const dateStr = new Date(focusTimestamp * 1000).toISOString().slice(0, 10);
        let targetIndex = -1;
        for (let i = 0; i < candlesData.length; i++) {
            const cDate = new Date((candlesData[i].time as number) * 1000).toISOString().slice(0, 10);
            if (cDate === dateStr) { targetIndex = i; break; }
        }
        // Fall back to nearest timestamp
        if (targetIndex === -1) {
            let best = 0;
            let bestDiff = Infinity;
            for (let i = 0; i < candlesData.length; i++) {
                const diff = Math.abs((candlesData[i].time as number) - focusTimestamp);
                if (diff < bestDiff) { bestDiff = diff; best = i; }
            }
            targetIndex = best;
        }

        // Show a window of ~60 bars centered on the target
        const half = 30;
        const from = Math.max(0, targetIndex - half);
        const to = Math.min(candlesData.length - 1, targetIndex + half);
        ts.setVisibleLogicalRange({ from, to });
    }, [focusTimestamp, candlesData]);

    // Add new indicator instance
    const addIndicator = (type: string) => {
        const id = `${type.toLowerCase()}-${Date.now()}`;
        let params: Record<string, number> = {};
        
        const currentCount = activeIndicators.filter(i => i.type === type).length;
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

        setActiveIndicators(prev => [
            ...prev,
            { id, type: type as any, params, color, visible: true }
        ]);
    };

    // Remove indicator instance
    const removeIndicator = (id: string) => {
        setActiveIndicators(prev => prev.filter(ind => ind.id !== id));
    };

    // Toggle indicator visibility
    const toggleIndicatorVisibility = (id: string) => {
        setActiveIndicators(prev => prev.map(ind => 
            ind.id === id ? { ...ind, visible: !ind.visible } : ind
        ));
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
        return AVAILABLE_INDICATORS.filter(ind => 
            ind.name.toLowerCase().includes(q) || 
            ind.desc.toLowerCase().includes(q)
        );
    }, [indicatorSearchQuery]);

    if (loading) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#131722] text-[#787b86] gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#2962ff]" />
                <span className="text-xs font-bold uppercase tracking-wider">Retrieving Candle Data...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#131722] text-[#ef5350] p-6 gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-[#ef5350]/60" />
                <span className="text-xs font-bold uppercase tracking-wider">{error}</span>
                <p className="text-[10px] text-[#787b86]">Please select another stock ticker or verify database price logs.</p>
            </div>
        );
    }

    return (
        <div 
            ref={mainContainerRef} 
            className="w-full h-full flex flex-col bg-[#131722] relative select-none overflow-hidden"
            style={{ touchAction: 'none' }}
            onWheel={(e) => {
                // ✅ Stop wheel events from bubbling to the page scroller
                e.stopPropagation();
            }}
        >
            {/* Custom Interactive Toolbar */}
            <div className="h-10 border-b border-[#2a2e39] bg-[#1c2030]/30 px-3 flex items-center justify-between text-xs text-[#d1d4dc] z-30 select-none">
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar flex-1 mr-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-bold text-white uppercase tracking-tight">{symbol}</span>
                        <span className="text-[10px] text-[#787b86] font-mono">({timeframe})</span>
                    </div>
                    <div className="h-4 w-[1px] bg-[#2a2e39] shrink-0" />
                    
                    {/* Drawing Tools Section */}
                    <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-[#787b86] uppercase tracking-wider font-bold mr-1">Draw:</span>
                        
                        {/* Horizontal Line Tool */}
                        <button 
                            onClick={() => onToolDrawComplete && onToolDrawComplete()}
                            className={`h-7 px-2.5 rounded flex items-center gap-1.5 transition-all text-[10px] font-bold uppercase tracking-wide ${
                                activeTool === "horizontal" 
                                    ? "bg-indigo-600 text-white" 
                                    : "bg-[#1c2030] text-[#787b86] hover:bg-[#2a2e39] hover:text-white"
                            }`}
                            title="Horizontal Line (Support/Resistance)"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <line x1="3" y1="12" x2="21" y2="12" strokeWidth="2"/>
                            </svg>
                            <span>Horizontal</span>
                        </button>

                        {/* Trend Line Tool */}
                        <button 
                            className="h-7 px-2.5 rounded flex items-center gap-1.5 transition-all text-[10px] font-bold uppercase tracking-wide bg-[#1c2030] text-[#787b86] hover:bg-[#2a2e39] hover:text-white opacity-50 cursor-not-allowed"
                            title="Trend Line (Coming Soon)"
                            disabled
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <line x1="3" y1="18" x2="21" y2="6" strokeWidth="2"/>
                            </svg>
                            <span>Trend</span>
                        </button>

                        {/* Fibonacci Tool */}
                        <button 
                            className="h-7 px-2.5 rounded flex items-center gap-1.5 transition-all text-[10px] font-bold uppercase tracking-wide bg-[#1c2030] text-[#787b86] hover:bg-[#2a2e39] hover:text-white opacity-50 cursor-not-allowed"
                            title="Fibonacci Retracement (Coming Soon)"
                            disabled
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M3 12h18M3 8h18M3 16h18M3 6h18M3 18h18" strokeWidth="1.5"/>
                            </svg>
                            <span>Fib</span>
                        </button>

                        {/* Rectangle Tool */}
                        <button 
                            className="h-7 px-2.5 rounded flex items-center gap-1.5 transition-all text-[10px] font-bold uppercase tracking-wide bg-[#1c2030] text-[#787b86] hover:bg-[#2a2e39] hover:text-white opacity-50 cursor-not-allowed"
                            title="Rectangle (Coming Soon)"
                            disabled
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <rect x="4" y="6" width="16" height="12" strokeWidth="2"/>
                            </svg>
                            <span>Rectangle</span>
                        </button>

                        {/* Clear All Tool */}
                        <button 
                            onClick={() => {
                                if (activeTool === "trash") {
                                    drawnPriceLevelsRef.current = [];
                                    priceLinesRef.current.forEach(line => {
                                        if (chartRefs.current.candlestickSeries) {
                                            try {
                                                chartRefs.current.candlestickSeries.removePriceLine(line);
                                            } catch {}
                                        }
                                    });
                                    priceLinesRef.current = [];
                                }
                                onToolDrawComplete && onToolDrawComplete();
                            }}
                            className={`h-7 px-2.5 rounded flex items-center gap-1.5 transition-all text-[10px] font-bold uppercase tracking-wide ${
                                activeTool === "trash" 
                                    ? "bg-red-600 text-white" 
                                    : "bg-[#1c2030] text-[#787b86] hover:bg-[#2a2e39] hover:text-red-400"
                            }`}
                            title="Clear All Drawings"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Clear</span>
                        </button>
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

                    {markersData.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] font-bold text-[#26a69a] uppercase tracking-wider font-mono shrink-0">
                            <BarChart3 className="w-3.5 h-3.5 text-[#26a69a]" />
                            <span>{markersData.length} Trades</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Sub-Legend containing exact Candlestick metrics and Overlay Indicator values */}
            <div className="absolute top-12 left-4 z-20 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-[#787b86] max-w-[90%] pointer-events-none">
                {hoverData ? (
                    <>
                        <span className="text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">O: <span className="text-white">{hoverData.open.toFixed(2)}</span></span>
                        <span className="text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">H: <span className="text-white">{hoverData.high.toFixed(2)}</span></span>
                        <span className="text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">L: <span className="text-white">{hoverData.low.toFixed(2)}</span></span>
                        <span className="text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">C: <span className="text-white">{hoverData.close.toFixed(2)}</span></span>
                        {hoverData.volume !== undefined && (
                            <span className="text-[#d1d4dc] shrink-0 font-bold uppercase tracking-tighter">V: <span className="text-white">{hoverData.volume.toLocaleString()}</span></span>
                        )}
                        
                        {/* Render active overlay indicators values */}
                        {activeIndicators.map(ind => {
                            if (!ind.visible || !["EMA", "SMA", "BB"].includes(ind.type) || !hoverData.indicatorValues) return null;
                            const val = hoverData.indicatorValues[ind.id];
                            if (val === undefined) return null;

                            if (ind.type === "EMA" || ind.type === "SMA") {
                                return (
                                    <span key={ind.id} style={{ color: ind.color }} className="shrink-0 font-bold">
                                        {ind.type}({ind.params.period}): <span className="text-white">{val.toFixed(2)}</span>
                                    </span>
                                );
                            }
                            if (ind.type === "BB") {
                                return (
                                    <span key={ind.id} style={{ color: ind.color }} className="shrink-0 font-bold">
                                        BB({ind.params.period},{ind.params.stdDev}): <span className="text-white">U {val.upper?.toFixed(2)}</span> M {val.middle?.toFixed(2)} <span className="text-white">L {val.lower?.toFixed(2)}</span>
                                    </span>
                                );
                            }
                            return null;
                        })}
                    </>
                ) : (
                    <span className="text-[#787b86] italic tracking-wide">Hover crosshair over candles for OHLCV & Indicator metrics</span>
                )}
            </div>

            {/* TradingView Legend Active Indicators Widget (Top-Left overlay) */}
            <div className="absolute top-24 left-4 z-20 flex flex-col gap-1.5 pointer-events-none max-h-[40%] overflow-y-auto no-scrollbar">
                {activeIndicators.map(ind => (
                    <div key={ind.id} className="pointer-events-auto flex items-center justify-between gap-3 bg-[#0c0d12]/80 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-white/5 text-[10px] text-zinc-300 font-mono font-bold select-none hover:border-zinc-700 transition-all">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full border border-white/10 shrink-0" style={{ backgroundColor: ind.color }} />
                            <span className="text-white tracking-tight">{ind.type} ({Object.values(ind.params).join(", ")})</span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 border-l border-white/10 pl-2">
                            <button 
                                onClick={() => toggleIndicatorVisibility(ind.id)}
                                className="text-zinc-500 hover:text-white transition-colors p-0.5 rounded hover:bg-white/5"
                                title={ind.visible ? "Hide" : "Show"}
                            >
                                {ind.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                            <button 
                                onClick={() => removeIndicator(ind.id)}
                                className="text-zinc-500 hover:text-red-400 transition-colors p-0.5 rounded hover:bg-white/5"
                                title="Remove"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Containers for Price and Lower Pane charts */}
            <div className="flex-1 flex flex-col min-h-0 bg-[#131722] p-1 overflow-hidden">
                {/* 1. Candlestick Chart */}
                <div 
                    ref={priceContainerRef} 
                    className="flex-1 w-full min-h-0 overflow-hidden" 
                    onMouseEnter={() => { activeChartIdRef.current = "price"; }}
                    onTouchStart={() => { activeChartIdRef.current = "price"; }}
                />

                {/* Dynamic Lower Panes */}
                {lowerPaneIndicators.map((ind) => (
                    <div 
                        key={ind.id} 
                        className="w-full h-[120px] relative border-t border-[#2a2e39] mt-1 shrink-0 overflow-hidden"
                    >
                        <div className="absolute top-1.5 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-[#787b86] uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ind.color }} />
                            <span>{ind.type} ({Object.values(ind.params).join(", ")})</span>
                            {hoverData && hoverData.indicatorValues && hoverData.indicatorValues[ind.id] !== undefined && (
                                <span className="font-semibold ml-1">
                                    {formatHoverDetails(ind, hoverData.indicatorValues[ind.id])}
                                </span>
                            )}
                        </div>
                        
                        {/* Visual guidelines for RSI / STOCH / CCI */}
                        {ind.type === "RSI" && (
                            <>
                                <div className="absolute right-0 top-[35px] w-full border-t border-[#7e57c2]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">70</div>
                                <div className="absolute right-0 bottom-[35px] w-full border-t border-[#7e57c2]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">30</div>
                            </>
                        )}
                        {ind.type === "STOCH" && (
                            <>
                                <div className="absolute right-0 top-[25px] w-full border-t border-[#2196f3]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">80</div>
                                <div className="absolute right-0 bottom-[25px] w-full border-t border-[#2196f3]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">20</div>
                            </>
                        )}
                        {ind.type === "CCI" && (
                            <>
                                <div className="absolute right-0 top-[35px] w-full border-t border-white/5 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">100</div>
                                <div className="absolute right-0 bottom-[35px] w-full border-t border-white/5 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">-100</div>
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
                            onMouseEnter={() => { activeChartIdRef.current = ind.id; }}
                            onTouchStart={() => { activeChartIdRef.current = ind.id; }}
                        />
                    </div>
                ))}
            </div>

            {/* Indicators Modal Overlay */}
            {showIndicatorModal && typeof window !== "undefined" && document.body && createPortal(
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[99999] p-4 select-none">
                    <div className="bg-[#131722] border border-[#2a2e39] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-[#2a2e39] flex items-center justify-between">
                            <span className="text-sm font-bold text-white uppercase tracking-wider">Indicators Workspace</span>
                            <button 
                                onClick={() => {
                                    setShowIndicatorModal(false);
                                    setIndicatorSearchQuery("");
                                }}
                                className="p-1.5 rounded hover:bg-[#1c2030] text-[#b2b5be] hover:text-white transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        
                        {/* Search Input */}
                        <div className="px-5 py-3 border-b border-[#2a2e39] bg-[#1c2030]/20 relative">
                            <input 
                                type="text"
                                placeholder="Search indicators..."
                                value={indicatorSearchQuery}
                                onChange={(e) => setIndicatorSearchQuery(e.target.value)}
                                className="w-full h-9 pl-9 pr-4 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-xs placeholder-[#787b86] focus:outline-none focus:border-[#2962ff] transition-all"
                                autoFocus
                            />
                            <Search className="absolute left-8 top-5 w-4 h-4 text-[#787b86]" />
                        </div>
                        
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6 min-h-0">
                            {/* Catalog indicators catalog grid list */}
                            <div className="space-y-3">
                                <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest border-b border-[#2a2e39] pb-1.5">Catalog (Click to add indicator)</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {filteredIndicatorsList.map((ind) => (
                                        <button
                                            key={ind.type}
                                            onClick={() => addIndicator(ind.type)}
                                            className="p-3.5 rounded-xl border border-white/5 bg-[#1c2030]/20 hover:bg-[#1c2030]/60 hover:border-zinc-700 transition-all text-left flex flex-col justify-between h-24 group relative overflow-hidden active:scale-[0.98]"
                                        >
                                            <div className="space-y-1 z-10 relative">
                                                <div className="text-[11px] font-black text-white uppercase group-hover:text-indigo-400 transition-colors">{ind.name}</div>
                                                <div className="text-[9px] text-[#787b86] font-semibold leading-snug line-clamp-2">{ind.desc}</div>
                                            </div>
                                            <div className="z-10 relative flex justify-between items-center w-full">
                                                <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-[#787b86] border border-white/5">{ind.category}</span>
                                                <span className="text-[9px] font-black text-indigo-400 group-hover:translate-x-1 transition-transform uppercase tracking-wider flex items-center gap-0.5">+ Add</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
