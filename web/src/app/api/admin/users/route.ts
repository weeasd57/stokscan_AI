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
      .select("*, subscriptions(*), bot_subscriptions(*)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + page_size - 1);

    if (search.trim()) {
      query = query.ilike("display_name", `%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      // Fallback if joined tables fail or RLS issues occur
      const fallbackQuery = supabase
        .from("profiles")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + page_size - 1);
      if (search.trim()) {
        fallbackQuery.ilike("display_name", `%${search}%`);
      }
      const fbRes = await fallbackQuery;
      return NextResponse.json({
        users: fbRes.data || [],
        total: fbRes.count || 0
      });
    }

    const formattedUsers = (data || []).map((u: any) => ({
      ...u,
      subscription: Array.isArray(u.subscriptions) ? u.subscriptions[0] || null : u.subscriptions || null,
      bot_subscriptions: Array.isArray(u.bot_subscriptions) ? u.bot_subscriptions : [],
      bot_count: Array.isArray(u.bot_subscriptions) ? u.bot_subscriptions.filter((b: any) => b.notifications_enabled).length : 0
    }));

    return NextResponse.json({ 
      users: formattedUsers, 
      total: count || 0 
    });
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}