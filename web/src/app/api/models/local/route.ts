import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from("model_metadata").select("*").order("created_at", { ascending: false });
    if (error) return NextResponse.json({ models: [] });
    return NextResponse.json({ models: data || [] });
  } catch (error) {
    console.error("Local models route error:", error);
    return NextResponse.json({ models: [] });
  }
}
