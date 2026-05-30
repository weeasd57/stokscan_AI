import type { TestPredictionRow } from "./types";

export type IndicatorStats = {
    buySignals: number;
    sellSignals: number;
    buyWinRate: string;
    sellWinRate: string;
};

export type FullIndicatorStats = {
    rsi: IndicatorStats;
    macd: IndicatorStats;
    ema: IndicatorStats;
    bb: IndicatorStats;
};

export type IndicatorSignals = {
    rsiSignal: "buy" | "sell" | "neutral";
    macdSignal: "buy" | "sell" | "neutral";
    emaSignal: "buy" | "sell" | "neutral";
    bbSignal: "buy" | "sell" | "neutral";
};

// Calculate indicator signals
export function getIndicatorSignals(row: TestPredictionRow, prevRow?: TestPredictionRow): IndicatorSignals {
    // RSI Signal: < 30 = Oversold (Buy), > 70 = Overbought (Sell)
    let rsiSignal: "buy" | "sell" | "neutral" = "neutral";
    if (row.rsi !== undefined) {
        if (row.rsi < 30) rsiSignal = "buy";
        else if (row.rsi > 70) rsiSignal = "sell";
    }

    // MACD Signal: MACD crosses above Signal = Buy, below = Sell
    let macdSignal: "buy" | "sell" | "neutral" = "neutral";
    if (row.macd !== undefined && row.macd_signal !== undefined && prevRow?.macd !== undefined && prevRow?.macd_signal !== undefined) {
        const currDiff = row.macd - row.macd_signal;
        const prevDiff = prevRow.macd - prevRow.macd_signal;
        if (currDiff > 0 && prevDiff <= 0) macdSignal = "buy";
        else if (currDiff < 0 && prevDiff >= 0) macdSignal = "sell";
    }

    // EMA Signal: Price > EMA50 > EMA200 = Buy, Price < EMA50 < EMA200 = Sell
    let emaSignal: "buy" | "sell" | "neutral" = "neutral";
    if (row.ema50 !== undefined && row.ema200 !== undefined) {
        if (row.close > row.ema50 && row.ema50 > row.ema200) emaSignal = "buy";
        else if (row.close < row.ema50 && row.ema50 < row.ema200) emaSignal = "sell";
    }

    // Bollinger Bands: Price at lower band = Buy, at upper band = Sell
    let bbSignal: "buy" | "sell" | "neutral" = "neutral";
    if (row.bb_lower !== undefined && row.bb_upper !== undefined) {
        const bbRange = row.bb_upper - row.bb_lower;
        if (bbRange > 0) {
            const position = (row.close - row.bb_lower) / bbRange;
            if (position <= 0.1) bbSignal = "buy";
            else if (position >= 0.9) bbSignal = "sell";
        }
    }

    return { rsiSignal, macdSignal, emaSignal, bbSignal };
}

// Calculate statistics for indicators
export function calculateIndicatorStats(rows: TestPredictionRow[]): FullIndicatorStats {
    const rowsWithSignals = rows.map((row, idx) => ({
        row,
        signals: getIndicatorSignals(row, rows[idx - 1])
    }));

    const calcStats = (signalKey: keyof IndicatorSignals): IndicatorStats => {
        let buySignals = 0;
        let sellSignals = 0;
        let buyWins = 0;
        let sellWins = 0;

        rowsWithSignals.forEach(({ row, signals }) => {
            const signal = signals[signalKey];
            if (signal === "buy") {
                buySignals++;
                if (row.target === 1) buyWins++;
            } else if (signal === "sell") {
                sellSignals++;
                if (row.target === 0) sellWins++;
            }
        });

        return {
            buySignals,
            sellSignals,
            buyWinRate: buySignals > 0 ? ((buyWins / buySignals) * 100).toFixed(1) : "0.0",
            sellWinRate: sellSignals > 0 ? ((sellWins / sellSignals) * 100).toFixed(1) : "0.0",
        };
    };

    return {
        rsi: calcStats("rsiSignal"),
        macd: calcStats("macdSignal"),
        ema: calcStats("emaSignal"),
        bb: calcStats("bbSignal"),
    };
}

export interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

export interface LineDataPoint {
    time: number;
    value: number;
}

export interface MacdDataPoint {
    time: number;
    macd: number;
    signal: number;
    histogram: number;
}

export interface BollingerBandsDataPoint {
    time: number;
    upper: number;
    middle: number;
    lower: number;
}

// 1. Calculate Simple Moving Average (SMA)
export function calculateSMA(data: Candle[], period: number): LineDataPoint[] {
    const result: LineDataPoint[] = [];
    if (data.length < period) return result;

    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i].close;
    }
    result.push({ time: data[period - 1].time, value: sum / period });

    for (let i = period; i < data.length; i++) {
        sum = sum - data[i - period].close + data[i].close;
        result.push({ time: data[i].time, value: sum / period });
    }
    return result;
}

// 2. Calculate Exponential Moving Average (EMA)
export function calculateEMA(data: Candle[], period: number): LineDataPoint[] {
    const result: LineDataPoint[] = [];
    if (data.length === 0) return result;

    const multiplier = 2 / (period + 1);
    
    // First value is simple average
    let ema = data[0].close;
    if (data.length >= period) {
        let sum = 0;
        for (let i = 0; i < period; i++) {
            sum += data[i].close;
        }
        ema = sum / period;
        result.push({ time: data[period - 1].time, value: ema });
        
        for (let i = period; i < data.length; i++) {
            ema = (data[i].close - ema) * multiplier + ema;
            result.push({ time: data[i].time, value: ema });
        }
    } else {
        // Fallback for short dataset
        result.push({ time: data[0].time, value: ema });
        for (let i = 1; i < data.length; i++) {
            ema = (data[i].close - ema) * multiplier + ema;
            result.push({ time: data[i].time, value: ema });
        }
    }
    
    return result;
}

// 3. Calculate Relative Strength Index (RSI)
export function calculateRSI(data: Candle[], period: number = 14): LineDataPoint[] {
    const result: LineDataPoint[] = [];
    if (data.length <= period) return result;

    let gains: number[] = [];
    let losses: number[] = [];

    // Calculate initial changes
    for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
    }

    // Calculate initial averages
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
        avgGain += gains[i];
        avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    let rsi = 100 - 100 / (1 + rs);
    result.push({ time: data[period].time, value: rsi });

    // Wilder's smoothing technique
    for (let i = period + 1; i < data.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
        rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
        result.push({ time: data[i].time, value: rsi });
    }

    return result;
}

// 4. Calculate MACD
export function calculateMACD(
    data: Candle[], 
    fastPeriod: number = 12, 
    slowPeriod: number = 26, 
    signalPeriod: number = 9
): MacdDataPoint[] {
    const result: MacdDataPoint[] = [];
    if (data.length < slowPeriod) return result;

    const fastEma = calculateEMA(data, fastPeriod);
    const slowEma = calculateEMA(data, slowPeriod);

    // Map fast and slow EMA by time
    const fastMap = new Map(fastEma.map(d => [d.time, d.value]));
    const slowMap = new Map(slowEma.map(d => [d.time, d.value]));

    // Calculate MACD line
    const macdLinePoints: LineDataPoint[] = [];
    for (const candle of data) {
        const fastVal = fastMap.get(candle.time);
        const slowVal = slowMap.get(candle.time);
        if (fastVal !== undefined && slowVal !== undefined) {
            macdLinePoints.push({ time: candle.time, value: fastVal - slowVal });
        }
    }

    if (macdLinePoints.length < signalPeriod) return result;

    // Calculate Signal Line (EMA of MACD line)
    // We treat macdLinePoints as candles to reuse calculateEMA
    const pseudoCandles: Candle[] = macdLinePoints.map(p => ({
        time: p.time,
        open: p.value,
        high: p.value,
        low: p.value,
        close: p.value
    }));
    const signalEma = calculateEMA(pseudoCandles, signalPeriod);
    const signalMap = new Map(signalEma.map(d => [d.time, d.value]));

    // Construct final result
    for (const p of macdLinePoints) {
        const signalVal = signalMap.get(p.time);
        if (signalVal !== undefined) {
            result.push({
                time: p.time,
                macd: p.value,
                signal: signalVal,
                histogram: p.value - signalVal
            });
        }
    }

    return result;
}

