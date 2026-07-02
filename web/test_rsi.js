const fs = require('fs');

// Replicate calculateRSI from indicators.ts
function calculateRSI(data, period = 14) {
    const result = [];
    if (data.length <= period) return result;

    let gains = [];
    let losses = [];

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

async function run() {
    try {
        const baseUrl = process.env.WEB_ORIGIN || "http://127.0.0.1:3000";
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ai_bot/candles?symbol=ABUK&exchange=EGX&limit=800`);
        const json = await res.json();
        const candles = json.candles;
        console.log("Candles length:", candles.length);
        console.log("Last candle time:", candles[candles.length - 1].time, "->", new Date(candles[candles.length - 1].time * 1000).toISOString().split('T')[0]);
        
        const rsiPoints = calculateRSI(candles, 14);
        console.log("RSI points length:", rsiPoints.length);
        console.log("Last RSI point time:", rsiPoints[rsiPoints.length - 1].time, "->", new Date(rsiPoints[rsiPoints.length - 1].time * 1000).toISOString().split('T')[0]);
        
        // Print last 5 candles and matching RSI points
        console.log("\nLast 5 items comparison:");
        for (let i = 5; i > 0; i--) {
            const c = candles[candles.length - i];
            const r = rsiPoints.find(p => p.time === c.time);
            console.log(`Candle Time: ${c.time} (${new Date(c.time*1000).toISOString().split('T')[0]}) -> Close: ${c.close} | RSI: ${r ? r.value.toFixed(2) : 'MISSING'}`);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
