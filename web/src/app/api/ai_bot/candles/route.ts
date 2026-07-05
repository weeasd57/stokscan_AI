import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    const exchange = url.searchParams.get("exchange") || "EGX";
    const limit = Math.min(Number(url.searchParams.get("limit") || 150), 1000);
    const bot_id = url.searchParams.get("bot_id") || "primary";

    if (!symbol) {
      return NextResponse.json({ candles: [], markers: [] }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    let rawCandles: any[] = [];
    let timeframe = "1d";

    if (exchange.toUpperCase() === "EGX") {
      const { data, error } = await supabase
        .from("stock_prices")
        .select("date,open,high,low,close,volume")
        .eq("symbol", symbol)
        .eq("exchange", "EGX")
        .order("date", { ascending: false })
        .limit(limit);

      if (!error && data) {
        rawCandles = [...data].reverse(); // reverse to chronological
      }
    } else {
      // Intraday or Crypto bars
      const { data, error } = await supabase
        .from("stock_bars_intraday")
        .select("ts,open,high,low,close,volume,timeframe")
        .eq("symbol", symbol)
        .eq("exchange", exchange)
        .order("ts", { ascending: false })
        .limit(limit);

      if (!error && data) {
        rawCandles = [...data].reverse();
        if (data.length > 0) {
          timeframe = data[0].timeframe || "15m";
        }
      }
    }

    // Format for lightweight-charts
    const candles = rawCandles.map((c: any) => {
      const ts = c.ts || c.date;
      let unix_ts = 0;
      if (ts) {
        if (ts.includes("T") || ts.includes(" ")) {
          unix_ts = Math.floor(new Date(ts).getTime() / 1000);
        } else {
          // YYYY-MM-DD
          unix_ts = Math.floor(new Date(ts + "T00:00:00Z").getTime() / 1000);
        }
      }
      return {
        time: unix_ts,
        open: Number(c.open || 0),
        high: Number(c.high || 0),
        low: Number(c.low || 0),
        close: Number(c.close || 0),
        volume: Number(c.volume || 0),
      };
    }).filter(c => c.time > 0);

    // Fetch markers from bot_trades
    const { data: markersData } = await supabase
      .from("bot_trades")
      .select("timestamp,action,price,entry_price,pnl")
      .eq("bot_id", bot_id)
      .eq("symbol", symbol)
      .order("timestamp", { ascending: true });

    const rawMarkers = markersData || [];
    const markers = rawMarkers.map((m: any) => {
      const unix_ts = Math.floor(new Date(m.timestamp).getTime() / 1000);
      return {
        time: unix_ts,
        position: m.action.toUpperCase() === "BUY" ? "belowBar" : "aboveBar",
        color: m.action.toUpperCase() === "BUY" ? "#10B981" : "#EF4444",
        shape: m.action.toUpperCase() === "BUY" ? "arrowUp" : "arrowDown",
        text: m.action.toUpperCase() + (m.pnl != null ? ` (${m.pnl > 0 ? "+" : ""}${Number(m.pnl).toFixed(1)}%)` : ""),
        action: m.action,
        price: m.price,
      };
    });

    return NextResponse.json({
      candles,
      markers,
      timeframe,
    });
  } catch (err: any) {
    console.error("Candles endpoint error:", err);
    return NextResponse.json({ candles: [], markers: [] }, { status: 500 });
  }
}
