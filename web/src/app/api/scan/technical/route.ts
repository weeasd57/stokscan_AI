import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      country = "Egypt",
      limit = 50,
      rsi_min,
      rsi_max,
      min_price,
      above_ema50,
      above_ema200,
      below_ema50,
      adx_min,
      adx_max,
      atr_min,
      atr_max,
      stoch_k_min,
      stoch_k_max,
      roc_min,
      roc_max,
      above_vwap20,
      volume_above_sma20,
      market_cap_min,
      market_cap_max,
      sector,
      industry,
      golden_cross,
      use_ai_filter,
      min_ai_precision = 0.6,
      avoid_distribution,
      require_accumulation,
      cmf_min,
      divergence_type,
      divergence_indicator,
      divergence_min_strength,
    } = body;

    const supabase = getSupabaseClient();

    // 1. Get symbols matching country from stocks table
    const { data: countryStocks } = await supabase
      .from('stocks')
      .select('symbol')
      .eq('country', country);

    const countrySymbols = (countryStocks || []).map((s: any) => s.symbol);

    // 2. Fetch technical indicators from Supabase
    let queryFields = `
      symbol,
      exchange,
      date,
      close,
      rsi_14,
      ema_20,
      ema_50,
      ema_200,
      atr_14,
      adx_14,
      stoch_k,
      stoch_d,
      volume,
      change_pct,
      vol_sma20,
      momentum_10,
      roc_12,
      macd,
      macd_signal,
      r_vol,
      vwap_20,
      cmf_20,
      mm_accumulation,
      mm_distribution,
      rsi_divergence,
      macd_divergence,
      stoch_divergence,
      divergence_strength,
      divergence_periods,
      divergence_summary
    `;

    let query = supabase
      .from('stock_technical_indicators')
      .select(queryFields);

    if (countrySymbols.length > 0) {
      query = query.in('symbol', countrySymbols);
    }

    // Apply primary filters directly in DB query if possible
    if (rsi_min !== undefined) {
      query = query.gte('rsi_14', rsi_min);
    }
    if (rsi_max !== undefined) {
      query = query.lte('rsi_14', rsi_max);
    }
    if (min_price !== undefined) {
      query = query.gte('close', min_price);
    }
    if (adx_min !== undefined) {
      query = query.gte('adx_14', adx_min);
    }
    if (adx_max !== undefined) {
      query = query.lte('adx_14', adx_max);
    }

    let { data: indicators, error } = await query
      .limit(1000) // Fetch a larger pool to allow client-side filters (joins)
      .order('date', { ascending: false });

    if (error) {
      // Fallback query without the missing fields (if legacy schema is in place)
      queryFields = `
        symbol,
        exchange,
        date,
        close,
        rsi_14,
        ema_20,
        ema_50,
        ema_200,
        atr_14,
        adx_14,
        stoch_k,
        stoch_d,
        volume,
        change_pct,
        vol_sma20,
        momentum_10,
        roc_12,
        macd,
        macd_signal,
        r_vol,
        vwap_20,
        rsi_divergence,
        macd_divergence,
        stoch_divergence,
        divergence_strength,
        divergence_periods,
        divergence_summary
      `;
      let fallbackQuery = supabase
        .from('stock_technical_indicators')
        .select(queryFields);

      if (countrySymbols.length > 0) {
        fallbackQuery = fallbackQuery.in('symbol', countrySymbols);
      }

      if (rsi_min !== undefined) fallbackQuery = fallbackQuery.gte('rsi_14', rsi_min);
      if (rsi_max !== undefined) fallbackQuery = fallbackQuery.lte('rsi_14', rsi_max);
      if (min_price !== undefined) fallbackQuery = fallbackQuery.gte('close', min_price);
      if (adx_min !== undefined) fallbackQuery = fallbackQuery.gte('adx_14', adx_min);
      if (adx_max !== undefined) fallbackQuery = fallbackQuery.lte('adx_14', adx_max);

      const fallbackResult = await fallbackQuery
        .limit(1000)
        .order('date', { ascending: false });

      indicators = fallbackResult.data;
      if (fallbackResult.error) {
        console.error('Technical scan Supabase fallback error:', fallbackResult.error);
        return NextResponse.json({ results: [], scanned_count: 0 });
      }
    }

    if (!indicators || indicators.length === 0) {
      return NextResponse.json({ results: [], scanned_count: 0 });
    }

    // Sort in memory by date descending to ensure the latest row comes first for deduplication
    const sortedIndicators = [...(indicators || [])].sort((a: any, b: any) => {
      const timeA = a.date ? new Date(a.date).getTime() : 0;
      const timeB = b.date ? new Date(b.date).getTime() : 0;
      return timeB - timeA;
    });

    const uniqueIndicatorsMap = new Map<string, any>();
    sortedIndicators.forEach((ind: any) => {
      const key = `${ind.symbol}-${ind.exchange}`;
      if (!uniqueIndicatorsMap.has(key)) {
        uniqueIndicatorsMap.set(key, ind);
      }
    });

    const dedupedIndicators = Array.from(uniqueIndicatorsMap.values());

    const scannedSymbols = dedupedIndicators.map((ind: any) => ind.symbol);

    // 3. Fetch fundamentals for these symbols
    const { data: fundamentals } = await supabase
      .from('stock_fundamentals')
      .select('symbol, name, fund_score, data')
      .in('symbol', scannedSymbols);

    // 4. Fetch AI scan results for these symbols
    const { data: scanResults } = await supabase
      .from('scan_results')
      .select('symbol, precision')
      .in('symbol', scannedSymbols);

    const fundMap = new Map();
    if (fundamentals) {
      fundamentals.forEach((f: any) => {
        fundMap.set(f.symbol, f);
      });
    }

    const scanMap = new Map();
    if (scanResults) {
      scanResults.forEach((s: any) => {
        scanMap.set(s.symbol, toNumber(s.precision));
      });
    }

    // 5. Apply filters and calculate scores in memory
    const scanned: any[] = [];

    for (const tech of dedupedIndicators) {
      const close = toNumber(tech.close);
      const rsi = toNumber(tech.rsi_14);
      const ema20 = toNumber(tech.ema_20);
      const ema50 = toNumber(tech.ema_50);
      const ema200 = toNumber(tech.ema_200);
      const volume = toNumber(tech.volume);
      const atr14 = toNumber(tech.atr_14);
      const adx14 = toNumber(tech.adx_14);
      const stoch_k = toNumber(tech.stoch_k);
      const stoch_d = toNumber(tech.stoch_d);
      const momentum10 = toNumber(tech.momentum_10);
      const roc12 = toNumber(tech.roc_12);
      const macd = toNumber(tech.macd);
      const macd_signal = toNumber(tech.macd_signal);
      const vol_sma20 = toNumber(tech.vol_sma20);
      const r_vol = toNumber(tech.r_vol);
      const change_p = toNumber(tech.change_pct);

      const cmf_20 = tech.cmf_20 !== undefined ? toNumber(tech.cmf_20) : 0.0;
      const mm_accumulation = tech.mm_accumulation !== undefined ? toNumber(tech.mm_accumulation) : 0.0;
      const mm_distribution = tech.mm_distribution !== undefined ? toNumber(tech.mm_distribution) : 0.0;
      const distribution_blocked = mm_distribution > 0.5 || cmf_20 < -0.10;
      const distribution_reason = mm_distribution > 0.5 ? "market_maker_distribution" : (cmf_20 < -0.10 ? "negative_money_flow" : null);

      const fundRecord = fundMap.get(tech.symbol) || {};
      const fundData = fundRecord.data || {};
      
      const companyName = fundRecord.name || fundData.name || tech.symbol;
      const m_cap = toNumber(fundData.marketCap);
      const peRatio = toNumber(fundData.peRatio);
      const eps = toNumber(fundData.eps);
      const dividendYield = toNumber(fundData.dividendYield);
      const sec = fundData.sector || "";
      const ind = fundData.industry || "";
      const beta = toNumber(fundData.beta);
      const logoUrl = fundData.logoUrl || null;

      // Filter in JS
      if (above_ema50 && close <= ema50) continue;
      if (below_ema50 && close >= ema50) continue;
      if (above_ema200 && close <= ema200) continue;
      
      if (atr_min !== undefined && atr14 < atr_min) continue;
      if (atr_max !== undefined && atr14 > atr_max) continue;
      if (stoch_k_min !== undefined && stoch_k < stoch_k_min) continue;
      if (stoch_k_max !== undefined && stoch_k > stoch_k_max) continue;
      if (roc_min !== undefined && roc12 < roc_min) continue;
      if (roc_max !== undefined && roc12 > roc_max) continue;

      if (above_vwap20 && tech.vwap_20 && close <= toNumber(tech.vwap_20)) continue;
      if (volume_above_sma20 && vol_sma20 > 0 && volume <= vol_sma20) continue;
      if (golden_cross && ema50 <= ema200) continue;

      // Fundamental Filters
      if (market_cap_min !== undefined && m_cap < market_cap_min) continue;
      if (market_cap_max !== undefined && m_cap > market_cap_max) continue;
      if (sector && !sec.toLowerCase().includes(sector.toLowerCase())) continue;
      if (industry && !ind.toLowerCase().includes(industry.toLowerCase())) continue;

      // Money Flow Filters
      if (avoid_distribution && distribution_blocked) continue;
      if (require_accumulation && mm_accumulation <= 0.5) continue;
      if (cmf_min !== undefined && cmf_20 < cmf_min) continue;

      // AI score & precision filter
      const precision = scanMap.get(tech.symbol);
      if (use_ai_filter) {
        if (precision === undefined || precision < min_ai_precision) continue;
      }

      // Divergence Filters
      if (divergence_type && divergence_type !== "NONE") {
        let hasDiv = false;
        const indFilter = (divergence_indicator || "ANY").toUpperCase();
        const indicatorsToCheck = indFilter === "ANY" || indFilter === ""
          ? ["rsi", "macd", "stoch"]
          : [indFilter.toLowerCase()];
          
        for (const indName of indicatorsToCheck) {
          const divVal = tech[`${indName}_divergence`] || "NONE";
          if (divergence_type === "ANY" && divVal !== "NONE") {
            hasDiv = true;
          } else if (divVal === divergence_type) {
            hasDiv = true;
          }
        }
        
        if (!hasDiv) continue;
        
        if (divergence_min_strength !== undefined) {
          const strength = tech.divergence_strength !== undefined ? toNumber(tech.divergence_strength) : 0.0;
          if (strength < divergence_min_strength) continue;
        }
      }

      // Calculate Technical Score (Acceleration Score 0-10)
      let trendPts = 0.0;
      if (close > 0 && ema50 > 0 && ema200 > 0) {
        if (ema20 > 0 && close > ema20 && ema20 > ema50 && ema50 > ema200) {
          trendPts = 3.0;
        } else if (close > ema50 && ema50 > ema200) {
          trendPts = 2.5;
        } else if (close > ema50 && close > ema200) {
          trendPts = 2.0;
        } else if (close > ema50) {
          trendPts = 1.5;
        } else if (close > ema200) {
          trendPts = 1.0;
        }
        if (ema50 > ema200) {
          trendPts = Math.min(3.0, trendPts + 0.5);
        }
      }

      let volumePts = 0.0;
      let calculatedRVol = r_vol;
      if (calculatedRVol <= 0 && vol_sma20 > 0 && volume > 0) {
        calculatedRVol = volume / vol_sma20;
      }
      if (calculatedRVol > 0) {
        if (calculatedRVol >= 3.0) volumePts = 2.5;
        else if (calculatedRVol >= 2.0) volumePts = 2.0;
        else if (calculatedRVol >= 1.5) volumePts = 1.5;
        else if (calculatedRVol >= 1.2) volumePts = 1.0;
        else if (calculatedRVol >= 0.8) volumePts = 0.5;
      }

      let momentumPts = 0.0;
      const effectiveMomentum = Math.abs(roc12) > 0 ? roc12 : momentum10;
      if (effectiveMomentum > 0.05) momentumPts += 1.0;
      else if (effectiveMomentum > 0.02) momentumPts += 0.75;
      else if (effectiveMomentum > 0) momentumPts += 0.5;

      if (macd > macd_signal && macd > 0) momentumPts += 1.0;
      else if (macd > macd_signal) momentumPts += 0.5;
      else if (macd > 0) momentumPts += 0.25;
      momentumPts = Math.min(2.0, momentumPts);

      let adxPts = 0.0;
      if (adx14 >= 50) adxPts = 1.5;
      else if (adx14 >= 35) adxPts = 1.25;
      else if (adx14 >= 25) adxPts = 1.0;
      else if (adx14 >= 20) adxPts = 0.5;

      let rsiPts = 0.0;
      if (rsi >= 70) rsiPts = 1.0;
      else if (rsi >= 55) rsiPts = 0.75;
      else if (rsi >= 45) rsiPts = 0.5;
      else if (rsi >= 30) rsiPts = 0.25;

      let rawTechnicalScore = trendPts + volumePts + momentumPts + adxPts + rsiPts;

      // Market Maker Phase Adjustments
      if (mm_distribution > 0.5) {
        rawTechnicalScore -= 3.0;
      } else if (cmf_20 < -0.05) {
        rawTechnicalScore -= 1.5;
      }
      if (mm_accumulation > 0.5) {
        rawTechnicalScore += 1.0;
      } else if (cmf_20 > 0.10) {
        rawTechnicalScore += 0.5;
      }

      const tScore = Math.round(Math.min(10, Math.max(0, rawTechnicalScore)));

      // Calculate Fundamental Score (1-10)
      let fScoreVal = 0;
      if (peRatio > 0 && peRatio <= 15) fScoreVal += 3;
      else if (peRatio > 15 && peRatio <= 25) fScoreVal += 2;
      else if (peRatio > 25 && peRatio <= 40) fScoreVal += 1;

      if (eps > 1) fScoreVal += 3;
      else if (eps > 0) fScoreVal += 2;
      else if (eps > -0.5) fScoreVal += 1;

      if (dividendYield > 3) fScoreVal += 2;
      else if (dividendYield > 1) fScoreVal += 1;

      if (m_cap > 10_000_000_000) fScoreVal += 2;
      else if (m_cap > 1_000_000_000) fScoreVal += 1;
      
      const fScore = Math.round(Math.min(10, Math.max(1, fScoreVal)));

      // Calculate Sentiment Score (1-10)
      let sScoreVal = 5;
      if (momentum10 > 0.03) sScoreVal += 2;
      else if (momentum10 > 0) sScoreVal += 1;
      else if (momentum10 < -0.03) sScoreVal -= 2;
      else if (momentum10 < 0) sScoreVal -= 1;

      if (rsi > 70) sScoreVal += 2;
      else if (rsi > 55) sScoreVal += 1;
      else if (rsi < 25) sScoreVal -= 2;
      else if (rsi < 40) sScoreVal -= 1;

      if (calculatedRVol > 2.0) sScoreVal += 2;
      else if (calculatedRVol > 1.3) sScoreVal += 1;
      else if (calculatedRVol < 0.5) sScoreVal -= 1;

      if (adx14 > 40) sScoreVal += 1;
      if (macd > macd_signal && macd > 0) sScoreVal += 1;

      const sScore = Math.round(Math.min(10, Math.max(1, sScoreVal)));

      // Calculate overall AI Score (1-10) if precision exists
      let aiScore: number | null = null;
      if (precision !== undefined && precision !== null) {
        const bt = min_ai_precision;
        let denom = 1.0 - bt;
        if (denom <= 0) denom = 0.01;
        const scaled = 6 + (precision - bt) / denom * 4;
        aiScore = Math.round(Math.min(Math.max(scaled, 6), 10));
      }

      scanned.push({
        symbol: tech.symbol,
        name: companyName,
        date: tech.date ?? null,
        year: tech.date ? new Date(tech.date).getFullYear() : null,
        last_close: close,
        rsi: rsi,
        volume: volume,
        ema50: ema50,
        ema200: ema200,
        momentum: momentum10,
        atr14: atr14,
        adx14: adx14,
        stoch_k: stoch_k,
        stoch_d: stoch_d,
        change_p: change_p,
        market_cap: m_cap,
        pe_ratio: peRatio,
        eps: eps,
        dividend_yield: dividendYield,
        sector: sec || null,
        industry: ind || null,
        beta: beta || null,
        ai_precision: precision || null,
        ai_signal: precision ? "BUY" : null,
        logo_url: logoUrl,
        ai_score: aiScore,
        fundamental_score: fScore,
        technical_score: tScore,
        sentiment_score: sScore,
        vwap20: tech.vwap_20 ? toNumber(tech.vwap_20) : 0,
        cmf_20: cmf_20,
        mm_accumulation: mm_accumulation > 0.5,
        mm_distribution: mm_distribution > 0.5,
        distribution_blocked: distribution_blocked,
        distribution_reason: distribution_reason,
        rsi_divergence: tech.rsi_divergence || "NONE",
        macd_divergence: tech.macd_divergence || "NONE",
        stoch_divergence: tech.stoch_divergence || "NONE",
        divergence_strength: tech.divergence_strength !== undefined ? toNumber(tech.divergence_strength) : 0.0,
        divergence_periods: tech.divergence_periods !== undefined ? toNumber(tech.divergence_periods) : 0,
        divergence_summary: tech.divergence_summary || null,
      });

      if (scanned.length >= limit) {
        break;
      }
    }

    return NextResponse.json({
      results: scanned,
      scanned_count: indicators.length
    });

  } catch (error) {
    console.error('Technical scan API error:', error);
    return NextResponse.json({ results: [], scanned_count: 0 });
  }
}
