import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 0);
    const page_size = Math.min(Number(url.searchParams.get("page_size") || 20), 100);
    const search = url.searchParams.get("search") || "";
    const offset = page * page_size;

    const supabase = getSupabaseClient();
    
    let query = supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, language, telegram_chat_id, notification_channel, default_target_pct, default_stop_pct, custom_ai_rules, created_at, updated_at, subscriptions(plan_id, status, current_period_end), bot_subscriptions(service_type, notifications_enabled)", { count: "exact" })
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
        .select("id, username, display_name, avatar_url, language, telegram_chat_id, notification_channel, default_target_pct, default_stop_pct, custom_ai_rules, created_at, updated_at", { count: "exact" })
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
