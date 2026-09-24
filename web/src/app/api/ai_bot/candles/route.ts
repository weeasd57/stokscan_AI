import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBackendBaseUrl() {
  return (
    process.env.PYTHON_BACKEND_URL ||
    process.env.TRADING_SIGNALS_API_URL ||
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

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

    if (exchange.toUpperCase() !== "EGX") {
      return NextResponse.json({ candles: [], markers: [], error: "Only EGX market data is available." }, { status: 410 });
    }

    // The backend owns the canonical HF-history + Supabase-tail merge. Keep
    // this route as a same-origin proxy so browser clients never receive the
    // HF credential and chart data matches scanner/training data exactly.
    try {
      const backendUrl = new URL(`${getBackendBaseUrl()}/bot/candles`);
      backendUrl.searchParams.set("symbol", symbol);
      backendUrl.searchParams.set("exchange", "EGX");
      backendUrl.searchParams.set("limit", String(limit));
      backendUrl.searchParams.set("bot_id", bot_id);
      const backendResponse = await fetch(backendUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      if (backendResponse.ok) {
        return NextResponse.json(await backendResponse.json(), {
          headers: { "Cache-Control": "private, max-age=60" },
        });
      }
    } catch (error) {
      console.warn("Unified candle backend unavailable; using live-table fallback:", error);
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
