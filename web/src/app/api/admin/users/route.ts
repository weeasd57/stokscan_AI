import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 0);
    const page_size = Math.min(Number(url.searchParams.get("page_size") || 20), 100);
    const search = url.searchParams.get("search") || "";
    const offset = page * page_size;

    const supabase = getSupabaseClient();
    
    let query = supabase
      .from("profiles")
      .select("id, display_name, language, telegram_chat_id, created_at, updated_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + page_size - 1);

    if (search.trim()) {
      query = query.ilike("display_name", `%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      users: data || [], 
      total: count || 0 
    });
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}