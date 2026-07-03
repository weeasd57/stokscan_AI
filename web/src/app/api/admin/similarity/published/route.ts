import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("similarity_reports")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("admin similarity published error:", error);
      return NextResponse.json({ scans: [], name: "Error loading report" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ scans: [], name: "No Active Similarity Report", updated_at: null });
    }

    const scans = typeof data.scans === "string" ? JSON.parse(data.scans) : (data.scans || []);
    return NextResponse.json({
      id: data.id,
      name: data.name,
      scans,
      k: data.k,
      forward_days: data.forward_days,
      target_return: data.target_return,
      stop_loss: data.stop_loss,
      updated_at: data.updated_at,
    });
  } catch {
    return NextResponse.json({ scans: [], name: "Internal error" }, { status: 500 });
  }
}
