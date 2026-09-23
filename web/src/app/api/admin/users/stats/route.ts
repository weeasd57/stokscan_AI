import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { requireAdmin } from "@/lib/admin-auth";
import { buildUserAnalytics } from "@/lib/admin/user-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const supabase = getSupabaseClient();
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [profilesRes, subscriptionsRes, botSubsRes, eventsRes, chatMessagesRes, chatSessionsRes] = await Promise.all([
      supabase.from("profiles").select("id,language,telegram_chat_id,notification_channel,created_at"),
      supabase.from("subscriptions").select("user_id,plan_id,status,current_period_end,created_at"),
      supabase.from("bot_subscriptions").select("service_type,notifications_enabled"),
      // This table is introduced by 20260923_user_activity_events. Missing it
      // must not break the existing users tab during a rolling deployment.
      supabase.from("user_activity_events").select("user_id,event_name,path,created_at").gte("created_at", ninetyDaysAgo).limit(100000),
      supabase.from("ai_chat_messages").select("user_id,role,created_at").gte("created_at", ninetyDaysAgo).limit(100000),
      supabase.from("ai_chat_sessions").select("id,user_id,created_at,updated_at").limit(100000),
    ]);

    if (profilesRes.error) return NextResponse.json({ detail: profilesRes.error.message }, { status: 500 });
    const allProfiles = profilesRes.data || [];
    const subscriptions = subscriptionsRes.data || [];
    const botSubs = botSubsRes.data || [];
    const events = eventsRes.error ? [] : (eventsRes.data || []);
    const chatMessages = chatMessagesRes.error ? [] : (chatMessagesRes.data || []);
    const chatSessions = chatSessionsRes.error ? [] : (chatSessionsRes.data || []);
    const analytics = buildUserAnalytics({
      profiles: allProfiles,
      subscriptions,
      events,
      chatMessages,
      chatSessions,
      now,
    });

    const newUsers30Days = allProfiles.filter((profile: any) => new Date(profile.created_at).getTime() >= now.getTime() - 30 * 24 * 60 * 60 * 1000).length;
    const newUsers7Days = allProfiles.filter((profile: any) => new Date(profile.created_at).getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000).length;
    const withTelegram = allProfiles.filter((profile: any) => String(profile.telegram_chat_id || "").trim()).length;
    const langMap: Record<string, number> = {};
    allProfiles.forEach((profile: any) => {
      const lang = String(profile.language || "en").toLowerCase();
      langMap[lang] = (langMap[lang] || 0) + 1;
    });

    const serviceMap: Record<string, number> = {
      stock_score: 0,
      historical_similarity: 0,
      technical_scanner: 0,
      ai_bot: 0,
    };
    botSubs.forEach((row: any) => {
      if (row.notifications_enabled && row.service_type) serviceMap[row.service_type] = (serviceMap[row.service_type] || 0) + 1;
    });

    let earliestTime = now.getTime();
    allProfiles.forEach((profile: any) => {
      const time = new Date(profile.created_at).getTime();
      if (Number.isFinite(time) && time < earliestTime) earliestTime = time;
    });
    const daysToLookBack = Math.max(Math.ceil((now.getTime() - earliestTime) / (1000 * 60 * 60 * 24)), 29);
    const signupsByDay: Record<string, number> = {};
    for (let i = daysToLookBack; i >= 0; i -= 1) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      signupsByDay[date] = 0;
    }
    allProfiles.forEach((profile: any) => {
      const date = new Date(profile.created_at).toISOString().split("T")[0];
      if (date in signupsByDay) signupsByDay[date] += 1;
    });

    const planMap = analytics.plans;
    return NextResponse.json({
      totalUsers: allProfiles.length,
      newUsers30Days,
      newUsers7Days,
      withTelegram,
      telegramRate: allProfiles.length ? Math.round((withTelegram / allProfiles.length) * 100) : 0,
      languages: langMap,
      plans: planMap,
      botServices: serviceMap,
      signupGrowth: Object.entries(signupsByDay).map(([date, count]) => ({ date: date.slice(5), count })),
      activeProUsers: analytics.activeProUsers,
      activeUsers30Days: analytics.activeUsers30Days,
      activeUsers7Days: analytics.activeUsers7Days,
      chatUsers30Days: analytics.chatUsers30Days,
      pageUsers30Days: analytics.pageUsers30Days,
      proActiveUsers30Days: analytics.proActiveUsers30Days,
      proChatUsers: analytics.proChatUsers,
      proPageUsers: analytics.proPageUsers,
      proChatOnlyUsers: analytics.proChatOnlyUsers,
      proPageOnlyUsers: analytics.proPageOnlyUsers,
      proChatRate: analytics.proChatRate,
      proPageRate: analytics.proPageRate,
      paidConversionRate: analytics.paidConversionRate,
      chatMessages: analytics.chatMessages,
      chatSessions: analytics.chatSessions,
      topPages: analytics.topPages,
      proTopPages: analytics.proTopPages,
      activityTelemetryAvailable: !eventsRes.error,
    });
  } catch (error) {
    console.error("[admin/users/stats] failed:", error);
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
