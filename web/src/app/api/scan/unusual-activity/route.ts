import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";
import { priorTwentySessionHigh } from "@/lib/unusualActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_RELATIVE_VOLUME = 2;
const MAX_RESULTS = 15;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  try {
    const supabase = getSupabaseServiceClient();
    const { data: latestRows, error: latestError } = await supabase
      .from("stock_technical_indicators")
      .select("date")
      .eq("exchange", "EGX")
      .order("date", { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    const asOf = latestRows?.[0]?.date ? String(latestRows[0].date).slice(0, 10) : null;
    if (!asOf) return NextResponse.json({ asOf: null, coverage: 0, totalMatches: 0, rows: [] }, { headers: dailyCacheHeaders(DAILY_CACHE_TAGS.market) });

    const { data: indicators, error: indicatorsError } = await supabase
      .from("stock_technical_indicators")
      .select("symbol,close,change_pct,rsi_14,r_vol,vol_sma20,volume,egx_ai_score")
      .eq("exchange", "EGX")
      .eq("date", asOf)
      .limit(1000);
    if (indicatorsError) throw indicatorsError;
    const bySymbol = new Map<string, any>();
    for (const row of indicators || []) {
      if (row.symbol) bySymbol.set(String(row.symbol), row);
    }
    const unusual = [...bySymbol.values()]
      .filter((row) => (finite(row.r_vol) ?? 0) >= MIN_RELATIVE_VOLUME && (finite(row.vol_sma20) ?? 0) > 0 && (finite(row.volume) ?? 0) > 0)
      .sort((a, b) => Number(b.r_vol) - Number(a.r_vol));
    const candidates = unusual.slice(0, MAX_RESULTS);

    const history = new Map<string, Array<{ date: string; high: number | string | null }>>();
    if (candidates.length) {
      const from = new Date(Date.parse(`${asOf}T00:00:00Z`) - 75 * 86_400_000).toISOString().slice(0, 10);
      const { data: bars, error: barsError } = await supabase
        .from("stock_prices")
        .select("symbol,date,high")
        .eq("exchange", "EGX")
        .in("symbol", candidates.map((row) => row.symbol))
        .gte("date", from)
        .lt("date", asOf)
        .order("date", { ascending: false })
        .limit(1000);
      if (barsError) throw barsError;
      for (const bar of bars || []) {
        const symbol = String(bar.symbol);
        const items = history.get(symbol) || [];
        items.push({ date: String(bar.date).slice(0, 10), high: bar.high });
        history.set(symbol, items);
      }
    }

    const rows = candidates.map((row) => {
      const close = finite(row.close);
      const resistance = priorTwentySessionHigh(history.get(String(row.symbol)) || [], asOf);
      const score = finite(row.egx_ai_score);
      return {
        symbol: String(row.symbol),
        relativeVolume: Number(row.r_vol),
        close,
        changePct: finite(row.change_pct),
        rsi: finite(row.rsi_14),
        aiScore: score !== null && score >= 0 && score <= 1 ? score * 100 : null,
        resistance,
        distanceToResistancePct: resistance && close !== null ? ((resistance - close) / resistance) * 100 : null,
      };
    });

    return NextResponse.json(
      { asOf, coverage: bySymbol.size, totalMatches: unusual.length, threshold: MIN_RELATIVE_VOLUME, rows },
      { headers: dailyCacheHeaders(DAILY_CACHE_TAGS.market) },
    );
  } catch (error) {
    console.error("[UNUSUAL_ACTIVITY] Failed to load latest technical snapshot", error);
    return NextResponse.json({ error: "Unusual activity is temporarily unavailable." }, { status: 503 });
  }
}
