"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createChart, IChartApi, ISeriesApi, UTCTimestamp, SeriesMarker, ColorType } from "lightweight-charts";
import { Loader2, Settings, Eye, EyeOff, BarChart3, AlertCircle, Search, X } from "lucide-react";
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
    LineDataPoint,
    BollingerBandsDataPoint,
    MacdDataPoint,
    AtrDataPoint,
    StochDataPoint,
    CciDataPoint
} from "@/lib/indicators";

interface TradingViewChartProps {
    symbol: string;
    theme?: "dark" | "light";
    exchange?: string;
}

interface IndicatorState {
    ema9: boolean;
    ema20: boolean;
    ema50: boolean;
    ema200: boolean;
    sma20: boolean;
    sma50: boolean;
    sma200: boolean;
    bb: boolean;
    rsi: boolean;
    macd: boolean;
    atr: boolean;
    stoch: boolean;
    cci: boolean;
}

interface IndicatorParams {
    ema9: number;
    ema20: number;
    ema50: number;
    ema200: number;
    sma20: number;
    sma50: number;
    sma200: number;
    bbPeriod: number;
    bbStdDev: number;
    rsi: number;
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    atr: number;
    stochK: number;
    stochD: number;
    cci: number;
}

export default function TradingViewChart({ symbol, theme = "dark", exchange }: TradingViewChartProps) {
    const mainContainerRef = useRef<HTMLDivElement>(null);
    const priceContainerRef = useRef<HTMLDivElement>(null);
    const rsiContainerRef = useRef<HTMLDivElement>(null);
    const macdContainerRef = useRef<HTMLDivElement>(null);
    const atrContainerRef = useRef<HTMLDivElement>(null);
    const stochContainerRef = useRef<HTMLDivElement>(null);
    const cciContainerRef = useRef<HTMLDivElement>(null);

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
        sma20?: number;
        sma50?: number;
        sma200?: number;
        bbUpper?: number;
        bbMiddle?: number;
        bbLower?: number;
        rsi?: number;
        macdVal?: number;
        macdSignal?: number;
        macdHist?: number;
        atr?: number;
        stochK?: number;
        stochD?: number;
        cci?: number;
    } | null>(null);

    // Active indicators toggles
    const [indicators, setIndicators] = useState<IndicatorState>({
        ema9: false,
        ema20: false,
        ema50: true,
        ema200: true,
        sma20: false,
        sma50: false,
        sma200: false,
        bb: false,
        rsi: true,
        macd: false,
        atr: false,
        stoch: false,
        cci: false,
    });

    const [indicatorParams, setIndicatorParams] = useState<IndicatorParams>({
        ema9: 9,
        ema20: 20,
        ema50: 50,
        ema200: 200,
        sma20: 20,
        sma50: 50,
        sma200: 200,
        bbPeriod: 20,
        bbStdDev: 2,
        rsi: 14,
        macdFast: 12,
        macdSlow: 26,
        macdSignal: 9,
        atr: 14,
        stochK: 14,
        stochD: 3,
        cci: 20
    });

    const [showIndicatorModal, setShowIndicatorModal] = useState<boolean>(false);
    const [indicatorSearchQuery, setIndicatorSearchQuery] = useState<string>("");

    // Refs for charts and series for update/destroy lifecycle
    const chartRefs = useRef<{
        priceChart: IChartApi | null;
        rsiChart: IChartApi | null;
        macdChart: IChartApi | null;
        atrChart: IChartApi | null;
        stochChart: IChartApi | null;
        cciChart: IChartApi | null;
        candlestickSeries: ISeriesApi<"Candlestick"> | null;
        volumeSeries: ISeriesApi<"Histogram"> | null;
        ema9Series: ISeriesApi<"Line"> | null;
        ema20Series: ISeriesApi<"Line"> | null;
        ema50Series: ISeriesApi<"Line"> | null;
        ema200Series: ISeriesApi<"Line"> | null;
        sma20Series: ISeriesApi<"Line"> | null;
        sma50Series: ISeriesApi<"Line"> | null;
        sma200Series: ISeriesApi<"Line"> | null;
        bbUpperSeries: ISeriesApi<"Line"> | null;
        bbMiddleSeries: ISeriesApi<"Line"> | null;
        bbLowerSeries: ISeriesApi<"Line"> | null;
        rsiSeries: ISeriesApi<"Line"> | null;
        macdLineSeries: ISeriesApi<"Line"> | null;
        macdSignalSeries: ISeriesApi<"Line"> | null;
        macdHistSeries: ISeriesApi<"Histogram"> | null;
        atrSeries: ISeriesApi<"Line"> | null;
        stochKSeries: ISeriesApi<"Line"> | null;
        stochDSeries: ISeriesApi<"Line"> | null;
        cciSeries: ISeriesApi<"Line"> | null;
    }>({
        priceChart: null,
        rsiChart: null,
        macdChart: null,
        atrChart: null,
        stochChart: null,
        cciChart: null,
        candlestickSeries: null,
        volumeSeries: null,
        ema9Series: null,
        ema20Series: null,
        ema50Series: null,
        ema200Series: null,
        sma20Series: null,
        sma50Series: null,
        sma200Series: null,
        bbUpperSeries: null,
        bbMiddleSeries: null,
        bbLowerSeries: null,
        rsiSeries: null,
        macdLineSeries: null,
        macdSignalSeries: null,
        macdHistSeries: null,
        atrSeries: null,
        stochKSeries: null,
        stochDSeries: null,
        cciSeries: null
    });

    const lastSize = useRef({ width: 0, height: 0 });
    const savedLogicalRangeRef = useRef<{ from: number; to: number } | null>(null);

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

    // 2. Initialize and draw charts (Lightweight Charts Canvas)
    useEffect(() => {
        if (loading || error || candlesData.length === 0) return;

        const handleResize = (newWidth?: number, newHeight?: number) => {
            const width = newWidth !== undefined ? newWidth : (mainContainerRef.current?.clientWidth || 0);
            const height = newHeight !== undefined ? newHeight : (mainContainerRef.current?.clientHeight || 450);
            if (chartRefs.current.priceChart) {
                let activeLowerPanesCount = 0;
                if (indicators.rsi) activeLowerPanesCount++;
                if (indicators.macd) activeLowerPanesCount++;
                if (indicators.atr) activeLowerPanesCount++;
                if (indicators.stoch) activeLowerPanesCount++;
                if (indicators.cci) activeLowerPanesCount++;
                
                const paneHeight = 100;
                const pricePaneHeight = Math.max(150, height - (activeLowerPanesCount * paneHeight) - 45);
                
                chartRefs.current.priceChart.resize(width, pricePaneHeight);
                if (chartRefs.current.rsiChart) chartRefs.current.rsiChart.resize(width, paneHeight);
                if (chartRefs.current.macdChart) chartRefs.current.macdChart.resize(width, paneHeight);
                if (chartRefs.current.atrChart) chartRefs.current.atrChart.resize(width, paneHeight);
                if (chartRefs.current.stochChart) chartRefs.current.stochChart.resize(width, paneHeight);
                if (chartRefs.current.cciChart) chartRefs.current.cciChart.resize(width, paneHeight);
            }
        };

        const width = mainContainerRef.current?.clientWidth || 0;
        const height = mainContainerRef.current?.clientHeight || 450;
        
        let activeLowerPanesCount = 0;
        if (indicators.rsi) activeLowerPanesCount++;
        if (indicators.macd) activeLowerPanesCount++;
        if (indicators.atr) activeLowerPanesCount++;
        if (indicators.stoch) activeLowerPanesCount++;
        if (indicators.cci) activeLowerPanesCount++;
        
        const paneHeight = 100;
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
                mouseWheel: false,
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
        
        // SMA 20
        let sma20Points: LineDataPoint[] = [];
        if (indicators.sma20) {
            sma20Points = calculateSMA(candlesData, indicatorParams.sma20);
            const sma20Series = priceChart.addLineSeries({ color: "#4caf50", lineWidth: 2, title: `SMA ${indicatorParams.sma20}` });
            sma20Series.setData(sma20Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.sma20Series = sma20Series;
        }

        // SMA 50
        let sma50Points: LineDataPoint[] = [];
        if (indicators.sma50) {
            sma50Points = calculateSMA(candlesData, indicatorParams.sma50);
            const sma50Series = priceChart.addLineSeries({ color: "#00bcd4", lineWidth: 2, title: `SMA ${indicatorParams.sma50}` });
            sma50Series.setData(sma50Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.sma50Series = sma50Series;
        }

        // SMA 200
        let sma200Points: LineDataPoint[] = [];
        if (indicators.sma200) {
            sma200Points = calculateSMA(candlesData, indicatorParams.sma200);
            const sma200Series = priceChart.addLineSeries({ color: "#ffeb3b", lineWidth: 2, title: `SMA ${indicatorParams.sma200}` });
            sma200Series.setData(sma200Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.sma200Series = sma200Series;
        }
        
        // EMA 9
        let ema9Points: LineDataPoint[] = [];
        if (indicators.ema9) {
            ema9Points = calculateEMA(candlesData, indicatorParams.ema9);
            const ema9Series = priceChart.addLineSeries({ color: "#2196f3", lineWidth: 2, title: `EMA ${indicatorParams.ema9}` });
            ema9Series.setData(ema9Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.ema9Series = ema9Series;
        }

        // EMA 20
        let ema20Points: LineDataPoint[] = [];
        if (indicators.ema20) {
            ema20Points = calculateEMA(candlesData, indicatorParams.ema20);
            const ema20Series = priceChart.addLineSeries({ color: "#ff9800", lineWidth: 2, title: `EMA ${indicatorParams.ema20}` });
            ema20Series.setData(ema20Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.ema20Series = ema20Series;
        }

        // EMA 50
        let ema50Points: LineDataPoint[] = [];
        if (indicators.ema50) {
            ema50Points = calculateEMA(candlesData, indicatorParams.ema50);
            const ema50Series = priceChart.addLineSeries({ color: "#e91e63", lineWidth: 2, title: `EMA ${indicatorParams.ema50}` });
            ema50Series.setData(ema50Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.ema50Series = ema50Series;
        }

        // EMA 200
        let ema200Points: LineDataPoint[] = [];
        if (indicators.ema200) {
            ema200Points = calculateEMA(candlesData, indicatorParams.ema200);
            const ema200Series = priceChart.addLineSeries({ color: "#9c27b0", lineWidth: 2, title: `EMA ${indicatorParams.ema200}` });
            ema200Series.setData(ema200Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.ema200Series = ema200Series;
        }

        // Bollinger Bands
        let bbPoints: BollingerBandsDataPoint[] = [];
        if (indicators.bb) {
            bbPoints = calculateBollingerBands(candlesData, indicatorParams.bbPeriod, indicatorParams.bbStdDev);
            
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
                    mouseWheel: false,
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
            chartRefs.current.rsiChart = rsiChart;
            activeCharts.push(rsiChart);

            // Add lines for 70 and 30 levels
            const rsiSeries = rsiChart.addLineSeries({ color: "#7e57c2", lineWidth: 2 });
            rsiPoints = calculateRSI(candlesData, indicatorParams.rsi);
            
            // Map candlesData to keep dates aligned (pad beginning with whitespace data)
            const rsiData = candlesData.map(c => {
                const p = rsiPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { time: c.time as UTCTimestamp, value: p.value } 
                    : { time: c.time as UTCTimestamp };
            });
            rsiSeries.setData(rsiData);
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

        // ATR Pane
        let atrPoints: AtrDataPoint[] = [];
        if (indicators.atr) {
            const atrChart = createChart(atrContainerRef.current!, {
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
                    rightOffset: 30,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                },
                rightPriceScale: {
                    borderColor: "#2a2e39",
                    minimumWidth: 80,
                },
                handleScroll: {
                    mouseWheel: false,
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
            chartRefs.current.atrChart = atrChart;
            activeCharts.push(atrChart);

            const atrSeries = atrChart.addLineSeries({ color: "#26a69a", lineWidth: 2 });
            atrPoints = calculateATR(candlesData, indicatorParams.atr);
            
            const atrData = candlesData.map(c => {
                const p = atrPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { time: c.time as UTCTimestamp, value: p.value } 
                    : { time: c.time as UTCTimestamp };
            });
            atrSeries.setData(atrData);
            chartRefs.current.atrSeries = atrSeries;
        }

        // Stochastic Pane
        let stochPoints: StochDataPoint[] = [];
        if (indicators.stoch) {
            const stochChart = createChart(stochContainerRef.current!, {
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
                    rightOffset: 30,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                },
                rightPriceScale: {
                    borderColor: "#2a2e39",
                    minimumWidth: 80,
                },
                handleScroll: {
                    mouseWheel: false,
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
            chartRefs.current.stochChart = stochChart;
            activeCharts.push(stochChart);

            const kSeries = stochChart.addLineSeries({ color: "#2196f3", lineWidth: 2 });
            const dSeries = stochChart.addLineSeries({ color: "#ff9800", lineWidth: 2, lineStyle: 2 });
            stochPoints = calculateStochastic(candlesData, indicatorParams.stochK, indicatorParams.stochD);
            
            const kData = candlesData.map(c => {
                const p = stochPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { time: c.time as UTCTimestamp, value: p.k } 
                    : { time: c.time as UTCTimestamp };
            });
            const dData = candlesData.map(c => {
                const p = stochPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { time: c.time as UTCTimestamp, value: p.d } 
                    : { time: c.time as UTCTimestamp };
            });
            kSeries.setData(kData);
            dSeries.setData(dData);
            chartRefs.current.stochKSeries = kSeries;
            chartRefs.current.stochDSeries = dSeries;
        }

        // CCI Pane
        let cciPoints: CciDataPoint[] = [];
        if (indicators.cci) {
            const cciChart = createChart(cciContainerRef.current!, {
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
                    rightOffset: 30,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                },
                rightPriceScale: {
                    borderColor: "#2a2e39",
                    minimumWidth: 80,
                },
                handleScroll: {
                    mouseWheel: false,
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
            chartRefs.current.cciChart = cciChart;
            activeCharts.push(cciChart);

            const cciSeries = cciChart.addLineSeries({ color: "#e91e63", lineWidth: 2 });
            cciPoints = calculateCCI(candlesData, indicatorParams.cci);
            
            const cciData = candlesData.map(c => {
                const p = cciPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { time: c.time as UTCTimestamp, value: p.value } 
                    : { time: c.time as UTCTimestamp };
            });
            cciSeries.setData(cciData);
            chartRefs.current.cciSeries = cciSeries;
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
                    rightOffset: 30,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                },
                rightPriceScale: {
                    borderColor: "#2a2e39",
                    minimumWidth: 80,
                },
                handleScroll: {
                    mouseWheel: false,
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
            chartRefs.current.macdChart = macdChart;
            activeCharts.push(macdChart);

            // MACD line
            macdPoints = calculateMACD(candlesData, indicatorParams.macdFast, indicatorParams.macdSlow, indicatorParams.macdSignal);
            
            const macdLineSeries = macdChart.addLineSeries({ color: "#2962ff", lineWidth: 2 });
            const macdLineData = candlesData.map(c => {
                const p = macdPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { time: c.time as UTCTimestamp, value: p.macd } 
                    : { time: c.time as UTCTimestamp };
            });
            macdLineSeries.setData(macdLineData);
            chartRefs.current.macdLineSeries = macdLineSeries;

            // Signal line
            const macdSignalSeries = macdChart.addLineSeries({ color: "#ff6d00", lineWidth: 2 });
            const macdSignalData = candlesData.map(c => {
                const p = macdPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { time: c.time as UTCTimestamp, value: p.signal } 
                    : { time: c.time as UTCTimestamp };
            });
            macdSignalSeries.setData(macdSignalData);
            chartRefs.current.macdSignalSeries = macdSignalSeries;

            // Histogram
            const macdHistSeries = macdChart.addHistogramSeries({
                color: "#26a69a"
            });
            const macdHistData = candlesData.map(c => {
                const p = macdPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { 
                        time: c.time as UTCTimestamp, 
                        value: p.histogram, 
                        color: p.histogram >= 0 ? "#26a69a80" : "#ef535080" 
                      } 
                    : { time: c.time as UTCTimestamp };
            });
            macdHistSeries.setData(macdHistData);
            chartRefs.current.macdHistSeries = macdHistSeries;
        }

        // Sync visual timescales across active pane charts without loop feedback and with boundary clamping
        let isSyncing = false;
        if (activeCharts.length >= 1) {
            const totalBars = candlesData.length;
            for (let i = 0; i < activeCharts.length; i++) {
                const chartA = activeCharts[i];
                chartA.timeScale().subscribeVisibleLogicalRangeChange((range) => {
                    if (isSyncing || !range) return;
                    
                    let from = range.from;
                    let to = range.to;
                    const width = to - from;
                    
                    // Clamp to keep candles visible on canvas:
                    // Max from (left-most visible index) should not exceed totalBars - 5
                    // Min to (right-most visible index) should not go below 5
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
                    
                    isSyncing = true;
                    const targetRange = needsClamping ? { from, to } : range;
                    for (let j = 0; j < activeCharts.length; j++) {
                        if (needsClamping || i !== j) {
                            activeCharts[j].timeScale().setVisibleLogicalRange(targetRange);
                        }
                    }
                    isSyncing = false;
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
            const sma20Val = sma20Points.find(p => p.time === t)?.value;
            const sma50Val = sma50Points.find(p => p.time === t)?.value;
            const sma200Val = sma200Points.find(p => p.time === t)?.value;
            const bb = bbPoints.find(p => p.time === t);
            const rsiVal = rsiPoints.find(p => p.time === t)?.value;
            const macdVal = macdPoints.find(p => p.time === t);
            const atrVal = atrPoints.find(p => p.time === t)?.value;
            const stochVal = stochPoints.find(p => p.time === t);
            const cciVal = cciPoints.find(p => p.time === t)?.value;

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
                sma20: sma20Val,
                sma50: sma50Val,
                sma200: sma200Val,
                bbUpper: bb?.upper,
                bbMiddle: bb?.middle,
                bbLower: bb?.lower,
                rsi: rsiVal,
                macdVal: macdVal?.macd,
                macdSignal: macdVal?.signal,
                macdHist: macdVal?.histogram,
                atr: atrVal,
                stochK: stochVal?.k,
                stochD: stochVal?.d,
                cci: cciVal
            });
        });

        // Setup resize hook using ResizeObserver
        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries || entries.length === 0) return;
            const { width, height } = entries[0].contentRect;
            const roundedWidth = Math.floor(width);
            const roundedHeight = Math.floor(height);
            // Prevent infinite resize loops
            if (roundedWidth !== lastSize.current.width || roundedHeight !== lastSize.current.height) {
                lastSize.current = { width: roundedWidth, height: roundedHeight };
                handleResize(roundedWidth, roundedHeight);
            }
        });

        if (mainContainerRef.current) {
            resizeObserver.observe(mainContainerRef.current);
        }
        
        // Initial resize and initial timescale alignment to prevent date misalignment of indicator sub-panes
        setTimeout(() => {
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
                    if (chartRefs.current.rsiChart) {
                        chartRefs.current.rsiChart.timeScale().setVisibleLogicalRange(currentRange);
                    }
                    if (chartRefs.current.macdChart) {
                        chartRefs.current.macdChart.timeScale().setVisibleLogicalRange(currentRange);
                    }
                    if (chartRefs.current.atrChart) {
                        chartRefs.current.atrChart.timeScale().setVisibleLogicalRange(currentRange);
                    }
                    if (chartRefs.current.stochChart) {
                        chartRefs.current.stochChart.timeScale().setVisibleLogicalRange(currentRange);
                    }
                    if (chartRefs.current.cciChart) {
                        chartRefs.current.cciChart.timeScale().setVisibleLogicalRange(currentRange);
                    }
                }
            }
        }, 150);

        return () => {
            resizeObserver.disconnect();
            
            // Save current logical range before destruction
            if (chartRefs.current.priceChart) {
                const range = chartRefs.current.priceChart.timeScale().getVisibleLogicalRange();
                if (range) {
                    savedLogicalRangeRef.current = { from: range.from, to: range.to };
                }
            }
            
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
            if (chartRefs.current.atrChart) {
                chartRefs.current.atrChart.remove();
                chartRefs.current.atrChart = null;
            }
            if (chartRefs.current.stochChart) {
                chartRefs.current.stochChart.remove();
                chartRefs.current.stochChart = null;
            }
            if (chartRefs.current.cciChart) {
                chartRefs.current.cciChart.remove();
                chartRefs.current.cciChart = null;
            }
        };
    }, [candlesData, indicators, loading, error, markersData, indicatorParams]);

    const toggleIndicator = (key: keyof IndicatorState) => {
        setIndicators(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    const renderIndicatorParams = (key: string) => {
        const inputClass = "w-14 h-6 px-1 rounded bg-[#1c2030] border border-[#2a2e39] text-white text-center text-xs font-mono focus:outline-none focus:border-indigo-500 transition-colors";
        const labelClass = "flex items-center gap-1.5 shrink-0";

        const updateParam = (paramKey: keyof IndicatorParams, val: number) => {
            if (isNaN(val) || val < 1) return;
            setIndicatorParams(prev => ({
                ...prev,
                [paramKey]: val
            }));
        };

        switch (key) {
            case "ema9":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="500" 
                            value={indicatorParams.ema9}
                            onChange={(e) => updateParam("ema9", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "ema20":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="500" 
                            value={indicatorParams.ema20}
                            onChange={(e) => updateParam("ema20", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "ema50":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="500" 
                            value={indicatorParams.ema50}
                            onChange={(e) => updateParam("ema50", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "ema200":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="500" 
                            value={indicatorParams.ema200}
                            onChange={(e) => updateParam("ema200", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "sma20":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="500" 
                            value={indicatorParams.sma20}
                            onChange={(e) => updateParam("sma20", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "sma50":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="500" 
                            value={indicatorParams.sma50}
                            onChange={(e) => updateParam("sma50", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "sma200":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="500" 
                            value={indicatorParams.sma200}
                            onChange={(e) => updateParam("sma200", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "bb":
                return (
                    <div className="flex items-center gap-3">
                        <label className={labelClass}>
                            <span>Period:</span>
                            <input 
                                type="number" 
                                min="1" 
                                max="200" 
                                value={indicatorParams.bbPeriod}
                                onChange={(e) => updateParam("bbPeriod", parseInt(e.target.value))}
                                className={inputClass}
                            />
                        </label>
                        <label className={labelClass}>
                            <span>StdDev:</span>
                            <input 
                                type="number" 
                                min="1" 
                                max="10" 
                                value={indicatorParams.bbStdDev}
                                onChange={(e) => updateParam("bbStdDev", parseInt(e.target.value))}
                                className={inputClass}
                            />
                        </label>
                    </div>
                );
            case "rsi":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="200" 
                            value={indicatorParams.rsi}
                            onChange={(e) => updateParam("rsi", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "macd":
                return (
                    <div className="flex flex-wrap items-center gap-3">
                        <label className={labelClass}>
                            <span>Fast:</span>
                            <input 
                                type="number" 
                                min="1" 
                                max="200" 
                                value={indicatorParams.macdFast}
                                onChange={(e) => updateParam("macdFast", parseInt(e.target.value))}
                                className={inputClass}
                            />
                        </label>
                        <label className={labelClass}>
                            <span>Slow:</span>
                            <input 
                                type="number" 
                                min="1" 
                                max="200" 
                                value={indicatorParams.macdSlow}
                                onChange={(e) => updateParam("macdSlow", parseInt(e.target.value))}
                                className={inputClass}
                            />
                        </label>
                        <label className={labelClass}>
                            <span>Signal:</span>
                            <input 
                                type="number" 
                                min="1" 
                                max="200" 
                                value={indicatorParams.macdSignal}
                                onChange={(e) => updateParam("macdSignal", parseInt(e.target.value))}
                                className={inputClass}
                            />
                        </label>
                    </div>
                );
            case "atr":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="200" 
                            value={indicatorParams.atr}
                            onChange={(e) => updateParam("atr", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            case "stoch":
                return (
                    <div className="flex items-center gap-3">
                        <label className={labelClass}>
                            <span>%K:</span>
                            <input 
                                type="number" 
                                min="1" 
                                max="200" 
                                value={indicatorParams.stochK}
                                onChange={(e) => updateParam("stochK", parseInt(e.target.value))}
                                className={inputClass}
                            />
                        </label>
                        <label className={labelClass}>
                            <span>%D:</span>
                            <input 
                                type="number" 
                                min="1" 
                                max="200" 
                                value={indicatorParams.stochD}
                                onChange={(e) => updateParam("stochD", parseInt(e.target.value))}
                                className={inputClass}
                            />
                        </label>
                    </div>
                );
            case "cci":
                return (
                    <label className={labelClass}>
                        <span>Period:</span>
                        <input 
                            type="number" 
                            min="1" 
                            max="200" 
                            value={indicatorParams.cci}
                            onChange={(e) => updateParam("cci", parseInt(e.target.value))}
                            className={inputClass}
                        />
                    </label>
                );
            default:
                return null;
        }
    };

    const INDICATORS_LIST = [
        { key: "ema9", name: "Exponential Moving Average (EMA 1)", desc: "Short-term exponential average of close prices.", category: "Overlays" },
        { key: "ema20", name: "Exponential Moving Average (EMA 2)", desc: "Short-term exponential average of close prices.", category: "Overlays" },
        { key: "ema50", name: "Exponential Moving Average (EMA 3)", desc: "Medium-term trend tracking average.", category: "Overlays" },
        { key: "ema200", name: "Exponential Moving Average (EMA 4)", desc: "Long-term market baseline indicator.", category: "Overlays" },
        { key: "sma20", name: "Simple Moving Average (SMA 1)", desc: "Short-term simple arithmetic average of prices.", category: "Overlays" },
        { key: "sma50", name: "Simple Moving Average (SMA 2)", desc: "Medium-term simple trend tracking average.", category: "Overlays" },
        { key: "sma200", name: "Simple Moving Average (SMA 3)", desc: "Long-term simple baseline trend indicator.", category: "Overlays" },
        { key: "bb", name: "Bollinger Bands", desc: "Volatility bands placed above and below a moving average.", category: "Overlays" },
        { key: "rsi", name: "Relative Strength Index (RSI)", desc: "Momentum oscillator that measures velocity and change of price.", category: "Lower Pane" },
        { key: "macd", name: "MACD", desc: "Trend-following momentum indicator showing relationship between EMAs.", category: "Lower Pane" },
        { key: "atr", name: "Average True Range (ATR)", desc: "Market volatility indicator showing the average range of price movement.", category: "Lower Pane" },
        { key: "stoch", name: "Stochastic Oscillator", desc: "Compares a closing price to its price range over a given time period.", category: "Lower Pane" },
        { key: "cci", name: "Commodity Channel Index (CCI)", desc: "Measures current price relative to average price level over period.", category: "Lower Pane" }
    ];

    const filteredIndicatorsList = useMemo(() => {
        if (!indicatorSearchQuery) return INDICATORS_LIST;
        const q = indicatorSearchQuery.toLowerCase();
        return INDICATORS_LIST.filter(ind => 
            ind.name.toLowerCase().includes(q) || 
            ind.desc.toLowerCase().includes(q) ||
            ind.category.toLowerCase().includes(q)
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
        <div ref={mainContainerRef} className="w-full h-full flex flex-col bg-[#131722] relative select-none overflow-hidden">
            {/* Custom Interactive Toolbar */}
            <div className="h-10 border-b border-[#2a2e39] bg-[#1c2030]/30 px-3 flex items-center justify-between text-xs text-[#d1d4dc] z-30 select-none">
                {/* Left scrollable items */}
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar flex-1 mr-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-bold text-white uppercase tracking-tight">{symbol}</span>
                        <span className="text-[10px] text-[#787b86] font-mono">({timeframe})</span>
                    </div>

                    <div className="h-4 w-[1px] bg-[#2a2e39] shrink-0" />
                </div>

                {/* Right side items (Not scrollable, contains relative dropdown) */}
                <div className="flex items-center gap-3 shrink-0">
                    {/* Indicators Modal Trigger */}
                    <div className="relative z-50">
                        <button 
                            onClick={() => setShowIndicatorModal(true)}
                            className="flex items-center gap-1 h-7 px-2.5 rounded transition-all active:scale-95 text-[11px] font-bold bg-[#1c2030] hover:bg-[#2a2e39] text-[#b2b5be] border border-[#2a2e39] uppercase tracking-wider"
                        >
                            <Settings className="w-3.5 h-3.5" />
                            <span>Indicators</span>
                        </button>
                    </div>

                    {/* Display markers count */}
                    {markersData.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] font-bold text-[#26a69a] uppercase tracking-wider font-mono shrink-0">
                            <BarChart3 className="w-3.5 h-3.5 text-[#26a69a]" />
                            <span>{markersData.length} Trades</span>
                        </div>
                    )}
                </div>
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
                            <span className="text-[#2196f3] shrink-0 font-bold">EMA({indicatorParams.ema9}): <span>{hoverData.ema9.toFixed(2)}</span></span>
                        )}
                        {indicators.ema20 && hoverData.ema20 !== undefined && (
                            <span className="text-[#ff9800] shrink-0 font-bold">EMA({indicatorParams.ema20}): <span>{hoverData.ema20.toFixed(2)}</span></span>
                        )}
                        {indicators.ema50 && hoverData.ema50 !== undefined && (
                            <span className="text-[#e91e63] shrink-0 font-bold">EMA({indicatorParams.ema50}): <span>{hoverData.ema50.toFixed(2)}</span></span>
                        )}
                        {indicators.ema200 && hoverData.ema200 !== undefined && (
                            <span className="text-[#9c27b0] shrink-0 font-bold">EMA({indicatorParams.ema200}): <span>{hoverData.ema200.toFixed(2)}</span></span>
                        )}
                        {indicators.sma20 && hoverData.sma20 !== undefined && (
                            <span className="text-[#4caf50] shrink-0 font-bold">SMA({indicatorParams.sma20}): <span>{hoverData.sma20.toFixed(2)}</span></span>
                        )}
                        {indicators.sma50 && hoverData.sma50 !== undefined && (
                            <span className="text-[#00bcd4] shrink-0 font-bold">SMA({indicatorParams.sma50}): <span>{hoverData.sma50.toFixed(2)}</span></span>
                        )}
                        {indicators.sma200 && hoverData.sma200 !== undefined && (
                            <span className="text-[#ffeb3b] shrink-0 font-bold">SMA({indicatorParams.sma200}): <span>{hoverData.sma200.toFixed(2)}</span></span>
                        )}
                        {indicators.bb && hoverData.bbMiddle !== undefined && (
                            <span className="text-[#90caf9] shrink-0 font-bold">
                                BB({indicatorParams.bbPeriod},{indicatorParams.bbStdDev}): <span className="text-white">U {hoverData.bbUpper?.toFixed(2)}</span> M {hoverData.bbMiddle?.toFixed(2)} <span className="text-white">L {hoverData.bbLower?.toFixed(2)}</span>
                            </span>
                        )}
                        {indicators.rsi && hoverData.rsi !== undefined && (
                            <span className="text-[#7e57c2] shrink-0 font-bold">RSI({indicatorParams.rsi}): <span>{hoverData.rsi.toFixed(2)}</span></span>
                        )}
                        {indicators.macd && hoverData.macdVal !== undefined && (
                            <span className="text-[#2962ff] shrink-0 font-bold">
                                MACD({indicatorParams.macdFast},{indicatorParams.macdSlow},{indicatorParams.macdSignal}): <span className="text-[#2962ff]">{hoverData.macdVal?.toFixed(2)}</span> Sig: <span className="text-[#ff6d00]">{hoverData.macdSignal?.toFixed(2)}</span> Hist: <span className={hoverData.macdHist! >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}>{hoverData.macdHist?.toFixed(2)}</span>
                            </span>
                        )}
                        {indicators.atr && hoverData.atr !== undefined && (
                            <span className="text-[#26a69a] shrink-0 font-bold">ATR({indicatorParams.atr}): <span>{hoverData.atr.toFixed(2)}</span></span>
                        )}
                        {indicators.stoch && hoverData.stochK !== undefined && (
                            <span className="text-[#2196f3] shrink-0 font-bold">STOCH(K={indicatorParams.stochK},D={indicatorParams.stochD}): <span className="text-[#2196f3]">K {hoverData.stochK.toFixed(2)}</span> <span className="text-[#ff9800]">D {hoverData.stochD?.toFixed(2)}</span></span>
                        )}
                        {indicators.cci && hoverData.cci !== undefined && (
                            <span className="text-[#e91e63] shrink-0 font-bold">CCI({indicatorParams.cci}): <span>{hoverData.cci.toFixed(2)}</span></span>
                        )}
                    </>
                ) : (
                    <span className="text-[#787b86] italic tracking-wide">Hover crosshair over candles for OHLCV & Indicator metrics</span>
                )}
            </div>

            {/* Containers for Price and Lower Pane charts */}
            <div className="flex-1 flex flex-col min-h-0 bg-[#131722] p-1 overflow-hidden">
                
                {/* 1. Candlestick Chart */}
                <div ref={priceContainerRef} className="flex-1 w-full min-h-0 overflow-hidden" />

                {/* 2. RSI Panel (rendered dynamically if checked) */}
                {indicators.rsi && (
                    <div className="w-full h-[100px] relative border-t border-[#2a2e39] mt-1 shrink-0 overflow-hidden">
                        <div className="absolute top-1 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-[#787b86] uppercase tracking-wider">
                            RSI (14) <span className="text-[#7e57c2] font-semibold">{hoverData?.rsi ? `: ${hoverData.rsi.toFixed(2)}` : ""}</span>
                        </div>
                        {/* 30 & 70 line markers in overlay */}
                        <div className="absolute right-0 top-[30px] w-full border-t border-[#7e57c2]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">70</div>
                        <div className="absolute right-0 bottom-[30px] w-full border-t border-[#7e57c2]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">30</div>
                        
                        <div ref={rsiContainerRef} className="w-full h-full overflow-hidden" />
                    </div>
                )}

                {/* 3. MACD Panel (rendered dynamically if checked) */}
                {indicators.macd && (
                    <div className="w-full h-[100px] relative border-t border-[#2a2e39] mt-1 shrink-0 overflow-hidden">
                        <div className="absolute top-1 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-[#787b86] uppercase tracking-wider">
                            MACD (12, 26, 9) <span className="text-[#2962ff] font-semibold">
                                {hoverData?.macdVal ? `: M ${hoverData.macdVal.toFixed(2)} S ${hoverData.macdSignal?.toFixed(2)} H ${hoverData.macdHist?.toFixed(2)}` : ""}
                            </span>
                        </div>
                        
                        <div ref={macdContainerRef} className="w-full h-full overflow-hidden" />
                    </div>
                )}

                {/* 4. ATR Panel (rendered dynamically if checked) */}
                {indicators.atr && (
                    <div className="w-full h-[100px] relative border-t border-[#2a2e39] mt-1 shrink-0 overflow-hidden">
                        <div className="absolute top-1 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-[#787b86] uppercase tracking-wider">
                            ATR (14) <span className="text-[#26a69a] font-semibold">{hoverData?.atr ? `: ${hoverData.atr.toFixed(2)}` : ""}</span>
                        </div>
                        <div ref={atrContainerRef} className="w-full h-full overflow-hidden" />
                    </div>
                )}

                {/* 5. Stochastic Panel (rendered dynamically if checked) */}
                {indicators.stoch && (
                    <div className="w-full h-[100px] relative border-t border-[#2a2e39] mt-1 shrink-0 overflow-hidden">
                        <div className="absolute top-1 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-[#787b86] uppercase tracking-wider">
                            Stochastic (14, 3) <span className="text-[#2196f3] font-semibold">
                                {hoverData?.stochK ? `: K ${hoverData.stochK.toFixed(2)} D ${hoverData.stochD?.toFixed(2)}` : ""}
                            </span>
                        </div>
                        <div className="absolute right-0 top-[20px] w-full border-t border-[#2196f3]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">80</div>
                        <div className="absolute right-0 bottom-[20px] w-full border-t border-[#2196f3]/10 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">20</div>
                        <div ref={stochContainerRef} className="w-full h-full overflow-hidden" />
                    </div>
                )}

                {/* 6. CCI Panel (rendered dynamically if checked) */}
                {indicators.cci && (
                    <div className="w-full h-[100px] relative border-t border-[#2a2e39] mt-1 shrink-0 overflow-hidden">
                        <div className="absolute top-1 left-4 z-20 pointer-events-none text-[9px] font-mono font-bold text-[#787b86] uppercase tracking-wider">
                            CCI (20) <span className="text-[#e91e63] font-semibold">{hoverData?.cci ? `: ${hoverData.cci.toFixed(2)}` : ""}</span>
                        </div>
                        <div className="absolute right-0 top-[30px] w-full border-t border-white/5 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">100</div>
                        <div className="absolute right-0 bottom-[30px] w-full border-t border-white/5 pointer-events-none flex justify-end pr-2 text-[8px] text-[#787b86]/30">-100</div>
                        <div ref={cciContainerRef} className="w-full h-full overflow-hidden" />
                    </div>
                )}
            </div>

            {/* Indicators Modal Overlay */}
            {showIndicatorModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[200] p-4 select-none">
                    <div className="bg-[#131722] border border-[#2a2e39] rounded-2xl w-full max-w-xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-[#2a2e39] flex items-center justify-between">
                            <span className="text-sm font-bold text-white uppercase tracking-wider">Indicators & Metrics</span>
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
                            {indicatorSearchQuery && (
                                <button 
                                    onClick={() => setIndicatorSearchQuery("")}
                                    className="absolute right-8 top-5 text-[#787b86] hover:text-white"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                        
                        {/* Indicators List */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1.5 min-h-0">
                            {filteredIndicatorsList.length > 0 ? (
                                filteredIndicatorsList.map((ind) => (
                                    <div
                                        key={ind.key}
                                        className={`flex flex-col w-full p-3 rounded-xl border text-left transition-all
                                            ${indicators[ind.key as keyof IndicatorState] 
                                                ? "bg-[#2962ff]/5 border-[#2962ff]/20 text-white" 
                                                : "bg-[#1c2030]/40 border-white/5 hover:bg-[#1c2030]/80 text-[#d1d4dc]"
                                            }
                                        `}
                                    >
                                        <div 
                                            className="flex items-center justify-between w-full cursor-pointer select-none active:scale-[0.99] transition-transform"
                                            onClick={() => toggleIndicator(ind.key as keyof IndicatorState)}
                                        >
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-xs font-bold uppercase tracking-wide">{ind.name}</span>
                                                <span className="text-[10px] text-[#787b86] font-medium leading-relaxed">{ind.desc}</span>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0 pl-4">
                                                <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-800 text-[#787b86] border border-white/5">{ind.category}</span>
                                                {indicators[ind.key as keyof IndicatorState] ? (
                                                    <Eye className="w-4 h-4 text-indigo-400" />
                                                ) : (
                                                    <EyeOff className="w-4 h-4 text-[#787b86]/40" />
                                                )}
                                            </div>
                                        </div>

                                        {/* Input fields to edit parameters if active */}
                                        {indicators[ind.key as keyof IndicatorState] && (
                                            <div 
                                                className="mt-2.5 pt-2.5 border-t border-white/5 flex flex-wrap items-center gap-3 text-[10px] font-bold text-zinc-400 select-text"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <span className="uppercase text-[#787b86] select-none">Inputs:</span>
                                                {renderIndicatorParams(ind.key)}
                                            </div>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-8 text-xs text-[#787b86] font-medium">
                                    No indicators match "{indicatorSearchQuery}"
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
