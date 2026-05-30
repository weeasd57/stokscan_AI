"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, UTCTimestamp, SeriesMarker, ColorType } from "lightweight-charts";
import { Loader2, Settings, Eye, EyeOff, BarChart3, AlertCircle } from "lucide-react";
import { 
    calculateEMA, 
    calculateRSI, 
    calculateMACD, 
    calculateBollingerBands, 
    Candle, 
    LineDataPoint,
    BollingerBandsDataPoint,
    MacdDataPoint
} from "@/lib/indicators";

interface TradingViewChartProps {
    symbol: string;
    theme?: "dark" | "light";
}

interface IndicatorState {
    ema9: boolean;
    ema20: boolean;
    ema50: boolean;
    ema200: boolean;
    bb: boolean;
    rsi: boolean;
    macd: boolean;
}

export default function TradingViewChart({ symbol, theme = "dark" }: TradingViewChartProps) {
    const mainContainerRef = useRef<HTMLDivElement>(null);
    const priceContainerRef = useRef<HTMLDivElement>(null);
    const rsiContainerRef = useRef<HTMLDivElement>(null);
    const macdContainerRef = useRef<HTMLDivElement>(null);

    // States
    const [candlesData, setCandlesData] = useState<Candle[]>([]);
    const [markersData, setMarkersData] = useState<any[]>([]);
    const [timeframe, setTimeframe] = useState<string>("15m");
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [showIndicatorMenu, setShowIndicatorMenu] = useState<boolean>(false);
    
    // Hover details legend state
    const [hoverData, setHoverData] = useState<{
        open: number;
        high: number;
        low: number;
        close: number;
        volume?: number;
        ema9?: number;
        ema20?: number;
        ema50?: number;
        ema200?: number;
        bbUpper?: number;
        bbMiddle?: number;
        bbLower?: number;
        rsi?: number;
        macdVal?: number;
        macdSignal?: number;
        macdHist?: number;
    } | null>(null);

    // Active indicators toggles
    const [indicators, setIndicators] = useState<IndicatorState>({
        ema9: false,
        ema20: false,
        ema50: true,
        ema200: true,
        bb: false,
        rsi: true,
        macd: false,
    });

    // Refs for charts and series for update/destroy lifecycle
    const chartRefs = useRef<{
        priceChart: IChartApi | null;
        rsiChart: IChartApi | null;
        macdChart: IChartApi | null;
        candlestickSeries: ISeriesApi<"Candlestick"> | null;
        volumeSeries: ISeriesApi<"Histogram"> | null;
        ema9Series: ISeriesApi<"Line"> | null;
        ema20Series: ISeriesApi<"Line"> | null;
        ema50Series: ISeriesApi<"Line"> | null;
        ema200Series: ISeriesApi<"Line"> | null;
        bbUpperSeries: ISeriesApi<"Line"> | null;
        bbMiddleSeries: ISeriesApi<"Line"> | null;
        bbLowerSeries: ISeriesApi<"Line"> | null;
        rsiSeries: ISeriesApi<"Line"> | null;
        macdLineSeries: ISeriesApi<"Line"> | null;
        macdSignalSeries: ISeriesApi<"Line"> | null;
        macdHistSeries: ISeriesApi<"Histogram"> | null;
    }>({
        priceChart: null,
        rsiChart: null,
        macdChart: null,
        candlestickSeries: null,
        volumeSeries: null,
        ema9Series: null,
        ema20Series: null,
        ema50Series: null,
        ema200Series: null,
        bbUpperSeries: null,
        bbMiddleSeries: null,
        bbLowerSeries: null,
        rsiSeries: null,
        macdLineSeries: null,
        macdSignalSeries: null,
        macdHistSeries: null
    });

    // 1. Fetch OHLCV candles data from our FastAPI backend
    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError(null);

        async function fetchCandles() {
            try {
                const res = await fetch(`/api/ai_bot/candles?symbol=${encodeURIComponent(symbol)}&limit=800`);
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
    }, [symbol]);

    // 2. Initialize and draw charts (Lightweight Charts Canvas)
    useEffect(() => {
        if (loading || error || candlesData.length === 0) return;

        const handleResize = () => {
            const width = mainContainerRef.current?.clientWidth || 0;
            if (chartRefs.current.priceChart) {
                const priceHeight = mainContainerRef.current?.clientHeight || 400;
                let activeLowerPanesCount = 0;
                if (indicators.rsi) activeLowerPanesCount++;
                if (indicators.macd) activeLowerPanesCount++;
                
                const paneHeight = 100;
                const pricePaneHeight = Math.max(200, priceHeight - (activeLowerPanesCount * paneHeight) - 45);
                
                chartRefs.current.priceChart.resize(width, pricePaneHeight);
                if (chartRefs.current.rsiChart) chartRefs.current.rsiChart.resize(width, paneHeight);
                if (chartRefs.current.macdChart) chartRefs.current.macdChart.resize(width, paneHeight);
            }
        };

        const width = mainContainerRef.current?.clientWidth || 0;
        const height = mainContainerRef.current?.clientHeight || 450;
        
        let activeLowerPanesCount = 0;
        if (indicators.rsi) activeLowerPanesCount++;
        if (indicators.macd) activeLowerPanesCount++;
        
        const paneHeight = 100;
        const priceHeight = Math.max(200, height - (activeLowerPanesCount * paneHeight) - 45);

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
            },
            rightPriceScale: {
                borderColor: "#2a2e39",
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

        // --- Calculate Overlay Indicators ---
        
        // EMA 9
        let ema9Points: LineDataPoint[] = [];
        if (indicators.ema9) {
            ema9Points = calculateEMA(candlesData, 9);
            const ema9Series = priceChart.addLineSeries({ color: "#2196f3", lineWidth: 2, title: "EMA 9" });
            ema9Series.setData(ema9Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.ema9Series = ema9Series;
        }

        // EMA 20
        let ema20Points: LineDataPoint[] = [];
        if (indicators.ema20) {
            ema20Points = calculateEMA(candlesData, 20);
            const ema20Series = priceChart.addLineSeries({ color: "#ff9800", lineWidth: 2, title: "EMA 20" });
            ema20Series.setData(ema20Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.ema20Series = ema20Series;
        }

        // EMA 50
        let ema50Points: LineDataPoint[] = [];
        if (indicators.ema50) {
            ema50Points = calculateEMA(candlesData, 50);
            const ema50Series = priceChart.addLineSeries({ color: "#e91e63", lineWidth: 2, title: "EMA 50" });
            ema50Series.setData(ema50Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.ema50Series = ema50Series;
        }

        // EMA 200
        let ema200Points: LineDataPoint[] = [];
        if (indicators.ema200) {
            ema200Points = calculateEMA(candlesData, 200);
            const ema200Series = priceChart.addLineSeries({ color: "#9c27b0", lineWidth: 2, title: "EMA 200" });
            ema200Series.setData(ema200Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.ema200Series = ema200Series;
        }

        // Bollinger Bands
        let bbPoints: BollingerBandsDataPoint[] = [];
        if (indicators.bb) {
            bbPoints = calculateBollingerBands(candlesData, 20, 2);
            
            const upper = priceChart.addLineSeries({ color: "#90caf9", lineWidth: 1, lineStyle: 2, title: "BB Upper" });
            upper.setData(bbPoints.map(p => ({ time: p.time as UTCTimestamp, value: p.upper })));
            chartRefs.current.bbUpperSeries = upper;

            const middle = priceChart.addLineSeries({ color: "#42a5f5", lineWidth: 1, lineStyle: 0, title: "BB Basis" });
            middle.setData(bbPoints.map(p => ({ time: p.time as UTCTimestamp, value: p.middle })));
            chartRefs.current.bbMiddleSeries = middle;

            const lower = priceChart.addLineSeries({ color: "#90caf9", lineWidth: 1, lineStyle: 2, title: "BB Lower" });
            lower.setData(bbPoints.map(p => ({ time: p.time as UTCTimestamp, value: p.lower })));
            chartRefs.current.bbLowerSeries = lower;
        }

        // --- Create Lower Panes ---
        const activeCharts: IChartApi[] = [priceChart];

        // RSI Pane
        let rsiPoints: LineDataPoint[] = [];
        if (indicators.rsi) {
            const rsiChart = createChart(rsiContainerRef.current!, {
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
                },
                rightPriceScale: {
                    borderColor: "#2a2e39",
                    entireTextOnly: true,
                }
            });
            chartRefs.current.rsiChart = rsiChart;
            activeCharts.push(rsiChart);

            // Add lines for 70 and 30 levels
            const rsiSeries = rsiChart.addLineSeries({ color: "#7e57c2", lineWidth: 2 });
            rsiPoints = calculateRSI(candlesData, 14);
            rsiSeries.setData(rsiPoints.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.rsiSeries = rsiSeries;

            // Render limit lines (30/70) margins
            const rsiScale = rsiSeries.priceScale();
            rsiScale.applyOptions({
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                },
            });
        }

        // MACD Pane
        let macdPoints: MacdDataPoint[] = [];
        if (indicators.macd) {
            const macdChart = createChart(macdContainerRef.current!, {
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
                    visible: false,
                },
                rightPriceScale: {
                    borderColor: "#2a2e39",
                }
            });
            chartRefs.current.macdChart = macdChart;
            activeCharts.push(macdChart);

            // MACD line
            macdPoints = calculateMACD(candlesData, 12, 26, 9);
            
            const macdLineSeries = macdChart.addLineSeries({ color: "#2962ff", lineWidth: 2 });
            macdLineSeries.setData(macdPoints.map(p => ({ time: p.time as UTCTimestamp, value: p.macd })));
            chartRefs.current.macdLineSeries = macdLineSeries;

            // Signal line
            const macdSignalSeries = macdChart.addLineSeries({ color: "#ff6d00", lineWidth: 2 });
            macdSignalSeries.setData(macdPoints.map(p => ({ time: p.time as UTCTimestamp, value: p.signal })));
            chartRefs.current.macdSignalSeries = macdSignalSeries;

            // Histogram
            const macdHistSeries = macdChart.addHistogramSeries({
                color: "#26a69a"
            });
            macdHistSeries.setData(macdPoints.map(p => ({
                time: p.time as UTCTimestamp,
                value: p.histogram,
                color: p.histogram >= 0 ? "#26a69a80" : "#ef535080"
            })));
            chartRefs.current.macdHistSeries = macdHistSeries;
        }

        // Sync visual timescales across active pane charts
        if (activeCharts.length > 1) {
            for (let i = 0; i < activeCharts.length; i++) {
                const chartA = activeCharts[i];
                chartA.timeScale().subscribeVisibleTimeRangeChange((range) => {
                    for (let j = 0; j < activeCharts.length; j++) {
                        if (i !== j) {
                            activeCharts[j].timeScale().setVisibleRange(range!);
                        }
                    }
                });
            }
        }

        // --- Render Local Strategy Trade Markers ---
        if (markersData && markersData.length > 0) {
            // Map markers unix timestamps to verify they exist on the chart
            const candleTimes = new Set(candlesData.map(c => c.time));
            const formattedMarkers: SeriesMarker<UTCTimestamp>[] = markersData
                .filter(m => candleTimes.has(m.time))
                .map(m => ({
                    time: m.time as UTCTimestamp,
                    position: m.position,
                    color: m.color,
                    shape: m.shape,
                    text: m.text,
                    size: 1.5,
                }));
            candlestickSeries.setMarkers(formattedMarkers);
        }

        // --- Setup Crosshair Tooltip Hover Legend details ---
        priceChart.subscribeCrosshairMove((param) => {
            if (!param.time || !param.point) {
                setHoverData(null);
                return;
            }

            const candle = candlesData.find(c => c.time === param.time);
            if (!candle) return;

            const t = param.time as number;

            // Retrieve values for enabled indicators at current crosshair coordinate
            const e9 = ema9Points.find(p => p.time === t)?.value;
            const e20 = ema20Points.find(p => p.time === t)?.value;
            const e50 = ema50Points.find(p => p.time === t)?.value;
            const e200 = ema200Points.find(p => p.time === t)?.value;
            const bb = bbPoints.find(p => p.time === t);
            const rsiVal = rsiPoints.find(p => p.time === t)?.value;
            const macdVal = macdPoints.find(p => p.time === t);

            setHoverData({
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
                ema9: e9,
                ema20: e20,
                ema50: e50,
                ema200: e200,
                bbUpper: bb?.upper,
                bbMiddle: bb?.middle,
                bbLower: bb?.lower,
                rsi: rsiVal,
                macdVal: macdVal?.macd,
                macdSignal: macdVal?.signal,
                macdHist: macdVal?.histogram
            });
        });

        // Setup resize hook
        window.addEventListener("resize", handleResize);
        setTimeout(handleResize, 100);

        return () => {
            window.removeEventListener("resize", handleResize);
            
            // Clean up charts
            if (chartRefs.current.priceChart) {
                chartRefs.current.priceChart.removeSeries(candlestickSeries);
                chartRefs.current.priceChart.removeSeries(volumeSeries);
                chartRefs.current.priceChart.remove();
                chartRefs.current.priceChart = null;
            }
            if (chartRefs.current.rsiChart) {
                chartRefs.current.rsiChart.remove();
                chartRefs.current.rsiChart = null;
            }
            if (chartRefs.current.macdChart) {
                chartRefs.current.macdChart.remove();
                chartRefs.current.macdChart = null;
            }
        };
    }, [candlesData, indicators, loading, error, markersData]);

    const toggleIndicator = (key: keyof IndicatorState) => {
        setIndicators(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

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
        <div ref={mainContainerRef} className="w-full h-full flex flex-col bg-[#131722] relative select-none">
            
            {/* Custom Interactive Toolbar */}
            <div className="h-10 border-b border-[#2a2e39] bg-[#1c2030]/30 px-3 flex items-center justify-between text-xs text-[#d1d4dc] z-30">
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                    <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-bold text-white uppercase tracking-tight">{symbol}</span>
                        <span className="text-[10px] text-[#787b86] font-mono">({timeframe})</span>
                    </div>

                    <div className="h-4 w-[1px] bg-[#2a2e39] shrink-0" />

                    {/* Indicators dropdown toggle */}
                    <div className="relative shrink-0">
                        <button 
                            onClick={() => setShowIndicatorMenu(!showIndicatorMenu)}
                            className={`flex items-center gap-1 h-7 px-2.5 rounded transition-all active:scale-95 text-[11px] font-bold uppercase tracking-wider
                                ${showIndicatorMenu 
                                    ? "bg-[#2962ff] text-white" 
                                    : "bg-[#1c2030] hover:bg-[#2a2e39] text-[#b2b5be] border border-[#2a2e39]"
                                }
                            `}
                        >
                            <Settings className="w-3.5 h-3.5" />
                            <span>Indicators</span>
                        </button>

                        {showIndicatorMenu && (
                            <div className="absolute top-full left-0 mt-1.5 w-56 rounded bg-[#131722] border border-[#2a2e39] shadow-2xl p-2.5 z-[160] flex flex-col gap-1 text-[11px]">
                                <h4 className="text-[9px] font-bold text-[#787b86] uppercase tracking-wider mb-1 px-1">Toggle Indicators</h4>
                                
                                <button 
                                    onClick={() => toggleIndicator("ema9")}
                                    className="flex items-center justify-between w-full h-7 px-2 hover:bg-[#1c2030] text-left rounded text-[#d1d4dc]"
                                >
                                    <span>Exponential Average 9</span>
                                    {indicators.ema9 ? <Eye className="w-3.5 h-3.5 text-[#2196f3]" /> : <EyeOff className="w-3.5 h-3.5 text-[#787b86]/40" />}
                                </button>
                                
                                <button 
                                    onClick={() => toggleIndicator("ema20")}
                                    className="flex items-center justify-between w-full h-7 px-2 hover:bg-[#1c2030] text-left rounded text-[#d1d4dc]"
                                >
                                    <span>Exponential Average 20</span>
                                    {indicators.ema20 ? <Eye className="w-3.5 h-3.5 text-[#ff9800]" /> : <EyeOff className="w-3.5 h-3.5 text-[#787b86]/40" />}
                                </button>

                                <button 
                                    onClick={() => toggleIndicator("ema50")}
                                    className="flex items-center justify-between w-full h-7 px-2 hover:bg-[#1c2030] text-left rounded text-[#d1d4dc]"
                                >
                                    <span>Exponential Average 50</span>
                                    {indicators.ema50 ? <Eye className="w-3.5 h-3.5 text-[#e91e63]" /> : <EyeOff className="w-3.5 h-3.5 text-[#787b86]/40" />}
                                </button>

                                <button 
                                    onClick={() => toggleIndicator("ema200")}
                                    className="flex items-center justify-between w-full h-7 px-2 hover:bg-[#1c2030] text-left rounded text-[#d1d4dc]"
                                >
                                    <span>Exponential Average 200</span>
                                    {indicators.ema200 ? <Eye className="w-3.5 h-3.5 text-[#9c27b0]" /> : <EyeOff className="w-3.5 h-3.5 text-[#787b86]/40" />}
                                </button>

                                <div className="h-[1px] bg-[#2a2e39] my-1" />

                                <button 
                                    onClick={() => toggleIndicator("bb")}
                                    className="flex items-center justify-between w-full h-7 px-2 hover:bg-[#1c2030] text-left rounded text-[#d1d4dc]"
                                >
                                    <span>Bollinger Bands (20, 2)</span>
                                    {indicators.bb ? <Eye className="w-3.5 h-3.5 text-[#90caf9]" /> : <EyeOff className="w-3.5 h-3.5 text-[#787b86]/40" />}
                                </button>

                                <button 
                                    onClick={() => toggleIndicator("rsi")}
                                    className="flex items-center justify-between w-full h-7 px-2 hover:bg-[#1c2030] text-left rounded text-[#d1d4dc]"
                                >
                                    <span>RSI Pane (14)</span>
                                    {indicators.rsi ? <Eye className="w-3.5 h-3.5 text-[#7e57c2]" /> : <EyeOff className="w-3.5 h-3.5 text-[#787b86]/40" />}
                                </button>

                                <button 
                                    onClick={() => toggleIndicator("macd")}
                                    className="flex items-center justify-between w-full h-7 px-2 hover:bg-[#1c2030] text-left rounded text-[#d1d4dc]"
                                >
                                    <span>MACD Pane (12, 26, 9)</span>
                                    {indicators.macd ? <Eye className="w-3.5 h-3.5 text-[#2962ff]" /> : <EyeOff className="w-3.5 h-3.5 text-[#787b86]/40" />}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Display markers count */}
                {markersData.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-[#26a69a] uppercase tracking-wider font-mono shrink-0">
                        <BarChart3 className="w-3.5 h-3.5 text-[#26a69a]" />
                        <span>{markersData.length} Trades Synced</span>
                    </div>
                )}
            </div>

            {/* Sub-Legend containing exact Candlestick metrics and Indicator values under Crosshair */}
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
                        
                        {/* Overlay Indicators */}
                        {indicators.ema9 && hoverData.ema9 !== undefined && (
                            <span className="text-[#2196f3] shrink-0 font-bold">EMA(9): <span>{hoverData.ema9.toFixed(2)}</span></span>
                        )}
                        {indicators.ema20 && hoverData.ema20 !== undefined && (
                            <span className="text-[#ff9800] shrink-0 font-bold">EMA(20): <span>{hoverData.ema20.toFixed(2)}</span></span>
                        )}
                        {indicators.ema50 && hoverData.ema50 !== undefined && (
                            <span className="text-[#e91e63] shrink-0 font-bold">EMA(50): <span>{hoverData.ema50.toFixed(2)}</span></span>
                        )}
                        {indicators.ema200 && hoverData.ema200 !== undefined && (
                            <span className="text-[#9c27b0] shrink-0 font-bold">EMA(200): <span>{hoverData.ema200.toFixed(2)}</span></span>
                        )}
                        {indicators.bb && hoverData.bbMiddle !== undefined && (
                            <span className="text-[#90caf9] shrink-0 font-bold">
                                BB(20,2): <span className="text-white">U {hoverData.bbUpper?.toFixed(2)}</span> M {hoverData.bbMiddle?.toFixed(2)} <span className="text-white">L {hoverData.bbLower?.toFixed(2)}</span>
                            </span>
                        )}
                        {indicators.rsi && hoverData.rsi !== undefined && (
                            <span className="text-[#7e57c2] shrink-0 font-bold">RSI(14): <span>{hoverData.rsi.toFixed(2)}</span></span>
                        )}
                        {indicators.macd && hoverData.macdVal !== undefined && (
                            <span className="text-[#2962ff] shrink-0 font-bold">
                                MACD: <span className="text-[#2962ff]">{hoverData.macdVal?.toFixed(2)}</span> Sig: <span className="text-[#ff6d00]">{hoverData.macdSignal?.toFixed(2)}</span> Hist: <span className={hoverData.macdHist! >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}>{hoverData.macdHist?.toFixed(2)}</span>
                            </span>
                        )}
                    </>
                ) : (
                    <span className="text-[#787b86] italic tracking-wide">Hover crosshair over candles for OHLCV & Indicator metrics</span>
                )}
            </div>

            {/* Containers for Price and Lower Pane charts */}
            <div className="flex-1 flex flex-col min-h-0 bg-[#131722] p-1">
                
                {/* 1. Candlestick Chart */}
                <div ref={priceContainerRef} className="flex-1 w-full min-h-0" />

                {/* 2. RSI Panel (rendered dynamically if checked) */}
                {indicators.rsi && (
                    <div className="w-full h-[100px] relative border-t border-[#2a2e39] mt-1 shrink-0">
                        <div className="absolute top-1 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-[#787b86] uppercase tracking-wider">
                            RSI (14) <span className="text-[#7e57c2] font-semibold">{hoverData?.rsi ? `: ${hoverData.rsi.toFixed(2)}` : ""}</span>
                        </div>
                        {/* 30 & 70 line markers in overlay */}
                        <div className="absolute right-0 top-[30px] w-full border-t border-[#7e57c2]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">70</div>
                        <div className="absolute right-0 bottom-[30px] w-full border-t border-[#7e57c2]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">30</div>
                        
                        <div ref={rsiContainerRef} className="w-full h-full" />
                    </div>
                )}

                {/* 3. MACD Panel (rendered dynamically if checked) */}
                {indicators.macd && (
                    <div className="w-full h-[100px] relative border-t border-[#2a2e39] mt-1 shrink-0">
                        <div className="absolute top-1 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-[#787b86] uppercase tracking-wider">
                            MACD (12, 26, 9) <span className="text-[#2962ff] font-semibold">
                                {hoverData?.macdVal ? `: M ${hoverData.macdVal.toFixed(2)} S ${hoverData.macdSignal?.toFixed(2)} H ${hoverData.macdHist?.toFixed(2)}` : ""}
                            </span>
                        </div>
                        
                        <div ref={macdContainerRef} className="w-full h-full" />
                    </div>
                )}
            </div>
        </div>
    );
}
