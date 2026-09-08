import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("reconciliation_conflicts")
      .select("*")
      .order("last_updated_at", { ascending: false });
    if (error) return NextResponse.json({ detail: error.message }, { status: 500 });
    return NextResponse.json({ read_only: true, conflicts: data || [] });
  } catch (error) {
    return NextResponse.json({ detail: String(error) }, { status: 500 });
  }
}
