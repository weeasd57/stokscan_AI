import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const incomingUrl = new URL(req.url);
    const country = incomingUrl.searchParams.get("country") || "Egypt";
    const limit = parseInt(incomingUrl.searchParams.get("limit") || "50");
    const minPrecision = parseFloat(incomingUrl.searchParams.get("min_precision") || "0.6");

    const body = await req.json().catch(() => ({}));

    const supabase = getSupabaseClient();

    // Get AI scan results from Supabase
    const { data: scanResults, error } = await supabase
      .from('scan_results')
      .select(`
        symbol,
        exchange,
        name,
        last_close,
        precision,
        signal,
        top_reasons,
        council_score,
        consensus_ratio
      `)
      .gte('precision', minPrecision)
      .order('precision', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('AI scan Supabase error:', error);
      return NextResponse.json({ error: 'Failed to perform AI scan' }, { status: 500 });
    }

    // Transform to expected format
    const results = scanResults?.map((scan: any) => ({
      symbol: scan.symbol,
      exchange: scan.exchange,
      name: scan.name || scan.symbol,
      last_close: toNumber(scan.last_close),
      precision: toNumber(scan.precision),
      signal: scan.signal || 'HOLD',
      confidence: toNumber(scan.precision) >= 0.8 ? 'High' : toNumber(scan.precision) >= 0.6 ? 'Medium' : 'Low',
      top_reasons: scan.top_reasons || [],
      council_score: toNumber(scan.council_score),
      consensus_ratio: scan.consensus_ratio
    })) || [];

    return NextResponse.json({
      results,
      scanned_count: results.length
    });

  } catch (error) {
    console.error('AI scan API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
