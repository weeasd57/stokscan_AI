"use client";

import React, { useState, useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Send, User, Bot, Loader2, MessageSquare, Clock } from "lucide-react";

type ChatSession = {
    session_id: string;
    user_name: string;
    last_message: string;
    last_message_time: string;
};

type SupportMessage = {
    id: string;
    session_id: string;
    sender: "user" | "admin";
    content: string;
    user_name: string;
    created_at: string;
};

export default function SupportTab() {
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [loadingSessions, setLoadingSessions] = useState(true);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [input, setInput] = useState("");
    const [replying, setReplying] = useState(false);

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

    // Scroll to bottom when messages load/change
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [messages]);

    // Fetch initial chat sessions list
    const fetchSessions = async () => {
        try {
            setLoadingSessions(true);
            const res = await fetch("/api/admin/support/chats");
            const data = await res.json();
            if (data.chats) {
                setSessions(data.chats);
            }
        } catch (err) {
            console.error("Error fetching support chats:", err);
        } finally {
            setLoadingSessions(false);
        }
    };

    useEffect(() => {
        void fetchSessions();
    }, []);

    // Load messages when a session is selected
    useEffect(() => {
        if (!selectedSessionId) {
            setMessages([]);
            return;
        }

        const fetchMessages = async () => {
            try {
                setLoadingMessages(true);
                const res = await fetch(`/api/admin/support/messages?session_id=${selectedSessionId}`);
                const data = await res.json();
                if (data.messages) {
                    setMessages(data.messages);
                }
            } catch (err) {
                console.error("Error fetching session messages:", err);
            } finally {
                setLoadingMessages(false);
            }
        };

        void fetchMessages();

        // Subscribe to messages in this session in real-time (WebSockets)
        const channel = supabase
            .channel(`admin-session-ws-${selectedSessionId}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "support_messages",
                    filter: `session_id=eq.${selectedSessionId}`
                },
                (payload: any) => {
                    const newMsg = payload.new as SupportMessage;
                    setMessages((prev) => {
                        if (prev.some((m) => m.id === newMsg.id)) return prev;
                        const tempIndex = prev.findIndex((m) => m.id.startsWith("temp-") && m.content === newMsg.content && m.sender === newMsg.sender);
                        if (tempIndex > -1) {
                            const list = [...prev];
                            list[tempIndex] = newMsg;
                            return list;
                        }
                        return [...prev, newMsg];
                    });
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [selectedSessionId, supabase]);

    // Subscribe to all new message inserts to update the session list dynamically (WebSockets)
    useEffect(() => {
        const listChannel = supabase
            .channel("admin-support-list-ws")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "support_messages"
                },
                (payload: any) => {
                    const newMsg = payload.new as SupportMessage;
                    setSessions((prev) => {
                        const existingIndex = prev.findIndex((s) => s.session_id === newMsg.session_id);
                        const updatedSession = {
                            session_id: newMsg.session_id,
                            user_name: newMsg.user_name || "Guest",
                            last_message: newMsg.content,
                            last_message_time: newMsg.created_at
                        };
                        const list = [...prev];
                        if (existingIndex > -1) {
                            list.splice(existingIndex, 1);
                        }
                        return [updatedSession, ...list];
                    });
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(listChannel);
        };
    }, [supabase]);

    const handleSendReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !selectedSessionId) return;

        const content = input.trim();
        setInput("");
        setReplying(true);

        const tempId = "temp-admin-" + Math.random().toString(36).substring(2) + Date.now().toString(36);
        const optimisticMsg: SupportMessage = {
            id: tempId,
            session_id: selectedSessionId,
            sender: "admin",
            content,
            user_name: "Admin",
            created_at: new Date().toISOString()
        };

        setMessages((prev) => [...prev, optimisticMsg]);

        try {
            const res = await fetch("/api/admin/support/reply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: selectedSessionId,
                    content
                })
            });
            const data = await res.json();
            if (data.ok && data.message) {
                setMessages((prev) =>
                    prev.map((m) => m.id === tempId ? data.message : m)
                );
            }
        } catch (err) {
            console.error("Error sending admin reply:", err);
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
        } finally {
            setReplying(false);
        }
    };

    return (
        <div className="flex h-[calc(100vh-230px)] border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white overflow-hidden">
            {/* Sidebar: Chat Sessions List */}
            <div className="w-1/3 border-r-4 border-black dark:border-white flex flex-col h-full bg-zinc-50 dark:bg-zinc-900/40">
                <div className="p-4 border-b-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-pink-500" />
                    <span className="text-xs font-black uppercase tracking-wider">Customer Support Chats</span>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-800">
                    {loadingSessions ? (
                        <div className="flex items-center justify-center p-8">
                            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="p-6 text-center text-zinc-400 dark:text-zinc-500 font-bold text-xs">
                            No active chat sessions.
                        </div>
                    ) : (
                        sessions.map((sess) => {
                            const isSelected = selectedSessionId === sess.session_id;
                            return (
                                <button
                                    key={sess.session_id}
                                    onClick={() => setSelectedSessionId(sess.session_id)}
                                    className={`w-full text-left p-4 transition-all flex flex-col gap-1 rounded-none hover:bg-zinc-100 dark:hover:bg-zinc-800/40 ${
                                        isSelected ? "bg-pink-500/10 dark:bg-pink-500/10 border-l-4 border-pink-500" : ""
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-black text-xs text-black dark:text-white truncate max-w-[70%]">{sess.user_name}</span>
                                        <span className="text-[9px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1 font-mono">
                                            <Clock className="h-3 w-3" />
                                            {new Date(sess.last_message_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate max-w-full font-mono">{sess.last_message}</p>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Chat Pane */}
            <div className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950">
                {selectedSessionId ? (
                    <>
                        {/* Session Header */}
                        <div className="p-4 border-b-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="font-black text-xs text-black dark:text-white">
                                    Chatting with: {sessions.find(s => s.session_id === selectedSessionId)?.user_name || "Guest"}
                                </span>
                                <span className="text-[9px] text-zinc-500 dark:text-zinc-500 font-mono">Session ID: {selectedSessionId}</span>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div 
                            ref={messagesContainerRef}
                            className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-white dark:bg-zinc-950"
                        >
                            {loadingMessages ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
                                </div>
                            ) : (
                                messages.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`flex gap-3 ${msg.sender === "admin" ? "flex-row-reverse" : "flex-row"}`}
                                    >
                                        <div className={`
                                            h-8 w-8 rounded-none border-2 border-black flex items-center justify-center shrink-0
                                            ${msg.sender === "admin" ? "bg-pink-500 text-black border-pink-500" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700"}
                                        `}>
                                            {msg.sender === "admin" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                                        </div>
                                        <div className={`
                                            max-w-[70%] p-3.5 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,0.15)] dark:shadow-[2px_2px_0px_rgba(255,255,255,0.05)] font-mono text-xs
                                            ${msg.sender === "admin"
                                                ? "bg-pink-50 dark:bg-pink-500/10 border-pink-400 dark:border-pink-500 text-pink-900 dark:text-pink-200"
                                                : "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700"}
                                        `}>
                                            <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                                            <div className="text-[8px] text-zinc-400 dark:text-zinc-500 mt-2 text-right">
                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Input Area */}
                        <form onSubmit={handleSendReply} className="p-4 border-t-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Type support reply..."
                                className="flex-1 h-12 rounded-none bg-white dark:bg-zinc-950 border-2 border-black dark:border-zinc-700 px-4 text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-pink-500 focus:outline-none transition-colors"
                            />
                            <button
                                type="submit"
                                disabled={replying || !input.trim()}
                                className="h-12 w-12 rounded-none bg-pink-500 hover:bg-pink-400 border-2 border-black dark:border-zinc-700 text-black flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </button>
                        </form>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500 p-8">
                        <MessageSquare className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mb-2 animate-bounce" />
                        <span className="font-black text-xs uppercase tracking-wider">Select a session to start chatting</span>
                    </div>
                )}
            </div>
        </div>
    );
}
