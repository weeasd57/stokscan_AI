import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.from("model_metadata").select("*").order("created_at", { ascending: false });
    return NextResponse.json(data || [], {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("ai_bot model_cards error:", error);
    return NextResponse.json([], { status: 200 });
  }
}
