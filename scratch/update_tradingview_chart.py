import os

file_path = r"c:\Users\MR__CODER__\Desktop\stokscan_AI\web\src\components\TradingViewChart.tsx"

with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update Imports
old_imports = """import { Loader2, Settings, Eye, EyeOff, BarChart3, AlertCircle } from "lucide-react";
import { 
    calculateEMA, 
    calculateRSI, 
    calculateMACD, 
    calculateBollingerBands, 
    Candle, 
    LineDataPoint,
    BollingerBandsDataPoint,
    MacdDataPoint
} from "@/lib/indicators";"""

new_imports = """import { Loader2, Settings, Eye, EyeOff, BarChart3, AlertCircle, Search, X } from "lucide-react";
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
    MacdDataPoint
} from "@/lib/indicators";"""

code = code.replace(old_imports, new_imports)

# 2. Update Refs declarations (adding atrContainerRef, stochContainerRef, cciContainerRef)
old_containers_refs = """    const mainContainerRef = useRef<HTMLDivElement>(null);
    const priceContainerRef = useRef<HTMLDivElement>(null);
    const rsiContainerRef = useRef<HTMLDivElement>(null);
    const macdContainerRef = useRef<HTMLDivElement>(null);"""

new_containers_refs = """    const mainContainerRef = useRef<HTMLDivElement>(null);
    const priceContainerRef = useRef<HTMLDivElement>(null);
    const rsiContainerRef = useRef<HTMLDivElement>(null);
    const macdContainerRef = useRef<HTMLDivElement>(null);
    const atrContainerRef = useRef<HTMLDivElement>(null);
    const stochContainerRef = useRef<HTMLDivElement>(null);
    const cciContainerRef = useRef<HTMLDivElement>(null);"""

code = code.replace(old_containers_refs, new_containers_refs)

# 3. Update IndicatorState interface
old_ind_state = """interface IndicatorState {
    ema9: boolean;
    ema20: boolean;
    ema50: boolean;
    ema200: boolean;
    bb: boolean;
    rsi: boolean;
    macd: boolean;
}"""

new_ind_state = """interface IndicatorState {
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
}"""

code = code.replace(old_ind_state, new_ind_state)

# 4. Update default indicators state & add modal/search states
old_indicators_state = """    // Active indicators toggles
    const [indicators, setIndicators] = useState<IndicatorState>({
        ema9: false,
        ema20: false,
        ema50: true,
        ema200: true,
        bb: false,
        rsi: true,
        macd: false,
    });"""

new_indicators_state = """    // Active indicators toggles
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

    const [showIndicatorModal, setShowIndicatorModal] = useState<boolean>(false);
    const [indicatorSearchQuery, setIndicatorSearchQuery] = useState<string>("");"""

code = code.replace(old_indicators_state, new_indicators_state)

# 5. Update chartRefs interface and defaults
old_chart_refs_t = """    // Refs for charts and series for update/destroy lifecycle
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
    });"""

new_chart_refs_t = """    // Refs for charts and series for update/destroy lifecycle
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
    });"""

code = code.replace(old_chart_refs_t, new_chart_refs_t)

# 6. Update handleResize resizing calculations
old_resize_c = """        const handleResize = (newWidth?: number, newHeight?: number) => {
            const width = newWidth !== undefined ? newWidth : (mainContainerRef.current?.clientWidth || 0);
            const height = newHeight !== undefined ? newHeight : (mainContainerRef.current?.clientHeight || 450);
            if (chartRefs.current.priceChart) {
                let activeLowerPanesCount = 0;
                if (indicators.rsi) activeLowerPanesCount++;
                if (indicators.macd) activeLowerPanesCount++;
                
                const paneHeight = 100;
                const pricePaneHeight = Math.max(150, height - (activeLowerPanesCount * paneHeight) - 45);
                
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
        const priceHeight = Math.max(150, height - (activeLowerPanesCount * paneHeight) - 45);"""

new_resize_c = """        const handleResize = (newWidth?: number, newHeight?: number) => {
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
        const priceHeight = Math.max(150, height - (activeLowerPanesCount * paneHeight) - 45);"""

code = code.replace(old_resize_c, new_resize_c)

# 7. Update overlays to calculate SMA 20, 50, 200
old_overlays_start = """        // --- Calculate Overlay Indicators ---"""
new_overlays_start = """        // --- Calculate Overlay Indicators ---
        
        // SMA 20
        let sma20Points: LineDataPoint[] = [];
        if (indicators.sma20) {
            sma20Points = calculateSMA(candlesData, 20);
            const sma20Series = priceChart.addLineSeries({ color: "#4caf50", lineWidth: 1.5, title: "SMA 20" });
            sma20Series.setData(sma20Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.sma20Series = sma20Series;
        }

        // SMA 50
        let sma50Points: LineDataPoint[] = [];
        if (indicators.sma50) {
            sma50Points = calculateSMA(candlesData, 50);
            const sma50Series = priceChart.addLineSeries({ color: "#00bcd4", lineWidth: 1.5, title: "SMA 50" });
            sma50Series.setData(sma50Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.sma50Series = sma50Series;
        }

        // SMA 200
        let sma200Points: LineDataPoint[] = [];
        if (indicators.sma200) {
            sma200Points = calculateSMA(candlesData, 200);
            const sma200Series = priceChart.addLineSeries({ color: "#ffeb3b", lineWidth: 1.5, title: "SMA 200" });
            sma200Series.setData(sma200Points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
            chartRefs.current.sma200Series = sma200Series;
        }"""

