"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ChatSession } from "@/components/chat/ChatSidebar";

export type ChatMessage = {
    id?: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    imageUrl?: string;
    images?: string[];
    actions?: ChatAction[];
};

type ChatAction = {
    label: string;
    type: "navigate" | "function";
    value: string;
};

export const AVAILABLE_AI_MODELS = [
    { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B", badgeAr: "فائق السرعة ⚡", badgeEn: "Ultra Fast ⚡", descAr: "استجابة صواريخ خلال 1-2 ثانية بتحليل مباشر للبورصة", descEn: "Ultra-fast 1-2s response for instant EGX stock analysis" },
    { id: "meta/llama-3.2-11b-vision-instruct", name: "Llama 3.2 Vision", badgeAr: "رؤية الصور 📷", badgeEn: "Vision 📷", descAr: "متخصص في قراءة وتحليل صور الشاشات والمحافظ المالية", descEn: "Specialized in analyzing portfolio screenshots" },
    { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash", badgeAr: "تفكير عالي 🧠", badgeEn: "Reasoning 🧠", descAr: "نموذج الاستدلال الفني والمالي والتفكير المعمق", descEn: "Specialized in deep reasoning and financial logic" },
    { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro", badgeAr: "العملاق 🔥", badgeEn: "Ultra MoE 🔥", descAr: "نموذج ديب سيك V4 الأحدث بسياق 1M وسرعة تحليل", descEn: "Latest DeepSeek V4 Pro model with 1M context" },
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
    sessions: ChatSession[];
    activeSessionId: string | null;
    createNewSession: () => void;
    switchSession: (sessionId: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    renameSession: (sessionId: string, newTitle: string) => Promise<void>;
    isSidebarOpen: boolean;
    setIsSidebarOpen: (v: boolean) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

// Local Storage Persistence Helpers
function getStoredSessions(): ChatSession[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem("egxbots_chat_sessions_v2");
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveStoredSessions(sessions: ChatSession[]) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem("egxbots_chat_sessions_v2", JSON.stringify(sessions));
    } catch (e) {
        console.error("Failed to save sessions to localStorage:", e);
    }
}

function getStoredMessages(sessionId: string): ChatMessage[] {
    if (typeof window === "undefined" || !sessionId) return [];
    try {
        const raw = localStorage.getItem(`egxbots_msgs_${sessionId}`);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveStoredMessages(sessionId: string, msgs: ChatMessage[]) {
    if (typeof window === "undefined" || !sessionId) return;
    try {
        const cleanMsgs = msgs.map(m => ({
            ...m,
            imageUrl: m.imageUrl ? "[image]" : undefined,
            images: m.images ? m.images.map(() => "[image]") : undefined
        }));
        localStorage.setItem(`egxbots_msgs_${sessionId}`, JSON.stringify(cleanMsgs));
    } catch (e) {
        console.error("Failed to save messages to localStorage:", e);
    }
}

export function ChatProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();

    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [remainingQuota, setRemainingQuota] = useState<number>(15);
    const [selectedModel, setSelectedModelState] = useState<string>("meta/llama-3.1-8b-instruct");
    const [sessions, setSessionsState] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

    const sessionMessagesCache = useRef<Record<string, ChatMessage[]>>({});
    const loadingSessionIds = useRef<Record<string, boolean>>({});
    const activeSessionIdRef = useRef<string | null>(activeSessionId);

    const setActiveSessionId = useCallback((id: string | null) => {
        activeSessionIdRef.current = id;
        setActiveSessionIdState(id);
    }, []);

    const messagesRef = useRef<ChatMessage[]>(messages);

    const setSessions = useCallback((updater: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])) => {
        setSessionsState(prev => {
            const next = typeof updater === "function" ? updater(prev) : updater;
            saveStoredSessions(next);
            return next;
        });
    }, []);

    useEffect(() => {
        messagesRef.current = messages;
        if (activeSessionId && messages.length > 0) {
            sessionMessagesCache.current[activeSessionId] = messages;
            saveStoredMessages(activeSessionId, messages);
        }
    }, [messages, activeSessionId]);

    // Load initial sessions from localStorage on mount
    useEffect(() => {
        const localSessions = getStoredSessions();
        if (localSessions.length > 0) {
            setSessionsState(localSessions);
            const latest = localSessions[0];
            setActiveSessionId(latest.id);
            const localMsgs = getStoredMessages(latest.id);
            if (localMsgs.length > 0) {
                setMessages(localMsgs);
                messagesRef.current = localMsgs;
                sessionMessagesCache.current[latest.id] = localMsgs;
            }
        }
    }, [setActiveSessionId]);

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

    const fetchSessions = useCallback(async () => {
        try {
            const res = await fetch("/api/ai-chat?action=sessions");
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.sessions)) {
                    setSessions(prevLocal => {
                        const localMap = new Map(prevLocal.map(s => [s.id, s]));
                        data.sessions.forEach((srvS: ChatSession) => {
                            localMap.set(srvS.id, srvS);
                        });
                        const merged = Array.from(localMap.values());
                        merged.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
                        return merged;
                    });

                    if (!activeSessionIdRef.current && data.sessions.length > 0) {
                        const latestId = data.sessions[0].id;
                        setActiveSessionId(latestId);
                        fetchSessionMessages(latestId);
                    }
                }
                if (data.remaining_quota !== undefined) {
                    setRemainingQuota(data.remaining_quota);
                }
            }
        } catch (e) {
            console.error("Failed to fetch chat sessions:", e);
        }
    }, [setActiveSessionId, setSessions]);

    const fetchSessionMessages = async (sessionId: string) => {
        try {
            const res = await fetch(`/api/ai-chat?session_id=${sessionId}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.history) && data.history.length > 0) {
                    sessionMessagesCache.current[sessionId] = data.history;
                    saveStoredMessages(sessionId, data.history);

                    if (activeSessionIdRef.current === sessionId) {
                        setMessages(data.history);
                        messagesRef.current = data.history;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to load session messages from server:", e);
        }
    };

    // Switch active session instantly while preserving per-session loading state
    const switchSession = useCallback(async (sessionId: string) => {
        setActiveSessionId(sessionId);

        // Preserve and sync loading status for target session
        const isTargetLoading = !!loadingSessionIds.current[sessionId];
        setIsLoading(isTargetLoading);

        // 1. Memory Cache
        if (sessionMessagesCache.current[sessionId] && sessionMessagesCache.current[sessionId].length > 0) {
            setMessages(sessionMessagesCache.current[sessionId]);
            messagesRef.current = sessionMessagesCache.current[sessionId];
        } else {
            // 2. localStorage
            const localMsgs = getStoredMessages(sessionId);
            if (localMsgs.length > 0) {
                setMessages(localMsgs);
                messagesRef.current = localMsgs;
                sessionMessagesCache.current[sessionId] = localMsgs;
            } else {
                setMessages([]);
                messagesRef.current = [];
            }
        }

        // 3. Fetch background sync from server
        await fetchSessionMessages(sessionId);
    }, [setActiveSessionId]);

    const createNewSession = useCallback(() => {
        setActiveSessionId(null);
        setMessages([]);
        messagesRef.current = [];
        setIsLoading(false);
    }, [setActiveSessionId]);

    const deleteSession = useCallback(async (sessionId: string) => {
        delete sessionMessagesCache.current[sessionId];
        delete loadingSessionIds.current[sessionId];
        if (typeof window !== "undefined") {
            localStorage.removeItem(`egxbots_msgs_${sessionId}`);
        }
        setSessions(prev => prev.filter(s => s.id !== sessionId));

        if (activeSessionIdRef.current === sessionId) {
            createNewSession();
        }

        try {
            await fetch(`/api/ai-chat?session_id=${sessionId}`, { method: "DELETE" });
        } catch (e) {
            console.error("Failed to delete chat session from server:", e);
        }
    }, [createNewSession, setSessions]);

    const renameSession = useCallback(async (sessionId: string, newTitle: string) => {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
        try {
            await fetch("/api/ai-chat", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: sessionId, title: newTitle })
            });
        } catch (e) {
            console.error("Failed to rename session on server:", e);
        }
    }, [setSessions]);

    useEffect(() => {
        fetchSessions();
    }, [user, fetchSessions]);

    const sendMessage = useCallback(async (text: string, imageInput?: string | string[]) => {
        const imagesList: string[] = Array.isArray(imageInput) 
            ? imageInput 
            : (imageInput ? [imageInput] : []);

        if (!text.trim() && imagesList.length === 0) return;

        let currentSessionId = activeSessionIdRef.current;
        if (!currentSessionId) {
            currentSessionId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "session-" + Date.now();
            setActiveSessionId(currentSessionId);
            
            const sessionTitle = text.trim() 
                ? text.trim().substring(0, 32) + (text.length > 32 ? "..." : "")
                : (imagesList.length > 0 ? "تحليل صورة محفظة" : "محادثة جديدة");

            setSessions(prev => [{
                id: currentSessionId!,
                title: sessionTitle,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, ...prev]);
        }

        const newUserMsg: ChatMessage = {
            role: "user",
            content: text || (imagesList.length > 0 ? `📷 [${imagesList.length} Images attached]` : ""),
            timestamp: Date.now(),
            imageUrl: imagesList[0] || undefined,
            images: imagesList.length > 0 ? imagesList : undefined,
        };

        const existingSessionMsgs = sessionMessagesCache.current[currentSessionId] || messagesRef.current;
        const nextMessages = [...existingSessionMsgs, newUserMsg];

        if (activeSessionIdRef.current === currentSessionId) {
            setMessages(nextMessages);
            messagesRef.current = nextMessages;
        }

        sessionMessagesCache.current[currentSessionId] = nextMessages;
        saveStoredMessages(currentSessionId, nextMessages);

        // Mark loading state for this session
        loadingSessionIds.current[currentSessionId] = true;
        if (activeSessionIdRef.current === currentSessionId) {
            setIsLoading(true);
        }

        const appendAssistantResponse = (assistantMsg: ChatMessage) => {
            const currentMsgs = sessionMessagesCache.current[currentSessionId!] || [];
            const updated = [...currentMsgs, assistantMsg];

            sessionMessagesCache.current[currentSessionId!] = updated;
            saveStoredMessages(currentSessionId!, updated);

            if (activeSessionIdRef.current === currentSessionId) {
                setMessages(updated);
                messagesRef.current = updated;
            }
        };

        try {
            if (remainingQuota <= 0) {
                appendAssistantResponse({
                    role: "assistant",
                    content: "وصلت للحد الأقصى اليومي (15 رسالة يومياً). يرجى العودة غداً أو تواصل مع الدعم الفني!",
                    timestamp: Date.now()
                });
                return;
            }

            const response = await fetch("/api/ai-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text || "قم بقراءة وتحليل هذه الصورة المرفقة.",
                    history: existingSessionMsgs.map(m => ({ role: m.role, content: m.content })),
                    images: imagesList.length > 0 ? imagesList : undefined,
                    image: imagesList[0] || undefined,
                    model: selectedModel,
                    session_id: currentSessionId,
                })
            });

            if (response.status === 504 || response.status === 502) {
                appendAssistantResponse({
                    role: "assistant",
                    content: "استغرقت الاستجابة وقتاً أطول من المعتاد بسبب الضغط على الموديل. يرجى إعادة المحاولة أو اختيار موديل أسرع مثل Llama 3.1 8B ⚡",
                    timestamp: Date.now()
                });
                return;
            }

            const data = await response.json();
            
            if (response.status === 429) {
                setRemainingQuota(0);
                appendAssistantResponse({
                    role: "assistant",
                    content: data.detail || "وصلت للحد الأقصى اليومي 15 رسالة.",
                    timestamp: Date.now()
                });
                return;
            }

            if (!response.ok) {
                throw new Error(data.detail || "Failed to communicate with AI");
            }

            if (data.remaining_quota !== undefined) {
                setRemainingQuota(data.remaining_quota);
            }

            appendAssistantResponse({
                role: "assistant",
                content: data.reply || "معذرة، لم أتمكن من معالجة هذا الطلب.",
                timestamp: Date.now()
            });

        } catch (err: any) {
            appendAssistantResponse({
                role: "assistant",
                content: "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.",
                timestamp: Date.now()
            });
        } finally {
            loadingSessionIds.current[currentSessionId] = false;
            if (activeSessionIdRef.current === currentSessionId) {
                setIsLoading(false);
            }
        }
    }, [remainingQuota, selectedModel, setActiveSessionId, setSessions]);

    return (
        <ChatContext.Provider value={{ 
            isOpen, 
            setIsOpen, 
            messages, 
            sendMessage, 
            isLoading, 
            remainingQuota, 
            selectedModel, 
            setSelectedModel,
            sessions,
            activeSessionId,
            createNewSession,
            switchSession,
            deleteSession,
            renameSession,
            isSidebarOpen,
            setIsSidebarOpen
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
