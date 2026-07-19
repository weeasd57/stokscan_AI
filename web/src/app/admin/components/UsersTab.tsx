"use client";

import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

interface UserRow {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    language: string | null;
    telegram_chat_id: string | null;
    notification_channel: string | null;
    default_target_pct: number | string | null;
    default_stop_pct: number | string | null;
    gemini_api_key: string | null;
    openrouter_api_key: string | null;
    custom_ai_rules: string | null;
    created_at: string;
    updated_at: string | null;
    subscription: { plan_id: string; status: string; current_period_end: string | null } | null;
    bot_subscriptions: { service_type: string; notifications_enabled: boolean }[];
    bot_count: number;
}

interface UserDetail {
    profile: Record<string, any>;
    subscription: Record<string, any> | null;
    bot_subscriptions: Record<string, any>[];
    open_positions: Record<string, any>[];
    recent_scans: Record<string, any>[];
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
}

const SERVICE_LABELS: Record<string, string> = {
    stock_score: "Stocks Score",
    historical_similarity: "Similarity",
    technical_scanner: "Tech Scanner",
    ai_bot: "AI Bot",
};

export default function UsersTab() {
    const [users, setUsers] = useState<UserRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [pageSize] = useState(20);
    const [search, setSearch] = useState("");
    const [planFilter, setPlanFilter] = useState<string>("ALL");
    const [loading, setLoading] = useState(true);
    
    // Stats Dashboard State
    const [stats, setStats] = useState<UserStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);

    // Modal States
    const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{
        display_name: string;
        language: string;
        telegram_chat_id: string;
        notification_channel: string | null;
        default_target_pct: string;
        default_stop_pct: string;
        gemini_api_key: string;
        openrouter_api_key: string;
        custom_ai_rules: string;
    }>({
        display_name: "",
        language: "",
        telegram_chat_id: "",
        notification_channel: "",
        default_target_pct: "",
        default_stop_pct: "",
        gemini_api_key: "",
        openrouter_api_key: "",
        custom_ai_rules: "",
    });

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/users?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search)}`);
            const data = await res.json();
            setUsers(data.users || []);
            setTotal(data.total || 0);
        } catch (e) {
            toast.error("Failed to load users");
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, search]);

    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const res = await fetch("/api/admin/users/stats");
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (e) {
            console.error("Failed to load user stats", e);
        } finally {
            setStatsLoading(false);
        }
    }, []);

    useEffect(() => { 
        fetchUsers(); 
        fetchStats();
    }, [fetchUsers, fetchStats]);

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
            gemini_api_key: user.gemini_api_key || "",
            openrouter_api_key: user.openrouter_api_key || "",
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
                gemini_api_key: editForm.gemini_api_key || null,
                openrouter_api_key: editForm.openrouter_api_key || null,
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
            fetchStats();
        } catch (e) {
            toast.error("Failed to delete user");
        }
    };

    const filteredUsers = users.filter(u => {
        if (planFilter === "PRO") return u.subscription?.plan_id === "pro";
        if (planFilter === "FREE") return !u.subscription?.plan_id || u.subscription?.plan_id === "free";
        if (planFilter === "TELEGRAM") return !!u.telegram_chat_id;
        return true;
    });

    const totalPages = Math.ceil(total / pageSize);
    const maxGrowthCount = Math.max(...(stats?.signupGrowth?.map(g => g.count) || [1]), 1);

    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* ─── SMART ANALYTICS DASHBOARD ─── */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)]">
                <div className="flex items-center justify-between gap-4 mb-6">
                    <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-3">
                        <BarChart3 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        USER ANALYTICS & INSIGHTS
                    </h2>
                    <button
                        onClick={() => { fetchStats(); fetchUsers(); }}
                        className="h-9 px-3 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 font-black text-xs uppercase tracking-wider hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${statsLoading ? "animate-spin" : ""}`} />
                        REFRESH ANALYTICS
                    </button>
                </div>

                {/* KPI Cards Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <div className="border-4 border-black dark:border-white bg-blue-50 dark:bg-blue-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">Total Registered</span>
                            <UsersIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : stats?.totalUsers || 0}
                        </div>
                        <div className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3" /> All-time accounts
                        </div>
                    </div>

                    <div className="border-4 border-black dark:border-white bg-emerald-50 dark:bg-emerald-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">New (Last 30 Days)</span>
                            <UserPlus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : stats?.newUsers30Days || 0}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                            +{stats?.newUsers7Days || 0} in last 7 days
                        </div>
                    </div>

                    <div className="border-4 border-black dark:border-white bg-cyan-50 dark:bg-cyan-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">Telegram Linked</span>
                            <MessageSquare className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : `${stats?.telegramRate || 0}%`}
                        </div>
                        <div className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 mt-1">
                            {stats?.withTelegram || 0} active chat IDs
                        </div>
                    </div>

                    <div className="border-4 border-black dark:border-white bg-amber-50 dark:bg-amber-950/40 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="font-black text-[10px] uppercase tracking-wider">Bot Services Active</span>
                            <Bot className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="text-3xl font-black text-black dark:text-white font-mono">
                            {statsLoading ? "..." : Object.values(stats?.botServices || {}).reduce((a, b) => a + b, 0)}
                        </div>
                        <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1">
                            Active bot subscriptions
                        </div>
                    </div>
                </div>

                {/* Growth Chart & Breakdown Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* User Growth Chart (30-day Histogram Bar Chart) */}
                    <div className="lg:col-span-2 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                <Activity className="w-4 h-4 text-blue-500" />
                                USER REGISTRATION TREND (LAST 30 DAYS)
                            </h3>
                            <span className="text-[10px] font-bold font-mono text-zinc-400">DAILY SIGNUPS</span>
                        </div>
                        
                        {statsLoading ? (
                            <div className="h-32 flex items-center justify-center text-xs font-bold text-zinc-400">Loading chart...</div>
                        ) : (
                            <div className="h-36 flex items-end justify-between gap-1 pt-6 pb-2 border-b-2 border-zinc-300 dark:border-zinc-700">
                                {stats?.signupGrowth?.map((item, idx) => {
                                    const heightPct = Math.max((item.count / maxGrowthCount) * 100, item.count > 0 ? 15 : 4);
                                    return (
                                        <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                                            {/* Tooltip */}
                                            <div className="absolute -top-8 hidden group-hover:flex bg-black text-white text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap z-10 border border-white">
                                                {item.date}: {item.count} users
                                            </div>
                                            <div 
                                                style={{ height: `${heightPct}%` }}
                                                className={`w-full max-w-[12px] border border-black dark:border-white transition-all ${item.count > 0 ? "bg-blue-500 dark:bg-blue-400 group-hover:bg-blue-600" : "bg-zinc-200 dark:bg-zinc-800"}`}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div className="flex justify-between items-center text-[9px] font-mono text-zinc-400 mt-2">
                            <span>{stats?.signupGrowth?.[0]?.date || "30d ago"}</span>
                            <span>Today</span>
                        </div>
                    </div>

                    {/* Distribution Breakdown Cards */}
                    <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4 space-y-4">
                        <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                            <PieChart className="w-4 h-4 text-purple-500" />
                            DEMOGRAPHICS & BOT SERVICES
                        </h3>

                        {/* Language */}
                        <div>
                            <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">Languages</div>
                            <div className="flex items-center gap-2 font-mono text-xs">
                                <div className="flex-1 bg-white dark:bg-zinc-950 p-2 border-2 border-black dark:border-white flex justify-between">
                                    <span className="font-bold">🇬🇧 English</span>
                                    <span className="font-black">{stats?.languages?.en || 0}</span>
                                </div>
                                <div className="flex-1 bg-white dark:bg-zinc-950 p-2 border-2 border-black dark:border-white flex justify-between">
                                    <span className="font-bold">🇪🇬 Arabic</span>
                                    <span className="font-black">{stats?.languages?.ar || 0}</span>
                                </div>
                            </div>
                        </div>

                        {/* Bot Services Breakdown */}
                        <div>
                            <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">Bot Service Subscriptions</div>
                            <div className="space-y-1 font-mono text-[11px]">
                                {Object.entries(stats?.botServices || {}).map(([key, count]) => (
                                    <div key={key} className="flex justify-between items-center bg-white dark:bg-zinc-950 px-2 py-1 border border-zinc-200 dark:border-zinc-800">
                                        <span className="text-zinc-600 dark:text-zinc-300 font-bold">{SERVICE_LABELS[key] || key}</span>
                                        <span className="font-black px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-400">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── USER MANAGEMENT TABLE ─── */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)]">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-3">
                        <UsersIcon className="w-6 h-6" />
                        USER DIRECTORY
                    </h2>

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Search Bar */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                                placeholder="Search users by name..."
                                className="h-10 pl-9 pr-4 w-60 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        {/* Filter Pill Dropdown */}
                        <div className="flex items-center border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900">
                            <SlidersHorizontal className="w-4 h-4 ml-2 text-zinc-400" />
                            <select
                                value={planFilter}
                                onChange={(e) => setPlanFilter(e.target.value)}
                                className="h-9 px-2 bg-transparent font-black text-xs uppercase tracking-wider focus:outline-none cursor-pointer"
                            >
                                <option value="ALL">All Users</option>
                                <option value="PRO">PRO Plan Only</option>
                                <option value="FREE">Free Plan Only</option>
                                <option value="TELEGRAM">Telegram Linked</option>
                            </select>
                        </div>

                        <button
                            onClick={fetchUsers}
                            className="h-10 px-4 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 font-black text-xs uppercase tracking-wider hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            REFRESH TABLE
                        </button>
                    </div>
                </div>

                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-3">
                    Showing {filteredUsers.length} of {total} users • Page {page + 1} of {totalPages || 1}
                </div>

                {loading && !users.length ? (
                    <div className="flex items-center justify-center h-40 text-zinc-400 font-bold uppercase tracking-widest">
                        <RefreshCw className="w-5 h-5 animate-spin mr-3" />
                        Loading user directory...
                    </div>
                ) : !filteredUsers.length ? (
                    <div className="flex items-center justify-center h-40 text-zinc-400 font-bold uppercase tracking-widest">
                        No matching users found
                    </div>
                ) : (
                    <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-xs font-mono">
                            <thead>
                                <tr className="border-b-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900">
                                    <th className="px-3 py-3 text-left uppercase tracking-widest font-black">User</th>
                                    <th className="px-3 py-3 text-left uppercase tracking-widest font-black">Plan</th>
                                    <th className="px-3 py-3 text-left uppercase tracking-widest font-black">Bots</th>
                                    <th className="px-3 py-3 text-left uppercase tracking-widest font-black">Language</th>
                                    <th className="px-3 py-3 text-left uppercase tracking-widest font-black">Telegram</th>
                                    <th className="px-3 py-3 text-left uppercase tracking-widest font-black">Joined</th>
                                    <th className="px-3 py-3 text-center uppercase tracking-widest font-black">Actions</th>
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
                                                    <div className="text-[10px] text-zinc-400 truncate max-w-[120px]">{u.id.slice(0, 8)}...</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            {u.subscription?.plan_id ? (
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 border-2 border-black dark:border-white font-black text-[10px] uppercase tracking-wider ${u.subscription.plan_id === "pro" ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"}`}>
                                                    <Crown className="w-3 h-3" />
                                                    {u.subscription.plan_id}
                                                </span>
                                            ) : (
                                                <span className="text-zinc-400 font-bold">Free</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-1.5">
                                                <Bot className="w-3.5 h-3.5 text-amber-500" />
                                                <span className="font-black">{u.bot_count || (u.bot_subscriptions || []).length}</span>
                                                {(u.bot_subscriptions || []).slice(0, 2).map((b, i) => (
                                                    <span key={i} className="text-[9px] font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-1 border border-zinc-300 dark:border-zinc-700">
                                                        {SERVICE_LABELS[b.service_type] || b.service_type}
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
                                                    title="View Detail"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEdit(u); }}
                                                    className="p-1.5 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors"
                                                    title="Edit User"
                                                >
                                                    <Edit3 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteUser(u.id); }}
                                                    className="p-1.5 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                                    title="Delete User"
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
                            <ChevronLeft className="w-4 h-4" /> Prev
                        </button>
                        <span className="text-xs font-bold font-mono text-zinc-500">
                            Page {page + 1} of {totalPages}
                        </span>
                        <button
                            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                            disabled={page >= totalPages - 1}
                            className="h-8 px-3 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 font-black text-xs uppercase tracking-wider disabled:opacity-30 flex items-center gap-1 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                        >
                            Next <ChevronRight className="w-4 h-4" />
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
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Gemini API Key</label>
                                    <input
                                        type="password"
                                        value={editForm.gemini_api_key}
                                        onChange={(e) => setEditForm(f => ({ ...f, gemini_api_key: e.target.value }))}
                                        className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
                                        placeholder="••••••••"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">OpenRouter API Key</label>
                                    <input
                                        type="password"
                                        value={editForm.openrouter_api_key}
                                        onChange={(e) => setEditForm(f => ({ ...f, openrouter_api_key: e.target.value }))}
                                        className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
                                        placeholder="••••••••"
                                    />
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
                                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                                            {Object.entries(selectedUser.subscription).map(([k, v]) => (
                                                <div key={k} className="p-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                                                    <span className="font-black text-zinc-500 uppercase text-[10px]">{k}: </span>
                                                    <span className="font-bold">{String(v ?? "—")}</span>
                                                </div>
                                            ))}
                                        </div>
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
                                                    <span className="font-bold">{SERVICE_LABELS[b.service_type] || b.service_type}</span>
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
