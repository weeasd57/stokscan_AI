import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const supabase = getSupabaseClient();

    // 1. Fetch latest open AI recommendations
    const { data: recommendations, error: recError } = await supabase
      .from("scan_results")
      .select("symbol, name, signal, entry_price, target_price, stop_loss, precision, top_reasons, model_name, created_at")
      .eq("country", "Egypt")
      .eq("status", "open")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(10);

    if (recError) {
      console.error("Failed to fetch scan results:", recError);
      return NextResponse.json({ error: "Failed to fetch AI signals" }, { status: 500 });
    }

    if (!recommendations || recommendations.length === 0) {
      return NextResponse.json({
        signals: [],
        total_open: 0,
        buy_count: 0,
        sell_count: 0,
      });
    }

    const symbols = recommendations.map((r: any) => r.symbol);

    // 2. Fetch latest prices for these symbols from stock_technical_indicators
    // Get the latest technical indicators date first to query the exact row
    const { data: dateRows } = await supabase
      .from("stock_technical_indicators")
      .select("date")
      .eq("exchange", "EGX")
      .order("date", { ascending: false })
      .limit(1);

    const latestDate = dateRows && dateRows.length > 0 ? dateRows[0].date : null;

    let pricesMap = new Map<string, number>();
    if (latestDate) {
      const { data: priceRows } = await supabase
        .from("stock_technical_indicators")
        .select("symbol, close")
        .eq("date", latestDate)
        .in("symbol", symbols);

      if (priceRows) {
        for (const row of priceRows) {
          pricesMap.set(row.symbol.toUpperCase(), Number(row.close || 0));
        }
      }
    }

    // Fallback: if some symbols are missing or date failed, check stock_prices latest close
    const missingSymbols = symbols.filter((s: any) => !pricesMap.has(s.toUpperCase()));
    if (missingSymbols.length > 0) {
      for (const sym of missingSymbols) {
        const { data: latestPrice } = await supabase
          .from("stock_prices")
          .select("close")
          .eq("symbol", sym)
          .order("date", { ascending: false })
          .limit(1);

        if (latestPrice && latestPrice.length > 0) {
          pricesMap.set(sym.toUpperCase(), Number(latestPrice[0].close || 0));
        }
      }
    }

    // 3. Process Signals
    let buyCount = 0;
    let sellCount = 0;
    const signals: any[] = [];

    for (const rec of recommendations) {
      const symbolUpper = rec.symbol.toUpperCase();
      const currentPrice = pricesMap.get(symbolUpper) || Number(rec.entry_price || 0);

      const entry = Number(rec.entry_price || 0);
      const isBuy = String(rec.signal || "").toUpperCase().includes("BUY");
      if (isBuy) buyCount++;
      else sellCount++;

      // Compute PnL %
      let pnlPct = 0;
      if (entry > 0) {
        pnlPct = isBuy
          ? ((currentPrice - entry) / entry) * 100
          : ((entry - currentPrice) / entry) * 100;
      }

      // Parse top reasons
      let reasons: string[] = [];
      if (rec.top_reasons) {
        if (Array.isArray(rec.top_reasons)) {
          reasons = rec.top_reasons;
        } else if (typeof rec.top_reasons === "string") {
          try {
            reasons = JSON.parse(rec.top_reasons);
          } catch {
            reasons = [rec.top_reasons];
          }
        }
      }

      signals.push({
        symbol: rec.symbol,
        name: rec.name || rec.symbol,
        signal: isBuy ? "BUY" : "SELL",
        entry_price: entry,
        current_price: currentPrice,
        target_price: Number(rec.target_price || 0),
        stop_loss: Number(rec.stop_loss || 0),
        precision: Number(rec.precision || 0),
        pnl_pct: pnlPct,
        top_reasons: reasons,
        model_name: rec.model_name || "AI Council",
        created_at: rec.created_at,
        council_score: 0,
      });
    }

    return NextResponse.json({
      signals,
      total_open: signals.length,
      buy_count: buyCount,
      sell_count: sellCount,
    });
  } catch (error) {
    console.error("AI Signals API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
