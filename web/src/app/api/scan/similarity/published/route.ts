import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";

// ISR: revalidate every 5 minutes (Next.js built-in cache layer)
export const revalidate = 300;

export async function GET() {
  try {
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
        {
          headers: {
            // Cache empty response for 60s — don't hammer Supabase when table is empty
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          },
        }
      );
    }

    // Parse scans if stored as JSON string
    const scans = typeof data.scans === 'string' ? JSON.parse(data.scans) : (data.scans || []);

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
      {
        headers: {
          // Vercel CDN caches for 5 min, serves stale for up to 10 min while revalidating
          // Result: only 1 Supabase call per 5 minutes regardless of how many users hit this
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );

  } catch (error) {
    console.error('Similarity report API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


