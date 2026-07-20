"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/contexts/AuthContext";
import { useTechnicalScanner } from "@/contexts/TechnicalScannerContext";
import { useRouter } from "next/navigation";

// Simple message type
export type ChatMessage = {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    actions?: ChatAction[];
};

type ChatAction = {
    label: string;
    type: "navigate" | "function";
    value: string; // URL or function name
};

interface ChatContextType {
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    messages: ChatMessage[];
    sendMessage: (text: string) => Promise<void>;
    isLoading: boolean;
    remainingQuota: number;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const { setTechScanner } = useTechnicalScanner();
    const router = useRouter();
    const supabase = createSupabaseBrowserClient();

    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const [remainingQuota, setRemainingQuota] = useState<number>(4);

    // Initial Welcome Message
    useEffect(() => {
        setMessages([
            {
                role: "assistant",
                content: "Hello! I am your AI Market Assistant. I can help you analyze stocks, explain indicators, or navigate the app. How can I help today?",
                timestamp: Date.now(),
            }
        ]);
    }, []);

    // Initialize Context
    useEffect(() => {
        if (!user) return;
        // Optional: Pre-fetch quota if needed, but the API will return it on first message.
    }, [user]);

    const handleAction = useCallback((action: ChatAction) => {
        if (action.type === "navigate") {
            router.push(action.value);
            setIsOpen(false); // Optional: close on nav
        } else if (action.type === "function") {
            // Handle specific triggers
            if (action.value === "SCAN_TECH_BULLISH") {
                setTechScanner(prev => ({ ...prev, rsiMin: "50", rsiMax: "70", aboveEma200: true }));
                router.push("/scanner/technical");
            }
            // Add more actions here
        }
    }, [router, setTechScanner]);

    const sendMessage = async (text: string) => {
        if (!text.trim()) return;

        const newUserMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
        setMessages(prev => [...prev, newUserMsg]);
        setIsLoading(true);

        try {
            if (remainingQuota <= 0) {
                setMessages(prev => [...prev, {
                    role: "assistant",
                    content: "Daily limit reached. You can send up to 4 messages per day. Please come back tomorrow!",
                    timestamp: Date.now()
                }]);
                setIsLoading(false);
                return;
            }

            const response = await fetch("/api/ai-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: text, history: messages })
            });

            const data = await response.json();
            
            if (response.status === 429) {
                setRemainingQuota(0);
                setMessages(prev => [...prev, {
                    role: "assistant",
                    content: data.detail || "Daily limit reached. You can send up to 4 messages per day.",
                    timestamp: Date.now()
                }]);
                return;
            }

            if (!response.ok) {
                throw new Error(data.detail || "Failed to communicate with AI");
            }

            if (data.remaining_quota !== undefined) {
                setRemainingQuota(data.remaining_quota);
            }

            setMessages(prev => [...prev, {
                role: "assistant",
                content: data.reply || "Sorry, I couldn't process that.",
                timestamp: Date.now()
            }]);

        } catch (err) {
            setMessages(prev => [...prev, {
                role: "assistant",
                content: "Error communicating with AI service.",
                timestamp: Date.now()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ChatContext.Provider value={{ isOpen, setIsOpen, messages, sendMessage, isLoading, remainingQuota }}>
            {children}
        </ChatContext.Provider>
    );
}

export function useChat() {
    const context = useContext(ChatContext);
    if (!context) throw new Error("useChat must be used within ChatProvider");
    return context;
}
