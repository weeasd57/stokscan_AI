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
    const snapshotAt = now.toISOString();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [profilesRes, subscriptionsRes, botSubsRes, eventsRes, chatMessagesRes, chatSessionsRes, paymentsRes, kashierRes, positionsRes] = await Promise.all([
      supabase.from("profiles").select("id,language,telegram_chat_id,notification_channel,created_at", { count: "exact" }).range(0, 999),
      supabase.from("subscriptions").select("user_id,plan_id,status,current_period_end,created_at"),
      supabase.from("bot_subscriptions").select("service_type,notifications_enabled"),
      supabase.from("user_activity_events").select("id,user_id,event_name,path,created_at", { count: "exact" }).gte("created_at", ninetyDaysAgo).lte("created_at", snapshotAt).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 999),
      supabase.from("ai_chat_messages").select("id,user_id,role,created_at", { count: "exact" }).gte("created_at", ninetyDaysAgo).lte("created_at", snapshotAt).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 999),
      supabase.from("ai_chat_sessions").select("id,user_id,created_at,updated_at").limit(100000),
      supabase.from("local_payment_orders").select("user_id,amount_egp,status,provider,payment_review_status,created_at").order("created_at", { ascending: false }).limit(500),
      supabase.from("kashier_payments").select("user_id,amount_paid,status,created_at").order("created_at", { ascending: false }).limit(500),
      supabase.from("positions").select("user_id,symbol,status").eq("status", "open").limit(10000),
    ]);

    if (profilesRes.error) return NextResponse.json({ detail: profilesRes.error.message }, { status: 500 });
    const allProfiles = profilesRes.data || [];
    const totalProfileCount = profilesRes.count ?? allProfiles.length;
    for (let offset = allProfiles.length; offset < totalProfileCount; offset += 1000) {
      const pageRes = await supabase
        .from("profiles")
        .select("id,language,telegram_chat_id,notification_channel,created_at")
        .range(offset, Math.min(offset + 999, totalProfileCount - 1));
      if (pageRes.error) return NextResponse.json({ detail: pageRes.error.message }, { status: 500 });
      allProfiles.push(...(pageRes.data || []));
    }
    const subscriptions = subscriptionsRes.data || [];
    const botSubs = botSubsRes.data || [];
    const events = eventsRes.error ? [] : [...(eventsRes.data || [])];
    const chatMessages = chatMessagesRes.error ? [] : [...(chatMessagesRes.data || [])];
    let eventsComplete = !eventsRes.error;
    let chatMessagesComplete = !chatMessagesRes.error;
    if (!eventsRes.error) {
      for (let offset = events.length; offset < (eventsRes.count ?? events.length); offset += 1000) {
        const pageRes = await supabase
          .from("user_activity_events")
          .select("id,user_id,event_name,path,created_at")
          .gte("created_at", ninetyDaysAgo)
          .lte("created_at", snapshotAt)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, Math.min(offset + 999, (eventsRes.count ?? events.length) - 1));
        if (pageRes.error) {
          eventsComplete = false;
          break;
        }
        events.push(...(pageRes.data || []));
      }
    }
    if (!chatMessagesRes.error) {
      for (let offset = chatMessages.length; offset < (chatMessagesRes.count ?? chatMessages.length); offset += 1000) {
        const pageRes = await supabase
          .from("ai_chat_messages")
          .select("id,user_id,role,created_at")
          .gte("created_at", ninetyDaysAgo)
          .lte("created_at", snapshotAt)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, Math.min(offset + 999, (chatMessagesRes.count ?? chatMessages.length) - 1));
        if (pageRes.error) {
          chatMessagesComplete = false;
          break;
        }
        chatMessages.push(...(pageRes.data || []));
      }
    }
    const chatSessions = chatSessionsRes.error ? [] : (chatSessionsRes.data || []);
    const paymentOrders = paymentsRes.error ? [] : (paymentsRes.data || []);
    const kashierPayments = kashierRes.error ? [] : (kashierRes.data || []);
    const positions = positionsRes.error ? [] : (positionsRes.data || []);

    let emailDomains: Record<string, number> = {};
    try {
      const authRes = await supabase.auth.admin.listUsers({ page: 1, perPage: 2000 });
      for (const user of authRes.data?.users || []) {
        const email = String(user.email || "");
        const atIdx = email.indexOf("@");
        if (atIdx > 0) {
          const domain = email.slice(atIdx + 1).toLowerCase();
          emailDomains[domain] = (emailDomains[domain] || 0) + 1;
        }
      }
    } catch { /* auth users unavailable */ }

    const analytics = buildUserAnalytics({
      profiles: allProfiles,
      totalProfileCount,
      subscriptions,
      events,
      chatMessages,
      chatSessions,
      paymentOrders,
      kashierPayments,
      positions,
      emailDomains,
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
      totalUsers: totalProfileCount,
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
      activeUsers30DaysRate: analytics.activeUsers30DaysRate,
      activeUsers7DaysRate: analytics.activeUsers7DaysRate,
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
      engagementDataComplete: eventsComplete && chatMessagesComplete,
      totalRevenue: analytics.totalRevenue,
      totalPaidOrders: analytics.totalPaidOrders,
      pendingOrders: analytics.pendingOrders,
      rejectedOrders: analytics.rejectedOrders,
      avgOrderValue: analytics.avgOrderValue,
      recentOrders: analytics.recentOrders,
      portfolioUsers: analytics.portfolioUsers,
      totalOpenPositions: analytics.totalOpenPositions,
      topStocks: analytics.topStocks,
      dau: analytics.dau,
      dauRate: analytics.dauRate,
      newUsers14Days: analytics.newUsers14Days,
      retentionRate: analytics.retentionRate,
      emailDomains: analytics.emailDomains,
    });
  } catch (error) {
    console.error("[admin/users/stats] failed:", error);
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
