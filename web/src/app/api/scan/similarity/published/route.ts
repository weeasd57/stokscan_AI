import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";

export const runtime = "nodejs";
export const revalidate = 86400;

const PUBLIC_CACHE_HEADERS = dailyCacheHeaders(DAILY_CACHE_TAGS.market);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 0);

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
      return NextResponse.json(
        { scans: [], name: "No Active Similarity Report", updated_at: null },
        { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
      );
    }

    // Parse scans if stored as JSON string
    let scans = typeof data.scans === 'string' ? JSON.parse(data.scans) : (data.scans || []);

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


