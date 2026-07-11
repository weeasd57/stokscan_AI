import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const supabase = getSupabaseClient();

    // 1. Get the latest available date for EGX
    const { data: dateRows, error: dateError } = await supabase
      .from("stock_technical_indicators")
      .select("date")
      .eq("exchange", "EGX")
      .order("date", { ascending: false })
      .limit(1);

    if (dateError || !dateRows || dateRows.length === 0) {
      console.error("Failed to fetch latest technical indicator date:", dateError);
      return NextResponse.json({ error: "No technical indicator data available" }, { status: 404 });
    }

    const latestDate = dateRows[0].date;

    // 2. Fetch all indicators for this date
    const { data: indicators, error: indError } = await supabase
      .from("stock_technical_indicators")
      .select("symbol, close, volume, ema_50, ema_200, rsi_14, vol_sma20, change_pct")
      .eq("exchange", "EGX")
      .eq("date", latestDate);

    if (indError || !indicators || indicators.length === 0) {
      console.error("Failed to fetch indicators for date:", latestDate, indError);
      return NextResponse.json({ error: "Failed to fetch indicators" }, { status: 500 });
    }

    // 3. Fetch fundamentals to map names
    const { data: fundRows } = await supabase
      .from("stock_fundamentals")
      .select("symbol, data")
      .eq("exchange", "EGX");

    const nameMap = new Map<string, string>();
    if (fundRows) {
      for (const row of fundRows) {
        const payload = row.data || {};
        const name = payload.name || payload.Name || "";
        if (name) {
          nameMap.set(row.symbol.toUpperCase(), name);
        }
      }
    }

    // 4. Calculate Breadth Metrics
    let advancing = 0;
    let declining = 0;
    let unchanged = 0;
    let aboveEma50 = 0;
    let aboveEma200 = 0;
    let rsiSum = 0;
    let rsiCount = 0;
    let volRatioSum = 0;
    let volRatioCount = 0;

    const validStocks: any[] = [];

    for (const ind of indicators) {
      const close = Number(ind.close || 0);
      if (!close) continue;

      const changePct = Number(ind.change_pct || 0);
      if (changePct > 0) advancing++;
      else if (changePct < 0) declining++;
      else unchanged++;

      const ema50 = Number(ind.ema_50 || 0);
      const ema200 = Number(ind.ema_200 || 0);
      if (ema50 && close > ema50) aboveEma50++;
      if (ema200 && close > ema200) aboveEma200++;

      const rsi = Number(ind.rsi_14);
      if (!isNaN(rsi)) {
        rsiSum += rsi;
        rsiCount++;
      }

      const vol = Number(ind.volume || 0);
      const volSma = Number(ind.vol_sma20 || 0);
      if (vol && volSma) {
        volRatioSum += vol / volSma;
        volRatioCount++;
      }

      validStocks.push({
        symbol: ind.symbol,
        name: nameMap.get(ind.symbol.toUpperCase()) || ind.symbol,
        change_pct: changePct,
        close: close,
        volume: vol,
        rsi_14: !isNaN(rsi) ? rsi : 50,
      });
    }

    const totalStocks = validStocks.length || 1;
    const pctAboveEma50 = (aboveEma50 / totalStocks) * 100;
    const pctAboveEma200 = (aboveEma200 / totalStocks) * 100;
    const avgRsi = rsiCount > 0 ? rsiSum / rsiCount : 50;
    const avgVolRatio = volRatioCount > 0 ? volRatioSum / volRatioCount : 1.0;

    // Calculate Health Score
    // 30% weight: ratio of advancing stocks
    const adRatio = (advancing + declining) > 0 ? advancing / (advancing + declining) : 0.5;
    const adScore = adRatio * 100;

    // 20% weight: % above ema50
    const ema50Score = pctAboveEma50;

    // 20% weight: % above ema200
    const ema200Score = pctAboveEma200;

    // 15% weight: normalized RSI (score is highest at 50, drops if overbought (>70) or oversold (<30))
    let rsiScore = 50;
    if (avgRsi >= 30 && avgRsi <= 70) {
      rsiScore = 100 - Math.abs(avgRsi - 50) * 2.5; 
    } else if (avgRsi < 30) {
      rsiScore = Math.max(10, avgRsi * 1.6);
    } else {
      rsiScore = Math.max(10, (100 - avgRsi) * 1.6);
    }

    // 15% weight: volume ratio (capped at 2.0, mapped 0-100)
    const volScore = Math.min(100, (avgVolRatio / 2.0) * 100);

    const healthScore = Math.round(
      adScore * 0.3 +
      ema50Score * 0.2 +
      ema200Score * 0.2 +
      rsiScore * 0.15 +
      volScore * 0.15
    );

    let healthLabel = "moderate";
    if (healthScore >= 70) healthLabel = "strong";
    else if (healthScore < 45) healthLabel = "weak";

    // Top Gainers and Losers
    const sortedMovers = [...validStocks].sort((a, b) => b.change_pct - a.change_pct);
    const topGainers = sortedMovers.slice(0, 5);
    const topLosers = [...sortedMovers].reverse().slice(0, 5);

    return NextResponse.json({
      health_score: healthScore,
      health_label: healthLabel,
      advancing,
      declining,
      unchanged,
      pct_above_ema50: pctAboveEma50,
      pct_above_ema200: pctAboveEma200,
      avg_rsi: avgRsi,
      volume_ratio: avgVolRatio,
      top_gainers: topGainers,
      top_losers: topLosers,
      date: latestDate,
      total_stocks: totalStocks,
    });
  } catch (error) {
    console.error("Breadth API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
