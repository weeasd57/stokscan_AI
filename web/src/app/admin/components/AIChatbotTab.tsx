"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Save, Sparkles, MessageSquare, KeyRound, Link as LinkIcon, Settings2, User, RefreshCw, Eye, EyeOff, Search, Clock, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import SupportTab from "./SupportTab";
import { FormattedChatMessage } from "@/components/chat/FormattedChatMessage";

export default function AIChatbotTab() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [logsLoading, setLogsLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    
    const [settings, setSettings] = useState({
        api_url: "https://integrate.api.nvidia.com/v1",
        api_key: "",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        system_prompt: ""
    });

    const [logs, setLogs] = useState<any[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [searchUserQuery, setSearchUserQuery] = useState("");
    const [viewMode, setViewMode] = useState<"ai_config" | "support_chats">("ai_config");
    const [readTimestamps, setReadTimestamps] = useState<Record<string, number>>({});

    useEffect(() => {
        try {
            const saved = localStorage.getItem("admin_read_chats_timestamps");
            if (saved) setReadTimestamps(JSON.parse(saved));
        } catch {}
    }, []);

    useEffect(() => {
        fetchSettings();
        fetchLogs();
    }, []);

    const fetchSettings = async () => {
        try {
            const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY || localStorage.getItem("adminKey") || "";
            const res = await fetch("/api/admin/ai-chatbot/settings", {
                headers: { "x-admin-key": adminKey }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.api_url) {
                    setSettings({
                        api_url: data.api_url || "https://integrate.api.nvidia.com/v1",
                        api_key: data.api_key || "",
                        model: data.model || "nvidia/nemotron-3.5-lightning-30b-a3b",
                        system_prompt: data.system_prompt || ""
                    });
                }
            }
        } catch (error) {
            console.error("Error fetching settings:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchLogs = async () => {
        setLogsLoading(true);
        try {
            const res = await fetch("/api/admin/ai-chatbot/logs");
            if (res.ok) {
                const data = await res.json();
                setLogs(data);
            }
        } catch (e) {
            console.error("Failed to load logs");
        } finally {
            setLogsLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY || localStorage.getItem("adminKey") || "";
            const res = await fetch("/api/admin/ai-chatbot/settings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-admin-key": adminKey
                },
                body: JSON.stringify(settings)
            });
            
            if (res.ok) {
                toast.success("AI settings saved successfully!");
            } else {
                toast.error("Failed to save AI settings");
            }
        } catch (e) {
            toast.error("An error occurred");
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteUserChats = async (userId: string, userName: string) => {
        if (!window.confirm(`هل أنت تأكد من مسح جميع محادثات المستخدم (${userName}) نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`)) {
            return;
        }

        setIsDeleting(true);
        try {
            const res = await fetch("/api/admin/ai-chatbot/delete-user-chats", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId })
            });

            if (res.ok) {
                toast.success(`تم مسح جميع محادثات المستخدم (${userName}) بنجاح!`);
                setSelectedUserId(null);
                await fetchLogs();
            } else {
                const data = await res.json();
                toast.error(data.detail || "فشل مسح المحادثات");
            }
        } catch (e) {
            toast.error("حدث خطأ أثناء مسح المحادثات");
        } finally {
            setIsDeleting(false);
        }
    };

    // Group logs by user session
    const userGroups = useMemo(() => {
        const map: Record<string, {
            user_id: string;
            user_name: string;
            telegram_chat_id: string | null;
            last_date: string;
            logs: any[];
        }> = {};

        logs.forEach((log) => {
            const id = log.user_id || log.user_name || "Guest";
            if (!map[id]) {
                map[id] = {
                    user_id: id,
                    user_name: log.user_name || "Guest User",
                    telegram_chat_id: log.telegram_chat_id || null,
                    last_date: log.created_at,
                    logs: []
                };
            }
            map[id].logs.push(log);
        });

        // Convert to array and sort logs chronologically per user, and user groups by last active
        return Object.values(map).map(g => ({
            ...g,
            logs: g.logs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
            last_date: g.logs[g.logs.length - 1]?.created_at || g.last_date
        })).sort((a, b) => new Date(b.last_date).getTime() - new Date(a.last_date).getTime());
    }, [logs]);

    const filteredUserGroups = useMemo(() => {
        if (!searchUserQuery.trim()) return userGroups;
        const q = searchUserQuery.toLowerCase();
        return userGroups.filter(
            g => g.user_name.toLowerCase().includes(q) || g.user_id.toLowerCase().includes(q)
        );
    }, [userGroups, searchUserQuery]);

    const selectedGroup = useMemo(() => {
        if (!selectedUserId && filteredUserGroups.length > 0) {
            return filteredUserGroups[0];
        }
        return filteredUserGroups.find(g => g.user_id === selectedUserId) || filteredUserGroups[0] || null;
    }, [filteredUserGroups, selectedUserId]);

    useEffect(() => {
        if (selectedGroup) {
            const userId = selectedGroup.user_id;
            const lastMsgTime = new Date(selectedGroup.last_date).getTime();
            const currentReadTime = readTimestamps[userId] || 0;

            if (lastMsgTime > currentReadTime) {
                const updated = { ...readTimestamps, [userId]: Date.now() };
                setReadTimestamps(updated);
                try {
                    localStorage.setItem("admin_read_chats_timestamps", JSON.stringify(updated));
                } catch {}
            }
        }
    }, [selectedGroup, logs]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
            </div>
        );
    }

    return (
        <div className="max-w-[1920px] mx-auto px-4 md:px-8 py-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight text-black dark:text-white flex items-center gap-3">
                        <Sparkles className="w-8 h-8 text-indigo-500" />
                        AI Chatbot Monitor
                    </h2>
                    <p className="text-zinc-500 font-medium mt-1">Monitor user conversations with the AI assistant.</p>
                </div>
            </div>

            <div className="w-full">
                    {/* User-grouped Logs Column */}
                    <div className="w-full">
                        <div className="bg-white dark:bg-zinc-900 border-4 border-black dark:border-white h-full min-h-[600px] max-h-[850px] shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] flex flex-col overflow-hidden">
                            <div className="p-4 md:p-6 border-b-2 border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
                                        <User className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-base md:text-lg font-bold uppercase tracking-tight text-black dark:text-white">
                                            AI Chat User Sessions
                                        </h3>
                                        <p className="text-xs text-zinc-500 font-medium">
                                            {userGroups.length} users recorded
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={fetchLogs}
                                    disabled={logsLoading}
                                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors text-zinc-500"
                                    title="Refresh interactions"
                                >
                                    <RefreshCw className={`w-5 h-5 ${logsLoading ? "animate-spin" : ""}`} />
                                </button>
                            </div>

                            {logsLoading && logs.length === 0 ? (
                                <div className="flex items-center justify-center flex-1 min-h-[400px]">
                                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                                </div>
                            ) : logs.length === 0 ? (
                                <div className="flex items-center justify-center flex-1 min-h-[400px] text-zinc-500 font-medium">
                                    No user interactions recorded yet.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-3 flex-1 overflow-hidden min-h-[500px]">
                                    {/* Left Pane: Users List */}
                                    <div className="md:col-span-1 border-r-2 border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50/50 dark:bg-zinc-950/30 overflow-hidden">
                                        {/* Search Filter */}
                                        <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
                                            <div className="relative">
                                                <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                                                <input
                                                    type="text"
                                                    value={searchUserQuery}
                                                    onChange={(e) => setSearchUserQuery(e.target.value)}
                                                    placeholder="Search user name..."
                                                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 pl-9 pr-3 py-2 text-xs rounded-lg text-black dark:text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                                                />
                                            </div>
                                        </div>

                                        {/* Users Cards List */}
                                        <div className="flex-1 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-800">
                                            {filteredUserGroups.map((group) => {
                                                const isSelected = selectedGroup?.user_id === group.user_id;
                                                const lastMsgTime = new Date(group.last_date).getTime();
                                                const readTime = readTimestamps[group.user_id] || 0;
                                                const isUnread = lastMsgTime > readTime;

                                                return (
                                                    <button
                                                        key={group.user_id}
                                                        onClick={() => setSelectedUserId(group.user_id)}
                                                        className={`w-full text-left p-3.5 transition-all flex items-center justify-between gap-2 ${
                                                            isSelected 
                                                                ? "bg-indigo-500/10 border-l-4 border-indigo-500 dark:bg-indigo-950/30" 
                                                                : isUnread 
                                                                    ? "bg-blue-500/5 dark:bg-blue-950/20 hover:bg-blue-500/10"
                                                                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                                            <div className="relative shrink-0">
                                                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                                                                    isSelected ? "bg-indigo-500 text-white" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                                                                }`}>
                                                                    {group.user_name.substring(0, 2).toUpperCase()}
                                                                </div>
                                                                {isUnread && (
                                                                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-zinc-900 animate-pulse" />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="font-bold text-xs text-black dark:text-white truncate flex items-center gap-1.5">
                                                                    <span>{group.user_name}</span>
                                                                    {isUnread && (
                                                                        <span className="text-[9px] bg-blue-500 text-white px-1.5 py-0.2 rounded-full font-bold">
                                                                            غير مقروء
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 mt-0.5">
                                                                    <Clock className="w-3 h-3" />
                                                                    {new Date(group.last_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end shrink-0 gap-1">
                                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                                isUnread 
                                                                    ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30" 
                                                                    : "bg-indigo-500/10 text-indigo-500 border border-indigo-500/20"
                                                            }`}>
                                                                {group.logs.length} msgs
                                                            </span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Right Pane: Selected User Conversation */}
                                    <div className="md:col-span-2 flex flex-col h-full bg-white dark:bg-zinc-900 overflow-hidden">
                                        {selectedGroup ? (
                                            <>
                                                {/* Selected User Header */}
                                                <div className="p-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between shrink-0">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold">
                                                            {selectedGroup.user_name.substring(0, 2).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-sm text-black dark:text-white flex items-center gap-2">
                                                                {selectedGroup.user_name}
                                                                {selectedGroup.telegram_chat_id && (
                                                                    <span className="text-[10px] bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-0.5 rounded-full font-normal flex items-center gap-1">
                                                                        <LinkIcon className="w-3 h-3" /> Telegram Linked
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-[11px] text-zinc-500 font-mono">
                                                                ID: {selectedGroup.user_id}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="text-xs text-zinc-500 font-medium">
                                                            Total: <span className="font-bold text-black dark:text-white">{selectedGroup.logs.length} interactions</span>
                                                        </div>
                                                        <button
                                                            onClick={() => handleDeleteUserChats(selectedGroup.user_id, selectedGroup.user_name)}
                                                            disabled={isDeleting}
                                                            className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                                                            title="مسح كافة محادثات هذا المستخدم"
                                                        >
                                                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                            <span>مسح الشات بالكامل</span>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Conversation Timeline */}
                                                <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[650px]">
                                                    {selectedGroup.logs.map((log) => (
                                                        <div key={log.id} className="space-y-2 border-b border-zinc-100 dark:border-zinc-800/60 pb-4 last:border-b-0">
                                                            <div className="text-[10px] font-mono text-zinc-400 text-center my-1">
                                                                {new Date(log.created_at).toLocaleString()}
                                                            </div>
                                                            {/* User Message */}
                                                            <div className="flex items-start gap-2.5 justify-end">
                                                                <div className="bg-zinc-100 dark:bg-zinc-800 text-black dark:text-zinc-100 p-3 rounded-2xl rounded-tr-none text-xs max-w-[85%] leading-relaxed">
                                                                    <span className="text-[10px] font-bold text-zinc-400 block mb-1">User:</span>
                                                                    <p className="whitespace-pre-wrap">{log.message}</p>
                                                                </div>
                                                                <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400 text-xs shrink-0">
                                                                    <User className="w-3.5 h-3.5" />
                                                                </div>
                                                            </div>
                                                            {/* AI Response */}
                                                            <div className="flex items-start gap-2.5">
                                                                <div className="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs shrink-0">
                                                                    <Sparkles className="w-3.5 h-3.5" />
                                                                </div>
                                                                <div className="bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-black dark:text-zinc-100 p-3 rounded-2xl rounded-tl-none text-xs max-w-[85%] leading-relaxed">
                                                                    <span className="text-[10px] font-bold text-indigo-500 block mb-1 flex items-center gap-1">
                                                                        <Sparkles className="w-3 h-3" /> EGX Bots AI:
                                                                    </span>
                                                                    <div className="text-black dark:text-zinc-100">
                                                                        <FormattedChatMessage content={log.reply} role="assistant" showSuggestedButtons={false} />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-2 p-6">
                                                <User className="w-12 h-12 text-zinc-300 dark:text-zinc-700" />
                                                <p className="text-sm font-medium">Select a user to view their conversation history with the AI Assistant.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
    );
}
