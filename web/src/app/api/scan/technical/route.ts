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
      adx_min,
      adx_max,
      sector,
    } = body;

    const supabase = getSupabaseClient();

    // Get technical indicators from Supabase
    let query = supabase
      .from('stock_technical_indicators')
      .select(`
        symbol,
        exchange,
        close,
        rsi_14,
        ema_50,
        ema_200,
        atr_14,
        adx_14,
        stoch_k,
        stoch_d,
        volume,
        volume_sma_20,
        change_pct
      `);

    // Apply filters
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

    const { data: indicators, error } = await query
      .limit(limit)
      .order('symbol', { ascending: true });

    if (error) {
      console.error('Technical scan Supabase error:', error);
      return NextResponse.json({ error: 'Failed to scan technical indicators' }, { status: 500 });
    }

    // Apply EMA filters in JS (complex logic)
    let results = indicators || [];
    
    if (above_ema50) {
      results = results.filter((s: any) => s.close > s.ema_50);
    }
    if (above_ema200) {
      results = results.filter((s: any) => s.close > s.ema_200);
    }

    // Transform to expected format
    const scanned = results.map((stock: any) => ({
      symbol: stock.symbol,
      name: stock.symbol, // Fallback to symbol
      last_close: toNumber(stock.close),
      rsi: toNumber(stock.rsi_14),
      volume: toNumber(stock.volume),
      ema50: toNumber(stock.ema_50),
      ema200: toNumber(stock.ema_200),
      momentum: toNumber(stock.change_pct),
      atr14: toNumber(stock.atr_14),
      adx14: toNumber(stock.adx_14),
      stoch_k: toNumber(stock.stoch_k),
      stoch_d: toNumber(stock.stoch_d),
      change_p: toNumber(stock.change_pct)
    }));

    return NextResponse.json({
      results: scanned,
      scanned_count: scanned.length
    });

  } catch (error) {
    console.error('Technical scan API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

