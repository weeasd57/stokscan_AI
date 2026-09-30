import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";
import { prepareSimilarityReport, calculateSimilarityStats, marketRegimeAt, sectorFlowAt, type SimilarityMatch } from "@/lib/historical-similarity";

export const runtime = "nodejs";
export const revalidate = 86400;

const PUBLIC_CACHE_HEADERS = dailyCacheHeaders(DAILY_CACHE_TAGS.market);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 0);
    const view = url.searchParams.get("view");
    const selectedSymbol = String(url.searchParams.get("symbol") || "").toUpperCase();

    const supabase = getSupabaseClient();

    // Select only needed columns — avoid pulling the full scans JSONB blob twice
    const { data, error } = await supabase
      .from('similarity_reports')
      .select('id, name, scans, k, forward_days, target_return, stop_loss, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Similarity report fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch similarity report' },
        { status: 500 }
      );
    }

    if (!data) {
      if (view === "summary" || selectedSymbol) {
        return NextResponse.json(prepareSimilarityReport({ scans: [] }), { headers: { "Cache-Control": "public, s-maxage=60" } });
      }
      return NextResponse.json(
        { scans: [], name: "No Active Similarity Report", updated_at: null },
        { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
      );
    }

    // Parse scans if stored as JSON string
    let scans = typeof data.scans === 'string' ? JSON.parse(data.scans) : (data.scans || []);

    if (view === "summary" || selectedSymbol) {
      const report = prepareSimilarityReport({ ...data, scans });
      // These are shared public market queries, never viewer entitlements.
      const [namesResult, marketResult] = await Promise.all([
        supabase.from("stock_fundamentals").select("symbol,data").eq("exchange", "EGX"),
        supabase.from("market_cache").select("payload").eq("cache_key", "market_status_Egypt").maybeSingle(),
      ]);
      const names = new Map<string, any>((namesResult.data || []).map((row: any) => [row.symbol, row.data || {}]));
      const market = typeof marketResult.data?.payload === "string" ? JSON.parse(marketResult.data.payload) : marketResult.data?.payload;
      const contextAt = (date: string): string | null => {
        const first = marketRegimeAt(market?.egx30 || [], date);
        const second = marketRegimeAt(market?.egx100 || [], date);
        return first && second ? (first === second ? first : "mixed") : null;
      };
      for (const scan of report.scans) {
        const identity = names.get(scan.symbol.split(".")[0]) || {};
        scan.name = identity.name_ar || identity.arabic_name || identity.name || identity.Name || scan.name;
        scan.sector = identity.sector || identity.Sector || "Other";
        scan.current_market = contextAt(scan.target_date);
      }
      if (view === "summary") {
        return NextResponse.json({ ...report, scans: report.scans.map(({ matches, target_path, ...summary }) => summary) }, { headers: PUBLIC_CACHE_HEADERS });
      }
      const scan = report.scans.find(row => row.symbol === selectedSymbol);
      if (!scan) return NextResponse.json({ error: "Symbol not in current report" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      // Query one sector only. Older cases with no heatmap record stay unknown.
      const { data: heatRows } = await supabase.from("market_heatmap")
        .select("symbol,cmf_20,captured_at").eq("exchange", "EGX").eq("sector", scan.sector)
        .order("captured_at", { ascending: false }).limit(5000);
      const captures = new Map<string, { date: string; cmf: number; captured: string }>();
      // A capped response may cut through the oldest day. Do not classify that partial sector sample.
      const truncatedDay = heatRows?.length === 5000 ? String(heatRows.at(-1)?.captured_at).slice(0, 10) : null;
      for (const row of heatRows || []) {
        if (row.cmf_20 == null || !Number.isFinite(Number(row.cmf_20))) continue;
        const date = String(row.captured_at).slice(0, 10), key = `${date}:${row.symbol}`;
        if (date === truncatedDay) continue;
        const existing = captures.get(key);
        if (!existing || row.captured_at > existing.captured) captures.set(key, { date, cmf: Number(row.cmf_20), captured: row.captured_at });
      }
      const byDay = new Map<string, number[]>();
      for (const row of captures.values()) byDay.set(row.date, [...(byDay.get(row.date) || []), row.cmf]);
      const sectorHistory = Array.from(byDay.entries()).map(([date, values]) => ({ date, cmf: values.reduce((a, b) => a + b, 0) / values.length }));
      scan.current_sector = sectorFlowAt(sectorHistory, scan.target_date);
      scan.matches = (scan.matches || []).map(match => ({ ...match, market_context: contextAt(match.date), sector_context: sectorFlowAt(sectorHistory, match.date) }));
      const sameContext = (match: SimilarityMatch) => Boolean(scan.current_market && scan.current_sector && match.market_context === scan.current_market && match.sector_context === scan.current_sector);
      scan.context_coverage = { observed: scan.matches.length, market: scan.matches.filter(m => m.market_context).length, sector: scan.matches.filter(m => m.sector_context).length, matched: scan.matches.filter(sameContext).length };
      if (url.searchParams.get("context") === "matched") {
        scan.matches = scan.matches.filter(sameContext);
        scan.stats = calculateSimilarityStats(scan.matches, report.forward_days, report.target_return, report.stop_loss);
      }
      return NextResponse.json({ ...report, scans: [scan] }, { headers: PUBLIC_CACHE_HEADERS });
    }

    if (requestedLimit > 0 && Array.isArray(scans)) {
      scans = scans.slice(0, requestedLimit);
    }

    return NextResponse.json(
      {
        id: data.id,
        name: data.name,
        scans,
        k: data.k,
        forward_days: data.forward_days,
        target_return: data.target_return,
        stop_loss: data.stop_loss,
        updated_at: data.updated_at,
      },
      { headers: PUBLIC_CACHE_HEADERS }
    );

  } catch (error) {
    console.error('Similarity report API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