code = code.replace(old_overlays_start, new_overlays_start)

# 8. Add lower pane chart builders (ATR, Stochastic, CCI) right before MACD Pane
old_macd_pane_init = """        // MACD Pane"""
new_macd_pane_init = """        // ATR Pane
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
            atrPoints = calculateATR(candlesData, 14);
            
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

            const kSeries = stochChart.addLineSeries({ color: "#2196f3", lineWidth: 1.5 });
            const dSeries = stochChart.addLineSeries({ color: "#ff9800", lineWidth: 1.5, lineStyle: 2 });
            stochPoints = calculateStochastic(candlesData, 14, 3);
            
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
            cciPoints = calculateCCI(candlesData, 20);
            
            const cciData = candlesData.map(c => {
                const p = cciPoints.find(pt => pt.time === c.time);
                return p !== undefined 
                    ? { time: c.time as UTCTimestamp, value: p.value } 
                    : { time: c.time as UTCTimestamp };
            });
            cciSeries.setData(cciData);
            chartRefs.current.cciSeries = cciSeries;
        }

        // MACD Pane"""

code = code.replace(old_macd_pane_init, new_macd_pane_init)

# 9. Update crosshair data retrieval
old_crosshair_vals = """            // Retrieve values for enabled indicators at current crosshair coordinate
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
            });"""

new_crosshair_vals = """            // Retrieve values for enabled indicators at current crosshair coordinate
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
            });"""

code = code.replace(old_crosshair_vals, new_crosshair_vals)

# 10. Update initial zoom alignment checks
old_zoom_sync = """                const currentRange = chartRefs.current.priceChart.timeScale().getVisibleLogicalRange();
                if (currentRange) {
                    if (chartRefs.current.rsiChart) {
                        chartRefs.current.rsiChart.timeScale().setVisibleLogicalRange(currentRange);
                    }
                    if (chartRefs.current.macdChart) {
                        chartRefs.current.macdChart.timeScale().setVisibleLogicalRange(currentRange);
                    }
                }"""

new_zoom_sync = """                const currentRange = chartRefs.current.priceChart.timeScale().getVisibleLogicalRange();
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
                }"""

code = code.replace(old_zoom_sync, new_zoom_sync)

# 11. Update charts cleanup
old_cleanup = """            if (chartRefs.current.rsiChart) {
                chartRefs.current.rsiChart.remove();
                chartRefs.current.rsiChart = null;
            }
            if (chartRefs.current.macdChart) {
                chartRefs.current.macdChart.remove();
                chartRefs.current.macdChart = null;
            }"""

new_cleanup = """            if (chartRefs.current.rsiChart) {
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
            }"""

code = code.replace(old_cleanup, new_cleanup)

# 12. Update toggleIndicator and add dynamic search logic
old_toggle_ind = """    const toggleIndicator = (key: keyof IndicatorState) => {
        setIndicators(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };"""

new_toggle_ind = """    const toggleIndicator = (key: keyof IndicatorState) => {
        setIndicators(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    const INDICATORS_LIST = [
        { key: "ema9", name: "Exponential Moving Average 9", desc: "Short-term exponential average of close prices.", category: "Overlays" },
        { key: "ema20", name: "Exponential Moving Average 20", desc: "Short-term exponential average of close prices.", category: "Overlays" },
        { key: "ema50", name: "Exponential Moving Average 50", desc: "Medium-term trend tracking average.", category: "Overlays" },
        { key: "ema200", name: "Exponential Moving Average 200", desc: "Long-term market baseline indicator.", category: "Overlays" },
        { key: "sma20", name: "Simple Moving Average 20", desc: "Short-term simple arithmetic average of prices.", category: "Overlays" },
        { key: "sma50", name: "Simple Moving Average 50", desc: "Medium-term simple trend tracking average.", category: "Overlays" },
        { key: "sma200", name: "Simple Moving Average 200", desc: "Long-term simple baseline trend indicator.", category: "Overlays" },
        { key: "bb", name: "Bollinger Bands (20, 2)", desc: "Volatility bands placed above and below a moving average.", category: "Overlays" },
        { key: "rsi", name: "Relative Strength Index (14)", desc: "Momentum oscillator that measures velocity and change of price.", category: "Lower Pane" },
        { key: "macd", name: "MACD (12, 26, 9)", desc: "Trend-following momentum indicator showing relationship between EMAs.", category: "Lower Pane" },
        { key: "atr", name: "Average True Range (14)", desc: "Market volatility indicator showing the average range of price movement.", category: "Lower Pane" },
        { key: "stoch", name: "Stochastic Oscillator (14, 3)", desc: "Compares a closing price to its price range over a given time period.", category: "Lower Pane" },
        { key: "cci", name: "Commodity Channel Index (20)", desc: "Measures current price relative to average price level over period.", category: "Lower Pane" }
    ];

    const filteredIndicatorsList = useMemo(() => {
        if (!indicatorSearchQuery) return INDICATORS_LIST;
        const q = indicatorSearchQuery.toLowerCase();
        return INDICATORS_LIST.filter(ind => 
            ind.name.toLowerCase().includes(q) || 
            ind.desc.toLowerCase().includes(q) ||
            ind.category.toLowerCase().includes(q)
        );
    }, [indicatorSearchQuery]);"""

