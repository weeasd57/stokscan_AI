import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id") || "";
    if (!sessionId) return NextResponse.json({ messages: [] });

    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("support_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    return NextResponse.json({ messages: data || [] });
  } catch (error) {
    console.error("support messages route error:", error);
    return NextResponse.json({ messages: [] });
  }
}
