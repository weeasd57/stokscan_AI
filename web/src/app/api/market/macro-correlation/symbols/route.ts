import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("stocks")
      .select("symbol")
      .eq("country", "Egypt");

    if (error) {
      throw error;
    }

    const symbols = Array.from(new Set((data || []).map((s: any) => s.symbol))).sort();

    if (symbols.length === 0) {
      // Fallback symbols if DB is empty
      return NextResponse.json({
        symbols: ["FWRY", "ABUK", "AMOC", "EAST", "SWDY", "HRHO", "CIEB", "MASR", "COSG", "ETEL"]
      });
    }

    return NextResponse.json({ symbols });
  } catch (error) {
    console.error("Error fetching macro-correlation symbols:", error);
    return NextResponse.json({
      symbols: ["FWRY", "ABUK", "AMOC", "EAST", "SWDY", "HRHO", "CIEB", "MASR", "COSG", "ETEL"]
    });
  }
}