import_use_memo = """import { useEffect, useRef, useState } from "react";"""
import_use_memo_r = """import { useEffect, useRef, useState, useMemo } from "react";"""
code = code.replace(import_use_memo, import_use_memo_r)
code = code.replace(old_toggle_ind, new_toggle_ind)

# 13. Update indicators toolbar button & remove old dropdown
old_dropdown_trigger = """                    {/* Indicators dropdown toggle */}
                    <div className="relative z-50">
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
                            <div className="absolute top-full right-0 mt-1.5 w-56 rounded bg-[#131722] border border-[#2a2e39] shadow-2xl p-2.5 z-[160] flex flex-col gap-1 text-[11px]">
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
                    </div>"""

new_dropdown_trigger = """                    {/* Indicators Modal Trigger */}
                    <div className="relative z-50">
                        <button 
                            onClick={() => setShowIndicatorModal(true)}
                            className="flex items-center gap-1 h-7 px-2.5 rounded transition-all active:scale-95 text-[11px] font-bold bg-[#1c2030] hover:bg-[#2a2e39] text-[#b2b5be] border border-[#2a2e39] uppercase tracking-wider"
                        >
                            <Settings className="w-3.5 h-3.5" />
                            <span>Indicators</span>
                        </button>
                    </div>"""

code = code.replace(old_dropdown_trigger, new_dropdown_trigger)

# 14. Update legend lines (add SMA and new indicators to legend metrics)
old_legend_metrics = """                        {/* Overlay Indicators */}
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
                        )}"""

new_legend_metrics = """                        {/* Overlay Indicators */}
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
                        {indicators.sma20 && hoverData.sma20 !== undefined && (
                            <span className="text-[#4caf50] shrink-0 font-bold">SMA(20): <span>{hoverData.sma20.toFixed(2)}</span></span>
                        )}
                        {indicators.sma50 && hoverData.sma50 !== undefined && (
                            <span className="text-[#00bcd4] shrink-0 font-bold">SMA(50): <span>{hoverData.sma50.toFixed(2)}</span></span>
                        )}
                        {indicators.sma200 && hoverData.sma200 !== undefined && (
                            <span className="text-[#ffeb3b] shrink-0 font-bold">SMA(200): <span>{hoverData.sma200.toFixed(2)}</span></span>
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
                        {indicators.atr && hoverData.atr !== undefined && (
                            <span className="text-[#26a69a] shrink-0 font-bold">ATR(14): <span>{hoverData.atr.toFixed(2)}</span></span>
                        )}
                        {indicators.stochK && hoverData.stochK !== undefined && (
                            <span className="text-[#2196f3] shrink-0 font-bold">STOCH: <span className="text-[#2196f3]">K {hoverData.stochK.toFixed(2)}</span> <span className="text-[#ff9800]">D {hoverData.stochD?.toFixed(2)}</span></span>
                        )}
                        {indicators.cci && hoverData.cci !== undefined && (
                            <span className="text-[#e91e63] shrink-0 font-bold">CCI(20): <span>{hoverData.cci.toFixed(2)}</span></span>
                        )}"""

code = code.replace(old_legend_metrics, new_legend_metrics)

# 15. Update sub-legend (for hover crosshair parameters types)
old_hover_state_t = """        open: number;
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
        macdHist?: number;"""

new_hover_state_t = """        open: number;
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
        cci?: number;"""

code = code.replace(old_hover_state_t, new_hover_state_t)

# 16. Update containers divs and modal overlay at the bottom
old_containers_bottom = """                {/* 3. MACD Panel (rendered dynamically if checked) */}
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
            </div>
        </div>
    );
}"""

new_containers_bottom = """                {/* 3. MACD Panel (rendered dynamically if checked) */}
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
                                    <button
                                        key={ind.key}
                                        onClick={() => toggleIndicator(ind.key as keyof IndicatorState)}
                                        className={`flex items-center justify-between w-full p-3 rounded-xl transition-all border text-left active:scale-[0.99]
                                            ${indicators[ind.key as keyof IndicatorState] 
                                                ? "bg-indigo-600/10 border-indigo-500/30 text-white" 
                                                : "bg-[#1c2030]/40 border-white/5 hover:bg-[#1c2030]/80 text-[#d1d4dc]"
                                            }
                                        `}
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
                                    </button>
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
}"""

code = code.replace(old_containers_bottom, new_containers_bottom)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Finished updating TradingViewChart.tsx successfully!")
