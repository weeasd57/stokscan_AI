"use client";

import { useState, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import {
    Users as UsersIcon,
    Search,
    RefreshCw,
    Trash2,
    Eye,
    Edit3,
    X,
    Save,
    ChevronLeft,
    ChevronRight,
    Bot,
    Crown,
    MessageSquare,
    Globe,
    Calendar,
    Shield,
    TrendingUp,
    Activity,
    UserPlus,
    BarChart3,
    PieChart,
    CheckCircle2,
    AlertCircle,
    SlidersHorizontal,
    ArrowUpRight,
    DollarSign,
    Clock,
    Target,
    Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

interface UserRow {
    id: string;
    email: string | null;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    language: string | null;
    telegram_chat_id: string | null;
    notification_channel: string | null;
    default_target_pct: number | string | null;
    default_stop_pct: number | string | null;
    custom_ai_rules: string | null;
    created_at: string;
    updated_at: string | null;
    subscription: { plan_id: string; status: string; current_period_end: string | null } | null;
    payment_review_status?: "pending_review" | "reviewed" | "rejected" | null;
    bot_subscriptions: { service_type: string; notifications_enabled: boolean }[];
    bot_count: number;
}

interface UserDetail {
    profile: Record<string, any>;
    subscription: Record<string, any> | null;
    bot_subscriptions: Record<string, any>[];
    open_positions: Record<string, any>[];
    recent_scans: Record<string, any>[];
    usage?: {
        pageTrackingAvailable?: boolean;
        pageViews: number;
        uniquePages: number;
        topPages: { path: string; views: number; users: number }[];
        chatMessages: number;
        chatSessions: number;
        aiRequests: number;
        topIntents: { intent: string; count: number }[];
        lastActiveAt: string | null;
    };
    payments?: {
        attempts: number;
        successful: number;
        totalPaid: number;
        currency: string;
        recent: Record<string, any>[];
    };
}

interface UserStats {
    totalUsers: number;
    newUsers30Days: number;
    newUsers7Days: number;
    withTelegram: number;
    telegramRate: number;
    languages: Record<string, number>;
    plans: Record<string, number>;
    botServices: Record<string, number>;
    signupGrowth: { date: string; count: number }[];
    activeProUsers: number;
    activeUsers30Days: number;
    activeUsers7Days: number;
    activeUsers30DaysRate: number;
    activeUsers7DaysRate: number;
    chatUsers30Days: number;
    pageUsers30Days: number;
    proActiveUsers30Days: number;
    proChatUsers: number;
    proPageUsers: number;
    proChatOnlyUsers: number;
    proPageOnlyUsers: number;
    proChatRate: number;
    proPageRate: number;
    paidConversionRate: number;
    chatMessages: number;
    chatSessions: number;
    topPages: { path: string; views: number; users: number }[];
    proTopPages: { path: string; views: number; users: number }[];
    activityTelemetryAvailable: boolean;
    engagementDataComplete: boolean;
    totalRevenue: number;
    totalPaidOrders: number;
    pendingOrders: number;
    rejectedOrders: number;
    avgOrderValue: number;
    recentOrders: { user_id: string; amount_egp: number; status: string; provider: string; payment_review_status: string | null; created_at: string }[];
    portfolioUsers: number;
    totalOpenPositions: number;
    topStocks: { symbol: string; count: number }[];
    dau: number;
    dauRate: number;
    newUsers14Days: number;
    retentionRate: number;
    emailDomains: { domain: string; count: number }[];
}

const SERVICE_LABELS: Record<string, string> = {
    stock_score: "Stocks Score",
    historical_similarity: "Similarity",
    technical_scanner: "Tech Scanner",
    ai_bot: "AI Bot",
};
const SERVICE_LABELS_AR: Record<string, string> = {
    stock_score: "تقييم الأسهم",
    historical_similarity: "التشابه التاريخي",
    technical_scanner: "الماسح الفني",
    ai_bot: "بوت الذكاء الاصطناعي",
};

export default function UsersTab() {
    const { language } = useLanguage();
    const isAr = language === "ar";
    const [users, setUsers] = useState<UserRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [pageSize] = useState(20);
    const [search, setSearch] = useState("");
    const [planFilter, setPlanFilter] = useState<string>("ALL");
    const [planMenuOpen, setPlanMenuOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    
    // Stats Dashboard State
    const [stats, setStats] = useState<UserStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(false);
    const [analyticsLoaded, setAnalyticsLoaded] = useState(false);

    // Modal States
    const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [subscriptionActionLoading, setSubscriptionActionLoading] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{
        display_name: string;
        language: string;
        telegram_chat_id: string;
        notification_channel: string | null;
        default_target_pct: string;
        default_stop_pct: string;
        custom_ai_rules: string;
    }>({
        display_name: "",
        language: "",
        telegram_chat_id: "",
        notification_channel: "",
        default_target_pct: "",
        default_stop_pct: "",
        custom_ai_rules: "",
    });

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/users?page=${page}&page_size=${pageSize}&plan=${planFilter}&search=${encodeURIComponent(search)}`);
            if (!res.ok) throw new Error("User list request failed");
            const data = await res.json();
            setUsers(data.users || []);
            setTotal(data.total || 0);
        } catch (e) {
            toast.error(isAr ? "تعذر تحميل قائمة المستخدمين" : "Failed to load users");
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, search, planFilter, isAr]);

    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const res = await fetch("/api/admin/users/stats");
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            } else {
                toast.error(isAr ? "تعذر تحميل التحليلات" : "Failed to load analytics");
            }
        } catch (e) {
            console.error("Failed to load user stats", e);
            toast.error(isAr ? "تعذر الاتصال لتحميل التحليلات" : "Unable to connect to load analytics");
        } finally {
            setStatsLoading(false);
        }
    }, [isAr]);

    useEffect(() => { 
        fetchUsers();
    }, [fetchUsers]);

    const loadAnalytics = useCallback(async () => {
        setAnalyticsLoaded(true);
        await fetchStats();
    }, [fetchStats]);

    const fetchDetail = async (userId: string) => {
        setDetailLoading(true);
        try {
            const res = await fetch(`/api/admin/users/${userId}`);
            const data = await res.json();
            // Ensure safe structure even if backend returns flat data
            if (data && !data.profile) {
                setSelectedUser({
                    profile: data,
                    subscription: null,
                    bot_subscriptions: [],
                    open_positions: [],
                    recent_scans: [],
                });
            } else {
                setSelectedUser(data);
            }
        } catch (e) {
            toast.error("Failed to load user detail");
        } finally {
            setDetailLoading(false);
        }
    };

    const startEdit = (user: UserRow) => {
        setEditingId(user.id);
        setEditForm({
            display_name: user.display_name || "",
            language: user.language || "en",
            telegram_chat_id: user.telegram_chat_id || "",
            notification_channel: user.notification_channel || "",
            default_target_pct: user.default_target_pct !== null && user.default_target_pct !== undefined ? String(user.default_target_pct) : "10.00",
            default_stop_pct: user.default_stop_pct !== null && user.default_stop_pct !== undefined ? String(user.default_stop_pct) : "3.50",
            custom_ai_rules: user.custom_ai_rules || "",
        });
    };

    const saveEdit = async () => {
        if (!editingId) return;
        try {
            const payload = {
                ...editForm,
                default_target_pct: editForm.default_target_pct ? parseFloat(editForm.default_target_pct) : 10.00,
                default_stop_pct: editForm.default_stop_pct ? parseFloat(editForm.default_stop_pct) : 3.50,
                custom_ai_rules: editForm.custom_ai_rules || null,
                telegram_chat_id: editForm.telegram_chat_id || null,
                notification_channel: editForm.notification_channel || null,
            };
            const res = await fetch(`/api/admin/users/${editingId}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error("Update failed");
            toast.success("User updated successfully");
            setEditingId(null);
            fetchUsers();
            if (selectedUser) fetchDetail(editingId);
        } catch (e) {
            toast.error("Failed to update user");
        }
    };

    const deleteUser = async (userId: string) => {
        if (!confirm("Are you sure? This will delete the user and all their data.")) return;
        try {
            const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Delete failed");
            toast.success("User deleted");
            setSelectedUser(null);
            fetchUsers();
            if (analyticsLoaded) fetchStats();
        } catch (e) {
            toast.error("Failed to delete user");
        }
    };

    const runSubscriptionAction = async (userId: string, action: "mark_payment_reviewed" | "cancel_subscription") => {
        if (action === "cancel_subscription" && !confirm(isAr ? "إلغاء اشتراك برو وسحب رابط وعضوية قناة VIP لهذا المستخدم؟" : "Cancel this user's Pro subscription and revoke their VIP channel link and membership?")) return;
        setSubscriptionActionLoading(true);
        try {
            const res = await fetch(`/api/admin/users/${userId}/subscription`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || "Subscription update failed");
            toast.success(action === "mark_payment_reviewed" ? "تمت مراجعة الدفع" : isAr ? "تم إلغاء برو وسحب رابط VIP" : "Pro cancelled and VIP link revoked");
            fetchUsers();
            if (selectedUser?.profile?.id === userId) fetchDetail(userId);
        } catch (error: any) { toast.error(error.message || "فشل تحديث الاشتراك"); }
        finally { setSubscriptionActionLoading(false); }
    };

    // Cohort filters are applied by the API so pagination and totals stay correct.
    const filteredUsers = users;

    const totalPages = Math.ceil(total / pageSize);



    return (
        <div dir={isAr ? "rtl" : "ltr"} className="p-4 md:p-6 space-y-6">
            {/* ─── SMART ANALYTICS DASHBOARD ─── */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)]">
                <div className="flex items-center justify-between gap-4 mb-6">
                    <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-3">
                        <BarChart3 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        {isAr ? "تحليلات المستخدمين والرؤى" : "USER ANALYTICS & INSIGHTS"}
                    </h2>
                    <button
                        onClick={() => { loadAnalytics(); fetchUsers(); }}
                        className="h-9 px-3 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 font-black text-xs uppercase tracking-wider hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${statsLoading ? "animate-spin" : ""}`} />
                        {analyticsLoaded ? (isAr ? "تحديث التحليلات" : "REFRESH ANALYTICS") : (isAr ? "تحميل التحليلات" : "LOAD ANALYTICS")}
                    </button>
                </div>

                {!analyticsLoaded ? (
                    <div className="mb-6 border-2 border-dashed border-zinc-400 p-4 text-sm text-zinc-500">
                        {isAr ? "لا تُحمّل التحليلات المتقدمة إلا عند الطلب لتجنب استعلامات كبيرة للمستخدمين والمحادثات والنشاط والمدفوعات في كل زيارة للأدمن." : "Advanced analytics is loaded only when requested to avoid large user, chat, activity, and payment queries on every Admin visit."}
                    </div>
                ) : <>
                {/* KPI Cards — Revenue · Pro · MAU · Growth */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
                    <div className="border-4 border-black dark:border-white bg-emerald-50 dark:bg-emerald-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">{isAr ? "إجمالي الإيرادات" : "Total Revenue"}</span>
                            <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : `${(stats?.totalRevenue || 0).toLocaleString()}`}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3" /> {isAr ? `ج.م · ${stats?.totalPaidOrders || 0} طلب مدفوع` : `EGP · ${stats?.totalPaidOrders || 0} paid orders`}
                        </div>
                    </div>

                    <div className="border-4 border-black dark:border-white bg-indigo-50 dark:bg-indigo-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">{isAr ? "مشتركو برو النشطون" : "Active Pro"}</span>
                            <Crown className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : stats?.activeProUsers || 0}
                        </div>
                        <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                            {stats?.paidConversionRate || 0}% {isAr ? "نسبة التحويل" : "conversion rate"}
                        </div>
                    </div>

                    <div className="border-4 border-black dark:border-white bg-blue-50 dark:bg-blue-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">{isAr ? "النشطون شهريًا" : "Monthly Active"}</span>
                            <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : `${stats && !stats.engagementDataComplete ? "≥ " : ""}${stats?.activeUsers30Days || 0}`}
                        </div>
                        <div className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mt-1">
                            {isAr ? `النشطون اليوم: ${stats && !stats.engagementDataComplete ? "≥ " : ""}${stats?.dau || 0} · النشطون شهريًا من الكل: ${stats && !stats.engagementDataComplete ? "≥ " : ""}${stats?.activeUsers30DaysRate || 0}%` : `DAU: ${stats && !stats.engagementDataComplete ? "≥ " : ""}${stats?.dau || 0} · MAU share: ${stats && !stats.engagementDataComplete ? "≥ " : ""}${stats?.activeUsers30DaysRate || 0}%`}
                        </div>
                    </div>

                    <div className="border-4 border-black dark:border-white bg-cyan-50 dark:bg-cyan-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">{isAr ? "النمو (30 يومًا)" : "Growth (30d)"}</span>
                            <UserPlus className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : `+${stats?.newUsers30Days || 0}`}
                        </div>
                        <div className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 mt-1">
                            {isAr ? `متوسط ${stats?.newUsers7Days ? Math.round(stats.newUsers7Days / 7) : 0} يوميًا · الإجمالي: ${stats?.totalUsers || 0}` : `~${stats?.newUsers7Days ? Math.round(stats.newUsers7Days / 7) : 0}/day (7d avg) · Total: ${stats?.totalUsers || 0}`}
                        </div>
                    </div>
                    <div className="border-4 border-black dark:border-white bg-violet-50 dark:bg-violet-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">{isAr ? "إجمالي المستخدمين" : "Total Users"}</span>
                            <UsersIcon className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : (stats?.totalUsers || 0).toLocaleString(isAr ? "ar-EG" : "en-US")}
                        </div>
                        <div className="text-[10px] font-bold text-violet-600 dark:text-violet-400 mt-1">{isAr ? "إجمالي الحسابات المسجلة" : "Registered accounts"}</div>
                    </div>
                </div>

                {/* Growth Chart */}
                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4 mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                            <Activity className="w-4 h-4 text-blue-500" />
                            {isAr ? "نمو تسجيل المستخدمين (كل الفترات)" : "USER REGISTRATION TREND (ALL TIME)"}
                        </h3>
                        <span className="text-[10px] font-bold font-mono text-zinc-400">{isAr ? "التسجيلات اليومية" : "DAILY SIGNUPS"}</span>
                    </div>
                    {statsLoading ? (
                        <div className="h-44 flex items-center justify-center text-xs font-bold text-zinc-400">Loading chart...</div>
                    ) : (
                        <div className="h-44 w-full pt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={stats?.signupGrowth || []} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#52525b" opacity={0.2} />
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#71717a' }} minTickGap={15} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#71717a' }} allowDecimals={false} />
                                    <RechartsTooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #fff', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#a1a1aa', marginBottom: '4px' }} cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '3 3' }} />
                                    <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" activeDot={{ r: 5, strokeWidth: 0, fill: '#fff' }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                {/* Revenue & Payments + Activity & Engagement */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {/* Revenue & Payments */}
                    <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                        <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2 mb-3">
                            <DollarSign className="w-4 h-4 text-emerald-500" /> {isAr ? "الإيرادات والمدفوعات" : "REVENUE & PAYMENTS"}
                        </h3>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            {[
                                [isAr ? "إجمالي الإيرادات" : "Total Revenue", `${(stats?.totalRevenue || 0).toLocaleString(isAr ? "ar-EG" : "en-US")} ${isAr ? "ج.م" : "EGP"}`],
                                [isAr ? "الطلبات المدفوعة" : "Paid Orders", stats?.totalPaidOrders || 0],
                                [isAr ? "متوسط الطلب" : "Avg Order", `${stats?.avgOrderValue || 0} ${isAr ? "ج.م" : "EGP"}`],
                                [isAr ? "بانتظار المراجعة" : "Pending Review", stats?.pendingOrders || 0],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 p-2">
                                    <div className="text-[9px] font-black text-zinc-500 uppercase">{label}</div>
                                    <div className="font-black font-mono mt-1">{statsLoading ? "..." : value}</div>
                                </div>
                            ))}
                        </div>
                        {stats?.recentOrders?.length ? (
                            <div>
                                <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">{isAr ? "أحدث الطلبات" : "Recent Orders"}</div>
                                <div className="space-y-1">
                                    {stats.recentOrders.slice(0, 6).map((o, i) => (
                                        <div key={i} className="flex items-center justify-between text-[11px] font-mono bg-white dark:bg-zinc-950 px-2 py-1 border border-zinc-200 dark:border-zinc-800">
                                            <span className="font-bold text-black dark:text-white">{o.amount_egp} EGP</span>
                                            <span className={`font-black text-[9px] px-1.5 py-0.5 border ${o.status === "approved" || o.status === "success" ? "bg-green-100 text-green-700 border-green-400" : o.status === "pending" ? "bg-amber-100 text-amber-700 border-amber-400" : "bg-red-100 text-red-700 border-red-400"}`}>
                                                {o.status}
                                            </span>
                                            <span className="text-zinc-400">{new Date(o.created_at).toLocaleDateString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <div className="text-xs font-bold text-zinc-400">{isAr ? "لا توجد طلبات دفع بعد." : "No payment orders yet."}</div>}
                        {stats?.rejectedOrders ? <div className="mt-2 text-[10px] font-black text-red-500">{stats.rejectedOrders} {isAr ? "طلب مرفوض" : "rejected order(s)"}</div> : null}
                    </div>

                    {/* Activity & Engagement */}
                    <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                        <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2 mb-3">
                            <Zap className="w-4 h-4 text-amber-500" /> {isAr ? "النشاط والتفاعل" : "ACTIVITY & ENGAGEMENT"}
                        </h3>
                        <p className="mb-3 text-[10px] font-bold text-zinc-500">
                            {isAr ? "النشط = مستخدم مسجل فتح صفحة أو أرسل رسالة للشات. الفترات متحركة، واليوم حسب توقيت القاهرة." : "Active means a registered user viewed a page or sent a chat message. MAU/WAU are rolling windows; DAU follows Cairo time."}
                        </p>
                        {stats && !stats.engagementDataComplete && (
                            <div className="mb-3 border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                                {isAr ? "تنبيه: تعذر تحميل مصدر واحد للنشاط على الأقل؛ أرقام MAU/WAU/DAU المعروضة جزئية وقد تكون أقل من الحقيقة." : "Warning: at least one activity source could not be loaded; MAU/WAU/DAU are partial and may be understated."}
                            </div>
                        )}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            {[
                                ["MAU", stats?.activeUsers30Days || 0, stats?.activeUsers30DaysRate || 0, isAr ? "آخر 30 يومًا" : "Last 30 days"],
                                ["WAU", stats?.activeUsers7Days || 0, stats?.activeUsers7DaysRate || 0, isAr ? "آخر 7 أيام" : "Last 7 days"],
                                ["DAU", stats?.dau || 0, stats?.dauRate || 0, isAr ? "اليوم — القاهرة" : "Today — Cairo"],
                            ].map(([label, value, rate, sub]) => (
                                <div key={String(label)} className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 p-2 text-center">
                                    <div className="text-[9px] font-black text-zinc-500 uppercase">{label}</div>
                                    <div className="text-xl font-black font-mono mt-1">{statsLoading ? "..." : `${stats && !stats.engagementDataComplete ? "≥ " : ""}${Number(value).toLocaleString(isAr ? "ar-EG" : "en-US")}`}</div>
                                    <div className="text-[10px] font-black text-emerald-600 dark:text-emerald-400">{statsLoading ? "..." : `${stats && !stats.engagementDataComplete ? "≥ " : ""}${Number(rate)}%`}</div>
                                    <div className="text-[9px] font-bold text-zinc-400">{String(sub)}</div>
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            {[
                                [isAr ? "مستخدمو الشات (30 يومًا)" : "Chat Users (30d)", stats?.chatUsers30Days || 0],
                                [isAr ? "جلسات الشات" : "Chat Sessions", stats?.chatSessions || 0],
                                [isAr ? "رسائل المستخدمين" : "User Messages", stats?.chatMessages || 0],
                                [isAr ? "نشطون شهريًا من إجمالي المستخدمين" : "Monthly active share of all users", `${stats && !stats.engagementDataComplete ? "≥ " : ""}${stats?.activeUsers30DaysRate || 0}%`],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 p-2">
                                    <div className="text-[9px] font-black text-zinc-500 uppercase">{label}</div>
                                    <div className="font-black font-mono mt-1">{statsLoading ? "..." : value}</div>
                                </div>
                            ))}
                        </div>
                        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                            {isAr ? `تيليجرام: ${stats?.withTelegram || 0} (${stats?.telegramRate || 0}%) · اشتراكات الخدمات: ${Object.values(stats?.botServices || {}).reduce((a, b) => a + b, 0)}` : `Telegram: ${stats?.withTelegram || 0} (${stats?.telegramRate || 0}%) · Bot services: ${Object.values(stats?.botServices || {}).reduce((a, b) => a + b, 0)}`}
                        </div>
                    </div>
                </div>

                {/* Portfolio & Top Stocks + Email Demographics */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {/* Portfolio & Top Stocks */}
                    <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                        <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2 mb-3">
                            <TrendingUp className="w-4 h-4 text-emerald-500" /> {isAr ? "المحافظ والأسهم الأكثر امتلاكًا" : "PORTFOLIO & TOP STOCKS"}
                        </h3>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            <div className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 p-2">
                                <div className="text-[9px] font-black text-zinc-500 uppercase">{isAr ? "مستخدمو المحافظ" : "Portfolio Users"}</div>
                                <div className="text-xl font-black font-mono mt-1">{statsLoading ? "..." : stats?.portfolioUsers || 0}</div>
                            </div>
                            <div className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 p-2">
                                <div className="text-[9px] font-black text-zinc-500 uppercase">{isAr ? "المراكز المفتوحة" : "Open Positions"}</div>
                                <div className="text-xl font-black font-mono mt-1">{statsLoading ? "..." : stats?.totalOpenPositions || 0}</div>
                            </div>
                        </div>
                        {stats?.topStocks?.length ? (
                            <div>
                                <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">{isAr ? "الأسهم الأكثر امتلاكًا" : "Most Held Stocks"}</div>
                                <div className="space-y-1">
                                    {stats.topStocks.slice(0, 8).map((s, i) => (
                                        <div key={s.symbol} className="flex items-center justify-between text-[11px] font-mono bg-white dark:bg-zinc-950 px-2 py-1 border border-zinc-200 dark:border-zinc-800">
                                            <span className="font-black text-black dark:text-white">#{i + 1}</span>
                                            <span className="font-bold flex-1 ml-2">{s.symbol}</span>
                                            <span className="font-black px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-400">{s.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <div className="text-xs font-bold text-zinc-400">{isAr ? "لا توجد مراكز بالمحافظ بعد." : "No portfolio positions yet."}</div>}
                    </div>

                    {/* Email Domains & Demographics */}
                    <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                        <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2 mb-3">
                            <Globe className="w-4 h-4 text-cyan-500" /> {isAr ? "نطاقات البريد وخصائص المستخدمين" : "EMAIL DOMAINS & DEMOGRAPHICS"}
                        </h3>
                        {/* Languages */}
                        <div className="mb-3">
                            <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">{isAr ? "اللغات" : "Languages"}</div>
                            <div className="flex items-center gap-2 font-mono text-xs">
                                <div className="flex-1 bg-white dark:bg-zinc-950 p-2 border-2 border-black dark:border-white flex justify-between">
                                    <span className="font-bold">EN</span>
                                    <span className="font-black">{stats?.languages?.en || 0}</span>
                                </div>
                                <div className="flex-1 bg-white dark:bg-zinc-950 p-2 border-2 border-black dark:border-white flex justify-between">
                                    <span className="font-bold">AR</span>
                                    <span className="font-black">{stats?.languages?.ar || 0}</span>
                                </div>
                            </div>
                        </div>
                        {/* Email Domains */}
                        {stats?.emailDomains?.length ? (
                            <div>
                                <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">{isAr ? "أكثر نطاقات البريد" : "Top Email Domains"}</div>
                                <div className="space-y-1 font-mono text-[11px]">
                                    {stats.emailDomains.map((d) => (
                                        <div key={d.domain} className="flex justify-between items-center bg-white dark:bg-zinc-950 px-2 py-1 border border-zinc-200 dark:border-zinc-800">
                                            <span className="text-zinc-600 dark:text-zinc-300 font-bold">{d.domain}</span>
                                            <span className="font-black px-1.5 py-0.5 bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-400">{d.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <div className="text-xs font-bold text-zinc-400">{isAr ? "بيانات البريد غير متاحة." : "Email data unavailable."}</div>}
                        {/* Bot Services */}
                        <div className="mt-3">
                            <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">{isAr ? "اشتراكات خدمات البوت" : "Bot Service Subscriptions"}</div>
                            <div className="space-y-1 font-mono text-[11px]">
                                {Object.entries(stats?.botServices || {}).map(([key, count]) => (
                                    <div key={key} className="flex justify-between items-center bg-white dark:bg-zinc-950 px-2 py-1 border border-zinc-200 dark:border-zinc-800">
                                        <span className="text-zinc-600 dark:text-zinc-300 font-bold">{(isAr ? SERVICE_LABELS_AR[key] : SERVICE_LABELS[key]) || key}</span>
                                        <span className="font-black px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-400">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Pro Cohort & Product Usage */}
                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4 mb-2">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                            <Crown className="w-4 h-4 text-indigo-500" /> {isAr ? "مشتركو برو واستخدام المنتجات" : "PRO COHORT & PRODUCT USAGE"}
                        </h3>
                        {stats && !stats.activityTelemetryAvailable && <span className="text-[10px] font-black text-amber-600 border-2 border-amber-500 px-2 py-1">{isAr ? "تتبع الصفحات يبدأ بعد إعداد جدول النشاط" : "PAGE TRACKING STARTS AFTER MIGRATION"}</span>}
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                        {[
                            [isAr ? "مشتركو برو النشطون" : "Active Pro", stats?.activeProUsers || 0, isAr ? "مستخدم" : "users"],
                            [isAr ? "مشتركو برو مستخدمو الشات" : "Pro using chat", `${stats?.proChatUsers || 0} (${stats?.proChatRate || 0}%)`, isAr ? "من مشتركي برو النشطين" : "of active Pro"],
                            [isAr ? "مشتركو برو مستخدمو الصفحات" : "Pro using pages", `${stats?.proPageUsers || 0} (${stats?.proPageRate || 0}%)`, isAr ? "من المستخدمين المتتبَّعين" : "tracked users"],
                            [isAr ? "التحويل إلى الاشتراك المدفوع" : "Paid conversion", `${stats?.paidConversionRate || 0}%`, isAr ? "من المسجلين إلى برو" : "registered → Pro"],
                        ].map(([label, value, hint]) => (
                            <div key={String(label)} className="border-4 border-black dark:border-white bg-indigo-50 dark:bg-indigo-950/30 p-3">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
                                <div className="text-2xl font-black font-mono mt-1">{statsLoading ? "..." : value}</div>
                                <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300 mt-1">{hint}</div>
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-zinc-950 border-2 border-black dark:border-white p-3">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="font-black text-[10px] uppercase tracking-widest flex items-center gap-1"><Globe className="w-3 h-3 text-cyan-500" /> {isAr ? "أكثر الصفحات — الجميع" : "TOP PAGES — ALL"}</h4>
                                <span className="text-[10px] font-bold text-zinc-500">{stats?.pageUsers30Days || 0} {isAr ? "مستخدم" : "users"}</span>
                            </div>
                            <div className="space-y-1">
                                {(stats?.topPages || []).slice(0, 5).map((row) => <div key={row.path} className="flex items-center justify-between gap-2 text-[11px] font-mono border-b border-zinc-200 dark:border-zinc-800 pb-1"><span className="font-bold truncate">{row.path}</span><span className="text-zinc-500 shrink-0">{row.users}u · {row.views}v</span></div>)}
                                {!stats?.topPages?.length && <div className="text-[10px] font-bold text-zinc-400">{isAr ? "لا توجد أحداث." : "No events."}</div>}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-950 border-2 border-black dark:border-white p-3">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="font-black text-[10px] uppercase tracking-widest flex items-center gap-1"><Crown className="w-3 h-3 text-indigo-500" /> {isAr ? "أكثر الصفحات — برو" : "TOP PAGES — PRO"}</h4>
                                <span className="text-[10px] font-bold text-zinc-500">{isAr ? `الشات فقط: ${stats?.proChatOnlyUsers || 0}` : `Chat-only: ${stats?.proChatOnlyUsers || 0}`}</span>
                            </div>
                            <div className="space-y-1">
                                {(stats?.proTopPages || []).slice(0, 5).map((row) => <div key={row.path} className="flex items-center justify-between gap-2 text-[11px] font-mono border-b border-zinc-200 dark:border-zinc-800 pb-1"><span className="font-bold truncate">{row.path}</span><span className="text-zinc-500 shrink-0">{row.users}u · {row.views}v</span></div>)}
                                {!stats?.proTopPages?.length && <div className="text-[10px] font-bold text-zinc-400">{isAr ? "لا توجد أحداث لمشتركي برو." : "No Pro events."}</div>}
                            </div>
                        </div>
                    </div>
                </div>
                </>}
            </div>

            {/* ─── USER MANAGEMENT TABLE ─── */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)]">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-3">
                        <UsersIcon className="w-6 h-6" />
                        {isAr ? "قائمة المستخدمين" : "USER DIRECTORY"}
                    </h2>

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Search Bar */}
                        <div className="relative">
                            <Search className={`absolute ${isAr ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400`} />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                                placeholder={isAr ? "ابحث باسم المستخدم أو البريد..." : "Search users by name..."}
                                className={`h-10 ${isAr ? "pr-9 pl-4" : "pl-9 pr-4"} w-60 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500`}
                            />
                        </div>

                        {/* Filter Pill Dropdown */}
                         <div className="relative flex items-center border-4 border-black dark:border-white bg-white dark:bg-zinc-900">
                             <SlidersHorizontal className="w-4 h-4 ml-2 text-zinc-400" />
                             <button type="button" onClick={() => setPlanMenuOpen((open) => !open)} className="h-9 min-w-[155px] px-3 flex items-center justify-between gap-3 text-start text-black dark:text-white font-black text-xs uppercase tracking-wider focus:outline-none">
                                 <span>{(isAr ? { ALL: "كل المستخدمين", PRO: "مشتركو برو", FREE: "الخطة المجانية", TELEGRAM: "مرتبطون بتليجرام" } : { ALL: "All Users", PRO: "PRO Plan Only", FREE: "Free Plan Only", TELEGRAM: "Telegram Linked" })[planFilter]}</span>
                                 <span className="text-zinc-400">▾</span>
                             </button>
                             {planMenuOpen && <div className="absolute z-50 top-full inset-x-0 mt-1 border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                                 {["ALL", "PRO", "FREE", "TELEGRAM"].map((value) => {
                                     const labels: Record<string, string> = isAr ? { ALL: "كل المستخدمين", PRO: "مشتركو برو", FREE: "الخطة المجانية", TELEGRAM: "مرتبطون بتليجرام" } : { ALL: "All Users", PRO: "PRO Plan Only", FREE: "Free Plan Only", TELEGRAM: "Telegram Linked" };
                                     return <button key={value} type="button" onClick={() => { setPlanFilter(value); setPage(0); setPlanMenuOpen(false); }} className={`block w-full px-3 py-2 text-start text-xs font-black uppercase tracking-wider ${planFilter === value ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-950 text-black dark:text-white hover:bg-blue-100 dark:hover:bg-blue-950"}`}>{labels[value]}</button>;
                                 })}
                             </div>}
                         </div>

                        <button
                            onClick={fetchUsers}
                            className="h-10 px-4 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 font-black text-xs uppercase tracking-wider hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            {isAr ? "تحديث القائمة" : "REFRESH TABLE"}
                        </button>
                    </div>
                </div>

                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-3">
                    {isAr ? `عرض ${filteredUsers.length} من ${total} مستخدم • الصفحة ${page + 1} من ${totalPages || 1}` : `Showing ${filteredUsers.length} of ${total} users • Page ${page + 1} of ${totalPages || 1}`}
                </div>

                {loading && !users.length ? (
                    <div className="flex items-center justify-center h-40 text-zinc-400 font-bold uppercase tracking-widest">
                        <RefreshCw className="w-5 h-5 animate-spin mr-3" />
                        {isAr ? "جارٍ تحميل المستخدمين..." : "Loading user directory..."}
                    </div>
                ) : !filteredUsers.length ? (
                    <div className="flex items-center justify-center h-40 text-zinc-400 font-bold uppercase tracking-widest">
                        {isAr ? "لا يوجد مستخدمون مطابقون" : "No matching users found"}
                    </div>
                ) : (
                    <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-xs font-mono">
                            <thead>
                                <tr className="border-b-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900">
                                    <th className="px-3 py-3 text-start uppercase tracking-widest font-black">{isAr ? "المستخدم" : "User"}</th>
                                    <th className="px-3 py-3 text-start uppercase tracking-widest font-black">{isAr ? "الخطة" : "Plan"}</th>
                                    <th className="px-3 py-3 text-start uppercase tracking-widest font-black">{isAr ? "البوتات" : "Bots"}</th>
                                    <th className="px-3 py-3 text-start uppercase tracking-widest font-black">{isAr ? "اللغة" : "Language"}</th>
                                    <th className="px-3 py-3 text-start uppercase tracking-widest font-black">{isAr ? "تليجرام" : "Telegram"}</th>
                                    <th className="px-3 py-3 text-start uppercase tracking-widest font-black">{isAr ? "تاريخ التسجيل" : "Joined"}</th>
                                    <th className="px-3 py-3 text-center uppercase tracking-widest font-black">{isAr ? "إجراءات" : "Actions"}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((u) => (
                                    <tr
                                        key={u.id}
                                        className="border-b-2 border-zinc-200 dark:border-zinc-800 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors cursor-pointer"
                                        onClick={() => fetchDetail(u.id)}
                                    >
                                     <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-2.5">
                                                {u.avatar_url ? (
                                                    <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full border-2 border-black dark:border-white object-cover" />
                                                ) : (
                                                    <div className="w-7 h-7 rounded-full border-2 border-black dark:border-white bg-blue-100 dark:bg-blue-900 flex items-center justify-center font-black text-[11px] text-blue-700 dark:text-blue-300">
                                                        {(u.display_name || u.username || "?")[0].toUpperCase()}
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="font-bold text-black dark:text-white text-xs">{u.display_name || u.username || "—"}</div>
                                                    <div className="text-[10px] text-blue-600 dark:text-blue-400 truncate max-w-[180px]">{u.email || u.username || "—"}</div>
                                                    <div className="text-[10px] text-zinc-400 truncate max-w-[120px]">{u.id.slice(0, 8)}...</div>
                                                </div>
                                            </div>
                                         </td>
                                         <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                             {u.subscription?.plan_id === "pro" && u.subscription?.status === "active" ? (
                                                 <button onClick={() => runSubscriptionAction(u.id, "cancel_subscription")} disabled={subscriptionActionLoading} className="border-2 border-red-500 bg-red-50 px-2 py-1 text-[10px] font-black text-red-700 hover:bg-red-500 hover:text-white disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300">{isAr ? "إلغاء برو" : "Cancel Pro"}</button>
                                             ) : <span className="text-zinc-400 font-bold">{isAr ? "مجاني" : "Free"}</span>}
                                         </td>
                                        <td className="px-3 py-2.5">
                                            {u.subscription?.plan_id ? (
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 border-2 border-black dark:border-white font-black text-[10px] uppercase tracking-wider ${u.subscription.plan_id === "pro" ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"}`}>
                                                    <Crown className="w-3 h-3" />
                                                {isAr ? (u.subscription.plan_id.toLowerCase() === "pro" ? "برو" : u.subscription.plan_id.toLowerCase() === "free" ? "مجاني" : u.subscription.plan_id) : u.subscription.plan_id}
                                                </span>
                                            ) : (
                                                <span className="text-zinc-400 font-bold">{isAr ? "مجاني" : "Free"}</span>
                                            )}
                                            {u.payment_review_status === "pending_review" && <span className="ml-1 inline-flex items-center gap-1 border border-amber-500 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"><AlertCircle className="w-3 h-3" /> مراجعة</span>}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-1.5">
                                                <Bot className="w-3.5 h-3.5 text-amber-500" />
                                                <span className="font-black">{u.bot_count || (u.bot_subscriptions || []).length}</span>
                                                {(u.bot_subscriptions || []).slice(0, 2).map((b, i) => (
                                                    <span key={i} className="text-[9px] font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-1 border border-zinc-300 dark:border-zinc-700">
                                                        {(isAr ? SERVICE_LABELS_AR[b.service_type] : SERVICE_LABELS[b.service_type]) || b.service_type}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className="inline-flex items-center gap-1 font-bold text-zinc-600 dark:text-zinc-300">
                                                <Globe className="w-3 h-3 text-zinc-400" />
                                                {(u.language || "en").toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            {u.telegram_chat_id ? (
                                                <span className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 font-bold">
                                                    <MessageSquare className="w-3 h-3" />
                                                    {u.telegram_chat_id.slice(0, 10)}...
                                                </span>
                                            ) : (
                                                <span className="text-zinc-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className="inline-flex items-center gap-1 text-zinc-500 font-bold">
                                                <Calendar className="w-3 h-3" />
                                                {new Date(u.created_at).toLocaleDateString()}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); fetchDetail(u.id); }}
                                                    className="p-1.5 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                                                    title={isAr ? "عرض التفاصيل" : "View Detail"}
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEdit(u); }}
                                                    className="p-1.5 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors"
                                                    title={isAr ? "تعديل المستخدم" : "Edit User"}
                                                >
                                                    <Edit3 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteUser(u.id); }}
                                                    className="p-1.5 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                                    title={isAr ? "حذف المستخدم" : "Delete User"}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t-2 border-zinc-200 dark:border-zinc-800">
                        <button
                            onClick={() => setPage(Math.max(0, page - 1))}
                            disabled={page === 0}
                            className="h-8 px-3 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 font-black text-xs uppercase tracking-wider disabled:opacity-30 flex items-center gap-1 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                        >
                            <ChevronLeft className="w-4 h-4" /> {isAr ? "السابق" : "Prev"}
                        </button>
                        <span className="text-xs font-bold font-mono text-zinc-500">
                            {isAr ? `الصفحة ${page + 1} من ${totalPages}` : `Page ${page + 1} of ${totalPages}`}
                        </span>
                        <button
                            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                            disabled={page >= totalPages - 1}
                            className="h-8 px-3 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 font-black text-xs uppercase tracking-wider disabled:opacity-30 flex items-center gap-1 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                        >
                            {isAr ? "التالي" : "Next"} <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>

            {/* ─── EDIT USER MODAL ─── */}
            {editingId && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-4">
                    <div className="bg-white dark:bg-zinc-950 border-4 border-black dark:border-white rounded-none shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-4 py-3 border-b-4 border-black dark:border-white bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-between shrink-0">
                            <span className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                <Edit3 className="w-4 h-4" /> EDIT USER CONFIGURATION
                            </span>
                            <button onClick={() => setEditingId(null)} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-4 space-y-4 overflow-y-auto flex-1">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Display Name</label>
                                    <input
                                        type="text"
                                        value={editForm.display_name}
                                        onChange={(e) => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                                        className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Language</label>
                                    <select
                                        value={editForm.language}
                                        onChange={(e) => setEditForm(f => ({ ...f, language: e.target.value }))}
                                        className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
                                    >
                                        <option value="en">English (en)</option>
                                        <option value="ar">Arabic (ar)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Telegram Chat ID</label>
                                    <input
                                        type="text"
                                        value={editForm.telegram_chat_id}
                                        onChange={(e) => setEditForm(f => ({ ...f, telegram_chat_id: e.target.value }))}
                                        className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Notification Status</label>
                                    <select
                                        value={editForm.notification_channel || ""}
                                        onChange={(e) => setEditForm(f => ({ ...f, notification_channel: e.target.value || null }))}
                                        className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
                                    >
                                        <option value="telegram">Enabled (Telegram)</option>
                                        <option value="">Disabled</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Target %</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editForm.default_target_pct}
                                            onChange={(e) => setEditForm(f => ({ ...f, default_target_pct: e.target.value }))}
                                            className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Stop %</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editForm.default_stop_pct}
                                            onChange={(e) => setEditForm(f => ({ ...f, default_stop_pct: e.target.value }))}
                                            className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs font-mono"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Custom AI Rules</label>
                                <textarea
                                    value={editForm.custom_ai_rules}
                                    onChange={(e) => setEditForm(f => ({ ...f, custom_ai_rules: e.target.value }))}
                                    rows={3}
                                    className="w-full p-2 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
                                    placeholder="Enter custom guidelines for the bot..."
                                />
                            </div>
                        </div>
                        <div className="px-4 py-3 border-t-4 border-black dark:border-white flex items-center justify-end gap-2 shrink-0">
                            <button onClick={() => setEditingId(null)} className="h-9 px-4 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 font-black text-xs uppercase tracking-wider">
                                Cancel
                            </button>
                            <button onClick={saveEdit} className="h-9 px-4 border-4 border-black dark:border-white bg-blue-500 font-black text-xs uppercase tracking-wider text-white flex items-center gap-1">
                                <Save className="w-3.5 h-3.5" /> Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── FIXED USER DETAIL MODAL ─── */}
            {selectedUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-4">
                    <div className="bg-white dark:bg-zinc-950 border-4 border-black dark:border-white rounded-none shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] w-full max-w-2xl overflow-hidden max-h-[85vh] flex flex-col">
                        <div className="px-4 py-3 border-b-4 border-black dark:border-white bg-cyan-100 dark:bg-cyan-900/20 flex items-center justify-between shrink-0">
                            <span className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                <Shield className="w-4 h-4 text-cyan-600" /> USER DETAILS & PROFILE
                            </span>
                            <button onClick={() => setSelectedUser(null)} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {detailLoading ? (
                            <div className="flex items-center justify-center py-20">
                                <RefreshCw className="w-5 h-5 animate-spin text-zinc-400" />
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {/* Profile Info */}
                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <UsersIcon className="w-3 h-3 text-blue-500" /> PROFILE METADATA
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                                        {Object.entries(selectedUser.profile || {}).map(([k, v]) => (
                                            <div key={k} className="flex items-center justify-between p-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                                                <span className="font-black text-zinc-500 uppercase tracking-wider text-[10px]">{k}:</span>
                                                <span className="text-black dark:text-white font-bold truncate max-w-[180px]">{String(v ?? "—")}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Subscription Info */}
                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <Crown className="w-3 h-3 text-indigo-500" /> SUBSCRIPTION PLAN
                                    </h3>
                                    {selectedUser.subscription ? (
                                        <>
                                            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                                            {Object.entries(selectedUser.subscription).map(([k, v]) => (
                                                <div key={k} className="p-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                                                    <span className="font-black text-zinc-500 uppercase text-[10px]">{k}: </span>
                                                    <span className="font-bold">{String(v ?? "—")}</span>
                                                </div>
                                            ))}
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {(selectedUser.payments?.recent || []).some((payment: any) => payment.payment_review_status === "pending_review") && <button onClick={() => runSubscriptionAction(selectedUser.profile.id, "mark_payment_reviewed")} disabled={subscriptionActionLoading} className="inline-flex items-center gap-1 border-2 border-emerald-600 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-600 hover:text-white disabled:opacity-50 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3" /> تمّت مراجعة الدفع</button>}
                                                {selectedUser.subscription.status === "active" && <button onClick={() => runSubscriptionAction(selectedUser.profile.id, "cancel_subscription")} disabled={subscriptionActionLoading} className="inline-flex items-center gap-1 border-2 border-red-500 bg-red-50 px-2 py-1 text-[10px] font-black text-red-700 hover:bg-red-500 hover:text-white disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300"><X className="w-3 h-3" /> {isAr ? "إلغاء برو وسحب VIP" : "Cancel Pro and revoke VIP"}</button>}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-xs text-zinc-400 font-bold p-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                                            No active subscription found (Free Tier Account)
                                        </div>
                                    )}
                                </div>

                                {/* Bot Subscriptions */}
                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <Bot className="w-3 h-3 text-amber-500" /> BOT SUBSCRIPTIONS ({(selectedUser.bot_subscriptions || []).length})
                                    </h3>
                                    {(selectedUser.bot_subscriptions || []).length ? (
                                        <div className="space-y-1.5">
                                            {selectedUser.bot_subscriptions.map((b, i) => (
                                                <div key={i} className="flex items-center justify-between text-xs font-mono px-3 py-1.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                                                    <span className="font-bold">{(isAr ? SERVICE_LABELS_AR[b.service_type] : SERVICE_LABELS[b.service_type]) || b.service_type}</span>
                                                    <span className={`font-black text-[10px] px-2 py-0.5 border ${b.notifications_enabled ? "bg-green-100 text-green-700 border-green-400" : "bg-zinc-100 text-zinc-500 border-zinc-300"}`}>
                                                        {b.notifications_enabled ? "🔔 ENABLED" : "🔕 DISABLED"}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-zinc-400 font-bold">No bot notifications subscribed</span>
                                    )}
                                </div>

                                {/* Product Usage & Revenue */}
                                <div className="border-4 border-black dark:border-white bg-indigo-50 dark:bg-indigo-950/30 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-indigo-700 dark:text-indigo-300 mb-3 flex items-center gap-2">
                                        <Activity className="w-3 h-3" /> PRODUCT USAGE & PAYMENT
                                    </h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono mb-3">
                                        {[
                                            ["Page views", selectedUser.usage?.pageViews || 0],
                                            ["Chat messages", selectedUser.usage?.chatMessages || 0],
                                            ["AI requests", selectedUser.usage?.aiRequests || 0],
                                            ["Paid total", `${Number(selectedUser.payments?.totalPaid || 0).toFixed(2)} ${selectedUser.payments?.currency || "EGP"}`],
                                        ].map(([label, value]) => <div key={String(label)} className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 p-2"><div className="text-[9px] font-black text-zinc-500 uppercase">{label}</div><div className="font-black mt-1">{value}</div></div>)}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                                        <div><div className="text-[10px] font-black text-zinc-500 uppercase mb-1">Most used pages</div>{(selectedUser.usage?.topPages || []).slice(0, 5).map((row) => <div key={row.path} className="flex justify-between border-b border-indigo-200 dark:border-indigo-800 py-1"><span className="truncate mr-2">{row.path}</span><span>{row.views}×</span></div>)}{!selectedUser.usage?.topPages?.length && <span className="text-zinc-400">{selectedUser.usage?.pageTrackingAvailable === false ? "Page tracking is not available yet" : "No page data yet"}</span>}</div>
                                        <div><div className="text-[10px] font-black text-zinc-500 uppercase mb-1">Chat intents</div>{(selectedUser.usage?.topIntents || []).slice(0, 5).map((row) => <div key={row.intent} className="flex justify-between border-b border-indigo-200 dark:border-indigo-800 py-1"><span className="truncate mr-2">{row.intent}</span><span>{row.count}×</span></div>)}{!selectedUser.usage?.topIntents?.length && <span className="text-zinc-400">No AI telemetry yet</span>}</div>
                                    </div>
                                    <div className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 mt-3">Last active: {selectedUser.usage?.lastActiveAt ? new Date(selectedUser.usage.lastActiveAt).toLocaleString() : "—"} · Payment attempts: {selectedUser.payments?.attempts || 0} · Successful: {selectedUser.payments?.successful || 0}</div>
                                </div>

                                {/* Open Positions */}
                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <TrendingUp className="w-3 h-3 text-emerald-500" /> OPEN POSITIONS ({(selectedUser.open_positions || []).length})
                                    </h3>
                                    {(selectedUser.open_positions || []).length ? (
                                        <div className="space-y-1">
                                            {selectedUser.open_positions.map((p, i) => (
                                                <div key={i} className="flex items-center justify-between text-xs font-mono px-2 py-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                                                    <span className="font-bold">{p.symbol}.{p.exchange || "EGX"}</span>
                                                    <span className="text-green-600 font-bold">Entry: {p.entry_price}</span>
                                                    <span className="text-zinc-400">{p.status || "OPEN"}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-zinc-400 font-bold">No active open positions</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
