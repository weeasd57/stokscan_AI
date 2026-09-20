import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";

export const runtime = "nodejs";

const PUBLIC_CACHE_HEADERS = dailyCacheHeaders(DAILY_CACHE_TAGS.market);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "FWRY").toUpperCase().trim();

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("market_cache")
      .select("payload")
      .eq("cache_key", "hedge_scan_cache")
      .eq("country", "Egypt")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.payload) {
      console.error("Hedge scan cache read failed or empty:", error);
      // Fallback response with some default nodes — short cache only
      return NextResponse.json({
        nodes: [
          { symbol: "ABUK", weight: 85 },
          { symbol: "AMOC", weight: 79 },
          { symbol: "EAST", weight: 74 },
          { symbol: "SWDY", weight: 70 },
          { symbol: "HRHO", weight: 65 }
        ],
        links: [
          { source: symbol, target: "ABUK" },
          { source: symbol, target: "AMOC" },
          { source: symbol, target: "EAST" },
          { source: symbol, target: "SWDY" },
          { source: symbol, target: "HRHO" }
        ]
      }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } });
    }

    const payload = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
    const symbolsList = Array.isArray(payload?.symbols) ? payload.symbols : [];

    const rootItem = symbolsList.find((s: any) => s.symbol === symbol);
    if (!rootItem) {
      const top5 = symbolsList.slice(0, 5);
      return NextResponse.json({
        nodes: top5.map((s: any) => ({ symbol: s.symbol, weight: 80 })),
        links: top5.map((s: any) => ({ source: symbol, target: s.symbol }))
      }, { headers: PUBLIC_CACHE_HEADERS });
    }

    const peers = symbolsList
      .filter((s: any) => s.symbol !== symbol)
      .map((s: any) => {
        const d_official = Math.abs((s.corr_usd_official || 0) - (rootItem.corr_usd_official || 0));
        const d_parallel = Math.abs((s.corr_usd_parallel || 0) - (rootItem.corr_usd_parallel || 0));
        const d_gold = Math.abs((s.corr_gold || 0) - (rootItem.corr_gold || 0));
        const distance = d_official + d_parallel + d_gold;
        const weight = Math.min(99, Math.max(30, Math.round((1 - distance / 3) * 100)));
        return { symbol: s.symbol, weight };
      })
      .sort((a: any, b: any) => b.weight - a.weight)
      .slice(0, 8);

    const nodes = peers.map((p: any) => ({ symbol: p.symbol, weight: p.weight }));
    const links = peers.map((p: any) => ({ source: symbol, target: p.symbol }));

    return NextResponse.json({ nodes, links }, { headers: PUBLIC_CACHE_HEADERS });
  } catch (err: any) {
    console.error("Error building correlation network:", err);
    return NextResponse.json({ nodes: [], links: [] });
  }
}
