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

export type PaymentOrderRow = {
  user_id: string;
  amount_egp: number;
  status: string;
  provider?: string;
  payment_review_status?: string;
  created_at: string;
};
export type KashierPaymentRow = {
  user_id: string;
  amount_paid: number;
  status: string;
  created_at: string;
};
export type PositionRow = {
  user_id: string;
  symbol: string;
  status: string;
};

export type PortfolioUserRow = {
  user_id: string;
  symbol: string;
  name?: string | null;
  quantity?: number | null;
  entry_price?: number | null;
  current_price?: number | null;
  entry_at?: string | null;
  status: string;
  updated_at?: string | null;
};

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

function cairoDayStart(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second),
  );
  const offset = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - offset;
}

function percentOfTotal(count: number, total: number): number {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

export function buildUserAnalytics(input: {
  profiles: AnalyticsProfile[];
  totalProfileCount?: number;
  subscriptions: AnalyticsSubscription[];
  events?: AnalyticsEvent[];
  chatMessages?: AnalyticsChatMessage[];
  chatSessions?: AnalyticsChatSession[];
  paymentOrders?: PaymentOrderRow[];
  kashierPayments?: KashierPaymentRow[];
  positions?: PositionRow[];
  emailDomains?: Record<string, number>;
  now?: Date;
}) {
  const now = input.now || new Date();
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const profiles = input.profiles || [];
  const profileIds = unique(profiles.map((profile) => String(profile.id)));
  const totalProfileCount = Math.max(profileIds.size, Number(input.totalProfileCount) || 0);
  const activeProIds = new Set([...unique(
    (input.subscriptions || [])
      .filter((sub) => String(sub.plan_id || "").toLowerCase() === "pro" && String(sub.status || "").toLowerCase() === "active")
      .map((sub) => String(sub.user_id))
  )].filter((id) => profileIds.has(id)));
  const pageEvents = (input.events || []).filter((event) => !event.event_name || event.event_name === "page_view");
  const userChatMessages = (input.chatMessages || []).filter((message) => !message.role || message.role === "user");
  const isCurrentActivity = (userId: string, createdAt?: string | null, since = 0) => {
    const time = validDate(createdAt);
    return profileIds.has(userId) && time > 0 && time >= since && time <= now.getTime();
  };
  const pageUsers30 = unique(pageEvents.filter((event) => isCurrentActivity(String(event.user_id || ""), event.created_at, thirtyDaysAgo)).map((event) => String(event.user_id)));
  const chatUsers30 = unique(userChatMessages.filter((message) => isCurrentActivity(String(message.user_id || ""), message.created_at, thirtyDaysAgo)).map((message) => String(message.user_id)));
  const activeUsers30 = new Set([...pageUsers30, ...chatUsers30]);
  const activeUsers7 = new Set([
    ...pageEvents.filter((event) => isCurrentActivity(String(event.user_id || ""), event.created_at, sevenDaysAgo)).map((event) => String(event.user_id)),
    ...userChatMessages.filter((message) => isCurrentActivity(String(message.user_id || ""), message.created_at, sevenDaysAgo)).map((message) => String(message.user_id)),
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

  // ── Revenue ──
  const successfulKashier = (input.kashierPayments || []).filter(
    (p) => String(p.status || "").toLowerCase() === "success"
  );
  const approvedLocal = (input.paymentOrders || []).filter(
    (p) => String(p.status || "").toLowerCase() === "approved"
  );
  const totalRevenue =
    successfulKashier.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0) +
    approvedLocal.reduce((sum, p) => sum + Number(p.amount_egp || 0), 0);
  const totalPaidOrders = successfulKashier.length + approvedLocal.length;
  const pendingOrders = (input.paymentOrders || []).filter(
    (p) => String(p.status || "").toLowerCase() === "pending"
  ).length;
  const rejectedOrders = (input.paymentOrders || []).filter(
    (p) => String(p.status || "").toLowerCase() === "rejected"
  ).length;
  const avgOrderValue = totalPaidOrders ? Math.round(totalRevenue / totalPaidOrders) : 0;

  const allOrders = [
    ...(input.paymentOrders || []).map((p) => ({
      user_id: p.user_id,
      amount_egp: Number(p.amount_egp || 0),
      status: p.status,
      provider: p.provider || "vodafone_cash",
      payment_review_status: p.payment_review_status,
      created_at: p.created_at,
    })),
    ...(input.kashierPayments || []).map((p) => ({
      user_id: p.user_id,
      amount_egp: Number(p.amount_paid || 0),
      status: p.status,
      provider: "kashier",
      payment_review_status: null,
      created_at: p.created_at,
    })),
  ]
    .sort((a, b) => validDate(b.created_at) - validDate(a.created_at))
    .slice(0, 10);

  // ── Portfolio ──
  const openPositions = (input.positions || []).filter(
    (p) => String(p.status || "").toLowerCase() === "open"
  );
  const portfolioUserIds = unique(openPositions.map((p) => p.user_id));
  const symbolCount = new Map<string, number>();
  for (const pos of openPositions) {
    const sym = String(pos.symbol || "").toUpperCase();
    if (sym) symbolCount.set(sym, (symbolCount.get(sym) || 0) + 1);
  }
  const topStocks = Array.from(symbolCount.entries())
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ── DAU (today) ──
  const todayStart = cairoDayStart(now);
  const dau = new Set([
    ...pageEvents.filter((e) => isCurrentActivity(String(e.user_id || ""), e.created_at, todayStart)).map((e) => String(e.user_id)),
    ...userChatMessages.filter((m) => isCurrentActivity(String(m.user_id || ""), m.created_at, todayStart)).map((m) => String(m.user_id)),
  ]).size;

  // ── Growth velocity ──
  const fourteenDaysAgo = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const newUsers14Days = profiles.filter((p) => validDate(p.created_at) >= fourteenDaysAgo).length;

  // ── Email domains ──
  const emailDomainList = Object.entries(input.emailDomains || {})
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    activeProUsers: activeProIds.size,
    activeUsers30Days: activeUsers30.size,
    activeUsers7Days: activeUsers7.size,
    activeUsers30DaysRate: percentOfTotal(activeUsers30.size, totalProfileCount),
    activeUsers7DaysRate: percentOfTotal(activeUsers7.size, totalProfileCount),
    chatUsers30Days: chatUsers30.size,
    pageUsers30Days: pageUsers30.size,
    proActiveUsers30Days: proActive30.size,
    proChatUsers: proChatUsers.size,
    proPageUsers: proPageUsers.size,
    proChatOnlyUsers: [...proChatUsers].filter((id) => !proPageUsers.has(id)).length,
    proPageOnlyUsers: [...proPageUsers].filter((id) => !proChatUsers.has(id)).length,
    proChatRate: activeProIds.size ? Math.round((proChatUsers.size / activeProIds.size) * 100) : 0,
    proPageRate: activeProIds.size ? Math.round((proPageUsers.size / activeProIds.size) * 100) : 0,
    paidConversionRate: totalProfileCount ? Math.round((activeProIds.size / totalProfileCount) * 100) : 0,
    plans,
    topPages: topPages(pageEvents, null),
    proTopPages: topPages(pageEvents, activeProIds),
    chatMessages: userChatMessages.length,
    chatSessions: (input.chatSessions || []).length,
    totalRevenue,
    totalPaidOrders,
    pendingOrders,
    rejectedOrders,
    avgOrderValue,
    recentOrders: allOrders,
    portfolioUsers: portfolioUserIds.size,
    totalOpenPositions: openPositions.length,
    topStocks,
    dau,
    dauRate: percentOfTotal(dau, totalProfileCount),
    newUsers14Days,
    retentionRate: totalProfileCount ? Math.round((activeUsers30.size / totalProfileCount) * 100) : 0,
    emailDomains: emailDomainList,
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
