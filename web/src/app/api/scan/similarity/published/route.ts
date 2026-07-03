import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    // Get the latest similarity report
    const { data, error } = await supabase
      .from('similarity_reports')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Similarity report fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch similarity report' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ scans: [], name: "No Active Similarity Report", updated_at: null });
    }

    // Parse scans if they are a string
    const scans = typeof data.scans === 'string' ? JSON.parse(data.scans) : data.scans;

    return NextResponse.json({
      id: data.id,
      name: data.name,
      scans: scans || [],
      k: data.k,
      forward_days: data.forward_days,
      target_return: data.target_return,
      stop_loss: data.stop_loss,
      updated_at: data.updated_at
    });

  } catch (error) {
    console.error('Similarity report API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
