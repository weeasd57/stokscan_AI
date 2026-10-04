"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { 
    Loader2, Sparkles, MessageSquare, Link as LinkIcon, User, RefreshCw, 
    Search, Clock, ChevronRight, Trash2, Maximize, Minimize, Database, 
    Zap, Crown, ArrowDown, Folder, Archive, CheckCircle2 
} from "lucide-react";
import { toast } from "sonner";
import SupportTab from "./SupportTab";
import { FormattedChatMessage } from "@/components/chat/FormattedChatMessage";

export default function AIChatbotTab() {
    const [logsLoading, setLogsLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const [logs, setLogs] = useState<any[]>([]);
    const [loadedLimit, setLoadedLimit] = useState(1000);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [searchUserQuery, setSearchUserQuery] = useState("");
    const [viewMode, setViewMode] = useState<"ai_config" | "support_chats">("ai_config");
    const [readTimestamps, setReadTimestamps] = useState<Record<string, number>>({});
    const [readSessionTimestamps, setReadSessionTimestamps] = useState<Record<string, number>>({});
    const [proOnly, setProOnly] = useState(false);

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const firstUnreadRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        try {
            const saved = localStorage.getItem("admin_read_chats_timestamps");
            if (saved) setReadTimestamps(JSON.parse(saved));
            const savedSessions = localStorage.getItem("admin_read_session_timestamps");
            if (savedSessions) setReadSessionTimestamps(JSON.parse(savedSessions));
        } catch {}
    }, []);

    useEffect(() => {
        fetchLogs(1000);
    }, []);

    const fetchLogs = async (limit = loadedLimit) => {
        setLogsLoading(true);
        try {
            const res = await fetch(`/api/admin/ai-chatbot/logs?limit=${limit}`);
            if (res.ok) {
                const data = await res.json();
                setLoadedLimit(limit);
                const enrichedData = data.map((log: any) => {
                    const reply = log.reply || "";
                    let dataSource = log.data_source || "unknown";
                    let dataDate = log.data_date || null;

                    if (!dataSource || dataSource === "unknown") {
                        if (reply.includes("بيانات لحظية (Real-time)")) {
                            dataSource = "realtime";
                        } else if (reply.includes("بيانات من قاعدة البيانات (Supabase)")) {
                            dataSource = "supabase";
                        }
                    }

                    if (!dataDate) {
                        const dateMatch = reply.match(/تاريخ البيانات:\s*([^\n]+)/);
                        if (dateMatch) {
                            dataDate = dateMatch[1].trim();
                        }
                    }

                    return {
                        ...log,
                        dataSource,
                        dataDate
                    };
                });
                setLogs(enrichedData);
            }
        } catch (e) {
            console.error("Failed to load logs");
        } finally {
            setLogsLoading(false);
        }
    };

    const handleDeleteUserChats = async (userId: string, userName: string) => {
        if (!window.confirm(`هل أنت متأكد من مسح جميع محادثات المستخدم (${userName}) نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`)) {
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
                setSelectedSessionId(null);
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

    // Group logs by user, and inside each user group into rooms/sessions
    const userGroups = useMemo(() => {
        const map: Record<string, {
            user_id: string;
            user_name: string;
            telegram_chat_id: string | null;
            last_date: string;
            logs: any[];
            is_pro: boolean;
            sessionsMap: Record<string, {
                id: string;
                title: string;
                is_deleted_by_user: boolean;
                deleted_at: string | null;
                last_date: string;
                logs: any[];
            }>;
        }> = {};

        const visibleLogs = proOnly ? logs.filter((log) => log.is_pro === true) : logs;
        visibleLogs.forEach((log) => {
            const id = log.user_id || log.user_name || "Guest";
            if (!map[id]) {
                map[id] = {
                    user_id: id,
                    user_name: log.user_name || "Guest User",
                    telegram_chat_id: log.telegram_chat_id || null,
                    last_date: log.created_at,
                    logs: [],
                    is_pro: log.is_pro === true,
                    sessionsMap: {},
                };
            }
            map[id].is_pro = map[id].is_pro || log.is_pro === true;
            map[id].logs.push(log);

            const sId = log.session_id || "general";
            if (!map[id].sessionsMap[sId]) {
                map[id].sessionsMap[sId] = {
                    id: sId,
                    title: log.session_title || (sId === "general" ? "محادثة رئيسية" : "محادثة"),
                    is_deleted_by_user: Boolean(log.is_deleted_by_user),
                    deleted_at: log.deleted_at || null,
                    last_date: log.created_at,
                    logs: [],
                };
            }
            map[id].sessionsMap[sId].logs.push(log);
            if (new Date(log.created_at).getTime() > new Date(map[id].sessionsMap[sId].last_date).getTime()) {
                map[id].sessionsMap[sId].last_date = log.created_at;
            }
        });

        return Object.values(map).map(g => {
            const sortedSessions = Object.values(g.sessionsMap).map(s => ({
                ...s,
                logs: s.logs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            })).sort((a, b) => new Date(b.last_date).getTime() - new Date(a.last_date).getTime());

            return {
                ...g,
                logs: g.logs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
                last_date: g.logs[g.logs.length - 1]?.created_at || g.last_date,
                sessions: sortedSessions,
            };
        }).sort((a, b) => new Date(b.last_date).getTime() - new Date(a.last_date).getTime());
    }, [logs, proOnly]);

    const [dateFilter, setDateFilter] = useState<"all" | "today" | "week">("all");

    const filteredUserGroups = useMemo(() => {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const sevenDays = 7 * oneDay;

        let filtered = userGroups;

        if (dateFilter === "today") {
            filtered = filtered.filter(g => now - new Date(g.last_date).getTime() <= oneDay);
        } else if (dateFilter === "week") {
            filtered = filtered.filter(g => now - new Date(g.last_date).getTime() <= sevenDays);
        }

        if (!searchUserQuery.trim()) return filtered;
        const q = searchUserQuery.toLowerCase();
        return filtered.filter(
            g => g.user_name.toLowerCase().includes(q) ||
                 g.user_id.toLowerCase().includes(q) ||
                 g.logs.some(l => (l.message || "").toLowerCase().includes(q) || (l.reply || "").toLowerCase().includes(q))
        );
    }, [userGroups, searchUserQuery, dateFilter]);

    const selectedGroup = useMemo(() => {
        if (!selectedUserId && filteredUserGroups.length > 0) {
            return filteredUserGroups[0];
        }
        return filteredUserGroups.find(g => g.user_id === selectedUserId) || filteredUserGroups[0] || null;
    }, [filteredUserGroups, selectedUserId]);

    // Active session for the selected user
    const currentSessions = useMemo(() => {
        return selectedGroup?.sessions || [];
    }, [selectedGroup]);

    const activeSession = useMemo(() => {
        if (!currentSessions.length) return null;
        if (selectedSessionId) {
            const found = currentSessions.find(s => s.id === selectedSessionId);
            if (found) return found;
        }
        return currentSessions[0];
    }, [currentSessions, selectedSessionId]);

    // Active conversation messages to display (either of selected session or all)
    const activeMessages = useMemo(() => {
        if (!activeSession) return selectedGroup?.logs || [];
        return activeSession.logs;
    }, [activeSession, selectedGroup]);

    // Read status for user and session
    const lastSessionReadTime = useMemo(() => {
        if (!activeSession) return 0;
        return readSessionTimestamps[activeSession.id] || 0;
    }, [activeSession, readSessionTimestamps]);

    // Calculate unread messages in the active session
    const unreadMessagesCount = useMemo(() => {
        if (!activeMessages.length || !lastSessionReadTime) return 0;
        return activeMessages.filter(m => new Date(m.created_at).getTime() > lastSessionReadTime).length;
    }, [activeMessages, lastSessionReadTime]);

    // Mark as read when entering or viewing session
    const markActiveSessionAsRead = () => {
        if (!activeSession) return;
        const sId = activeSession.id;
        const now = Date.now();
        const updated = { ...readSessionTimestamps, [sId]: now };
        setReadSessionTimestamps(updated);
        try {
            localStorage.setItem("admin_read_session_timestamps", JSON.stringify(updated));
        } catch {}

        if (selectedGroup) {
            const uId = selectedGroup.user_id;
            const updatedUsers = { ...readTimestamps, [uId]: now };
            setReadTimestamps(updatedUsers);
            try {
                localStorage.setItem("admin_read_chats_timestamps", JSON.stringify(updatedUsers));
            } catch {}
        }
    };

    // Scroll to first unread message
    const scrollToFirstUnread = () => {
        if (firstUnreadRef.current) {
            firstUnreadRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
            toast.info("تم التمرير لأول رسالة غير مقروءة");
        } else if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTo({
                top: messagesContainerRef.current.scrollHeight,
                behavior: "smooth"
            });
        }
    };

    useEffect(() => {
        if (selectedGroup && activeSession) {
            const lastMsgTime = new Date(activeSession.last_date).getTime();
            const currentReadTime = readSessionTimestamps[activeSession.id] || 0;
            if (lastMsgTime > currentReadTime) {
                // Keep unread jump available until user manually marks or clicks jump
            }
        }
    }, [selectedGroup, activeSession]);

    return (
        <div className="max-w-[1920px] mx-auto px-4 md:px-8 py-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight text-black dark:text-white flex items-center gap-3">
                        <Sparkles className="w-8 h-8 text-indigo-500" />
                        AI Chatbot & Support Monitor
                    </h2>
                    <p className="text-zinc-500 font-medium mt-1">سجل استفسارات ومحادثات العملاء وتذاكر الدعم الفني المباشر مقسمة حسب الغرف والجلسات.</p>
                </div>
            </div>

            {/* Sub-tab Navigation */}
            <div className="flex items-center gap-3 border-b-2 border-zinc-200 dark:border-zinc-800 pb-3">
                <button
                    onClick={() => setViewMode("ai_config")}
                    className={`px-4 py-2 text-xs md:text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${
                        viewMode === "ai_config"
                            ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                            : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                    }`}
                >
                    <Sparkles className="w-4 h-4" />
                    <span>🤖 سجل محادثات الذكاء الاصطناعي (AI Chatbot)</span>
                    <span className="text-[10px] bg-black/20 dark:bg-white/20 px-2 py-0.5 rounded-full font-mono">
                        {userGroups.length}
                    </span>
                </button>
                <button
                    onClick={() => setViewMode("support_chats")}
                    className={`px-4 py-2 text-xs md:text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${
                        viewMode === "support_chats"
                            ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                            : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                    }`}
                >
                    <MessageSquare className="w-4 h-4" />
                    <span>💬 تذاكر ودعم العملاء المباشر (Human Support)</span>
                </button>
            </div>

            {viewMode === "support_chats" ? (
                <div className="w-full bg-white dark:bg-black border-4 border-black dark:border-white shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] p-4">
                    <SupportTab />
                </div>
            ) : (
                <div className="w-full">
                    <div className={isFullscreen 
                        ? "fixed inset-0 z-[100] bg-white dark:bg-black flex flex-col overflow-hidden m-0 w-full h-full" 
                        : "bg-white dark:bg-black border-4 border-black dark:border-white h-full min-h-[650px] shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] flex flex-col overflow-hidden"}>
                        
                        {/* Top Bar */}
                        <div className="p-4 md:p-6 border-b-2 border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-black">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
                                    <User className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-base md:text-lg font-bold uppercase tracking-tight text-black dark:text-white">
                                        AI Chat User Sessions & Rooms
                                    </h3>
                                    <p className="text-xs text-zinc-500 font-medium">
                                        {filteredUserGroups.length} من {userGroups.length} عميل مسجل
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setProOnly((value) => !value)}
                                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${proOnly ? "border-amber-500 bg-amber-500 text-black" : "border-zinc-300 text-zinc-500 hover:bg-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}
                                    title="تصفية المحادثات للمستخدمين المشتركين في Pro"
                                >
                                    <Crown className="w-3.5 h-3.5" />
                                    {proOnly ? "PRO فقط" : "كل المستخدمين"}
                                </button>
                                <button
                                    onClick={() => setIsFullscreen(!isFullscreen)}
                                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors text-zinc-500"
                                    title={isFullscreen ? "تصغير الواجهة" : "تكبير الواجهة"}
                                >
                                    {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={() => fetchLogs()}
                                    disabled={logsLoading}
                                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors text-zinc-500"
                                    title="تحديث المحادثات"
                                >
                                    <RefreshCw className={`w-5 h-5 ${logsLoading ? "animate-spin" : ""}`} />
                                </button>
                                {loadedLimit < 5000 && (
                                    <button
                                        onClick={() => fetchLogs(5000)}
                                        disabled={logsLoading}
                                        className="rounded-lg border border-zinc-300 px-2 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                        title="تحميل السجل الموسع حتى 5000 رسالة"
                                    >
                                        LOAD 5000
                                    </button>
                                )}
                            </div>
                        </div>

                        {logsLoading && logs.length === 0 ? (
                            <div className="flex items-center justify-center flex-1 min-h-[400px]">
                                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                            </div>
                        ) : logs.length === 0 ? (
                            <div className="flex items-center justify-center flex-1 min-h-[400px] text-zinc-500 font-medium">
                                لا توجد محادثات مسجلة حتى الآن.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-4 flex-1 overflow-hidden min-h-[550px]">
                                
                                {/* Right Column: Users List */}
                                <div className="md:col-span-1 border-l-2 border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50/50 dark:bg-black overflow-hidden order-first md:order-last">
                                    {/* Search Filter & Date Quick Tabs */}
                                    <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
                                        <div className="relative">
                                            <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
                                            <input
                                                type="text"
                                                value={searchUserQuery}
                                                onChange={(e) => setSearchUserQuery(e.target.value)}
                                                placeholder="بحث باسم العميل، الإيميل، أو نص..."
                                                className="w-full bg-white dark:bg-black border border-zinc-300 dark:border-zinc-800 pl-9 pr-3 py-2 text-xs rounded-lg text-black dark:text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {(["all", "today", "week"] as const).map((filterKey) => (
                                                <button
                                                    key={filterKey}
                                                    onClick={() => setDateFilter(filterKey)}
                                                    className={`flex-1 py-1 text-[11px] font-bold rounded-md transition-all text-center ${
                                                        dateFilter === filterKey
                                                            ? "bg-indigo-500 text-white shadow-sm"
                                                            : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:text-black dark:hover:text-white"
                                                    }`}
                                                >
                                                    {filterKey === "all" ? "الكل" : filterKey === "today" ? "اليوم" : "آخر 7 أيام"}
                                                </button>
                                            ))}
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
                                                    onClick={() => {
                                                        setSelectedUserId(group.user_id);
                                                        setSelectedSessionId(null);
                                                    }}
                                                    className={`w-full text-left p-3.5 transition-all flex items-center justify-between gap-2 ${
                                                        isSelected 
                                                            ? "bg-indigo-500/10 border-l-4 border-indigo-500 dark:bg-zinc-900" 
                                                            : isUnread 
                                                                ? "bg-blue-500/5 dark:bg-blue-950/20 hover:bg-blue-500/10"
                                                                : "hover:bg-zinc-100 dark:hover:bg-zinc-900/60"
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
                                                                {group.is_pro && <span title="مستخدم Pro" aria-label="Pro user"><Crown className="w-3.5 h-3.5 shrink-0 text-amber-500" /></span>}
                                                                {isUnread && (
                                                                    <span className="text-[9px] bg-blue-500 text-white px-1.5 py-0.2 rounded-full font-bold">
                                                                        جديد
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-[10px] text-zinc-500 flex items-center gap-2 mt-0.5">
                                                                <span>{group.sessions.length} غرف</span>
                                                                <span>•</span>
                                                                <span>{new Date(group.last_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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

                                {/* Main Area: Selected User Header, Rooms Bar, and Messages */}
                                <div className="md:col-span-3 flex flex-col h-full bg-white dark:bg-black overflow-hidden order-last md:order-first">
                                    {selectedGroup ? (
                                        <>
                                            {/* Top User Bar */}
                                            <div className="p-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-black flex items-center justify-between shrink-0">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold">
                                                        {selectedGroup.user_name.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-sm text-black dark:text-white flex items-center gap-2">
                                                            {selectedGroup.user_name}
                                                            {selectedGroup.is_pro && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400"><Crown className="w-3 h-3" /> PRO</span>}
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
                                                        الإجمالي: <span className="font-bold text-black dark:text-white">{selectedGroup.logs.length} رسالة</span>
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

                                            {/* Rooms / Sessions Bar */}
                                            <div className="border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-950 px-3 py-2 flex items-center gap-2 overflow-x-auto shrink-0">
                                                <span className="text-xs font-bold text-zinc-500 shrink-0 flex items-center gap-1">
                                                    <Folder className="w-3.5 h-3.5 text-indigo-500" />
                                                    الغرف ({selectedGroup.sessions.length}):
                                                </span>
                                                {selectedGroup.sessions.map((sess) => {
                                                    const isSelectedSession = activeSession?.id === sess.id;
                                                    const sessLastTime = new Date(sess.last_date).getTime();
                                                    const sessReadTime = readSessionTimestamps[sess.id] || 0;
                                                    const isSessionUnread = sessLastTime > sessReadTime;

                                                    return (
                                                        <button
                                                            key={sess.id}
                                                            onClick={() => setSelectedSessionId(sess.id)}
                                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 border ${
                                                                isSelectedSession
                                                                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                                                                    : sess.is_deleted_by_user
                                                                        ? "bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                                                                        : isSessionUnread
                                                                            ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-400"
                                                                            : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
                                                            }`}
                                                        >
                                                            {sess.is_deleted_by_user ? (
                                                                    <span title="تم إخفاؤها من جانب المستخدم"><Archive className="w-3 h-3 text-amber-500 shrink-0" /></span>
                                                            ) : (
                                                                <MessageSquare className="w-3 h-3 opacity-70 shrink-0" />
                                                            )}
                                                            <span className="max-w-[140px] truncate" title={sess.title}>
                                                                {sess.title || "محادثة"}
                                                            </span>
                                                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                                                isSelectedSession 
                                                                    ? "bg-black/30 text-white" 
                                                                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                                                            }`}>
                                                                {sess.logs.length}
                                                            </span>
                                                            {isSessionUnread && (
                                                                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                                            )}
                                                            {sess.is_deleted_by_user && (
                                                                <span className="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1 rounded">
                                                                    مخفية
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* Action Bar inside Room: Unread jump & Mark as Read */}
                                            <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs shrink-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-black dark:text-white">
                                                        غرفة: {activeSession?.title || "العامة"}
                                                    </span>
                                                    {activeSession?.is_deleted_by_user && (
                                                        <span className="bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold border border-amber-300 dark:border-amber-800 flex items-center gap-1">
                                                            <Archive className="w-3 h-3" />
                                                            المستخدم قام بإخفاء هذه الغرفة من حسابه (محفوظة للأدمن)
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    {unreadMessagesCount > 0 ? (
                                                        <button
                                                            onClick={scrollToFirstUnread}
                                                            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md text-xs font-black shadow-sm transition-all animate-bounce"
                                                            title="الانتقال التلقائي للرسائل الجديدة غير المقروءة"
                                                        >
                                                            <ArrowDown className="w-3.5 h-3.5" />
                                                            <span>الانتقال للجديد ({unreadMessagesCount} غير مقروءة)</span>
                                                        </button>
                                                    ) : (
                                                        <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1">
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            جميع الرسائل مقروءة
                                                        </span>
                                                    )}
                                                    <button
                                                        onClick={markActiveSessionAsRead}
                                                        className="px-2.5 py-1 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded transition-colors text-xs font-bold"
                                                        title="تعليم الغرفة كمقروءة الآن"
                                                    >
                                                        تعليم كمقروء
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Conversation Timeline */}
                                            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 relative">
                                                {activeMessages.map((log, index) => {
                                                    const msgTime = new Date(log.created_at).getTime();
                                                    const isMsgUnread = lastSessionReadTime > 0 && msgTime > lastSessionReadTime;
                                                    const isFirstUnread = isMsgUnread && (index === 0 || new Date(activeMessages[index - 1].created_at).getTime() <= lastSessionReadTime);

                                                    return (
                                                        <div 
                                                            key={log.id} 
                                                            ref={isFirstUnread ? firstUnreadRef : undefined}
                                                            className={`space-y-2 border-b border-zinc-100 dark:border-zinc-800/60 pb-4 last:border-b-0 rounded-lg p-2 transition-colors ${
                                                                isMsgUnread ? "bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40" : ""
                                                            }`}
                                                        >
                                                            {isFirstUnread && (
                                                                <div className="flex items-center gap-2 my-2">
                                                                    <div className="h-[2px] flex-1 bg-blue-500/50" />
                                                                    <span className="bg-blue-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                                                                        <ArrowDown className="w-3 h-3" /> رسائل جديدة غير مقروءة
                                                                    </span>
                                                                    <div className="h-[2px] flex-1 bg-blue-500/50" />
                                                                </div>
                                                            )}

                                                            <div className="text-[10px] font-mono text-zinc-400 text-center my-1 flex items-center justify-center gap-2">
                                                                <span>{new Date(log.created_at).toLocaleString()}</span>
                                                                {log.session_title && (
                                                                    <span className="text-[9px] bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.2 rounded font-sans text-zinc-600 dark:text-zinc-400">
                                                                        غرفة: {log.session_title}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* User Message */}
                                                            <div className="flex items-start gap-2.5 justify-end">
                                                                <div className="bg-zinc-100 dark:bg-zinc-900 border dark:border-zinc-800/80 text-black dark:text-zinc-100 p-3 rounded-2xl rounded-tr-none text-xs max-w-[85%] leading-relaxed">
                                                                    <span className="text-[10px] font-bold text-zinc-400 block mb-1">User:</span>
                                                                    {log.image_url && (
                                                                        <div className="mb-2">
                                                                            <a href={log.image_url} target="_blank" rel="noopener noreferrer" title="انقر لفتح الصورة بالحجم الكامل">
                                                                                <img 
                                                                                    src={log.image_url} 
                                                                                    alt="User Attached Image" 
                                                                                    className="max-w-[220px] max-h-48 rounded-lg border border-zinc-300 dark:border-zinc-700 object-cover shadow-sm hover:opacity-90 transition-opacity cursor-pointer" 
                                                                                />
                                                                            </a>
                                                                        </div>
                                                                    )}
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
                                                                <div className="bg-indigo-50/70 dark:bg-zinc-950 border border-indigo-100 dark:border-zinc-800/80 text-black dark:text-zinc-100 p-3 rounded-2xl rounded-tl-none text-xs max-w-[85%] leading-relaxed">
                                                                    <span className="text-[10px] font-bold text-indigo-500 block mb-1 flex items-center justify-between gap-1 w-full">
                                                                        <span className="flex items-center gap-1">
                                                                            <Sparkles className="w-3 h-3 text-indigo-500" /> EGX Bots AI:
                                                                        </span>
                                                                        <div className="flex items-center gap-1.5">
                                                                            {log.dataSource === "realtime" && (
                                                                                <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20 flex items-center gap-1" title="تم بناء الرد من بيانات السوق اللحظية">
                                                                                    <Zap className="w-3 h-3 text-amber-500" /> Real-time
                                                                                </span>
                                                                            )}
                                                                            {log.dataSource === "supabase" && (
                                                                                <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20 flex items-center gap-1" title="تم بناء الرد من قاعدة البيانات (Supabase)">
                                                                                    <Database className="w-3 h-3 text-blue-500" /> Supabase
                                                                                </span>
                                                                            )}
                                                                            {log.dataDate && (
                                                                                <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-400 bg-zinc-500/10 px-2 py-0.5 rounded-md border border-zinc-500/20 flex items-center gap-1" title="تاريخ البيانات التي اتخذ الموديل القرار عليها">
                                                                                    <Clock className="w-3 h-3 text-zinc-500" /> {log.dataDate}
                                                                                </span>
                                                                            )}
                                                                            {log.latency_ms && log.latency_ms > 0 && (
                                                                                <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 flex items-center gap-1">
                                                                                    <Clock className="w-3 h-3 text-emerald-500" /> {(log.latency_ms / 1000).toFixed(2)}s
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </span>
                                                                    <div className="text-black dark:text-zinc-100">
                                                                        {log.reply && log.reply.trim().length > 0 ? (
                                                                            <FormattedChatMessage
                                                                                content={log.reply}
                                                                                role="assistant"
                                                                                showSuggestedButtons={false}
                                                                                latencyMs={log.latency_ms}
                                                                                tables={Array.isArray(log.tables) ? log.tables : []}
                                                                            />
                                                                        ) : (
                                                                            <div className="text-zinc-400 dark:text-zinc-500 italic text-[11px] py-1 flex items-center gap-1.5">
                                                                                <span>⚠️</span>
                                                                                <span>لم يتم تسجيل رد من المساعد (أو انقطع الاتصال أثناء التوليد)</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-2 p-6">
                                            <User className="w-12 h-12 text-zinc-300 dark:text-zinc-700" />
                                            <p className="text-sm font-medium">اختر مستخدماً لعرض غرفه ومحادثاته مع المساعد الذكي.</p>
                                        </div>
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
