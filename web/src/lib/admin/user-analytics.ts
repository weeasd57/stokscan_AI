export type AnalyticsProfile = { id: string; created_at?: string | null };
export type AnalyticsSubscription = { user_id: string; plan_id?: string | null; status?: string | null };
export type AnalyticsEvent = {
  user_id: string;
  event_name?: string | null;
  path?: string | null;
  created_at?: string | null;
};
export type AnalyticsChatMessage = { user_id: string; role?: string | null; created_at?: string | null };
export type AnalyticsChatSession = { id: string; user_id: string; created_at?: string | null; updated_at?: string | null };
export type TopPage = { path: string; views: number; users: number };

function validDate(value?: string | null): number {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function unique(values: Iterable<string>): Set<string> {
  return new Set(Array.from(values).filter(Boolean));
}

function topPages(events: AnalyticsEvent[], cohort: Set<string> | null): TopPage[] {
  const byPath = new Map<string, { views: number; users: Set<string> }>();
  for (const event of events) {
    if (event.event_name && event.event_name !== "page_view") continue;
    const path = String(event.path || "").trim();
    const userId = String(event.user_id || "").trim();
    if (!path || !userId || (cohort && !cohort.has(userId))) continue;
    const row = byPath.get(path) || { views: 0, users: new Set<string>() };
    row.views += 1;
    row.users.add(userId);
    byPath.set(path, row);
  }
  return Array.from(byPath.entries())
    .map(([path, row]) => ({ path, views: row.views, users: row.users.size }))
    .sort((a, b) => b.users - a.users || b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, 8);
}

export function buildUserAnalytics(input: {
  profiles: AnalyticsProfile[];
  subscriptions: AnalyticsSubscription[];
  events?: AnalyticsEvent[];
  chatMessages?: AnalyticsChatMessage[];
  chatSessions?: AnalyticsChatSession[];
  now?: Date;
}) {
  const now = input.now || new Date();
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const profiles = input.profiles || [];
  const profileIds = unique(profiles.map((profile) => String(profile.id)));
  const activeProIds = new Set([...unique(
    (input.subscriptions || [])
      .filter((sub) => String(sub.plan_id || "").toLowerCase() === "pro" && String(sub.status || "").toLowerCase() === "active")
      .map((sub) => String(sub.user_id))
  )].filter((id) => profileIds.has(id)));
  const pageEvents = (input.events || []).filter((event) => !event.event_name || event.event_name === "page_view");
  const userChatMessages = (input.chatMessages || []).filter((message) => !message.role || message.role === "user");
  const pageUsers30 = unique(pageEvents.filter((event) => validDate(event.created_at) >= thirtyDaysAgo).map((event) => String(event.user_id)));
  const chatUsers30 = unique(userChatMessages.filter((message) => validDate(message.created_at) >= thirtyDaysAgo).map((message) => String(message.user_id)));
  const activeUsers30 = new Set([...pageUsers30, ...chatUsers30]);
  const activeUsers7 = new Set([
    ...pageEvents.filter((event) => validDate(event.created_at) >= sevenDaysAgo).map((event) => String(event.user_id)),
    ...userChatMessages.filter((message) => validDate(message.created_at) >= sevenDaysAgo).map((message) => String(message.user_id)),
  ]);
  const pageUserIds = unique(pageEvents.map((event) => String(event.user_id)));
  const chatUserIds = unique(userChatMessages.map((message) => String(message.user_id)));
  const proPageUsers = new Set([...pageUserIds].filter((userId) => activeProIds.has(userId)));
  const proChatUsers = new Set([...chatUserIds].filter((userId) => activeProIds.has(userId)));
  const proActive30 = new Set([...activeUsers30].filter((userId) => activeProIds.has(userId)));
  const activePlanByUser = new Map<string, string>();
  for (const sub of input.subscriptions || []) {
    const plan = String(sub.plan_id || "").toLowerCase();
    const userId = String(sub.user_id || "");
    if (!plan || !userId || String(sub.status || "").toLowerCase() !== "active" || !profileIds.has(userId)) continue;
    activePlanByUser.set(userId, plan);
  }
  const plans: Record<string, number> = {};
  for (const userId of profileIds) {
    const plan = activePlanByUser.get(userId) || "free";
    plans[plan] = (plans[plan] || 0) + 1;
  }

  return {
    activeProUsers: activeProIds.size,
    activeUsers30Days: activeUsers30.size,
    activeUsers7Days: activeUsers7.size,
    chatUsers30Days: chatUsers30.size,
    pageUsers30Days: pageUsers30.size,
    proActiveUsers30Days: proActive30.size,
    proChatUsers: proChatUsers.size,
    proPageUsers: proPageUsers.size,
    proChatOnlyUsers: [...proChatUsers].filter((id) => !proPageUsers.has(id)).length,
    proPageOnlyUsers: [...proPageUsers].filter((id) => !proChatUsers.has(id)).length,
    proChatRate: activeProIds.size ? Math.round((proChatUsers.size / activeProIds.size) * 100) : 0,
    proPageRate: activeProIds.size ? Math.round((proPageUsers.size / activeProIds.size) * 100) : 0,
    paidConversionRate: profileIds.size ? Math.round((activeProIds.size / profileIds.size) * 100) : 0,
    plans,
    topPages: topPages(pageEvents, null),
    proTopPages: topPages(pageEvents, activeProIds),
    chatMessages: userChatMessages.length,
    chatSessions: (input.chatSessions || []).length,
  };
}

export function buildUserUsage(input: {
  events?: AnalyticsEvent[];
  chatMessages?: AnalyticsChatMessage[];
  chatSessions?: AnalyticsChatSession[];
  analytics?: { intent?: string | null; total_latency_ms?: number | null; created_at?: string | null }[];
}) {
  const events = input.events || [];
  const pages = topPages(events, null);
  const chatMessages = (input.chatMessages || []).filter((message) => !message.role || message.role === "user");
  const lastDates = [
    ...events.map((event) => event.created_at),
    ...input.chatMessages?.map((message) => message.created_at) || [],
  ].filter(Boolean).map((date) => new Date(date as string).getTime()).filter(Number.isFinite);
  const intents = new Map<string, number>();
  for (const row of input.analytics || []) {
    const intent = String(row.intent || "unknown");
    intents.set(intent, (intents.get(intent) || 0) + 1);
  }
  return {
    pageViews: events.filter((event) => !event.event_name || event.event_name === "page_view").length,
    uniquePages: pages.length,
    topPages: pages,
    chatMessages: chatMessages.length,
    chatSessions: (input.chatSessions || []).length,
    aiRequests: (input.analytics || []).length,
    topIntents: Array.from(intents.entries()).map(([intent, count]) => ({ intent, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    lastActiveAt: lastDates.length ? new Date(Math.max(...lastDates)).toISOString() : null,
  };
}