// 5. Calculate Bollinger Bands
export function calculateBollingerBands(data: Candle[], period: number = 20, stdDevMultiplier: number = 2): BollingerBandsDataPoint[] {
    const result: BollingerBandsDataPoint[] = [];
    if (data.length < period) return result;

    for (let i = period - 1; i < data.length; i++) {
        // Calculate SMA (Middle Band)
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += data[j].close;
        }
        const middle = sum / period;

        // Calculate Standard Deviation
        let varianceSum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            varianceSum += Math.pow(data[j].close - middle, 2);
        }
        const stdDev = Math.sqrt(varianceSum / period);

        result.push({
            time: data[i].time,
            middle: middle,
            upper: middle + stdDevMultiplier * stdDev,
            lower: middle - stdDevMultiplier * stdDev
        });
    }

    return result;
}

// 6. Calculate Average True Range (ATR)
export interface AtrDataPoint {
    time: number;
    value: number;
}

export function calculateATR(data: Candle[], period: number = 14): AtrDataPoint[] {
    const result: AtrDataPoint[] = [];
    if (data.length <= period) return result;

    const trs: number[] = [];
    trs.push(data[0].high - data[0].low);

    for (let i = 1; i < data.length; i++) {
        const h_l = data[i].high - data[i].low;
        const h_cp = Math.abs(data[i].high - data[i - 1].close);
        const l_cp = Math.abs(data[i].low - data[i - 1].close);
        trs.push(Math.max(h_l, h_cp, l_cp));
    }

    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += trs[i];
    }
    let atr = sum / period;
    result.push({ time: data[period].time, value: atr });

    for (let i = period + 1; i < data.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
        result.push({ time: data[i].time, value: atr });
    }

    return result;
}

// 7. Calculate Stochastic Oscillator
export interface StochDataPoint {
    time: number;
    k: number;
    d: number;
}

export function calculateStochastic(data: Candle[], kPeriod: number = 14, dPeriod: number = 3): StochDataPoint[] {
    const result: StochDataPoint[] = [];
    if (data.length < kPeriod) return result;

    const kValues: { time: number; value: number }[] = [];

    for (let i = kPeriod - 1; i < data.length; i++) {
        let lowestLow = data[i].low;
        let highestHigh = data[i].high;

        for (let j = i - kPeriod + 1; j <= i; j++) {
            if (data[j].low < lowestLow) lowestLow = data[j].low;
            if (data[j].high > highestHigh) highestHigh = data[j].high;
        }

        const range = highestHigh - lowestLow;
        const k = range === 0 ? 50 : 100 * (data[i].close - lowestLow) / range;
        kValues.push({ time: data[i].time, value: k });
    }

    if (kValues.length < dPeriod) return result;

    for (let i = dPeriod - 1; i < kValues.length; i++) {
        let sum = 0;
        for (let j = i - dPeriod + 1; j <= i; j++) {
            sum += kValues[j].value;
        }
        const d = sum / dPeriod;
        result.push({
            time: kValues[i].time,
            k: kValues[i].value,
            d: d
        });
    }

    return result;
}

// 8. Calculate Commodity Channel Index (CCI)
export interface CciDataPoint {
    time: number;
    value: number;
}

export function calculateCCI(data: Candle[], period: number = 20): CciDataPoint[] {
    const result: CciDataPoint[] = [];
    if (data.length < period) return result;

    const tps = data.map(d => (d.high + d.low + d.close) / 3);

    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += tps[j];
        }
        const sma = sum / period;

        let mdSum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            mdSum += Math.abs(tps[j] - sma);
        }
        const md = mdSum / period;

        const tp = tps[i];
        const cci = md === 0 ? 0 : (tp - sma) / (0.015 * md);

        result.push({
            time: data[i].time,
            value: cci
        });
    }

    return result;
}

