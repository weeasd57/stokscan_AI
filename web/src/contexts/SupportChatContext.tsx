"use client";

import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type SupportMessage = {
    id: string;
    session_id: string;
    sender: "user" | "admin";
    content: string;
    user_name: string;
    created_at: string;
};

interface SupportChatContextType {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    messages: SupportMessage[];
    sessionId: string;
    sendMessage: (content: string) => Promise<void>;
    loading: boolean;
    unreadCount: number;
    resetUnreadCount: () => void;
}

const SupportChatContext = createContext<SupportChatContextType | undefined>(undefined);

export function SupportChatProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [sessionId, setSessionId] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    // Load or generate session ID
    useEffect(() => {
        if (user) {
            setSessionId(user.id);
        } else {
            let storedId = localStorage.getItem("support_session_id");
            if (!storedId) {
                storedId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
                localStorage.setItem("support_session_id", storedId);
            }
            setSessionId(storedId);
        }
    }, [user]);

    // Load history and subscribe to changes
    useEffect(() => {
        if (!sessionId) return;

        const fetchHistory = async () => {
            try {
                const res = await fetch(`/api/support/messages?session_id=${sessionId}`);
                const data = await res.json();
                if (data.messages) {
                    setMessages(data.messages);
                }
            } catch (err) {
                console.error("Error loading chat history:", err);
            }
        };
        void fetchHistory();

        const channel = supabase
            .channel(`support-chat-provider-${sessionId}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "support_messages",
                    filter: `session_id=eq.${sessionId}`
                },
                (payload: any) => {
                    const newMsg = payload.new as SupportMessage;
                    setMessages((prev) => {
                        // 1. If we already have this message by real ID, skip
                        if (prev.some((m) => m.id === newMsg.id)) return prev;
                        // 2. If we have a matching optimistic message, replace it
                        const tempIndex = prev.findIndex((m) => m.id.startsWith("temp-") && m.content === newMsg.content && m.sender === newMsg.sender);
                        if (tempIndex > -1) {
                            const list = [...prev];
                            list[tempIndex] = newMsg;
                            return list;
                        }
                        return [...prev, newMsg];
                    });

                    // If widget is closed and message is from admin, increment unreadCount
                    if (!isOpen && newMsg.sender === "admin") {
                        setUnreadCount((c) => c + 1);
                    }
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [sessionId, supabase, isOpen]);

    // Reset unread count when opening the widget
    useEffect(() => {
        if (isOpen) {
            setUnreadCount(0);
        }
    }, [isOpen]);

    const sendMessage = async (content: string) => {
        if (!content.trim() || !sessionId) return;
        setLoading(true);

        const userName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Guest";

        // Create and append an optimistic message instantly
        const tempId = "temp-" + Math.random().toString(36).substring(2) + Date.now().toString(36);
        const optimisticMsg: SupportMessage = {
            id: tempId,
            session_id: sessionId,
            sender: "user",
            content,
            user_name: userName,
            created_at: new Date().toISOString()
        };

        setMessages((prev) => [...prev, optimisticMsg]);

        try {
            const res = await fetch("/api/support/message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: sessionId,
                    content,
                    user_name: userName
                })
            });
            const data = await res.json();
            if (data.ok && data.message) {
                // Replace optimistic message with actual DB message (which has database ID and fields)
                setMessages((prev) =>
                    prev.map((m) => m.id === tempId ? data.message : m)
                );
            }
        } catch (err) {
            console.error("Error sending message:", err);
            // Rollback optimistic message on error
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
        } finally {
            setLoading(false);
        }
    };

    const value = useMemo(() => ({
        isOpen,
        setIsOpen,
        messages,
        sessionId,
        sendMessage,
        loading,
        unreadCount,
        resetUnreadCount: () => setUnreadCount(0)
    }), [isOpen, messages, sessionId, loading, unreadCount]);

    return (
        <SupportChatContext.Provider value={value}>
            {children}
        </SupportChatContext.Provider>
    );
}

export function useSupportChat() {
    const context = useContext(SupportChatContext);
    if (!context) {
        throw new Error("useSupportChat must be used within a SupportChatProvider");
    }
    return context;
}
