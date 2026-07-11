import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      // Fallback response with some default nodes
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
      });
    }

    const payload = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
    const symbolsList = Array.isArray(payload?.symbols) ? payload.symbols : [];

    const rootItem = symbolsList.find((s: any) => s.symbol === symbol);
    if (!rootItem) {
      // If selected symbol isn't in cache, just return top 5 strongest overall hedges
      const top5 = symbolsList.slice(0, 5);
      return NextResponse.json({
        nodes: top5.map((s: any) => ({ symbol: s.symbol, weight: 80 })),
        links: top5.map((s: any) => ({ source: symbol, target: s.symbol }))
      });
    }

    // Compute distance to all other symbols based on correlation profile similarity
    const peers = symbolsList
      .filter((s: any) => s.symbol !== symbol)
      .map((s: any) => {
        const d_official = Math.abs((s.corr_usd_official || 0) - (rootItem.corr_usd_official || 0));
        const d_parallel = Math.abs((s.corr_usd_parallel || 0) - (rootItem.corr_usd_parallel || 0));
        const d_gold = Math.abs((s.corr_gold || 0) - (rootItem.corr_gold || 0));
        const distance = d_official + d_parallel + d_gold;
        // Convert distance to a weight percentage (closer profile = higher weight)
        const weight = Math.min(99, Math.max(30, Math.round((1 - distance / 3) * 100)));
        return { symbol: s.symbol, weight };
      })
      .sort((a: any, b: any) => b.weight - a.weight) // strongest peers first
      .slice(0, 8); // top 8 peers

    const nodes = peers.map((p: any) => ({ symbol: p.symbol, weight: p.weight }));
    const links = peers.map((p: any) => ({ source: symbol, target: p.symbol }));

    return NextResponse.json({
      nodes,
      links
    });
  } catch (err: any) {
    console.error("Error building correlation network:", err);
    return NextResponse.json({ nodes: [], links: [] });
  }
}
