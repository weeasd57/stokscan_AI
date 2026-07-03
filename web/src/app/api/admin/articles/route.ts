import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 0);
    const page_size = Math.min(Number(url.searchParams.get("page_size") || 10), 50);
    const search = url.searchParams.get("search") || "";
    const offset = page * page_size;

    const supabase = getSupabaseClient();
    let query = supabase
      .from("articles")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + page_size - 1);

    if (search.trim()) {
      query = query.or(`title_en.ilike.%${search}%,title_ar.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("admin articles error:", error);
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }
    return NextResponse.json({ data: data || [], total: count || 0, page, page_size });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("articles")
      .insert([{ ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
      .select()
      .single();
    if (error) return NextResponse.json({ detail: error.message }, { status: 400 });
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
