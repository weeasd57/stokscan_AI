import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const auth = await requireAdmin(_req);
    if (auth instanceof Response) return auth;
    const supabase = getSupabaseClient();

    // Fetch all profiles to compute analytics
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, language, telegram_chat_id, notification_channel, created_at");

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }

    const allProfiles = profiles || [];
    const totalUsers = allProfiles.length;

    // Date calculations
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newUsers30Days = allProfiles.filter((p: any) => new Date(p.created_at) >= thirtyDaysAgo).length;
    const newUsers7Days = allProfiles.filter((p: any) => new Date(p.created_at) >= sevenDaysAgo).length;

    // Telegram & notification rates
    const withTelegram = allProfiles.filter((p: any) => p.telegram_chat_id && p.telegram_chat_id.trim() !== "").length;
    const telegramRate = totalUsers > 0 ? Math.round((withTelegram / totalUsers) * 100) : 0;

    // Language distribution
    const langMap: Record<string, number> = {};
    allProfiles.forEach((p: any) => {
      const lang = (p.language || "en").toLowerCase();
      langMap[lang] = (langMap[lang] || 0) + 1;
    });

    // Signups grouped by day for last 30 days (for growth chart)
    const signupsByDayMap: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStr = d.toISOString().split("T")[0];
      signupsByDayMap[dayStr] = 0;
    }

    allProfiles.forEach((p: any) => {
      const dayStr = new Date(p.created_at).toISOString().split("T")[0];
      if (signupsByDayMap[dayStr] !== undefined) {
        signupsByDayMap[dayStr] += 1;
      }
    });

    const signupGrowth = Object.entries(signupsByDayMap).map(([date, count]) => ({
      date: date.slice(5), // MM-DD
      count,
    }));

    // Bot subscriptions breakdown
    const { data: botSubs } = await supabase.from("bot_subscriptions").select("service_type, notifications_enabled");
    const serviceMap: Record<string, number> = {
      stock_score: 0,
      historical_similarity: 0,
      technical_scanner: 0,
      ai_bot: 0,
    };

    (botSubs || []).forEach((bs: any) => {
      if (bs.notifications_enabled && bs.service_type) {
        serviceMap[bs.service_type] = (serviceMap[bs.service_type] || 0) + 1;
      }
    });

    // Subscriptions (Plan distribution)
    const { data: subs } = await supabase.from("subscriptions").select("plan_id, status");
    const planMap: Record<string, number> = { free: totalUsers, pro: 0, enterprise: 0 };

    (subs || []).forEach((s: any) => {
      if (s.status === "active" && s.plan_id) {
        const plan = s.plan_id.toLowerCase();
        planMap[plan] = (planMap[plan] || 0) + 1;
        if (planMap["free"] > 0) planMap["free"] -= 1;
      }
    });

    return NextResponse.json({
      totalUsers,
      newUsers30Days,
      newUsers7Days,
      withTelegram,
      telegramRate,
      languages: langMap,
      plans: planMap,
      botServices: serviceMap,
      signupGrowth,
    });
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
