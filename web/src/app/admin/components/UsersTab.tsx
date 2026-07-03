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
    const [loading, setLoading] = useState(true);
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

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const fetchDetail = async (userId: string) => {
        setDetailLoading(true);
        try {
            const res = await fetch(`/api/admin/users/${userId}`);
            const data = await res.json();
            setSelectedUser(data);
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
            toast.success("User updated");
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
        } catch (e) {
            toast.error("Failed to delete user");
        }
    };

    const totalPages = Math.ceil(total / pageSize);

    return (
        <div className="p-4 md:p-6 space-y-6">
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]">
                <div className="flex items-center justify-between gap-4 mb-6">
                    <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-3">
                        <UsersIcon className="w-6 h-6" />
                        USER MANAGEMENT
                    </h2>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                                placeholder="Search users..."
                                className="h-10 pl-9 pr-4 w-64 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <button
                            onClick={fetchUsers}
                            className="h-10 px-4 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 font-black text-xs uppercase tracking-wider hover:bg-zinc-200 dark:hover:bg-zinc-700 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] flex items-center gap-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            REFRESH
                        </button>
                    </div>
                </div>

                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                    {total} users • Page {page + 1} / {totalPages}
                </div>

                {loading && !users.length ? (
                    <div className="flex items-center justify-center h-40 text-zinc-400 font-bold uppercase tracking-widest">
                        <RefreshCw className="w-5 h-5 animate-spin mr-3" />
                        Loading users...
                    </div>
                ) : !users.length ? (
                    <div className="flex items-center justify-center h-40 text-zinc-400 font-bold uppercase tracking-widest">
                        No users found
                    </div>
                ) : (
                    <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-xs font-mono">
                            <thead>
                                <tr className="border-b-4 border-black dark:border-white">
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
                                {users.map((u) => (
                                    <tr
                                        key={u.id}
                                        className="border-b-2 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer"
                                        onClick={() => fetchDetail(u.id)}
                                    >
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                {u.avatar_url ? (
                                                    <img src={u.avatar_url} alt="" className="w-6 h-6 rounded-full border-2 border-black dark:border-white object-cover" />
                                                ) : (
                                                    <div className="w-6 h-6 rounded-full border-2 border-black dark:border-white bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-black text-[10px]">
                                                        {(u.display_name || u.username || "?")[0].toUpperCase()}
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="font-bold text-black dark:text-white">{u.display_name || u.username || "—"}</div>
                                                    <div className="text-[10px] text-zinc-400 truncate max-w-[120px]">{u.id.slice(0, 8)}...</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            {u.subscription?.plan_id ? (
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 border-2 border-black dark:border-white font-black text-[10px] uppercase tracking-wider ${u.subscription.plan_id === "pro" ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"}`}>
                                                    <Crown className="w-3 h-3" />
                                                    {u.subscription.plan_id}
                                                </span>
                                            ) : (
                                                <span className="text-zinc-400">Free</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1">
                                                <Bot className="w-3 h-3 text-zinc-400" />
                                                <span className="font-bold">{u.bot_count}</span>
                                                {(u.bot_subscriptions || []).slice(0, 3).map((b, i) => (
                                                    <span key={i} className="text-[9px] text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1 border border-zinc-300 dark:border-zinc-700">
                                                        {SERVICE_LABELS[b.service_type] || b.service_type}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                                                <Globe className="w-3 h-3" />
                                                {u.language || "—"}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            {u.telegram_chat_id ? (
                                                <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                                    <MessageSquare className="w-3 h-3" />
                                                    {u.telegram_chat_id.slice(0, 10)}...
                                                </span>
                                            ) : (
                                                <span className="text-zinc-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center gap-1 text-zinc-500">
                                                <Calendar className="w-3 h-3" />
                                                {new Date(u.created_at).toLocaleDateString()}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); fetchDetail(u.id); }}
                                                    className="p-1.5 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                                                    title="View"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEdit(u); }}
                                                    className="p-1.5 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors"
                                                    title="Edit"
                                                >
                                                    <Edit3 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteUser(u.id); }}
                                                    className="p-1.5 border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                                    title="Delete"
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
                        <span className="text-xs font-bold text-zinc-500">
                            {page + 1} / {totalPages}
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

            {editingId && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-4">
                    <div className="bg-white dark:bg-zinc-950 border-4 border-black dark:border-white rounded-none shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-4 py-3 border-b-4 border-black dark:border-white bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-between shrink-0">
                            <span className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                <Edit3 className="w-4 h-4" /> EDIT USER
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
                                        className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
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
                                            className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Stop %</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editForm.default_stop_pct}
                                            onChange={(e) => setEditForm(f => ({ ...f, default_stop_pct: e.target.value }))}
                                            className="w-full h-9 px-3 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs"
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
                                    rows={4}
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
                                <Save className="w-3.5 h-3.5" /> Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-4">
                    <div className="bg-white dark:bg-zinc-950 border-4 border-black dark:border-white rounded-none shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] w-full max-w-2xl overflow-hidden max-h-[85vh] flex flex-col">
                        <div className="px-4 py-3 border-b-4 border-black dark:border-white bg-cyan-100 dark:bg-cyan-900/20 flex items-center justify-between shrink-0">
                            <span className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                <Shield className="w-4 h-4" /> USER DETAIL
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
                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <UsersIcon className="w-3 h-3" /> PROFILE
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                                        {Object.entries(selectedUser.profile).map(([k, v]) => (
                                            <div key={k} className="flex items-center gap-2">
                                                <span className="font-black text-zinc-500 uppercase tracking-wider min-w-[80px]">{k}:</span>
                                                <span className="text-black dark:text-white truncate">{String(v ?? "—")}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <Crown className="w-3 h-3" /> SUBSCRIPTION
                                    </h3>
                                    {selectedUser.subscription ? (
                                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                                            {Object.entries(selectedUser.subscription).map(([k, v]) => (
                                                <div key={k}>
                                                    <span className="font-black text-zinc-500 uppercase">{k}: </span>
                                                    <span>{String(v ?? "—")}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-zinc-400 font-bold">No subscription (Free plan)</span>
                                    )}
                                </div>

                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <Bot className="w-3 h-3" /> BOT SUBSCRIPTIONS ({(selectedUser.bot_subscriptions || []).length})
                                    </h3>
                                    {(selectedUser.bot_subscriptions || []).length ? (
                                        <div className="space-y-1">
                                            {selectedUser.bot_subscriptions.map((b, i) => (
                                                <div key={i} className="flex items-center gap-2 text-xs font-mono px-2 py-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                                                    <span className="font-bold">{SERVICE_LABELS[b.service_type] || b.service_type}</span>
                                                    <span className={b.notifications_enabled ? "text-green-600" : "text-zinc-400"}>
                                                        {b.notifications_enabled ? "🔔 ON" : "🔕 OFF"}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-zinc-400 font-bold">No bot subscriptions</span>
                                    )}
                                </div>

                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <TrendingUp className="w-3 h-3" /> OPEN POSITIONS ({(selectedUser.open_positions || []).length})
                                    </h3>
                                    {(selectedUser.open_positions || []).length ? (
                                        <div className="space-y-1">
                                            {selectedUser.open_positions.map((p, i) => (
                                                <div key={i} className="flex items-center gap-2 text-xs font-mono px-2 py-1 border border-zinc-300 dark:border-zinc-700">
                                                    <span className="font-bold">{p.symbol}.{p.exchange}</span>
                                                    <span className="text-green-600">@ {p.entry_price}</span>
                                                    <span className="text-zinc-400">{p.status}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-zinc-400 font-bold">No open positions</span>
                                    )}
                                </div>

                                <div className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 p-4">
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                                        <Activity className="w-3 h-3" /> RECENT SCANS ({(selectedUser.recent_scans || []).length})
                                    </h3>
                                    {(selectedUser.recent_scans || []).length ? (
                                        <div className="space-y-1">
                                            {selectedUser.recent_scans.map((s, i) => (
                                                <div key={i} className="flex items-center gap-2 text-xs font-mono px-2 py-1 border border-zinc-300 dark:border-zinc-700">
                                                    <span className="font-bold">{s.symbol}</span>
                                                    <span className="text-indigo-600">{s.signal}</span>
                                                    <span className="text-zinc-400">{s.status}</span>
                                                    <span className="text-zinc-500">{new Date(s.created_at).toLocaleDateString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-zinc-400 font-bold">No recent scans</span>
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
