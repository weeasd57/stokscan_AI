import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("get_active_countries");

    if (error || !data) {
      console.warn("countries RPC failed, returning Egypt fallback:", error);
      return NextResponse.json({ countries: ["Egypt"] });
    }

    const countries = data.map((r: any) => r.country);
    return NextResponse.json({ countries });
  } catch (error) {
    console.error("countries route error:", error);
    return NextResponse.json({ countries: ["Egypt"] });
  }
}
