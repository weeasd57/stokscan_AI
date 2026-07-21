"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/contexts/AuthContext";
import { useTechnicalScanner } from "@/contexts/TechnicalScannerContext";
import { useRouter } from "next/navigation";

// Simple message type
export type ChatMessage = {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    imageUrl?: string; // base64 data URL for single image message (backward compat)
    images?: string[]; // Array of base64 data URLs for multi-image messages
    actions?: ChatAction[];
};

type ChatAction = {
    label: string;
    type: "navigate" | "function";
    value: string; // URL or function name
};

export const AVAILABLE_AI_MODELS = [
    { id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B", badgeAr: "الأذكى ✨", badgeEn: "Smartest ✨", descAr: "نموذج الذكاء الاصطناعي الأقوى لتحليل البورصة", descEn: "Most capable model for stock analysis" },
    { id: "z-ai/glm-5.2", name: "GLM 5.2", badgeAr: "تحليلي 📊", badgeEn: "Analytical 📊", descAr: "متخصص في التفكير والتحليل المالي المعقد", descEn: "Specialized in reasoning and financial math" },
    { id: "nvidia/nemotron-4-340b-instruct", name: "Nemotron 340B", badgeAr: "عملاق 🚀", badgeEn: "Pro 🚀", descAr: "أحد أضخم الموديلات لمعالجة البيانات بدقة", descEn: "Ultra-large model for data precision" },
    { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B", badgeAr: "سريع ⚡", badgeEn: "Fast ⚡", descAr: "فائق السرعة للإجابات المباشرة السريعة", descEn: "Ultra-fast response for simple queries" },
];

interface ChatContextType {
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    messages: ChatMessage[];
    sendMessage: (text: string, imageInput?: string | string[]) => Promise<void>;
    isLoading: boolean;
    remainingQuota: number;
    selectedModel: string;
    setSelectedModel: (model: string) => void;
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
    const [remainingQuota, setRemainingQuota] = useState<number>(15);
    const [selectedModel, setSelectedModelState] = useState<string>("meta/llama-3.3-70b-instruct");

    // Keep ref in sync for instant closure access inside async handlers
    const messagesRef = useRef<ChatMessage[]>(messages);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        const savedModel = localStorage.getItem("egxbots_selected_model");
        if (savedModel && AVAILABLE_AI_MODELS.some(m => m.id === savedModel)) {
            setSelectedModelState(savedModel);
        }
    }, []);

    const setSelectedModel = useCallback((model: string) => {
        setSelectedModelState(model);
        localStorage.setItem("egxbots_selected_model", model);
    }, []);

    const WELCOME_MSG: ChatMessage = {
        role: "assistant",
        content: "Hello! I am your AI Market Assistant. I can help you analyze stocks, explain indicators, or navigate the app. You can also send me images 📷 to analyze. How can I help today?",
        timestamp: Date.now(),
    };

    // Load initial history from localStorage
    useEffect(() => {
        try {
            const cached = localStorage.getItem("egxbots_chat_history");
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setMessages(parsed);
                    messagesRef.current = parsed;
                    return;
                }
            }
        } catch (e) {
            console.error("Failed to load cached chat history");
        }
        setMessages([WELCOME_MSG]);
        messagesRef.current = [WELCOME_MSG];
    }, []);

    // Save messages to localStorage whenever updated
    useEffect(() => {
        if (messages.length > 0) {
            try {
                // Don't persist large image base64 to localStorage to avoid quota issues
                const toCache = messages.map(m => ({
                    ...m,
                    imageUrl: m.imageUrl ? "[image]" : undefined,
                    images: m.images ? m.images.map(() => "[image]") : undefined,
                }));
                localStorage.setItem("egxbots_chat_history", JSON.stringify(toCache));
            } catch (e) {
                console.error("Failed to cache chat history");
            }
        }
    }, [messages]);

    // Fetch latest history and quota from server on mount / auth change
    useEffect(() => {
        let isMounted = true;

        const fetchHistoryAndQuota = async () => {
            try {
                const res = await fetch("/api/ai-chat");
                if (!isMounted) return;

                if (res.ok) {
                    const data = await res.json();
                    if (!isMounted) return;

                    if (data.remaining_quota !== undefined) {
                        setRemainingQuota(data.remaining_quota);
                    }
                    if (Array.isArray(data.history) && data.history.length > 0) {
                        setMessages(prev => {
                            const serverUserMessages = new Set(data.history.map((h: any) => h.content));
                            const unsavedLocal = prev.filter(m => m.role === "user" && !serverUserMessages.has(m.content));

                            const combined = [WELCOME_MSG, ...data.history, ...unsavedLocal];
                            messagesRef.current = combined;
                            return combined;
                        });
                    }
                }
            } catch (e) {
                console.error("Failed to fetch chat history from server:", e);
            }
        };

        fetchHistoryAndQuota();

        return () => {
            isMounted = false;
        };
    }, [user]);

    const handleAction = useCallback((action: ChatAction) => {
        if (action.type === "navigate") {
            router.push(action.value);
            setIsOpen(false);
        } else if (action.type === "function") {
            if (action.value === "SCAN_TECH_BULLISH") {
                setTechScanner(prev => ({ ...prev, rsiMin: "50", rsiMax: "70", aboveEma200: true }));
                router.push("/scanner/technical");
            }
        }
    }, [router, setTechScanner]);

    const sendMessage = useCallback(async (text: string, imageInput?: string | string[]) => {
        const imagesList: string[] = Array.isArray(imageInput) 
            ? imageInput 
            : (imageInput ? [imageInput] : []);

        if (!text.trim() && imagesList.length === 0) return;

        const newUserMsg: ChatMessage = {
            role: "user",
            content: text || (imagesList.length > 0 ? `📷 [${imagesList.length} Images attached]` : ""),
            timestamp: Date.now(),
            imageUrl: imagesList[0] || undefined,
            images: imagesList.length > 0 ? imagesList : undefined,
        };

        // Capture history snapshot before appending new user message
        const historySnapshot = [...messagesRef.current];

        // Immediately update state and ref
        const nextMessages = [...historySnapshot, newUserMsg];
        setMessages(nextMessages);
        messagesRef.current = nextMessages;
        setIsLoading(true);

        try {
            if (remainingQuota <= 0) {
                const limitMsg: ChatMessage = {
                    role: "assistant",
                    content: "Daily limit reached. You can send up to 15 messages per day. Please come back tomorrow!",
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, limitMsg]);
                messagesRef.current = [...messagesRef.current, limitMsg];
                setIsLoading(false);
                return;
            }

            const response = await fetch("/api/ai-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text || "Describe and analyze these attached images.",
                    history: historySnapshot.map(m => ({ role: m.role, content: m.content })),
                    images: imagesList.length > 0 ? imagesList : undefined,
                    image: imagesList[0] || undefined,
                    model: selectedModel,
                })
            });

            const data = await response.json();
            
            if (response.status === 429) {
                setRemainingQuota(0);
                const limitMsg: ChatMessage = {
                    role: "assistant",
                    content: data.detail || "Daily limit reached. You can send up to 15 messages per day.",
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, limitMsg]);
                messagesRef.current = [...messagesRef.current, limitMsg];
                return;
            }

            if (!response.ok) {
                throw new Error(data.detail || "Failed to communicate with AI");
            }

            if (data.remaining_quota !== undefined) {
                setRemainingQuota(data.remaining_quota);
            }

            const assistantMsg: ChatMessage = {
                role: "assistant",
                content: data.reply || "Sorry, I couldn't process that.",
                timestamp: Date.now()
            };
            setMessages(prev => [...prev, assistantMsg]);
            messagesRef.current = [...messagesRef.current, assistantMsg];

        } catch (err: any) {
            const errorMsg: ChatMessage = {
                role: "assistant",
                content: "Error communicating with AI service.",
                timestamp: Date.now()
            };
            setMessages(prev => [...prev, errorMsg]);
            messagesRef.current = [...messagesRef.current, errorMsg];
        } finally {
            setIsLoading(false);
        }
    }, [remainingQuota, selectedModel]);

    return (
        <ChatContext.Provider value={{ 
            isOpen, 
            setIsOpen, 
            messages, 
            sendMessage, 
            isLoading, 
            remainingQuota, 
            selectedModel, 
            setSelectedModel 
        }}>
            {children}
        </ChatContext.Provider>
    );
}

export function useChat() {
    const context = useContext(ChatContext);
    if (!context) throw new Error("useChat must be used within ChatProvider");
    return context;
}
